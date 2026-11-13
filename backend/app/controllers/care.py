"""Referrals, triage board, alerts and the doctor's queue."""

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.models import Alert, Appointment, Facility, Household, Person, Referral, User, Village
from app.services import referrals as refsvc
from app.services.fhir import referral_bundle
from app.services.packet import build_packet
from app.services.sync import referral_view

STAFF = ("anm", "medical_officer", "doctor")


def _block_village_ids(db: Session, user: User) -> list[str]:
    return list(db.scalars(select(Village.id).where(Village.block == user.block)))


def get_referral(db: Session, user: User, referral_id: str) -> Referral:
    r = db.get(Referral, referral_id)
    if r is None:
        raise HTTPException(404, "Referral not found")
    if user.role == "asha":
        if r.asha_id != user.id:
            raise HTTPException(403, "Not your referral")
        return r
    person = db.get(Person, r.person_id)
    household = db.get(Household, person.household_id)
    if household.village_id not in _block_village_ids(db, user):
        raise HTTPException(403, "Outside your block")
    return r


def _names(db: Session) -> dict[str, str]:
    return {f.id: f.name for f in db.scalars(select(Facility))}


def list_referrals(db: Session, user: User, status: str | None, include_closed: bool) -> list[dict]:
    q = (
        select(Referral, Person, Village)
        .join(Person, Person.id == Referral.person_id)
        .join(Household, Household.id == Person.household_id)
        .join(Village, Village.id == Household.village_id)
        .where(Village.block == user.block)
        .order_by(Referral.priority.desc(), Referral.created_at)
    )
    if user.role == "asha":
        q = q.where(Referral.asha_id == user.id)
    if status:
        q = q.where(Referral.status == status)
    elif not include_closed:
        q = q.where(Referral.status.in_(refsvc.OPEN + ("seen",)))
    names = _names(db)
    t = now()
    out = []
    for r, p, v in db.execute(q):
        view = referral_view(r, names)
        # Names stay out of district-level views (small-area privacy).
        view["person"] = {
            "name": None if user.role == "district_officer" else p.name,
            "age": t.year - p.birth_year,
            "sex": p.sex,
            "village": v.name,
        }
        view["lane"] = r.lane
        view["overdue"] = bool(r.due_at and r.due_at < t and r.status in refsvc.OPEN)
        out.append(view)
    return out


def transition(db: Session, user: User, referral_id: str, to: str, note: str | None, outcome: dict | None) -> dict:
    if user.role not in STAFF:
        raise HTTPException(403, "Only facility staff change referral status")
    if to in ("seen", "closed") and user.role not in ("doctor", "medical_officer"):
        raise HTTPException(403, "Only a doctor or medical officer records the visit")
    r = get_referral(db, user, referral_id)
    refsvc.transition(db, r, to, user, note, outcome)
    db.commit()
    return referral_view(r, _names(db))


def book(db: Session, user: User, referral_id: str, facility_id: str | None, mode: str | None) -> dict:
    r = get_referral(db, user, referral_id)
    facility = db.get(Facility, facility_id or r.facility_id)
    if facility is None:
        raise HTTPException(400, "No facility chosen")
    appt = refsvc.book(db, r, facility, mode or r.mode, user)
    db.commit()
    return {"referral": referral_view(r, _names(db)), "appointment_id": appt.id}


def set_lane(db: Session, user: User, referral_id: str, lane: str) -> dict:
    if user.role not in ("medical_officer", "doctor"):
        raise HTTPException(403, "Only the medical officer or doctor triages")
    r = get_referral(db, user, referral_id)
    r.lane = lane
    refsvc.audit(db, user, "referral.lane", "referral", r.id, lane=lane)
    db.commit()
    return {"id": r.id, "lane": r.lane}


def packet(db: Session, user: User, referral_id: str) -> dict:
    r = get_referral(db, user, referral_id)
    refsvc.audit(db, user, "packet.view", "referral", r.id)
    db.commit()
    return build_packet(db, r, include_identity=user.role != "district_officer")


def fhir(db: Session, user: User, referral_id: str) -> dict:
    if user.role not in STAFF:
        raise HTTPException(403, "Export is for facility staff")
    r = get_referral(db, user, referral_id)
    refsvc.audit(db, user, "fhir.export", "referral", r.id)
    db.commit()
    return referral_bundle(db, r)


def alerts(db: Session, user: User) -> list[dict]:
    q = select(Alert).where(Alert.acknowledged_at.is_(None))
    q = q.where((Alert.target_user_id == user.id) | ((Alert.target_role == user.role) & Alert.target_user_id.is_(None)))
    out = []
    for a in db.scalars(q.order_by(Alert.created_at.desc()).limit(100)):
        person_name = None
        if a.referral_id and user.role != "district_officer":
            r = db.get(Referral, a.referral_id)
            person = db.get(Person, r.person_id) if r else None
            person_name = person.name if person else None
        out.append({"id": a.id, "kind": a.kind, "level": a.level, "code": a.code, "referral_id": a.referral_id,
                    "person": person_name, "data": a.data, "created_at": a.created_at.isoformat() + "Z"})
    return out


def ack_alert(db: Session, user: User, alert_id: str) -> dict:
    a = db.get(Alert, alert_id)
    if a is None or not (a.target_user_id == user.id or a.target_role == user.role):
        raise HTTPException(404, "Alert not found")
    a.acknowledged_at = now()
    db.commit()
    return {"id": a.id}


def doctor_queue(db: Session, user: User) -> list[dict]:
    """Booked and recent appointments at the doctor's facility plus every teleconsult in the block."""
    t = now()
    tele_ids = list(db.scalars(select(Facility.id).where(Facility.block == user.block, Facility.kind == "tele_hub")))
    facility_ids = [i for i in [user.facility_id, *tele_ids] if i]
    q = (
        select(Appointment)
        .where(Appointment.facility_id.in_(facility_ids), Appointment.status.in_(("booked", "attended", "missed")),
               Appointment.slot_start >= t - timedelta(days=2), Appointment.slot_start <= t + timedelta(days=14))
        .order_by(Appointment.slot_start)
    )
    names = _names(db)
    out = []
    for a in db.scalars(q):
        r = db.get(Referral, a.referral_id)
        p = db.get(Person, r.person_id)
        out.append({
            "appointment_id": a.id,
            "slot_start": a.slot_start.isoformat() + "Z",
            "mode": a.mode,
            "meeting_url": a.meeting_url,
            "status": a.status,
            "facility": names.get(a.facility_id),
            "referral": {"id": r.id, "status": r.status, "urgency": r.urgency, "priority": r.priority, "reasons": r.reasons},
            "person": {"name": p.name, "age": t.year - p.birth_year, "sex": p.sex},
        })
    return out

"""Offline sync. The phone is the source of truth during a visit; the server applies its outbox.

Rules (blueprint "Offline rules"):
- Each event carries a client UUID; the server applies it once, so retries are always safe.
- Screenings are append-only. Demographics merge per field, last writer wins.
- Referral status belongs to the server; the phone only sends requests and notes.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import local_now, now
from app.core.config import get_settings
from app.ml.engine import score
from app.models import (
    Alert,
    Appointment,
    Consent,
    Facility,
    Household,
    Person,
    Referral,
    Screening,
    SyncEvent,
    SyndromeEvent,
    User,
    Village,
)
from app.integrations.abdm.abha import abha_service
from app.services import media as media_svc
from app.services import referrals as refsvc
from app.services.routing import from_model, route


class Rejected(Exception):
    pass


PERSON_FIELDS = ("name", "sex", "birth_year", "phone", "abha_number", "known_diabetes", "known_hypertension", "pregnant", "medications")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def _own_household(db: Session, user: User, household_id: str) -> Household:
    h = db.get(Household, household_id)
    if h is None or h.village_id not in (user.village_ids or []):
        raise Rejected("household outside jurisdiction")
    return h


def _own_person(db: Session, user: User, person_id: str) -> Person:
    p = db.get(Person, person_id)
    if p is None:
        raise Rejected("unknown person")
    _own_household(db, user, p.household_id)
    return p


# ---------------------------------------------------------------- appliers


def apply_household(db: Session, user: User, p: dict, _: datetime) -> dict:
    if p["village_id"] not in (user.village_ids or []):
        raise Rejected("village outside jurisdiction")
    h = db.get(Household, p["id"])
    if h is None:
        h = Household(id=p["id"], asha_id=user.id, village_id=p["village_id"], head_name=p["head_name"],
                      number=p.get("number", ""), lat=p["lat"], lon=p["lon"])
        db.add(h)
    else:
        for k in ("head_name", "number", "lat", "lon"):
            if k in p:
                setattr(h, k, p[k])
    return {"household_id": h.id}


def apply_person(db: Session, user: User, p: dict, at: datetime) -> dict:
    _own_household(db, user, p["household_id"])
    if p.get("abha_number"):
        check = abha_service().verify(p["abha_number"])
        if not check.valid:
            raise Rejected(check.reason or "invalid ABHA number")
        p = {**p, "abha_number": check.normalized}
    person = db.get(Person, p["id"])
    clock_in: dict = p.get("field_clock") or {}
    if person is None:
        person = Person(id=p["id"], household_id=p["household_id"], name=p["name"], sex=p["sex"], birth_year=p["birth_year"], field_clock={})
        db.add(person)
    clock = dict(person.field_clock or {})
    for field in PERSON_FIELDS:
        if field not in p:
            continue
        stamp = clock_in.get(field, at.isoformat())
        if stamp >= clock.get(field, ""):
            setattr(person, field, p[field])
            clock[field] = stamp
    person.field_clock = clock
    return {"person_id": person.id}


def apply_consent(db: Session, user: User, p: dict, at: datetime) -> dict:
    _own_person(db, user, p["person_id"])
    if db.get(Consent, p["id"]) is None:
        db.add(Consent(id=p["id"], person_id=p["person_id"], purpose=p["purpose"], method=p.get("method", "spoken_tap"),
                       granted=p["granted"], recorded_by=user.id, recorded_at=parse_ts(p.get("recorded_at", at.isoformat())),
                       language=p.get("language", "bn")))
    return {"consent_id": p["id"]}


def _comparable(result: dict | None) -> dict | None:
    if not result:
        return None
    return {
        "overall": result.get("overall"),
        "red_flags": result.get("red_flags"),
        "conditions": {k: (c.get("band"), c.get("score")) for k, c in (result.get("conditions") or {}).items()},
    }


def apply_screening(db: Session, user: User, p: dict, _: datetime) -> dict:
    person = _own_person(db, user, p["person_id"])
    if db.get(Screening, p["id"]):
        raise Rejected("screening already stored")
    has_consent = db.scalars(
        select(Consent).where(Consent.person_id == person.id, Consent.purpose == "screening", Consent.granted.is_(True),
                              Consent.withdrawn_at.is_(None))
    ).first()
    if not has_consent:
        raise Rejected("no screening consent on record")

    result = score(p["input"])
    client = p.get("client_result")
    mismatch = client is not None and _comparable(client) != _comparable(result)
    s = Screening(
        id=p["id"], person_id=person.id, asha_id=user.id, device_id=p.get("device_id", "unknown"),
        captured_at=parse_ts(p["captured_at"]), input=p["input"], result=result, client_result=client,
        engine_version=result["engine_version"], client_engine_version=p.get("client_engine_version"),
        score_mismatch=mismatch, urgency=result["overall"]["urgency"], priority=result["overall"]["priority"],
        override=p.get("override"),
    )
    db.add(s)
    db.flush()
    if mismatch:
        refsvc.raise_alert(db, "score_mismatch", "warning", "district_officer", "score_mismatch", screening_id=s.id)

    out: dict = {"screening_id": s.id, "urgency": s.urgency, "priority": s.priority, "score_mismatch": mismatch}
    override = p.get("override") or {}
    refer = result["overall"]["refer"] and override.get("decision") != "no_referral"
    if override.get("decision") == "refer":
        refer = True
    if not refer:
        return out

    household = db.get(Household, person.household_id)
    facilities = [from_model(f) for f in db.scalars(select(Facility).where(Facility.block == user.block))]
    routing = route(facilities, household.lat, household.lon, result["overall"]["needs"] or ["ncd_clinic"],
                    result["overall"]["urgency"], local_now(), get_settings().max_travel_minutes)
    r = refsvc.create_or_update(db, s, user, routing)
    out["referral_id"] = r.id
    out["routing"] = routing

    booking = p.get("booking")
    if booking and r.status in ("flagged", "acknowledged", "missed"):
        facility = db.get(Facility, booking.get("facility_id") or r.facility_id)
        if facility is not None:
            appt = refsvc.book(db, r, facility, booking.get("mode", r.mode), user)
            out["appointment"] = {"id": appt.id, "slot_start": appt.slot_start.isoformat() + "Z", "mode": appt.mode,
                                  "meeting_url": appt.meeting_url, "facility": facility.name}
    return out


def apply_referral_note(db: Session, user: User, p: dict, _: datetime) -> dict:
    r = db.get(Referral, p["referral_id"])
    if r is None or r.asha_id != user.id:
        raise Rejected("referral not yours")
    action = p["action"]  # reached | not_home | refused | moved | reminded
    if action in ("refused", "moved") and r.status in refsvc.OPEN:
        refsvc.transition(db, r, "cancelled", user, note=f"{action}: {p.get('note') or ''}".strip())
    elif action == "rebook" and r.status in ("missed", "flagged", "acknowledged"):
        facility = db.get(Facility, p.get("facility_id") or r.facility_id)
        refsvc.book(db, r, facility, p.get("mode", r.mode), user)
    else:
        refsvc._event(db, r, r.status, r.status, user, f"asha:{action} {p.get('note') or ''}".strip())
    return {"referral_id": r.id, "status": r.status}


def apply_voice_note(db: Session, user: User, p: dict, _: datetime) -> dict:
    r = db.get(Referral, p["referral_id"])
    if r is None or r.asha_id != user.id:
        raise Rejected("referral not yours")
    try:
        m = media_svc.store_voice_note(db, user, r, p["id"], p["mime"], p["data_base64"], p.get("duration_ms", 0))
    except media_svc.MediaError as exc:
        raise Rejected(str(exc)) from exc
    refsvc._event(db, r, r.status, r.status, user, "asha:voice_note")
    return {"media_id": m.id}


def apply_syndrome(db: Session, user: User, p: dict, _: datetime) -> dict:
    if p["village_id"] not in (user.village_ids or []):
        raise Rejected("village outside jurisdiction")
    db.add(SyndromeEvent(id=p["id"], village_id=p["village_id"], syndrome=p["syndrome"], day=date.fromisoformat(p["day"]),
                         count=int(p.get("count", 1)), reported_by=user.id))
    return {"ok": True}


def apply_facility_verify(db: Session, user: User, p: dict, _: datetime) -> dict:
    f = db.get(Facility, p["facility_id"])
    if f is None or f.block != user.block:
        raise Rejected("facility outside block")
    for k in ("staffed", "opens", "closes"):
        if k in p:
            setattr(f, k, p[k])
    f.last_verified_at = now()
    return {"facility_id": f.id}


APPLIERS = {
    "household.upsert": apply_household,
    "person.upsert": apply_person,
    "consent.record": apply_consent,
    "screening.create": apply_screening,
    "referral.note": apply_referral_note,
    "referral.voice_note": apply_voice_note,
    "syndrome.report": apply_syndrome,
    "facility.verify": apply_facility_verify,
}
# Apply parents before children when a batch arrives out of order.
ORDER = {t: i for i, t in enumerate(APPLIERS)}


def push(db: Session, user: User, device_id: str, events: list[dict]) -> list[dict]:
    results = []
    for ev in sorted(events, key=lambda e: (e["created_at"], ORDER.get(e["type"], 99))):
        seen = db.get(SyncEvent, ev["id"])
        if seen is not None:
            results.append({"id": ev["id"], "status": "duplicate", "result": seen.result, "error": seen.error})
            continue
        applier = APPLIERS.get(ev["type"])
        created = parse_ts(ev["created_at"])
        try:
            if applier is None:
                raise Rejected(f"unknown event type {ev['type']}")
            with db.begin_nested():
                result = applier(db, user, {**ev["payload"], "device_id": device_id}, created)
            status, error = "applied", None
        except Rejected as exc:
            result, status, error = None, "rejected", str(exc)
        except Exception as exc:  # a malformed event must not block the rest of the outbox
            result, status, error = None, "rejected", f"error: {exc.__class__.__name__}"
        db.add(SyncEvent(id=ev["id"], device_id=device_id, user_id=user.id, type=ev["type"], client_created_at=created,
                         status=status, error=error, result=result))
        db.commit()
        results.append({"id": ev["id"], "status": status, "result": result, "error": error})
    return results


# ---------------------------------------------------------------- pull


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


def referral_view(r: Referral, facility_names: dict[str, str]) -> dict:
    appts = [a for a in r.appointments if a.status in ("booked", "attended", "missed")]
    appt: Appointment | None = appts[-1] if appts else None
    return {
        "id": r.id,
        "person_id": r.person_id,
        "status": r.status,
        "urgency": r.urgency,
        "priority": r.priority,
        "reasons": r.reasons,
        "facility_id": r.facility_id,
        "facility_name": facility_names.get(r.facility_id or "", None),
        "mode": r.mode,
        "routing": r.routing,
        "escalation_level": r.escalation_level,
        "due_at": _iso(r.due_at),
        "created_at": _iso(r.created_at),
        "acknowledged_at": _iso(r.acknowledged_at),
        "booked_at": _iso(r.booked_at),
        "seen_at": _iso(r.seen_at),
        "closed_at": _iso(r.closed_at),
        "outcome": r.outcome,
        "appointment": {
            "slot_start": _iso(appt.slot_start), "mode": appt.mode, "meeting_url": appt.meeting_url, "status": appt.status,
        } if appt else None,
        "updated_at": _iso(r.updated_at),
    }


def pull(db: Session, user: User, since: datetime | None) -> dict:
    villages = db.scalars(select(Village).where(Village.id.in_(user.village_ids or []))).all()
    households = db.scalars(select(Household).where(Household.village_id.in_(user.village_ids or []))).all()
    hh_ids = [h.id for h in households]
    persons = db.scalars(select(Person).where(Person.household_id.in_(hh_ids))).all() if hh_ids else []
    person_ids = [p.id for p in persons]
    facilities = db.scalars(select(Facility).where(Facility.block == user.block)).all()
    names = {f.id: f.name for f in facilities}

    ref_q = select(Referral).where(Referral.person_id.in_(person_ids)) if person_ids else None
    if ref_q is not None and since is not None:
        ref_q = ref_q.where(Referral.updated_at >= since)
    refs = db.scalars(ref_q).all() if ref_q is not None else []

    # Latest screening summary per person, for the Today list and coverage ring.
    latest: dict[str, Screening] = {}
    if person_ids:
        for s in db.scalars(select(Screening).where(Screening.person_id.in_(person_ids)).order_by(Screening.captured_at)):
            latest[s.person_id] = s

    alerts = db.scalars(
        select(Alert).where(Alert.target_user_id == user.id, Alert.acknowledged_at.is_(None)).order_by(Alert.created_at.desc()).limit(50)
    ).all()
    names_by_referral = {r.id: p.name for r in db.scalars(select(Referral).where(Referral.id.in_([a.referral_id for a in alerts if a.referral_id])))
                          for p in [db.get(Person, r.person_id)] if p}
    return {
        "server_time": _iso(now()),
        "full": since is None,
        "villages": [{"id": v.id, "name": v.name, "lat": v.lat, "lon": v.lon, "population_30plus": v.population_30plus} for v in villages],
        "households": [
            {"id": h.id, "village_id": h.village_id, "head_name": h.head_name, "number": h.number, "lat": h.lat, "lon": h.lon,
             "updated_at": _iso(h.updated_at)}
            for h in households if since is None or h.updated_at >= since
        ],
        "persons": [
            {"id": p.id, "household_id": p.household_id, **{f: getattr(p, f) for f in PERSON_FIELDS}, "updated_at": _iso(p.updated_at)}
            for p in persons if since is None or p.updated_at >= since
        ],
        "screenings": [
            {"id": s.id, "person_id": s.person_id, "captured_at": _iso(s.captured_at), "urgency": s.urgency, "priority": s.priority,
             "result": s.result}
            for s in latest.values() if since is None or s.created_at >= since
        ],
        "referrals": [referral_view(r, names) for r in refs],
        "facilities": [
            {"id": f.id, "name": f.name, "kind": f.kind, "lat": f.lat, "lon": f.lon, "capabilities": f.capabilities, "opens": f.opens,
             "closes": f.closes, "days": f.days, "open_24x7": f.open_24x7, "staffed": f.staffed, "phone": f.phone,
             "last_verified_at": _iso(f.last_verified_at)}
            for f in facilities
        ],
        "alerts": [{"id": a.id, "kind": a.kind, "level": a.level, "code": a.code, "referral_id": a.referral_id,
                    "data": {**(a.data or {}), "person": names_by_referral.get(a.referral_id or "")}, "created_at": _iso(a.created_at)}
                   for a in alerts],
    }

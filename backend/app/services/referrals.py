"""The loop-closure engine: a server-owned state machine with a deadline on every step.

flagged → acknowledged → booked → seen → closed
                           ↘ missed → booked (no-show rescue)
Any open state can be cancelled (patient refused, moved away, died) with a reason.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import local_now, now
from app.core.config import get_settings
from app.models import Alert, Appointment, AuditLog, Facility, Person, Referral, ReferralEvent, Screening, User

OPEN = ("flagged", "acknowledged", "booked", "missed")
TRANSITIONS: dict[str, set[str]] = {
    "flagged": {"acknowledged", "booked", "cancelled"},
    "acknowledged": {"booked", "cancelled"},
    "booked": {"booked", "seen", "missed", "cancelled"},
    # A patient marked as a no-show often arrives late the same day, or takes the teleconsult
    # later: the visit is recorded against the missed appointment rather than lost.
    "missed": {"booked", "seen", "cancelled"},
    "seen": {"closed"},
    "closed": set(),
    "cancelled": set(),
}
# Hours allowed to acknowledge a new flag, by urgency.
ACK_HOURS = {"emergency": 1, "urgent": 4, "soon": 48, "routine": 168}
BOOK_HOURS = {"emergency": 2, "urgent": 12, "soon": 72, "routine": 168}
LANE = {"emergency": "urgent", "urgent": "urgent", "soon": "this_week", "routine": "monitor"}
RANK = {"routine": 0, "soon": 1, "urgent": 2, "emergency": 3}


def audit(db: Session, actor: User | None, action: str, entity: str, entity_id: str, **data) -> None:
    db.add(AuditLog(actor_id=actor.id if actor else None, action=action, entity=entity, entity_id=entity_id, data=data))


def raise_alert(db: Session, kind: str, level: str, target_role: str, code: str, *, referral: Referral | None = None,
                facility_id: str | None = None, target_user_id: str | None = None, **data) -> Alert:
    alert = Alert(
        kind=kind,
        level=level,
        target_role=target_role,
        target_user_id=target_user_id,
        facility_id=facility_id or (referral.facility_id if referral else None),
        referral_id=referral.id if referral else None,
        code=code,
        data=data,
    )
    db.add(alert)
    return alert


def _event(db: Session, r: Referral, from_status: str | None, to_status: str, actor: User | None, note: str | None = None) -> None:
    db.add(ReferralEvent(referral_id=r.id, from_status=from_status, to_status=to_status, actor_id=actor.id if actor else None, note=note))


def open_referral_for(db: Session, person_id: str) -> Referral | None:
    return db.scalars(
        select(Referral).where(Referral.person_id == person_id, Referral.status.in_(OPEN)).order_by(Referral.created_at.desc())
    ).first()


def create_or_update(db: Session, screening: Screening, asha: User, routing: dict | None) -> Referral:
    """One open referral per person: a new screening raises its urgency instead of duplicating it."""
    result = screening.result
    urgency = result["overall"]["urgency"]
    existing = open_referral_for(db, screening.person_id)
    if existing:
        if RANK[urgency] > RANK[existing.urgency]:
            existing.urgency, existing.lane = urgency, LANE[urgency]
            existing.due_at = now() + timedelta(hours=ACK_HOURS[urgency])
        existing.priority = max(existing.priority, result["overall"]["priority"])
        existing.reasons = sorted(set(existing.reasons) | set(result["overall"]["reasons"]))
        existing.screening_id = screening.id
        _event(db, existing, existing.status, existing.status, asha, "rescreened")
        return existing

    r = Referral(
        person_id=screening.person_id,
        screening_id=screening.id,
        asha_id=asha.id,
        status="flagged",
        urgency=urgency,
        priority=result["overall"]["priority"],
        lane=LANE[urgency],
        reasons=result["overall"]["reasons"],
        needs=result["overall"]["needs"],
        facility_id=routing["facility_id"] if routing else None,
        mode=routing["mode"] if routing else "in_person",
        routing=routing,
        due_at=now() + timedelta(hours=ACK_HOURS[urgency]),
    )
    db.add(r)
    db.flush()
    _event(db, r, None, "flagged", asha)
    level = "critical" if urgency in ("emergency", "urgent") else "info"
    kind = "emergency" if urgency == "emergency" else "new_flag"
    for role in ("medical_officer", "anm"):
        raise_alert(db, kind, level, role, f"{kind}_{urgency}", referral=r, priority=r.priority)
    if urgency == "emergency":
        from app.services.notifications import on_emergency  # deferred: notifications imports this module

        on_emergency(db, r)
    audit(db, asha, "referral.flagged", "referral", r.id, urgency=urgency)
    return r


def transition(db: Session, r: Referral, to: str, actor: User | None, note: str | None = None, outcome: dict | None = None) -> Referral:
    if to not in TRANSITIONS.get(r.status, set()):
        raise HTTPException(409, f"Cannot move a referral from {r.status} to {to}")
    t = now()
    previous = r.status
    r.status = to
    if to == "acknowledged":
        r.acknowledged_at = t
        r.due_at = t + timedelta(hours=BOOK_HOURS[r.urgency])
    elif to == "booked":
        r.acknowledged_at = r.acknowledged_at or t
        r.booked_at = t
    elif to == "seen":
        r.seen_at = t
        r.outcome = outcome or {}
        r.due_at = t + timedelta(hours=72)
        for a in r.appointments:
            if a.status == "booked":
                a.status = "attended"
        if previous == "missed":
            late = max((a for a in r.appointments if a.status == "missed"), key=lambda a: a.slot_start, default=None)
            if late:
                late.status = "attended"
    elif to == "closed":
        r.closed_at = t
        r.due_at = None
        if outcome:
            r.outcome = {**(r.outcome or {}), **outcome}
    elif to == "missed":
        r.missed_count += 1
        r.due_at = t + timedelta(hours=48)
    elif to == "cancelled":
        r.due_at = None
    if to in ("seen", "closed", "cancelled"):
        r.escalation_level = 0
    _event(db, r, previous, to, actor, note)
    audit(db, actor, f"referral.{to}", "referral", r.id)
    return r


# ---------------------------------------------------------------- booking

SLOT_MINUTES = 15


def _hm(value: str) -> tuple[int, int]:
    h, m = value.split(":")
    return int(h), int(m)


OPD_HOURS = ("09:00", "16:00")


def next_free_slot(db: Session, facility: Facility, earliest_local: datetime, opd_only: bool = True) -> tuple[datetime, datetime]:
    """First 15-minute slot (local time) with capacity left, up to two weeks out; returned in UTC.
    A 24x7 facility takes emergencies round the clock, but routine visits go to its OPD hours."""
    offset = timedelta(minutes=get_settings().local_utc_offset_minutes)
    round_the_clock = facility.open_24x7 and not opd_only
    opens, closes = OPD_HOURS if facility.open_24x7 and opd_only else (facility.opens, facility.closes)
    days = range(7) if facility.open_24x7 else (facility.days or [])
    for d in range(15):
        day = (earliest_local + timedelta(days=d)).replace(second=0, microsecond=0)
        if day.weekday() not in days or (facility.open_24x7 and opd_only and day.weekday() == 6):
            continue
        oh, om = (0, 0) if round_the_clock else _hm(opens)
        ch, cm = (23, 45) if round_the_clock else _hm(closes)
        start = day.replace(hour=oh, minute=om)
        close = day.replace(hour=ch, minute=cm)
        day_utc = (start - offset, close - offset)
        booked = db.scalars(
            select(Appointment.slot_start).where(
                Appointment.facility_id == facility.id,
                Appointment.status != "cancelled",
                Appointment.slot_start >= day_utc[0],
                Appointment.slot_start < day_utc[1],
            )
        ).all()
        if len(booked) >= facility.daily_slots:
            continue
        taken = {b.replace(second=0, microsecond=0) for b in booked}
        slot = start
        while slot + timedelta(minutes=SLOT_MINUTES) <= close:
            if slot >= earliest_local and (slot - offset) not in taken:
                return slot - offset, slot - offset + timedelta(minutes=SLOT_MINUTES)
            slot += timedelta(minutes=SLOT_MINUTES)
    raise HTTPException(409, "No free slot in the next two weeks")


def book(db: Session, r: Referral, facility: Facility, mode: str, actor: User | None) -> Appointment:
    lead = timedelta(minutes=30) if r.urgency in ("emergency", "urgent") else timedelta(hours=2)
    start, end = next_free_slot(db, facility, local_now() + lead, opd_only=r.urgency != "emergency")
    doctor = db.scalars(select(User).where(User.role == "doctor", User.facility_id == facility.id)).first()
    meeting = None
    if mode == "teleconsult":
        # Audio-first: video starts muted so a weak connection still carries the consult.
        meeting = f"{get_settings().jitsi_base_url}/PranaMap-{r.id[:8]}#config.startWithVideoMuted=true"
    for a in r.appointments:
        if a.status == "booked":
            a.status = "cancelled"
    appt = Appointment(
        referral_id=r.id, facility_id=facility.id, doctor_id=doctor.id if doctor else None,
        mode=mode, slot_start=start, slot_end=end, meeting_url=meeting,
    )
    db.add(appt)
    r.facility_id, r.mode = facility.id, mode
    transition(db, r, "booked", actor, note=f"slot {start.isoformat()}Z")
    r.due_at = end + timedelta(hours=24)
    db.flush()
    db.refresh(r)
    return appt


# ---------------------------------------------------------------- escalation ladder

LADDER = {1: "asha", 2: "medical_officer", 3: "district_officer"}


def run_escalations(db: Session) -> int:
    """Called by the worker. Overdue steps climb the ladder; passed appointments become no-shows."""
    t = now()
    changed = 0

    # No-shows: booked appointments whose slot ended more than a day ago without a visit.
    for appt in db.scalars(select(Appointment).where(Appointment.status == "booked", Appointment.slot_end < t - timedelta(hours=24))):
        r = db.get(Referral, appt.referral_id)
        if r is None or r.status != "booked":
            continue
        appt.status = "missed"
        transition(db, r, "missed", None, note="no-show")
        from app.services.notifications import on_missed

        on_missed(db, r, appt)
        person = db.get(Person, r.person_id)
        raise_alert(db, "no_show", "warning", "asha", "no_show_rescue", referral=r, target_user_id=r.asha_id,
                    person=person.name if person else None)
        changed += 1

    overdue = db.scalars(select(Referral).where(Referral.status.in_(OPEN), Referral.due_at.is_not(None), Referral.due_at < t))
    for r in overdue:
        level = min(3, r.escalation_level + 1)
        r.escalation_level = level
        r.due_at = t + timedelta(hours=24)
        role = LADDER[level]
        raise_alert(db, "escalation", "critical" if level >= 2 else "warning", role, f"escalation_l{level}",
                    referral=r, target_user_id=r.asha_id if role == "asha" else None, status=r.status, urgency=r.urgency)
        _event(db, r, r.status, r.status, None, f"escalated to level {level}")
        changed += 1
    db.commit()
    return changed

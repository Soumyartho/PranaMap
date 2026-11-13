"""Outbound messages: queue, consent check, idempotent scheduling, dispatch with retries.

Rules:
- A patient is messaged only with a phone number and a granted, unwithdrawn consent.
- Every message has a dedupe key, so a retried job never sends twice.
- Failures back off exponentially (2, 4, 8 … minutes); non-retryable errors stop at once.
- Message text is rendered at send time from a registered template; the table stores no phone.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import now
from app.core.config import get_settings
from app.integrations.messaging.providers import OutboundMessage, ProviderError, sms_provider, whatsapp_provider
from app.integrations.messaging.templates import TEMPLATES, render
from app.models import Appointment, Consent, Facility, Household, Notification, Person, Referral, User

MAX_ATTEMPTS = 5


def e164(phone: str | None) -> str | None:
    """Indian mobile numbers to +91XXXXXXXXXX; anything unusable becomes None."""
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10 and digits[0] in "6789":
        return "+91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return None


def mask(phone: str | None) -> str | None:
    return None if not phone else "•" * max(0, len(phone) - 4) + phone[-4:]


def has_contact_consent(db: Session, person_id: str) -> bool:
    return db.scalars(
        select(Consent.id).where(
            Consent.person_id == person_id, Consent.purpose.in_(("screening", "messages")),
            Consent.granted.is_(True), Consent.withdrawn_at.is_(None),
        )
    ).first() is not None


def enqueue(db: Session, *, dedupe_key: str, template: str, recipient_type: str, recipient_id: str, values: dict,
            lang: str = "bn", channel: str = "sms", referral_id: str | None = None, at=None) -> Notification | None:  # noqa: ANN001
    """Queue a message once. Returns None if this dedupe key was already queued."""
    if template not in TEMPLATES:
        raise ValueError(f"unknown template {template}")
    n = Notification(
        dedupe_key=dedupe_key, template=template, channel=channel, recipient_type=recipient_type, recipient_id=recipient_id,
        lang=lang, values=values, referral_id=referral_id, status="queued", next_attempt_at=at or now(),
    )
    try:
        with db.begin_nested():
            db.add(n)
            db.flush()
    except IntegrityError:
        return None
    return n


def _recipient_phone(db: Session, n: Notification) -> tuple[str | None, str | None]:
    """(phone, reason it cannot be sent)."""
    if n.recipient_type == "person":
        p = db.get(Person, n.recipient_id)
        if p is None:
            return None, "person not found"
        if not has_contact_consent(db, p.id):
            return None, "no consent to contact"
        phone = e164(p.phone)
        return (phone, None) if phone else (None, "no valid phone")
    u = db.get(User, n.recipient_id)
    phone = e164(u.phone) if u else None
    return (phone, None) if phone else (None, "no valid phone")


def dispatch_due(db: Session, limit: int = 50, providers: dict | None = None) -> int:
    """Send queued messages whose time has come. `providers` lets tests inject transports."""
    t = now()
    providers = providers or {"sms": sms_provider(), "whatsapp": whatsapp_provider()}
    due = db.scalars(
        select(Notification).where(Notification.status == "queued", Notification.next_attempt_at <= t)
        .order_by(Notification.next_attempt_at).limit(limit)
    ).all()
    for n in due:
        phone, reason = _recipient_phone(db, n)
        if reason:
            n.status, n.error = "skipped", reason
            continue
        text, params = render(n.template, n.lang, n.values)
        spec = TEMPLATES[n.template]
        msg = OutboundMessage(to=phone, body=text, channel=n.channel, template=n.template, dlt_template_id=spec["dlt_template_id"] or None,
                              whatsapp_template=spec["whatsapp_template"], lang=n.lang, params=params)
        n.attempts += 1
        try:
            result = providers[n.channel].send(msg)
            n.status, n.provider, n.provider_id, n.sent_at, n.error = result.status, result.provider, result.provider_id, now(), None
        except ProviderError as exc:
            n.error = str(exc)[:255]
            if exc.retryable and n.attempts < MAX_ATTEMPTS:
                n.next_attempt_at = t + timedelta(minutes=2 ** n.attempts)
            else:
                n.status = "failed"
    db.commit()
    return len(due)


# ---------------------------------------------------------------- triggers


def _asha_name(db: Session, r: Referral) -> str:
    u = db.get(User, r.asha_id)
    return u.name.split(" ")[0] if u else "ASHA"


def schedule_reminders(db: Session) -> int:
    """One reminder per booked appointment, `reminder_hours_before` before the slot."""
    s = get_settings()
    t = now()
    horizon = t + timedelta(hours=s.reminder_hours_before)
    count = 0
    for a in db.scalars(select(Appointment).where(Appointment.status == "booked", Appointment.slot_start > t, Appointment.slot_start <= horizon)):
        r = db.get(Referral, a.referral_id)
        if r is None:
            continue
        local = a.slot_start + timedelta(minutes=s.local_utc_offset_minutes)
        when = local.strftime("%d %b %H:%M")
        if a.mode == "teleconsult":
            template, values = "teleconsult_reminder", {"date": when, "asha": _asha_name(db, r)}
        else:
            f = db.get(Facility, a.facility_id)
            template, values = "appointment_reminder", {"facility": f.name if f else "PHC", "date": when, "asha": _asha_name(db, r)}
        lang = (db.get(User, r.asha_id).language if db.get(User, r.asha_id) else "bn")
        if enqueue(db, dedupe_key=f"reminder:{a.id}", template=template, recipient_type="person", recipient_id=r.person_id,
                   values=values, lang=lang, channel=s.patient_channel, referral_id=r.id):
            count += 1
    db.commit()
    return count


def on_missed(db: Session, r: Referral, appt: Appointment) -> None:
    f = db.get(Facility, appt.facility_id)
    asha = db.get(User, r.asha_id)
    enqueue(db, dedupe_key=f"missed:{appt.id}", template="missed_visit", recipient_type="person", recipient_id=r.person_id,
            values={"facility": f.name if f else "PHC", "asha": _asha_name(db, r)}, lang=asha.language if asha else "bn",
            channel=get_settings().patient_channel, referral_id=r.id)


def on_emergency(db: Session, r: Referral) -> None:
    """SMS every ANM of the block at once; the in-app alert may not be seen in time."""
    person = db.get(Person, r.person_id)
    house = db.get(Household, person.household_id) if person else None
    asha = db.get(User, r.asha_id)
    if not person or not asha:
        return
    for anm in db.scalars(select(User).where(User.role == "anm", User.block == asha.block)):
        enqueue(db, dedupe_key=f"emergency:{r.id}:{anm.id}", template="emergency_anm", recipient_type="user", recipient_id=anm.id,
                values={"person": person.name, "asha": asha.name, "house": house.number if house else ""}, lang=anm.language,
                channel="sms", referral_id=r.id)


def recent(db: Session, user: User, limit: int = 40) -> list[dict]:
    rows = db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(limit)).all()
    out = []
    for n in rows:
        who = db.get(Person, n.recipient_id) if n.recipient_type == "person" else db.get(User, n.recipient_id)
        out.append({
            "id": n.id, "template": n.template, "channel": n.channel, "status": n.status, "attempts": n.attempts,
            "provider": n.provider, "error": n.error, "to": mask(e164(getattr(who, "phone", None))),
            "recipient": None if user.role == "district_officer" else getattr(who, "name", None),
            "created_at": n.created_at.isoformat() + "Z", "sent_at": n.sent_at.isoformat() + "Z" if n.sent_at else None,
            "key": hashlib.sha1(n.dedupe_key.encode()).hexdigest()[:8],
        })
    return out

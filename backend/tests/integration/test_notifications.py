"""Notification pipeline on the seeded block: reminders, consent, idempotency, retries."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import clock
from app.integrations.messaging.providers import ConsoleProvider, ProviderError
from app.models import Consent, Notification, Person, User

CONSOLE = {"sms": ConsoleProvider(), "whatsapp": ConsoleProvider()}


@pytest.fixture(scope="module")
def db():
    from scripts.seed_synthetic import main as seed

    seed()
    from app.db.session import SessionLocal

    with SessionLocal() as s:
        yield s
    clock.reset()


def test_reminders_are_scheduled_exactly_once(db):
    from app.services.notifications import schedule_reminders

    first = schedule_reminders(db)
    assert first > 0, "the seed books teleconsults within the next day"
    assert schedule_reminders(db) == 0


def test_dispatch_sends_or_skips_with_a_reason(db):
    from app.services.notifications import dispatch_due

    dispatch_due(db, limit=500, providers=CONSOLE)
    rows = db.scalars(select(Notification)).all()
    assert rows and {n.status for n in rows} <= {"simulated", "skipped"}
    assert all(n.error in ("no valid phone", "no consent to contact") for n in rows if n.status == "skipped")


def test_withdrawn_consent_blocks_messages(db):
    from app.services.notifications import dispatch_due, enqueue

    p = db.scalars(select(Person).where(Person.phone.is_not(None))).first()
    for c in db.scalars(select(Consent).where(Consent.person_id == p.id)):
        c.withdrawn_at = clock.now()
    n = enqueue(db, dedupe_key=f"test:{p.id}", template="missed_visit", recipient_type="person", recipient_id=p.id,
                values={"facility": "PHC", "asha": "Rina"})
    db.commit()
    dispatch_due(db, providers=CONSOLE)
    db.refresh(n)
    assert n.status == "skipped" and n.error == "no consent to contact"


def test_duplicate_keys_are_ignored(db):
    from app.services.notifications import enqueue

    user = db.scalars(select(User).where(User.role == "anm")).first()
    args = dict(template="emergency_anm", recipient_type="user", recipient_id=user.id, values={"person": "X", "asha": "Y", "house": "Z"})
    assert enqueue(db, dedupe_key="test:dup", **args) is not None
    assert enqueue(db, dedupe_key="test:dup", **args) is None


def test_retries_back_off_then_fail(db):
    from app.services.notifications import MAX_ATTEMPTS, dispatch_due, enqueue

    class Down:
        def send(self, m):
            raise ProviderError("503", retryable=True)

    user = db.scalars(select(User).where(User.role == "anm")).first()
    n = enqueue(db, dedupe_key="test:retry", template="emergency_anm", recipient_type="user", recipient_id=user.id,
                values={"person": "X", "asha": "Y", "house": "Z"})
    db.commit()
    gaps = []
    for _ in range(MAX_ATTEMPTS):
        n.next_attempt_at = clock.now() - timedelta(seconds=1)
        db.commit()
        dispatch_due(db, providers={"sms": Down(), "whatsapp": Down()})
        db.refresh(n)
        if n.status == "queued":
            gaps.append((n.next_attempt_at - clock.now()).total_seconds())
    assert n.status == "failed" and n.attempts == MAX_ATTEMPTS
    assert gaps == sorted(gaps)  # each wait is longer than the last


def test_emergency_referral_texts_the_anms(db):
    """End to end through the loop: an emergency screening creates an SMS to every ANM in the block."""
    from app.models import Screening
    from app.services.referrals import create_or_update

    s = db.scalars(select(Screening).where(Screening.urgency == "emergency")).first()
    asha = db.get(User, s.asha_id)
    from app.models import Referral

    for r in db.scalars(select(Referral).where(Referral.person_id == s.person_id)):
        r.status = "closed"
    db.flush()
    r = create_or_update(db, s, asha, None)
    db.commit()
    texts = db.scalars(select(Notification).where(Notification.referral_id == r.id, Notification.template == "emergency_anm")).all()
    assert len(texts) == db.query(User).filter_by(role="anm").count()

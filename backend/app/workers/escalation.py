"""Background loop that keeps the escalation ladder moving.

A plain asyncio task inside the API process is enough for a pilot; swap for Celery/Arq with
Redis when there is more than one API instance.
"""

import asyncio
import logging

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.media import purge_expired
from app.services.notifications import dispatch_due, schedule_reminders
from app.services.referrals import run_escalations

log = logging.getLogger("pranamap.escalation")


def tick() -> int:
    """One pass of the loop-closure machinery: escalate, schedule reminders, send due messages."""
    with SessionLocal() as db:
        changed = run_escalations(db)
        schedule_reminders(db)
        dispatch_due(db)
        purge_expired(db)
        return changed


async def loop() -> None:
    interval = get_settings().escalation_interval_seconds
    while True:
        try:
            changed = await asyncio.to_thread(tick)
            if changed:
                log.info("escalation tick: %d referrals changed", changed)
        except Exception:  # keep the loop alive; the next tick retries
            log.exception("escalation tick failed")
        await asyncio.sleep(interval)

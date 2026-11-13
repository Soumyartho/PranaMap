"""One clock for the whole backend, so a demo can fast-forward time to show escalations."""

import calendar
from datetime import UTC, datetime, timedelta

from .config import get_settings

_offset = timedelta(0)


def now() -> datetime:
    """Naive UTC (SQLite stores no time zone)."""
    return datetime.now(UTC).replace(tzinfo=None) + _offset


def epoch(at: datetime | None = None) -> int:
    """Seconds since 1970 for a naive-UTC datetime (datetime.timestamp() would assume local time)."""
    return calendar.timegm((at or now()).utctimetuple())


def local_now() -> datetime:
    return now() + timedelta(minutes=get_settings().local_utc_offset_minutes)


def advance(hours: float) -> timedelta:
    global _offset
    _offset += timedelta(hours=hours)
    return _offset


def reset() -> None:
    global _offset
    _offset = timedelta(0)


def offset_hours() -> float:
    return _offset.total_seconds() / 3600

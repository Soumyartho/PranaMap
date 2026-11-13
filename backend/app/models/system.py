from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

from ._types import PK, Created, Json


class SyncEvent(Base):
    """Every outbox event the server has seen, keyed by the phone's own ID: retries are no-ops."""

    __tablename__ = "sync_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(32))
    client_created_at: Mapped[datetime] = mapped_column(DateTime)
    received_at: Mapped[Created]
    # applied | rejected
    status: Mapped[str] = mapped_column(String(12))
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result: Mapped[Json] = mapped_column(nullable=True)


class AuditLog(Base):
    """Append-only. No personal data in `data` beyond IDs."""

    __tablename__ = "audit_log"

    id: Mapped[PK]
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(48), index=True)
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    data: Mapped[Json] = mapped_column(default=dict)
    at: Mapped[Created]


class Notification(Base):
    """One outbound message. Stores who it is for, never the phone number itself: the number is
    resolved from the person or user at send time, so this table holds no copied PII."""

    __tablename__ = "notifications"

    id: Mapped[PK]
    # Idempotency: one reminder per appointment, one alert per emergency.
    dedupe_key: Mapped[str] = mapped_column(String(96), unique=True)
    template: Mapped[str] = mapped_column(String(48))
    channel: Mapped[str] = mapped_column(String(12))  # sms | whatsapp
    recipient_type: Mapped[str] = mapped_column(String(8))  # person | user
    recipient_id: Mapped[str] = mapped_column(String(36), index=True)
    lang: Mapped[str] = mapped_column(String(8), default="bn")
    values: Mapped[Json] = mapped_column(default=dict)
    referral_id: Mapped[str | None] = mapped_column(ForeignKey("referrals.id"), nullable=True, index=True)
    # queued | sent | simulated | failed | skipped
    status: Mapped[str] = mapped_column(String(12), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[Created]
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

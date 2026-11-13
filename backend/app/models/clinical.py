from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

from ._types import PK, Created, Json


class Screening(Base):
    """Append-only: two screenings are two rows, never an overwrite."""

    __tablename__ = "screenings"

    id: Mapped[PK]
    person_id: Mapped[str] = mapped_column(ForeignKey("persons.id"), index=True)
    asha_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[str] = mapped_column(String(64))
    captured_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    input: Mapped[Json]
    # Server re-score (the audit copy) and what the phone showed.
    result: Mapped[Json]
    client_result: Mapped[Json] = mapped_column(nullable=True)
    engine_version: Mapped[str] = mapped_column(String(16))
    client_engine_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # True when the phone's score differed from the server's: a bug, never silently ignored.
    score_mismatch: Mapped[bool] = mapped_column(Boolean, default=False)
    urgency: Mapped[str] = mapped_column(String(16), index=True)
    priority: Mapped[int] = mapped_column(Integer)
    override: Mapped[Json] = mapped_column(nullable=True)
    created_at: Mapped[Created]


class Consent(Base):
    """Consent ledger. The patient can see and withdraw every row."""

    __tablename__ = "consents"

    id: Mapped[PK]
    person_id: Mapped[str] = mapped_column(ForeignKey("persons.id"), index=True)
    # screening | data_sharing | teleconsult | ai_scoring
    purpose: Mapped[str] = mapped_column(String(32))
    # spoken_tap (offline) | otp (confirmed on sync)
    method: Mapped[str] = mapped_column(String(16))
    granted: Mapped[bool] = mapped_column(Boolean)
    recorded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    language: Mapped[str] = mapped_column(String(8), default="bn")


class SyndromeEvent(Base):
    """Doorstep syndrome reports that feed the outbreak radar."""

    __tablename__ = "syndrome_events"

    id: Mapped[PK]
    village_id: Mapped[str] = mapped_column(ForeignKey("villages.id"), index=True)
    # fever | fever_with_rash | acute_diarrhoea | jaundice | cough_cold
    syndrome: Mapped[str] = mapped_column(String(32), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    reported_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[Created]

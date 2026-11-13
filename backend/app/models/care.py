from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import now
from app.db.session import Base

from ._types import PK, Created, Json


class Referral(Base):
    """One flagged person on the way to care. Status is server-owned (see services.referrals)."""

    __tablename__ = "referrals"

    id: Mapped[PK]
    person_id: Mapped[str] = mapped_column(ForeignKey("persons.id"), index=True)
    screening_id: Mapped[str] = mapped_column(ForeignKey("screenings.id"))
    asha_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # flagged → acknowledged → booked → seen → closed   (+ missed, cancelled)
    status: Mapped[str] = mapped_column(String(16), index=True, default="flagged")
    urgency: Mapped[str] = mapped_column(String(16))
    priority: Mapped[int] = mapped_column(Integer)
    # Triage board lane: urgent | this_week | monitor
    lane: Mapped[str] = mapped_column(String(16), default="this_week")
    reasons: Mapped[Json] = mapped_column(default=list)
    needs: Mapped[Json] = mapped_column(default=list)
    facility_id: Mapped[str | None] = mapped_column(ForeignKey("facilities.id"), nullable=True, index=True)
    mode: Mapped[str] = mapped_column(String(16), default="in_person")
    routing: Mapped[Json] = mapped_column(nullable=True)
    escalation_level: Mapped[int] = mapped_column(Integer, default=0)
    missed_count: Mapped[int] = mapped_column(Integer, default=0)
    # Deadline for the next step; the escalation worker watches it.
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    booked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outcome: Mapped[Json] = mapped_column(nullable=True)
    created_at: Mapped[Created]
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now, index=True)

    events: Mapped[list["ReferralEvent"]] = relationship(order_by="ReferralEvent.at")
    appointments: Mapped[list["Appointment"]] = relationship(order_by="Appointment.slot_start")


class ReferralEvent(Base):
    __tablename__ = "referral_events"

    id: Mapped[PK]
    referral_id: Mapped[str] = mapped_column(ForeignKey("referrals.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_status: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[PK]
    referral_id: Mapped[str] = mapped_column(ForeignKey("referrals.id"), index=True)
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"), index=True)
    doctor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # in_person | teleconsult
    mode: Mapped[str] = mapped_column(String(16))
    slot_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    slot_end: Mapped[datetime] = mapped_column(DateTime)
    meeting_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # booked | attended | missed | cancelled
    status: Mapped[str] = mapped_column(String(16), default="booked")
    created_at: Mapped[Created]


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[PK]
    referral_id: Mapped[str | None] = mapped_column(ForeignKey("referrals.id"), nullable=True, index=True)
    # new_flag | emergency | escalation | no_show | outbreak | score_mismatch
    kind: Mapped[str] = mapped_column(String(24), index=True)
    # info | warning | critical
    level: Mapped[str] = mapped_column(String(12))
    # Who should act: asha | anm | medical_officer | district_officer
    target_role: Mapped[str] = mapped_column(String(24), index=True)
    target_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    facility_id: Mapped[str | None] = mapped_column(ForeignKey("facilities.id"), nullable=True, index=True)
    code: Mapped[str] = mapped_column(String(48))
    data: Mapped[Json] = mapped_column(default=dict)
    created_at: Mapped[Created]
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Media(Base):
    """A voice note from the ASHA for the doctor (store-and-forward consult when a call cannot hold).
    The bytes live on disk, outside the database; rows expire under the retention policy."""

    __tablename__ = "media"

    id: Mapped[PK]
    referral_id: Mapped[str] = mapped_column(ForeignKey("referrals.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="voice_note")
    mime: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[Created]
    delete_after: Mapped[datetime] = mapped_column(DateTime, index=True)

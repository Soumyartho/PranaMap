from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import now
from app.db.session import Base

from ._types import PK, Created, Json


class User(Base):
    """A health worker. Patients are Persons, not Users."""

    __tablename__ = "users"

    id: Mapped[PK]
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    # asha | anm | doctor | medical_officer | district_officer
    role: Mapped[str] = mapped_column(String(32))
    pin_hash: Mapped[str] = mapped_column(String(128))
    pin_salt: Mapped[str] = mapped_column(String(64))
    facility_id: Mapped[str | None] = mapped_column(ForeignKey("facilities.id"), nullable=True)
    block: Mapped[str] = mapped_column(String(120))
    # ASHA jurisdiction: the villages she serves.
    village_ids: Mapped[Json] = mapped_column(default=list)
    language: Mapped[str] = mapped_column(String(8), default="bn")
    created_at: Mapped[Created]


class Household(Base):
    __tablename__ = "households"

    id: Mapped[PK]
    village_id: Mapped[str] = mapped_column(ForeignKey("villages.id"), index=True)
    asha_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    head_name: Mapped[str] = mapped_column(String(120))
    number: Mapped[str] = mapped_column(String(16))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    created_at: Mapped[Created]
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    members: Mapped[list["Person"]] = relationship(back_populates="household")


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[PK]
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    sex: Mapped[str] = mapped_column(String(8))
    birth_year: Mapped[int] = mapped_column(Integer)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Mock ABHA in the demo; real ABHA linking goes through the ABDM sandbox.
    abha_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    known_diabetes: Mapped[bool] = mapped_column(default=False)
    known_hypertension: Mapped[bool] = mapped_column(default=False)
    pregnant: Mapped[bool] = mapped_column(default=False)
    medications: Mapped[Json] = mapped_column(default=list)
    # Per-field last-writer-wins: field -> client timestamp of its last write.
    field_clock: Mapped[Json] = mapped_column(default=dict)
    created_at: Mapped[Created]
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    household: Mapped[Household] = relationship(back_populates="members")

    def age(self, year: int) -> int:
        return year - self.birth_year

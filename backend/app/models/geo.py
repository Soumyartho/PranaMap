from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

from ._types import PK, Json


class Village(Base):
    __tablename__ = "villages"

    id: Mapped[PK]
    name: Mapped[str] = mapped_column(String(120))
    block: Mapped[str] = mapped_column(String(120), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    population_30plus: Mapped[int] = mapped_column(Integer, default=0)
    km_from_road: Mapped[float] = mapped_column(Float, default=0)


class Facility(Base):
    """A place care can happen, with what it can do and when. ASHAs keep it current."""

    __tablename__ = "facilities"

    id: Mapped[PK]
    name: Mapped[str] = mapped_column(String(160))
    # sub_centre | phc | chc | district_hospital | tele_hub
    kind: Mapped[str] = mapped_column(String(32))
    block: Mapped[str] = mapped_column(String(120), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    # glucose_test, bp_management, hb_test, sputum_test, ecg, ncd_clinic, emergency, teleconsult
    capabilities: Mapped[Json] = mapped_column(default=list)
    opens: Mapped[str] = mapped_column(String(5), default="09:00")
    closes: Mapped[str] = mapped_column(String(5), default="16:00")
    # 0 = Monday … 6 = Sunday
    days: Mapped[Json] = mapped_column(default=lambda: [0, 1, 2, 3, 4, 5])
    open_24x7: Mapped[bool] = mapped_column(default=False)
    staffed: Mapped[bool] = mapped_column(default=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    daily_slots: Mapped[int] = mapped_column(Integer, default=24)
    abdm_hfr_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

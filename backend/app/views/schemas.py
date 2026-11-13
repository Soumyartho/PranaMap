"""Request and response shapes (the V in MVC for a JSON API)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    pin: str = Field(min_length=4, max_length=8)


class UserOut(BaseModel):
    id: str
    name: str
    phone: str
    role: str
    block: str
    facility_id: str | None
    village_ids: list[str]
    language: str


class LoginOut(BaseModel):
    token: str
    user: UserOut
    # Per-user salt so the phone can derive its local encryption key from the PIN.
    key_salt: str


class SyncEventIn(BaseModel):
    id: str = Field(min_length=8, max_length=36)
    type: str
    created_at: str
    payload: dict[str, Any]


class SyncPushIn(BaseModel):
    device_id: str = Field(min_length=4, max_length=64)
    events: list[SyncEventIn] = Field(max_length=500)


class SyncResult(BaseModel):
    id: str
    status: Literal["applied", "duplicate", "rejected"]
    result: dict[str, Any] | None = None
    error: str | None = None


class SyncPushOut(BaseModel):
    results: list[SyncResult]
    server_time: str


class ScoreIn(BaseModel):
    input: dict[str, Any]


class TransitionIn(BaseModel):
    to: Literal["acknowledged", "booked", "seen", "closed", "missed", "cancelled"]
    note: str | None = Field(default=None, max_length=500)
    outcome: dict[str, Any] | None = None


class BookIn(BaseModel):
    facility_id: str | None = None
    mode: Literal["in_person", "teleconsult"] | None = None


class LaneIn(BaseModel):
    lane: Literal["urgent", "this_week", "monitor"]


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    lang: Literal["en", "hi", "bn"] = "en"


class AdvanceIn(BaseModel):
    hours: float = Field(gt=0, le=24 * 30)


class TranscribeIn(BaseModel):
    lang: Literal["en", "hi", "bn"]
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    # ~20 s of 16 kHz 16-bit audio, base64: enough for one spoken answer, bounded against abuse.
    audio_base64: str = Field(min_length=100, max_length=900_000)

"""Voice notes: validate, store on disk, list, serve, purge on schedule."""

from __future__ import annotations

import base64
import binascii
import hashlib
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.core.config import get_settings
from app.models import Media, Referral, User

ALLOWED = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"}


class MediaError(Exception):
    pass


def _dir() -> Path:
    d = Path(get_settings().media_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_for(media_id: str) -> Path:
    # IDs are server-validated UUID strings; never a path from the client.
    return _dir() / f"{media_id}.bin"


def store_voice_note(db: Session, user: User, referral: Referral, media_id: str, mime: str, data_b64: str, duration_ms: int) -> Media:
    base_mime = mime.split(";")[0].strip().lower()
    if base_mime not in ALLOWED:
        raise MediaError(f"unsupported audio type {base_mime}")
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MediaError("audio is not valid base64") from exc
    if not raw or len(raw) > get_settings().media_max_bytes:
        raise MediaError("audio is empty or too long")
    existing = db.get(Media, media_id)
    if existing:
        return existing
    path_for(media_id).write_bytes(raw)
    m = Media(id=media_id, referral_id=referral.id, kind="voice_note", mime=base_mime, size_bytes=len(raw),
              duration_ms=max(0, min(int(duration_ms), 120_000)), sha256=hashlib.sha256(raw).hexdigest(), created_by=user.id,
              delete_after=now() + timedelta(days=get_settings().media_retention_days))
    db.add(m)
    return m


def for_referral(db: Session, referral_id: str) -> list[dict]:
    rows = db.scalars(select(Media).where(Media.referral_id == referral_id).order_by(Media.created_at)).all()
    return [{"id": m.id, "kind": m.kind, "mime": m.mime, "duration_ms": m.duration_ms, "size_bytes": m.size_bytes,
             "created_at": m.created_at.isoformat() + "Z", "delete_after": m.delete_after.isoformat() + "Z"} for m in rows]


def purge_expired(db: Session) -> int:
    expired = db.scalars(select(Media).where(Media.delete_after < now())).all()
    for m in expired:
        path_for(m.id).unlink(missing_ok=True)
        db.delete(m)
    db.commit()
    return len(expired)

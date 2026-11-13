"""Store-and-forward voice notes through the API: ASHA -> sync -> doctor, with access rules and retention."""

import base64
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core import clock

OGG = b"OggS" + bytes(2000)  # stands in for a recorded clip; the server checks type and size, not codecs


@pytest.fixture(scope="module")
def client():
    from scripts.seed_synthetic import main as seed

    seed()
    from app.main import app

    with TestClient(app) as c:
        yield c
    clock.reset()


def login(client, phone):
    return {"Authorization": f"Bearer {client.post('/api/auth/login', json={'phone': phone, 'pin': '1234'}).json()['token']}"}


def push(client, headers, payload):
    ev = {"id": str(uuid.uuid4()), "type": "referral.voice_note", "created_at": "2026-11-12T05:00:00Z", "payload": payload}
    return client.post("/api/sync/push", json={"device_id": "test-device", "events": [ev]}, headers=headers).json()["results"][0]


def an_open_referral(client, asha):
    refs = client.get("/api/sync/pull", headers=asha).json()["referrals"]
    return next(r for r in refs if r["status"] in ("flagged", "acknowledged", "booked", "missed"))


def test_voice_note_reaches_the_doctor_and_not_the_asha(client):
    asha = login(client, "9000000001")
    ref = an_open_referral(client, asha)
    media_id = str(uuid.uuid4())
    res = push(client, asha, {"id": media_id, "referral_id": ref["id"], "mime": "audio/ogg;codecs=opus", "duration_ms": 4200,
                              "data_base64": base64.b64encode(OGG).decode()})
    assert res["status"] == "applied" and res["result"]["media_id"] == media_id

    mo = login(client, "9000000201")
    notes = client.get(f"/api/referrals/{ref['id']}/packet", headers=mo).json()["voice_notes"]
    assert [n["id"] for n in notes] == [media_id] and notes[0]["duration_ms"] == 4200

    audio = client.get(f"/api/media/{media_id}", headers=mo)
    assert audio.status_code == 200 and audio.content == OGG and audio.headers["content-type"].startswith("audio/ogg")
    assert client.get(f"/api/media/{media_id}", headers=asha).status_code == 403


def test_bad_audio_is_rejected(client):
    asha = login(client, "9000000001")
    ref = an_open_referral(client, asha)
    wrong_type = push(client, asha, {"id": str(uuid.uuid4()), "referral_id": ref["id"], "mime": "text/html",
                                     "data_base64": base64.b64encode(b"<script>").decode()})
    too_big = push(client, asha, {"id": str(uuid.uuid4()), "referral_id": ref["id"], "mime": "audio/webm",
                                  "data_base64": base64.b64encode(bytes(700_000)).decode()})
    assert wrong_type["status"] == "rejected" and "unsupported" in wrong_type["error"]
    assert too_big["status"] == "rejected" and "too long" in too_big["error"]


def test_retention_deletes_expired_notes(client):
    from app.db.session import SessionLocal
    from app.models import Media
    from app.services.media import path_for, purge_expired

    with SessionLocal() as db:
        m = db.query(Media).first()
        path = path_for(m.id)
        assert path.exists()
        clock.advance(24 * 61)  # beyond the 60-day retention
        assert purge_expired(db) >= 1
        assert not path.exists() and db.get(Media, m.id) is None
    clock.reset()

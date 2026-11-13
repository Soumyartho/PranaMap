"""The whole loop through the API: capture offline, sync, score, route, book, see, close, measure."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core import clock
from app.ml.engine import score


@pytest.fixture(scope="module")
def client():
    from scripts.seed_synthetic import main as seed

    seed()
    from app.main import app

    with TestClient(app) as c:
        yield c
    clock.reset()


def login(client, phone):
    r = client.post("/api/auth/login", json={"phone": phone, "pin": "1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_wrong_pin_is_rejected(client):
    assert client.post("/api/auth/login", json={"phone": "9000000001", "pin": "0000"}).status_code == 401


def test_asha_cannot_read_dashboard(client):
    assert client.get("/api/dashboard/summary", headers=login(client, "9000000001")).status_code == 403


def test_full_loop(client):
    asha = login(client, "9000000001")
    pulled = client.get("/api/sync/pull", headers=asha).json()
    assert pulled["full"] and pulled["households"] and pulled["facilities"]
    household = pulled["households"][0]

    # A new person, consent and a screening, captured offline and pushed as one batch.
    pid, cid, sid = (str(uuid.uuid4()) for _ in range(3))
    x = {"age": 58, "sex": "male", "tobacco": "daily", "alcohol_daily": False, "activity": "sedentary", "fh_diabetes": "one_parent",
         "fh_heart_or_bp": True, "waist_cm": 102, "bp_readings": [[164, 102], [160, 98]], "glucose_mg_dl": 236,
         "glucose_type": "random", "symptoms": ["excessive_thirst"]}
    client_result = score(x)
    events = [
        {"id": str(uuid.uuid4()), "type": "person.upsert", "created_at": "2026-10-07T05:00:00Z",
         "payload": {"id": pid, "household_id": household["id"], "name": "Test Person", "sex": "male", "birth_year": 1968}},
        {"id": str(uuid.uuid4()), "type": "consent.record", "created_at": "2026-10-07T05:00:01Z",
         "payload": {"id": cid, "person_id": pid, "purpose": "screening", "method": "spoken_tap", "granted": True,
                     "recorded_at": "2026-10-07T05:00:01Z"}},
        {"id": str(uuid.uuid4()), "type": "screening.create", "created_at": "2026-10-07T05:02:00Z",
         "payload": {"id": sid, "person_id": pid, "captured_at": "2026-10-07T05:02:00Z", "input": x, "client_result": client_result,
                     "client_engine_version": client_result["engine_version"], "booking": {"mode": "in_person"}}},
    ]
    body = {"device_id": "test-device", "events": events}
    first = client.post("/api/sync/push", json=body, headers=asha).json()["results"]
    assert [r["status"] for r in first] == ["applied", "applied", "applied"], first
    screening = first[2]["result"]
    assert screening["score_mismatch"] is False
    assert screening["urgency"] == "soon" and screening["referral_id"]
    assert screening["routing"]["reasons"] and screening["appointment"]["slot_start"]
    # A routine visit lands in clinic hours (09:00-16:00 IST) even at a 24x7 facility.
    from datetime import datetime, timedelta

    slot_local = datetime.fromisoformat(screening["appointment"]["slot_start"].rstrip("Z")) + timedelta(hours=5, minutes=30)
    assert 9 <= slot_local.hour < 16 and slot_local.weekday() != 6

    # Retrying the same outbox is a no-op: nothing is applied twice.
    again = client.post("/api/sync/push", json=body, headers=asha).json()["results"]
    assert [r["status"] for r in again] == ["duplicate"] * 3

    referral_id = screening["referral_id"]
    mo = login(client, "9000000201")
    packet = client.get(f"/api/referrals/{referral_id}/packet", headers=mo).json()
    assert packet["patient"]["name"] == "Test Person"
    assert packet["risk"]["diabetes"]["band"] == "high"
    assert any("diabetes" in q.lower() for q in packet["questions"])

    bundle = client.get(f"/api/referrals/{referral_id}/fhir", headers=mo).json()
    kinds = {e["resource"]["resourceType"] for e in bundle["entry"]}
    assert {"Patient", "Observation", "RiskAssessment", "ServiceRequest", "Appointment"} <= kinds

    # An ANM cannot record the visit; the medical officer can, and the outcome flows back to the phone.
    anm = login(client, "9000000101")
    assert client.post(f"/api/referrals/{referral_id}/transition", json={"to": "seen"}, headers=anm).status_code == 403
    seen = client.post(f"/api/referrals/{referral_id}/transition", json={"to": "seen", "outcome": {"confirmed": True}}, headers=mo)
    assert seen.status_code == 200 and seen.json()["status"] == "seen"
    assert client.post(f"/api/referrals/{referral_id}/transition", json={"to": "flagged"}, headers=mo).status_code == 422
    assert client.post(f"/api/referrals/{referral_id}/transition", json={"to": "booked"}, headers=mo).status_code == 409

    back = client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"}, headers=asha).json()
    mine = next(r for r in back["referrals"] if r["id"] == referral_id)
    assert mine["status"] == "seen" and mine["outcome"]["confirmed"] is True


def test_screening_without_consent_is_rejected(client):
    asha = login(client, "9000000001")
    pulled = client.get("/api/sync/pull", headers=asha).json()
    person = pulled["persons"][0]
    ev = {"id": str(uuid.uuid4()), "type": "screening.create", "created_at": "2026-10-07T06:00:00Z",
          "payload": {"id": str(uuid.uuid4()), "person_id": person["id"], "captured_at": "2026-10-07T06:00:00Z",
                      "input": {"age": 40, "sex": "female"}}}
    # Seeded people already have consent; a brand-new person without one must be refused.
    pid = str(uuid.uuid4())
    new_person = {"id": str(uuid.uuid4()), "type": "person.upsert", "created_at": "2026-10-07T05:59:00Z",
                  "payload": {"id": pid, "household_id": pulled["households"][0]["id"], "name": "No Consent", "sex": "female", "birth_year": 1980}}
    ev["payload"]["person_id"] = pid
    res = client.post("/api/sync/push", json={"device_id": "test-device", "events": [new_person, ev]}, headers=asha).json()["results"]
    assert res[0]["status"] == "applied"
    assert res[1]["status"] == "rejected" and "consent" in res[1]["error"]


def test_asha_cannot_write_outside_her_villages(client):
    asha = login(client, "9000000001")
    other = login(client, "9000000002")
    foreign_household = client.get("/api/sync/pull", headers=other).json()["households"][0]["id"]
    ev = {"id": str(uuid.uuid4()), "type": "person.upsert", "created_at": "2026-10-07T07:00:00Z",
          "payload": {"id": str(uuid.uuid4()), "household_id": foreign_household, "name": "X", "sex": "male", "birth_year": 1970}}
    res = client.post("/api/sync/push", json={"device_id": "test-device", "events": [ev]}, headers=asha).json()["results"]
    assert res[0]["status"] == "rejected"


def test_escalation_and_dashboard(client):
    mo = login(client, "9000000201")
    before = client.get("/api/dashboard/summary", headers=mo).json()
    assert before["population_30plus"] > 0 and before["loop_closure"]["eligible"] > 0
    assert 0 <= before["loop_closure"]["rate"] <= 1

    advanced = client.post("/api/demo/advance", json={"hours": 72}, headers=mo).json()
    assert advanced["escalations"] > 0
    alerts = client.get("/api/alerts", headers=mo).json()
    assert any(a["kind"] == "escalation" for a in alerts)
    clock.reset()

    hexes = client.get("/api/dashboard/hexmap", headers=mo).json()
    assert hexes["features"] and all(f["properties"]["screened"] >= hexes["min_cell_count"] for f in hexes["features"])
    out = client.get("/api/dashboard/outbreaks", headers=mo).json()
    assert any(a["syndrome"] == "acute_diarrhoea" for a in out["alerts"])
    cov = client.get("/api/dashboard/coverage", headers=mo).json()
    assert any(v["blind_spot"] for v in cov)


def test_doctor_has_a_teleconsult_queue(client):
    doctor = login(client, "9000000301")
    queue = client.get("/api/doctor/queue", headers=doctor).json()
    assert queue and all(q["mode"] == "teleconsult" and q["meeting_url"] for q in queue)


def test_district_officer_sees_no_names(client):
    dho = login(client, "9000000401")
    refs = client.get("/api/referrals", headers=dho).json()
    assert refs and all(r["person"]["name"] is None for r in refs)


def test_chat_red_flag_first(client):
    r = client.post("/api/chat", json={"message": "বাবার বুকে ব্যথা হচ্ছে", "lang": "bn"}).json()
    assert r["kind"] == "emergency" and r["call"] == "108"
    r = client.post("/api/chat", json={"message": "how do I quit gutkha", "lang": "hi"}).json()
    assert r["kind"] == "faq" and r["id"] == "tobacco"


def test_missed_appointment_can_still_be_seen(client):
    """A no-show who turns up late: the doctor's outcome is recorded, not rejected."""
    mo = login(client, "9000000201")
    missed = client.get("/api/referrals", params={"status": "missed"}, headers=mo).json()
    assert missed, "seed has missed referrals"
    rid = missed[0]["id"]
    outcome = {"confirmed": True, "evaluated": ["hypertension"], "confirmed_conditions": ["hypertension"], "plan": "Amlodipine 5 mg"}
    r = client.post(f"/api/referrals/{rid}/transition", json={"to": "seen", "outcome": outcome}, headers=mo)
    assert r.status_code == 200, r.text
    packet = client.get(f"/api/referrals/{rid}/fhir", headers=mo)
    assert packet.status_code == 200
    assert '"fulfilled"' in packet.text  # the missed appointment is now attended
    assert client.post(f"/api/referrals/{rid}/transition", json={"to": "closed"}, headers=mo).status_code == 200

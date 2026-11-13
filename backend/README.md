# Backend (FastAPI, MVC)

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m scripts.seed_synthetic             # build the synthetic village (every account's PIN: 1234)
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest                             # 262 tests: engine, WHO CVD parity, ML governance, adapters, full loop
```

Configuration: every setting has a local default; copy `.env.example` to `.env` to switch on Bhashini, SMS/WhatsApp
or the ABDM sandbox. `Dockerfile` builds the API image (from the repository root; see `../docker-compose.yml`).

API docs: http://localhost:8000/docs

| Layer | Folder | What lives there |
|---|---|---|
| Model | `app/models/` | SQLAlchemy entities: villages, facilities, households, persons, screenings, referrals, appointments, alerts, consents, sync events, audit log |
| View | `app/views/` | Pydantic request/response schemas |
| Controller | `app/controllers/` | Access rules and orchestration per area |
| Routes | `app/routes/api.py` | URL → controller wiring |
| Services | `app/services/` | Routing, referral state machine + booking + escalation, sync, packet, FHIR, dashboard, notifications outbox, voice notes, model monitoring |
| Engine | `app/ml/guidelines/` | Red-flag rules, CBAC, IDRS, BP staging, WHO 2019 CVD (`who_cvd.py`), anaemia, TB screen |
| ML | `app/ml/model.py`, `app/ml/training/` | Glass-box NCD model, run in shadow mode. `pip install -r requirements-ml.txt` then `python -m app.ml.training.train` retrains it and rewrites `../shared/models/ncd_risk.json` and the model card `../docs/models/ncd_risk.md` |
| Integrations | `app/integrations/` | Bhashini ASR, SMS (Twilio, Exotel) and WhatsApp Cloud with DLT templates, ABHA/ABDM |
| Worker | `app/workers/escalation.py` | Escalates overdue referrals, schedules reminders, sends due messages, purges expired voice notes |
| Chatbot | `app/chatbot/` | Emergency phrases first, then retrieval over `shared/faq.json` |

`scripts/make_risk_fixtures.py` regenerates `shared/fixtures/` (risk, routing and chat golden cases), which keep the
phone's offline engines identical to these. Run it after any engine change, then the frontend tests; CI fails if the
committed fixtures are stale.

Demo accounts (PIN 1234): ASHA 9000000001, ANM 9000000101, PHC medical officer 9000000201,
teleconsult doctor 9000000301, district officer 9000000401.

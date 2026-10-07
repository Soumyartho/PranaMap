# Backend (FastAPI, MVC)

- `app/models/`       DB entities (Model)
- `app/views/`        Pydantic response schemas / FHIR / packet builders (View)
- `app/controllers/`  Request handling logic (Controller)
- `app/routes/`       URL → controller wiring
- `app/services/`     Routing, alerting, scoring orchestration
- `app/ml/`           `guidelines/` (CBAC, IDRS, WHO/ISH, TB, red flags), `training/`, `artifacts/` (ONNX)
- `app/workers/`      Escalation timers, no-show rescue, outbox
- `app/integrations/` Bhashini, ABDM, messaging, LiveKit
- `app/chatbot/`      Red-flag layer + retrieval corpus
- `app/core/`, `app/db/`, `app/middleware/`  config, security, migrations
- `scripts/`          Synthetic village generator, seeders
- `tests/`            unit + integration

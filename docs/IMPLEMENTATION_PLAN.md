# PranaMap — Implementation Plan

Goal: demo the full closed loop (Capture → Score → Route → Follow-through → Map) offline-first, on a synthetic village, for IEMH4-HC-01.
North-star metric: share of flagged high-risk people who complete a visit within 14 days.

## 1. MVC mapping

| MVC | Backend (FastAPI, Python) | Frontend (React + TS PWA) |
|---|---|---|
| **Model** | `app/models` SQLAlchemy/PostGIS entities (Household, Person, Screening, Observation, Referral, Facility, Consent, AuditLog) | `src/models` Dexie (IndexedDB) tables, TS types, outbox/sync queue |
| **View** | `app/views` Pydantic response schemas (the API's "presentation": risk contract, FHIR bundles, pre-consult packet) | `src/views` pages, components, layouts (ASHA, Doctor, PHC, Patient, Chatbot) |
| **Controller** | `app/controllers` request logic; `app/routes` URL → controller wiring | `src/controllers` hooks/state machines (screening flow, referral, sync, voice) |
| Support | `services` (routing, alerting, scoring), `ml`, `workers`, `integrations`, `chatbot` | `services` (API client, ONNX scorer, voice, crypto, BLE), `workers` (service worker, sync), `i18n` |

Rule: views never touch the DB; controllers never render; models hold no business flow.

## 2. Phases (thin vertical slices, in order)

**Phase 0 — Foundations (day 1)**
- Backend: FastAPI skeleton, Postgres+PostGIS via Docker Compose, Alembic, health endpoint, auth (JWT), jurisdiction RLS.
- Frontend: Vite + React + TS, Tailwind, shadcn/ui, vite-plugin-pwa, i18next (en/hi/bn), routing, theme tokens.
- Shared: OpenAPI → generated TS client; lint/format; CI stub.

**Phase 1 — Risk engine (ML lane)**
- Guideline scorers with unit tests on worked examples: CBAC, IDRS, WHO/ISH non-lab chart, TB 4-symptom screen.
- Red-flag rules (BP crisis, chest pain, stroke signs, breathlessness, pregnancy danger signs) — run first, always.
- Glass-box model (EBM / logistic) trained on synthetic data + any legal public tabular data; calibration; ONNX export; identical scorer in browser and server.
- Output contract: band, calibrated probability, top-3 drivers, action, confidence, "what would sharpen this".

**Phase 2 — Offline ASHA capture (frontend core)**
- Dexie DB, AES-GCM encryption (PIN-derived key), outbox with UUIDv7 idempotent events.
- Screening flow: one question per screen, audio prompts, big keypad, read-back + plausibility checks.
- Prana Ring live scoring via ONNX Runtime Web; "why" bars; what-if slider; emergency screen.
- Sync chip + queue counter; Playwright offline test.

**Phase 3 — Sync + routing + referral loop (backend core)**
- `/sync` idempotent endpoint; server re-score for audit.
- Facility capability graph (open hours, staff, equipment); travel-time matrix (OSRM/Valhalla or haversine fallback); routing with explanation.
- Referral state machine: flagged → acknowledged → booked → seen → closed; escalation timers; no-show rescue (worker).
- Pre-consult packet generator (+ FHIR R4 export).

**Phase 4 — Care-team views**
- Doctor: teleconsult booking, packet card, audio-first call (Jitsi first, LiveKit later).
- PHC/District: H3 hexagon risk map (small-count <5 suppression), KPI cards, triage board, referral tracker, coverage ring, loop-closure metric.

**Phase 5 — Voice, chatbot, extras**
- Voice: pre-rendered audio packs (en/hi/bn), constrained-vocabulary ASR via Bhashini online, fallback record-and-transcribe-on-sync.
- Chatbot: rule-based red-flag layer → retrieval (pgvector) over MoHFW/ICMR text → LLM with citations; offline FAQ pack.
- Stretch: BLE cuff, camera OCR, ABDM sandbox/mock ABHA, Today list, Gram Sabha mode, outbreak radar (EARS C2), anaemia photo aid.

**Phase 6 — Polish and demo**
- Synthetic village generator; 6x CPU throttle test; Lighthouse; reduced-motion/lite mode; fairness report; demo script rehearsal (airplane mode headline).

## 3. Scope calls (my recommendations)
- **Must:** everything in Phases 0–4, voice in en + hi + bn, small chatbot, alert/escalation.
- **Stretch:** BLE, OCR, ABDM sandbox, outbreak radar, anaemia aid.
- **Cut:** native apps, payments, real patient data, custom model research beyond baseline.
- **Adult-only (30+) in v1** — avoids DPDP children's-data consent.
- Mock ABHA/ABDM and mock telephony (SMS/IVR) for the demo; real integrations only if time allows.

## 4. What I need from you (inputs)

### Decisions
1. **Team & time:** how many people, which lanes each owns (frontend / backend / ML / voice+demo), hackathon deadline and demo date.
2. **Languages:** confirm en + Hindi + Bengali as the demo set (or swap one).
3. **Hosting/DB:** OK to use local Docker Postgres+PostGIS for dev, and Supabase (hosted) for the demo? Or fully local?
4. **Backend language:** the blueprint says Python/FastAPI (same language as ML). Confirm, or prefer Node/NestJS.
5. **Demo geography:** which West Bengal block/district to model for the synthetic village (affects map centre, facility names, language mix).
6. **Telemedicine:** Jitsi (fast) vs LiveKit (as in the blueprint) for the demo.

### Accounts / keys (only when we reach that phase; mocks are used until then)
- Bhashini (ULCA) API key — ASR/TTS/translation. Registration is free but can take time, so start now.
- LLM API key for the chatbot (Claude/Gemini/Sarvam). Which one?
- Twilio/Exotel (SMS/IVR) or "mock only"?
- ABDM sandbox credentials (optional/stretch).
- Mapping: OpenStreetMap/PMTiles extract for the chosen region (I can fetch this if you name the area).

### Design input (to improve the frontend)
- Logo / brand colours if any (default: deep teal base, amber caution, red emergency only).
- Any UI references or screenshots you like.
- Do you have **real device access** for testing (a low-end Android phone, a BLE BP cuff)?
- Whether the ASHA UI should use a **bottom nav + one-handed layout** (my default) or something else.
- Preferred name/voice for audio prompts: record real voices, or use TTS (Bhashini/other) to pre-render packs? Native Hindi/Bengali speakers on the team to review wording?

### Clinical / content
- A **doctor or ANM reviewer** for red-flag rules, advice text and referral thresholds (blueprint requires this before ship; for the hackathon we label them "guideline-derived, pending clinical review").
- MoHFW/ICMR PDFs you want the chatbot grounded on (or I use public NP-NCD/CBAC material).
- Real PHC/CHC facility list for the area, if you have one (else: ABDM Health Facility Registry/OSM + synthetic capability data).

## 5. Verification approach
- Unit tests: scorers vs worked examples; red-flag rules; sync idempotency; referral state machine.
- E2E: Playwright with the browser offline, running the whole visit.
- Manual: airplane-mode demo, 6x CPU throttle, TalkBack check.

## 6. Open risks
- Bhashini onboarding time → keep keypad + audio packs as the guaranteed path.
- ONNX parity between Python and browser → add a golden-file test comparing outputs.
- Scope creep → freeze after Phase 4 until the loop demos end-to-end.

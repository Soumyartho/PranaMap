# PranaMap — Implementation Plan

## Status (13 November 2026)

**Built and tested end to end** on a synthetic block of 12 villages and about 1,100 people: the five-step loop of
capture, score, route, follow through and map. 262 backend tests, 712 frontend unit tests and an automated browser
suite run in CI. The browser suite covers airplane-mode screening, sync, the emergency path, photo OCR, the MO
dashboard, the doctor closing the loop, and a CPU-throttled performance budget.

| Brief item | Status |
|---|---|
| Risk-assessment engine for minimal training | Done. CBAC, IDRS, NP-NCD BP staging, WHO Hb thresholds and the WHO TB four-symptom screen, with red-flag rules first. CVD is the **WHO 2019 non-laboratory model**: sex-specific CHD and stroke Cox models, South Asia recalibration. It matches the reference implementation on 200 cases in both Python and TypeScript. |
| Explainable output | Done. Each condition returns a band, a 0–100 score (CVD: the 10-year risk), its top 3 drivers, an action, a confidence level and a "what would sharpen this" hint. Shown as the Prana Ring, the why bars and a what-if ghost ring. |
| ML layer | Done, in **shadow mode**. A glass-box logistic model for undiagnosed diabetes and hypertension, exported to JSON and run identically on the phone and the server. It has a model card (`docs/models/ncd_risk.md`) with calibration, fairness by sex and age, and known findings. The PHC monitors it on confirmed outcomes: agreement κ, a reliability chart and input drift. It changes no decision until validated (`validated=false` forces shadow mode). It is trained on a synthetic cohort, so a real one (NFHS-5/LASI or the pilot's outcomes) is the path to validation. |
| Offline-first PWA with sync | Done. IndexedDB records are AES-GCM encrypted with a PIN-derived key. The outbox uses UUIDv7 events and idempotent server apply. The service worker precaches the app. Initial load is 168 KB gzipped (CI budget 180 KB). |
| Teleconsult booking with nearest capable doctor | Done. Capacity-aware routing, clinic-hour slots, teleconsult fallback, audio-first Jitsi links. The ASHA can record a 60-second voice note for the doctor, deleted after 60 days. |
| PHC / district dashboard | Done. Loop-closure rate, KPIs, H3 hexagon map with small-count suppression, triage board, referral tracker, outbreak radar, blind spots and model monitoring. The district view carries no names. |
| Multilingual, voice-first | Done for en, hi and bn. **Offline speech recognition**: IndicConformer (hi, bn) and Whisper (en) run on the phone in a Web Worker after a one-time download from Settings. Bhashini is the online fallback, behind the API so the key stays server-side, and the browser recogniser is the last resort. Number parsing covers Hindi/Bengali number words, "साढ़े", "দেড়শো" and mixed digits. Translation QA in CI checks keys, placeholders, script and FAQ numbers. |
| Voice / OCR for vitals | Done. Voice (above); **camera OCR** of seven-segment BP, glucose and oximeter displays, running on the phone with a drag-to-frame crop; **Bluetooth** BP cuffs and pulse oximeters over the standard GATT profiles. Every captured value is read back for confirmation. |
| Encrypted storage, ABDM interoperability | Encryption done. FHIR R4 export done. ABHA numbers are captured and format-validated (14 digits or an @abdm address), with an ABDM gateway session client ready for sandbox credentials. |
| Automated alert to the nearest PHC | Done. New-flag and emergency alerts, an escalation ladder (ASHA → MO → DHO), no-show rescue. **SMS and WhatsApp**: DLT-compliant templates in 3 languages, Twilio and Exotel SMS, and WhatsApp Cloud template messages. A deduplicated outbox retries with backoff and checks consent before sending. Messages are simulated until credentials are set. |
| Regional-language chatbot | Done. Emergency phrases first in all three languages, then retrieval over a reviewed FAQ pack, offline on the phone. |

**Needs something outside the code:**
- **Credentials** (adapters built and tested against recorded API shapes; each switches on through `backend/.env`):
  - Bhashini (bhashini.gov.in);
  - Twilio or Exotel, plus DLT registration of the templates;
  - WhatsApp Business (Meta) with approved templates;
  - ABDM sandbox (sandbox.abdm.gov.in).
- **People:**
  - A doctor's sign-off on every red-flag rule, threshold and advice text.
  - Native Hindi and Bengali reviewers with health-worker experience for `docs/translation-review.csv`.
  - A field test on a low-end Android phone ([docs/PHONE_TESTING.md](PHONE_TESTING.md)).
- **Data:** a real cohort with confirmed outcomes to train and validate the ML model before it leaves shadow mode.

**Not built:**
- OTP consent confirmation on sync and remote key revocation for a lost phone.
- IVR.
- Pre-recorded audio prompt packs. Prompts use the phone's text-to-speech.
- A Postgres deployment. The models are portable; set `PRANAMAP_DATABASE_URL`.

---

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

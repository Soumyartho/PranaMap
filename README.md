# PranaMap

Offline-first, voice-first rural health screening that closes the loop. An ASHA screens a household with no network.
The phone scores risk and explains it, routes the person to a facility that can treat them, and PranaMap follows up
until the visit happens. Built for IEMHACKS 4.0, problem statement IEMH4-HC-01.

All data in this repository is synthetic. PranaMap is decision support for trained health workers, not a diagnosis.

## Run it

**One command** (Python 3.11+ and Node 20+). It creates the virtualenv, installs dependencies and seeds the synthetic
block on first run, then starts the API on :8000 and the app on http://localhost:5173. Ctrl+C stops both.

```powershell
./scripts/dev.ps1            # Windows. Add -Reseed to rebuild the demo data, -Phone to serve to a phone
```
```sh
scripts/dev.sh               # macOS / Linux / Git Bash. Options: --reseed, --phone
```

**Docker** (no local Python or Node): `docker compose up --build`, then open http://localhost:8080.

**By hand:** two terminals.

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m scripts.seed_synthetic
.venv/Scripts/python -m uvicorn app.main:app --port 8000

cd frontend
npm install
npm run dev
```

To try true offline use (service worker), run `npm run build`, then `npx vite preview`. To use a real phone, see
[docs/PHONE_TESTING.md](docs/PHONE_TESTING.md).

Copy [backend/.env.example](backend/.env.example) to `backend/.env` to switch on real services. With no settings,
everything runs locally:
- messages are recorded as *simulated*;
- ABHA numbers get format checks only;
- speech runs on the phone.

### Demo accounts (PIN 1234 for all)

| Role | Phone | Lands on |
|---|---|---|
| ASHA worker | 9000000001 | `/asha` phone app |
| ANM | 9000000101 | `/phc` dashboard |
| PHC medical officer | 9000000201 | `/phc` dashboard (can triage and record visits) |
| Teleconsult doctor | 9000000301 | `/doctor` queue |
| District health officer | 9000000401 | `/phc` dashboard, no patient names |

The login page lists them as one-tap buttons. The patient chat at `/chat` needs no account.

## Demo script (about five minutes)

1. **ASHA, airplane mode.**
   - Sign in as the ASHA in a phone-sized window.
   - Open Settings (gear) and download offline voice for বাংলা or हिन्दी.
   - Turn the network off (DevTools → Network → Offline).
   - From *Today*, open someone under *Not screened yet* and take consent.
   - Answer by tap, keypad, voice ("একশো পঞ্চাশ বাই নব্বই"), a photo of the BP monitor's display, or a Bluetooth cuff. Watch the Prana Ring move with each answer.
   - On the result, open the *why* bars, try *What if…*, and see where to go and why. Save. The sync chip shows the change waiting on the phone.
2. **Red flag.** Screen another person and tick *Chest pain*. The emergency screen fires at once, before any score and with no network: call 108, or text the ANM.
3. **Network on.** The chip goes from *Offline* to *Synced*. The server re-scores for audit, books the slot, and texts a reminder (simulated unless SMS is configured).
4. **PHC view.** Sign in as the medical officer. You get:
   - the loop-closure rate, the hexagon risk map, alerts and the triage board;
   - the outbreak radar, blind spots and the referral tracker;
   - **risk-model monitoring**: the shadow-mode ML model's calibration against confirmed outcomes, and input drift.

   *Demo clock → 3 days* shows overdue referrals escalating.
5. **Doctor.** Pick a consult, play the ASHA's voice note, start the audio-first call and record what was confirmed. The loop closes, the outcome returns to the ASHA's phone, and it feeds the model's calibration.

## What is in the repo

```
backend/    FastAPI + SQLAlchemy (MVC): risk engine, ML (shadow), sync, routing, referral loop, messaging,
            ABHA, Bhashini, voice notes, dashboard, FHIR, chatbot.
frontend/   React + TypeScript PWA (MVC): landing page, offline ASHA app, PHC dashboard, doctor view, chat.
shared/     The single source both sides read: FAQ pack, WHO CVD 2019 parameters, the exported ML model,
            and golden fixtures that pin the phone's engines to the server's.
docs/       Plan and status, model card, phone testing, translation review sheet.
scripts/    One-command dev start.
```

## Quality

| Check | Command | What it proves |
|---|---|---|
| Backend tests (262) | `cd backend && .venv/Scripts/python -m pytest` | Engine worked examples, WHO CVD 2019 parity with the reference Stata/R implementation (200 cases), model governance, messaging and ABHA adapters, the full loop through the API |
| Frontend unit tests (712) | `cd frontend && npm test` | The phone's risk engine, WHO CVD, routing and chatbot give identical output to the server's on every golden case; voice number parsing in 3 languages; BLE and seven-segment decoding; translation QA |
| End to end (6 + 3 voice) | `cd frontend && npm run e2e` | Production build plus a fresh seeded backend: a full screening in airplane mode, sync, and the referral reaching the PHC; the emergency path; reading a BP monitor from a photo; the MO dashboard; a doctor closing the loop; a 4× CPU throttle budget. `E2E_VOICE=1` adds offline speech in hi, bn and en |
| Performance budget | `cd frontend && npm run budget` | First load ≤ 180 KB gzipped JS (now about 168 KB); every phone route chunk ≤ 60 KB |
| Translation review | `cd frontend && npm run i18n:export` | Writes `docs/translation-review.csv` (474 strings, 240 marked clinical) for native-speaker review |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs every row except the review export on each push. It
also regenerates the engine fixtures and fails if they changed without being committed.

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for status and what remains.

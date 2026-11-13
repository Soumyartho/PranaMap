# Frontend (React + TypeScript PWA, MVC)

```bash
npm install
npm run dev        # http://localhost:5173, forwards /api to the backend on :8000
npm test           # 712 unit tests: engine/WHO CVD/routing/chat parity with the server, voice parsing, OCR, BLE, translation QA
npm run build      # production build with the offline service worker
npm run budget     # after a build: first-load and per-route size budgets (fails over budget)
npm run e2e        # Playwright: starts a seeded backend and the production build itself (E2E_VOICE=1 adds offline speech)
npm run dev:phone  # HTTPS on the LAN for a real phone (../docs/PHONE_TESTING.md)
npm run i18n:export  # translation review sheet → ../docs/translation-review.csv
```

| Layer | Folder | What lives there |
|---|---|---|
| Model | `src/models/` | Dexie (IndexedDB) schema, domain and risk types, landing-page copy |
| View | `src/views/` | `landing/`, `auth/`, `asha/` (phone app), `phc/` (dashboard, hex map, triage board), `doctor/`, `chatbot/`, shared `components/` |
| Controller | `src/controllers/` | Session and PIN unlock, the ASHA's decrypted data store, sync engine, screening flow, Today ranking, staff polling |
| Services | `src/services/` | Offline risk engine (with WHO CVD 2019 and the shadow ML model), routing, chatbot, WebCrypto vault, API client, voice (offline ASR, Bhashini, browser), device input (Bluetooth GATT, seven-segment OCR) |
| Workers | `src/workers/` | On-device speech recognition (ONNX Runtime Web / transformers.js), off the main thread |
| Routes | `src/routes/` | Router and role guards. Everything but the login and ASHA home is lazy-loaded |
| i18n | `src/i18n/` | A small translation layer (`{{x}}` interpolation, CLDR plurals); en is bundled, hi and bn load on demand |

Fonts: `public/fonts/` has General Sans (headings) and Gambetta (body) from the folders in this directory. Noto Sans
Bengali and Devanagari load from Google Fonts for Indic text and are cached by the service worker.

Offline: records are sealed with AES-GCM under a key derived from the ASHA's PIN (`services/crypto/vault.ts`). Changes
queue in an outbox and sync when there is signal (`controllers/sync/engine.ts`).

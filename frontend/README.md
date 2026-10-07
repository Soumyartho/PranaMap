# Frontend (React + TypeScript PWA, MVC)

- `src/models/`       Dexie tables, TS types, outbox/sync (Model)
- `src/views/`        `asha/ doctor/ phc/ patient/ chatbot/`, shared `components/`, `layouts/` (View)
- `src/controllers/`  Hooks and state machines: screening, referral, sync, voice, dashboard, auth (Controller)
- `src/services/`     API client, ONNX risk scorer, voice, WebCrypto, BLE
- `src/workers/`      Service worker, background sync
- `src/i18n/`         en / hi / bn message files
- `public/audio/`     Pre-rendered prompt packs per language
- `public/models/`    ONNX risk model
- `tests/`            unit + Playwright offline e2e

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Fonts: `public/fonts/` holds the variable WOFF2 files copied from `GeneralSans_Complete` (headings) and `Gambetta_Complete` (body).
Landing page: `src/views/landing/`, scroll controllers in `src/controllers/landing/`, copy in `src/models/content/landing.ts`.

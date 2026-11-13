import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (service worker, lazy chunks and all) and a
 * seeded, throwaway backend. `npm run e2e` starts both; nothing else needs to be running.
 *
 *   E2E_VOICE=1        also run the on-device speech test (downloads ~215 MB of models once)
 *   E2E_CHROME=path    use an installed Chrome instead of Playwright's Chromium
 */
const API_PORT = process.env.E2E_API_PORT ?? "8010";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "4180";

export default defineConfig({
  testDir: "tests/e2e",
  // The suites share one seeded database; tests that change server state run in sequence.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : undefined,
  },
  projects: [
    // A mid-range Android phone: the ASHA's device.
    { name: "phone", use: { ...devices["Pixel 7"], locale: "en-IN" }, testIgnore: /staff\.spec/ },
    // PHC and doctor screens are used on a desktop or laptop.
    { name: "desktop", use: { ...devices["Desktop Chrome"], locale: "en-IN" }, testMatch: /staff\.spec/ },
  ],
  webServer: [
    {
      command: "node tests/e2e/backend.mjs",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { E2E_API_PORT: API_PORT },
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { PRANAMAP_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});

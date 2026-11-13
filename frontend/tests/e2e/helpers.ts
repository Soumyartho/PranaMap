import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** English strings, so tests click what a user reads rather than CSS classes. */
export const EN = JSON.parse(readFileSync(new URL("../../src/i18n/locales/en.json", import.meta.url), "utf8"));

export const DEMO = { asha: "9000000001", anm: "9000000101", mo: "9000000201", doctor: "9000000301", dho: "9000000401" } as const;
export const PIN = "1234";

/**
 * Sign in through the demo-account list on the login screen. The demo ASHA's profile language is
 * Bengali; tests pick their language explicitly, as an ASHA can from the header.
 */
export async function signIn(page: Page, phone: string, lang: "en" | "hi" | "bn" = "en") {
  await page.addInitScript((l) => {
    localStorage.setItem("pranamap.prompts.muted", "1");
    localStorage.setItem("pranamap.lang", l);
  }, lang);
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(phone) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Wait until the service worker controls the page: from here the app shell works offline. */
export async function swReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
  });
}

/** After a reload the local data is locked again: enter the PIN on the unlock keypad. */
export async function unlock(page: Page, pin = PIN) {
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
}

export const syncChip = (page: Page) => page.getByTestId("sync-chip").first();

export async function setOnline(page: Page, online: boolean) {
  await page.context().setOffline(!online);
  await page.evaluate((on) => window.dispatchEvent(new Event(on ? "online" : "offline")), online);
}

/** Type digits on the in-app keypad. */
export async function keypad(page: Page, digits: string) {
  for (const d of digits) await page.locator("section[data-step]").getByRole("button", { name: d, exact: true }).click();
}

export interface Answers {
  bp?: [number, number];
  glucose?: number;
  danger?: string[]; // danger-sign codes to tick, e.g. ["chest_pain"]
  tobacco?: "never" | "past_or_sometimes" | "daily";
  stopAt?: string; // return when this step is showing, without answering it
}

/**
 * Walk the screening flow step by step, keyed on `data-step` so the order of questions (which
 * depends on age, sex and pregnancy) does not matter. Stops at the result screen or an emergency.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function screen(page: Page, a: Answers, L: any = EN): Promise<string> {
  const section = page.locator("section[data-step]");
  const emergency = page.getByRole("alertdialog");
  let last = "";
  for (let guard = 0; guard < 40; guard++) {
    await expect(section).toHaveCount(1);
    if (await emergency.isVisible()) return "emergency";
    const step = (await section.getAttribute("data-step"))!;
    if (step === "review" || step === a.stopAt) return step;
    if (step === last) {
      // Still animating out, or a click did not land yet.
      await page.waitForTimeout(150);
      continue;
    }
    const q = section;
    const button = (name: string) => q.getByRole("button", { name, exact: true });
    switch (step) {
      case "consent": await button(L.screen.consent.yes).click(); break;
      case "basics": await button(L.common.next).click(); break;
      case "pregnant": case "alcohol": case "fh_cv": await button(L.common.no).click(); break;
      case "tobacco": await button(L.screen.opt[a.tobacco ?? "never"]).click(); break;
      case "activity": await button(L.screen.opt.moderate).click(); break;
      case "fh_dm": await button(L.screen.opt.none).click(); break;
      case "bp1": case "bp2":
        if (!a.bp) { await button(L.common.skip).click(); break; }
        await keypad(page, String(a.bp[0]));
        await keypad(page, String(a.bp[1]));
        await button(L.common.next).click();
        break;
      case "glucose":
        if (!a.glucose) { await button(L.common.skip).click(); break; }
        await keypad(page, String(a.glucose));
        await button(L.common.next).click();
        break;
      case "danger":
        if (a.danger?.length) {
          for (const code of a.danger) await button(L.symptoms[code]).click();
          // A red-flag sign opens the emergency screen at once.
          await expect(emergency).toBeVisible();
          return "emergency";
        }
        await button(L.screen.none_of_these).click();
        break;
      case "symptoms": await button(L.screen.finish).click(); break;
      default: await button(L.common.skip).click(); // waist, height, weight, hb, spo2
    }
    last = step;
    await expect(section.and(page.locator(`[data-step="${step}"]`))).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
  }
  throw new Error("screening did not finish");
}

/** Staff API session, for checking what reached the server. */
export async function staffApi(request: APIRequestContext, phone: string) {
  const res = await request.post("/api/auth/login", { data: { phone, pin: PIN } });
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: async <T>(path: string): Promise<T> => {
      const r = await request.get(`/api${path}`, { headers });
      expect(r.ok(), `${path} → ${r.status()}`).toBeTruthy();
      return r.json();
    },
    post: async <T>(path: string, data: unknown): Promise<T> => {
      const r = await request.post(`/api${path}`, { headers, data });
      expect(r.ok(), `${path} → ${r.status()}`).toBeTruthy();
      return r.json();
    },
  };
}

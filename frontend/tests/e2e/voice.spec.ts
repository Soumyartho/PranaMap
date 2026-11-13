/**
 * On-device speech, end to end: download the language's model once, go offline, speak a blood
 * pressure into the (fake) microphone and see it parsed for confirmation. Opt-in with E2E_VOICE=1:
 * the first run downloads ~138 MB (Hindi/Bengali) or ~77 MB (English) of model weights.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { devices, expect, test } from "@playwright/test";
import { DEMO, screen, setOnline, signIn, swReady } from "./helpers";

const LANGS = ["hi", "bn", "en"] as const;
const LABEL = { hi: "हिन्दी", bn: "বাংলা", en: "English" };

test.skip(!process.env.E2E_VOICE, "set E2E_VOICE=1 to run the on-device speech test");
test.setTimeout(15 * 60_000);

for (const lang of LANGS) {
  test.describe(lang, () => {
    // Chromium plays this file as the microphone: a recorded "150 by 95" in the language.
    const wav = fileURLToPath(new URL(`../fixtures/audio/${lang}_bp_mic.wav`, import.meta.url));
    test(`hears a blood pressure in ${lang} with no network`, async ({ playwright, baseURL }) => {
      // The microphone file is a launch flag, so each language gets its own browser.
      const browser = await playwright.chromium.launch({
        executablePath: process.env.E2E_CHROME,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`],
      });
      const context = await browser.newContext({ ...devices["Pixel 7"], baseURL, permissions: ["microphone"] });
      const page = await context.newPage();
      const L = JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url), "utf8"));
      await signIn(page, DEMO.asha, lang);
      await swReady(page);

      await page.getByRole("button", { name: L.settings.title }).click();
      await page.locator("li", { hasText: LABEL[lang] }).getByRole("button", { name: L.settings.download }).click();
      await expect(page.getByText(L.settings.ready).first()).toBeVisible({ timeout: 12 * 60_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      await setOnline(page, false);
      await page.locator('a[href^="/asha/screen/"]').first().click();
      await screen(page, { stopAt: "bp1" }, L);
      await page.getByRole("button", { name: L.screen.tap_speak }).click();
      await expect(page.getByText(L.screen.heard)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText("150 / 95")).toBeVisible();
      await browser.close();
    });
  });
}

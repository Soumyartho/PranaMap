/**
 * The ASHA's phone: a full screening in airplane mode, the emergency path, reading a device display
 * from a photo, and the performance budget on a throttled CPU.
 */
import { expect, test, type Page } from "@playwright/test";
import { DEMO, EN, keypad, screen, setOnline, signIn, staffApi, swReady, syncChip, unlock } from "./helpers";

async function firstPersonToScreen(page: Page): Promise<string> {
  const link = page.locator('a[href^="/asha/screen/"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  await link.click();
  return href.split("/").pop()!;
}

test.describe("ASHA phone", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.asha);
    await swReady(page);
    // First pull of the village data is done once the sync chip settles.
    await expect(syncChip(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
  });

  test("screens a person offline, keeps it safe on the phone, and syncs the referral when back online", async ({ page, request }) => {
    await setOnline(page, false);
    await expect(syncChip(page)).toHaveAttribute("data-state", "offline");

    const personId = await firstPersonToScreen(page);
    expect(await screen(page, { bp: [172, 108], glucose: 245, tobacco: "daily" })).toBe("review");

    // Stage 2 hypertension and high glucose: the result asks for a referral, computed on the phone.
    await expect(page.getByText(EN.result.title, { exact: true })).toBeVisible();
    await expect(page.getByText(EN.result.route, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: EN.result.save, exact: true }).click();
    await page.waitForURL(/\/asha\/homes\//);

    // Encrypted in IndexedDB, waiting in the outbox.
    await expect(syncChip(page)).toHaveAttribute("data-state", "offline");
    await expect.poll(async () => Number(await syncChip(page).getAttribute("data-queued"))).toBeGreaterThan(0);

    await setOnline(page, true);
    await expect(syncChip(page)).toHaveAttribute("data-queued", "0", { timeout: 30_000 });
    await expect(syncChip(page)).toHaveAttribute("data-state", "synced");

    // The medical officer of the block now sees the referral, scored by the same engine.
    const mo = await staffApi(request, DEMO.mo);
    const referrals = await mo.get<{ person_id: string; reasons: string[]; status: string }[]>("/referrals");
    const mine = referrals.find((r) => r.person_id === personId);
    expect(mine, "referral reached the PHC").toBeTruthy();
    expect(mine!.reasons).toContain("hypertension");
  });

  test("a danger sign opens the emergency screen, with no network", async ({ page }) => {
    await setOnline(page, false);
    await firstPersonToScreen(page);
    expect(await screen(page, { danger: ["chest_pain"] })).toBe("emergency");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("link", { name: new RegExp(EN.emergency.call) })).toHaveAttribute("href", "tel:108");
    await expect(dialog.getByRole("link", { name: new RegExp(EN.emergency.sms) })).toHaveAttribute("href", /^sms:/);
    await dialog.getByRole("button", { name: EN.emergency.called }).click();
    await expect(dialog).toBeHidden();
  });

  test("reads a blood pressure monitor's display from a photo", async ({ page }) => {
    await firstPersonToScreen(page);
    const section = page.locator("section[data-step]");
    await screen(page, { stopAt: "bp1" });
    await expect(section).toHaveAttribute("data-step", "bp1");

    const png = await page.evaluate(drawDisplay, ["152", "96"]);
    await page.getByRole("button", { name: EN.device.camera }).click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "monitor.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.getByRole("button", { name: EN.device.read }).click();
    await page.getByRole("button", { name: EN.device.use }).click();
    await expect(section.getByText("152", { exact: true })).toBeVisible();
    await expect(section.getByText("96", { exact: true })).toBeVisible();
  });

  test("stays within the performance budget on a slow phone CPU", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); // a 2 GB, 4-core Android phone
    await firstPersonToScreen(page);
    const section = page.locator("section[data-step]");
    await expect(section).toHaveAttribute("data-step", "consent");
    await section.getByRole("button", { name: EN.screen.consent.yes, exact: true }).click();
    await expect(section).toHaveAttribute("data-step", "basics");
    await section.getByRole("button", { name: EN.common.next, exact: true }).click();

    // Each answer recomputes the whole risk engine on the phone; it has to feel instant.
    const t0 = Date.now();
    await keypadOrPick(page);
    const stepMs = Date.now() - t0;
    expect(stepMs, "answer → next question").toBeLessThan(1500);

    // Cold load of the app shell from the service worker cache, throttled, up to the PIN screen
    // (a reload locks the encrypted local data), then unlock and decrypt the day's list.
    const t1 = Date.now();
    await page.goto("/asha");
    await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
    const coldStart = Date.now() - t1;
    expect(coldStart, "cold start to PIN screen").toBeLessThan(4000);
    const t2 = Date.now();
    await unlock(page);
    await expect(page.locator('a[href^="/asha/screen/"]').first()).toBeVisible();
    expect(Date.now() - t2, "PIN to usable list").toBeLessThan(4000);
    test.info().annotations.push({ type: "perf", description: `answer ${stepMs} ms · cold start ${coldStart} ms · unlock ${Date.now() - t2} ms (4x CPU throttle)` });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
});

/** Answer whatever step is showing with its first option, then wait for the next one. */
async function keypadOrPick(page: Page) {
  const section = page.locator("section[data-step]");
  const step = await section.getAttribute("data-step");
  if (step === "bp1") await keypad(page, "120");
  else await section.locator("button[aria-pressed]").first().click();
  await expect(section).not.toHaveAttribute("data-step", step!);
}

/**
 * Runs in the page: draws an LCD-style seven-segment display (dark digits on a grey-green panel,
 * one reading per row, slight blur like a phone photo) and returns it as base64 PNG.
 */
async function drawDisplay(rows: string[]): Promise<string> {
  const SEG: Record<string, string> = {
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
  };
  const W = 46, H = 80, T = 9, GAP = 18;
  const canvas = new OffscreenCanvas(420, rows.length * (H + 40) + 60);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#b9c4b0";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#1d221c";
  g.filter = "blur(1px)";
  rows.forEach((text, row) => {
    const top = 40 + row * (H + 40);
    const left = canvas.width - 40 - text.length * (W + GAP);
    [...text].forEach((ch, i) => {
      const x = left + i * (W + GAP);
      const r = (sx: number, sy: number, w: number, h: number) => g.fillRect(x + sx, top + sy, w, h);
      for (const s of SEG[ch]) {
        if (s === "a") r(T, 0, W - 2 * T, T);
        if (s === "g") r(T, H / 2 - T / 2, W - 2 * T, T);
        if (s === "d") r(T, H - T, W - 2 * T, T);
        if (s === "f") r(0, T, T, H / 2 - T - 2);
        if (s === "b") r(W - T, T, T, H / 2 - T - 2);
        if (s === "e") r(0, H / 2 + 2, T, H / 2 - T - 2);
        if (s === "c") r(W - T, H / 2 + 2, T, H / 2 - T - 2);
      }
    });
  });
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

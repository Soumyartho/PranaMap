/**
 * PHC and doctor screens (desktop): the medical officer's triage board and model monitoring, and a
 * doctor closing the loop on a teleconsult, which the server records as a confirmed outcome.
 */
import { expect, test } from "@playwright/test";
import { DEMO, signIn, staffApi } from "./helpers";

test("medical officer sees the triage board, alerts and the shadow-mode model panel", async ({ page }) => {
  await signIn(page, DEMO.mo);
  await page.waitForURL(/\/phc/);
  for (const lane of ["Urgent", "This week", "Monitor"]) {
    await expect(page.getByRole("heading", { name: new RegExp(`^${lane}`) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Risk model monitoring" })).toBeVisible();
  await expect(page.getByText("Shadow mode.", { exact: true })).toBeVisible();
});

test("doctor records a visit outcome and the referral closes", async ({ page, request }) => {
  await signIn(page, DEMO.doctor);
  await page.waitForURL(/\/doctor/);

  const first = page.locator("aside li button").first();
  await expect(first).toBeVisible();
  const name = (await first.locator("span.truncate").textContent())!.trim();
  await first.click();

  await expect(page.getByRole("heading", { name: "Record the visit" })).toBeVisible();
  // Mark the first condition the referral was for as confirmed (or none, if it listed none).
  const conditions = page.locator("section button[aria-pressed]");
  await conditions.first().click();
  await page.getByPlaceholder(/Plan/).fill("Started amlodipine 5 mg; recheck BP in 2 weeks.");
  await page.getByRole("button", { name: "Save and close loop" }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const mo = await staffApi(request, DEMO.mo);
  const closed = await mo.get<{ status: string; person: { name: string | null }; outcome: { plan: string; evaluated: string[] } | null }[]>(
    "/referrals?include_closed=true",
  );
  const record = closed.find((r) => r.person.name === name && r.status === "closed" && r.outcome?.plan.startsWith("Started amlodipine"));
  expect(record, "closed referral with the outcome").toBeTruthy();
});

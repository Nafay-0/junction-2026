import { expect, test } from "@playwright/test";
import { watchErrors } from "../support/dock";

/**
 * Read-only smoke of a deployed site in a phone-sized browser: GET pages and JSON only; no join, no order, no
 * sign-in, at most one live price lookup (one product page). Safe during the event.
 *   E2E_LIVE_URL=https://jolly-wondrous-bunny.eur-1.aiven.app pnpm exec playwright test --project=live
 */
test.skip(!process.env.E2E_LIVE_URL, "set E2E_LIVE_URL to the deployed site");

test("health: catalogue, services, ledger, demo caps", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  test.info().annotations.push({ type: "health", description: JSON.stringify({ commit: h.version?.commit, catalog: h.catalog, demoLimits: h.demoLimits, diverged: h.dataPlane?.ledger?.diverged ?? null }) });
  expect(h.status).toBe("ok");
  expect(h.catalog?.source).toBe("valio");
  expect(h.dataPlane?.ledger?.diverged ?? null).toBeNull();
  for (const s of h.dataPlane?.services ?? []) if (s.inUse) expect.soft(s.reachable, `${s.service} reachable`).toBe(true);
  expect.soft(h.demoLimits?.llm?.usd ?? 0, "model spend today below its cap").toBeLessThan(h.demoLimits?.llm?.maxUsd ?? Infinity);
});

test("the wall renders with its QR code and no script errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
  await expect(page.locator("figure svg").first()).toBeVisible();
  await expect(page.getByText(/synthetic data/).first()).toBeVisible();
  await page.waitForTimeout(3_000); // a few live refreshes
  expect(errors).toEqual([]);
});

test("join page is served (HTML only: loading it in a browser would prepare a passkey)", async ({ request }) => {
  const r = await request.get("/join");
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/AimoPilot/);
});

test("the shop: kitchens, catalogue, one product page with a live price", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/k");
  await expect(page.getByRole("link", { name: /Ravintola Kaari/ }).first()).toBeVisible();
  await page.goto("/k/kaari/catalogue");
  const first = page.locator('a[href^="/k/kaari/catalogue/"]').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.click();
  await expect(page.getByText(/Checked live with the wholesaler|could not|not available/i).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("operations desk asks for the passcode", async ({ page }) => {
  await page.goto("/ops/enter");
  await expect(page.getByLabel("Passcode")).toBeVisible();
});

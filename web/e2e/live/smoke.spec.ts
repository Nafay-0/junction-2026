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

test("the landing page is at the address, and leads to the agent and the wall", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /An AI buyer for every kitchen/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Talk to the agent/ }).first()).toHaveAttribute("href", "/k");
  await expect(page.getByRole("link", { name: "Watch it live at the gate" })).toHaveAttribute("href", "/wall");
  await expect(page.getByText(/demo on synthetic data/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the wall renders with its QR code and no script errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/wall");
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

test("the shop's door: sign-in form; the stage kitchens are private to strangers", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/k");
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  await page.goto("/k/kaari");
  await expect(page.getByRole("heading", { name: "This kitchen is private" })).toBeVisible();
  expect(errors).toEqual([]);
});

// Opt-in (E2E_LIVE_SIGNIN=1): signs in to the first public test account (a session row, nothing else), opens the
// catalogue and one product page (one live price lookup).
test("signed in to a public test account: catalogue and one product page with a live price", async ({ page }) => {
  test.skip(!process.env.E2E_LIVE_SIGNIN, "E2E_LIVE_SIGNIN=1 to sign in to a public test account");
  const { TEST_ACCOUNTS } = await import("../../src/server/accounts/test-accounts");
  const tester = TEST_ACCOUNTS[0];
  const errors = watchErrors(page);
  await page.goto("/k");
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username", { exact: true }).fill(tester.username);
  await form.getByLabel("Password", { exact: true }).fill(tester.password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/k/${tester.username}`);
  await page.goto(`/k/${tester.username}/catalogue`);
  const first = page.locator(`a[href^="/k/${tester.username}/catalogue/"]`).first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.click();
  await expect(page.getByText(/Checked live with the wholesaler|could not|not available/i).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("operations desk: anyone may look; staff sign in with the passcode", async ({ page }) => {
  await page.goto("/ops");
  await expect(page.locator("text=You are looking, not operating. >> visible=true").first()).toBeVisible({ timeout: 20_000 });
  await page.goto("/ops/enter");
  await expect(page.getByLabel("Passcode")).toBeVisible();
});

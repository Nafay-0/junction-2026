import { expect, test, type Browser, type Page, devices } from "@playwright/test";
import { STAGE_PASSWORDS } from "../support/dock";
import { card, cards, option, say } from "../support/thread";

/**
 * Order pages watching a request that waits for sign-off, from one venue address, with the public limits on.
 * QA found that two such pages exceeded the console's per-address limit within a minute (the old order lane). Each
 * page here is a real /k/kaari/order (the conversation thread, main b9f934e) with its own order waiting for the head
 * chef; every 429 the pages receive is counted for 75 s. Kaari has one thread: the pages share it, as two screens of
 * one kitchen do; the first starts it over.
 */
const LIMITS_URL = process.env.E2E_LIMITS_URL;

async function watcher(browser: Browser, first: boolean): Promise<{ page: Page; refusals: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: LIMITS_URL });
  const page = await context.newPage();
  const refusals: string[] = [];
  page.on("response", async (r) => {
    if (r.status() !== 429) return;
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    refusals.push(`${new URL(r.url()).pathname} ${body.error?.message?.match(/"([^"]+)"/)?.[1] ?? "?"}`);
  });
  await page.goto("/k");
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username", { exact: true }).fill("kaari");
  await form.getByLabel("Password", { exact: true }).fill(STAGE_PASSWORDS.kaari);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/k/kaari");
  if (first) expect((await page.request.post("/ui-api/kitchens/kaari/thread/reset")).ok()).toBe(true);
  await page.goto("/k/kaari/order");
  const gates = cards(page, "gate");
  const before = await gates.count();
  await say(page, "100 litres of milk for Thursday");
  // The duplicate check ("Order again?") when an earlier watcher's order for the same day waits; then the options.
  const again = card(page, "anomaly").getByRole("button", { name: "Yes, that is right" });
  await expect(again.or(option(page, "Best"))).toBeVisible({ timeout: 20_000 });
  if (await again.isVisible()) await again.click();
  await option(page, "Best").getByRole("button", { name: "Choose" }).click({ timeout: 20_000 });
  await expect(gates.nth(before)).toContainText(/Waiting for /, { timeout: 20_000 });
  return { page, refusals, close: () => context.close() };
}

test.skip(!LIMITS_URL, "needs the limits-on server (E2E_LIMITS_URL)");

for (const n of (process.env.E2E_WATCHERS ?? "1,2").split(",").map(Number)) {
  test(`${n} order page(s) watching a waiting order from one address, 75 s`, async ({ browser }) => {
    test.setTimeout(240_000);
    await new Promise((r) => setTimeout(r, 61_000)); // a fresh rate-limit minute
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(await watcher(browser, i === 0));
    const start = pages.map((p) => p.refusals.length);
    await pages[0].page.waitForTimeout(75_000);
    const during = pages.map((p, i) => p.refusals.slice(start[i]));
    const byRule = during.flat().reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {});
    test.info().annotations.push({ type: `${n} watcher(s)`, description: JSON.stringify({ refusedWhileWatching: during.map((d) => d.length), byRule }) });
    for (const p of pages) await p.close();
    if (n === 1) expect(during.flat()).toEqual([]);
  });
}

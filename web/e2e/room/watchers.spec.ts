import { expect, test, type Browser, type Page, devices } from "@playwright/test";
import { STAGE_PASSWORDS } from "../support/dock";

/**
 * Order pages watching a request that waits for sign-off, from one venue address, with the public limits on.
 * QA found that two such pages exceed the console's per-address limit within a minute. Each page here is a real
 * /k/kaari/order with its own waiting order; every 429 the pages receive is counted for 75 s.
 */
const LIMITS_URL = process.env.E2E_LIMITS_URL;

async function watcher(browser: Browser): Promise<{ page: Page; refusals: string[]; close: () => Promise<void> }> {
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
  await page.goto("/k/kaari/order");
  await page.getByRole("button", { name: /100 litres of milk for Thursday/ }).filter({ visible: true }).first().click();
  const offline = page.getByRole("button", { name: "Use the offline example reader" }).filter({ visible: true });
  await expect(offline.or(page.getByRole("region", { name: /^Step 3:/ }))).toBeVisible({ timeout: 20_000 });
  if (await offline.count()) await offline.first().click();
  const meant = page.getByRole("button", { name: /Yes, I meant that/ }).filter({ visible: true });
  const best = page.getByRole("region", { name: /^Step 3:/ }).getByRole("article", { name: /^Best/ });
  await expect(meant.or(best).first()).toBeVisible({ timeout: 20_000 });
  if (await meant.count()) await meant.first().click();
  await best.getByRole("button", { name: "Get a fixed price for this" }).click();
  await page.getByRole("region", { name: /^Step 4:/ }).getByRole("button", { name: "Place the order" }).click();
  await expect(page.getByRole("region", { name: /^Step 6:/ })).toContainText(/Waiting for a person/, { timeout: 20_000 });
  return { page, refusals, close: () => context.close() };
}

test.skip(!LIMITS_URL, "needs the limits-on server (E2E_LIMITS_URL)");

for (const n of [1, 2]) {
  test(`${n} order page(s) watching a waiting order from one address, 75 s`, async ({ browser }) => {
    test.setTimeout(240_000);
    await new Promise((r) => setTimeout(r, 61_000)); // a fresh rate-limit minute
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(await watcher(browser));
    const start = pages.map((p) => p.refusals.length);
    await pages[0].page.waitForTimeout(75_000);
    const during = pages.map((p, i) => p.refusals.slice(start[i]));
    const byRule = during.flat().reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {});
    test.info().annotations.push({ type: `${n} watcher(s)`, description: JSON.stringify({ refusedWhileWatching: during.map((d) => d.length), byRule }) });
    for (const p of pages) await p.close();
    if (n === 1) expect(during.flat()).toEqual([]);
  });
}

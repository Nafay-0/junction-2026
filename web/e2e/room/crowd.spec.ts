import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page, devices } from "@playwright/test";
import { addPasskey, approveButton, askForMilkAndWaitForSignOff, joinAsApprover } from "../support/dock";

/**
 * The venue's Wi-Fi: every phone reaches the server from one public address, and the public rate limits are per
 * address (and per kitchen). Against the second test server, which has the public limits on, N visitors join at
 * once, wait on /approver for a while (as people do while the presenter talks), ask their agent for the 1,000 L,
 * and sign. A wall is open from the same address the whole time. Every 429 is recorded with its rule.
 * Results: test-results/crowd-<N>.json and the test's annotations.
 */
const LIMITS_URL = process.env.E2E_LIMITS_URL;
const IDLE_MS = Number(process.env.E2E_CROWD_IDLE_MS ?? 30_000);

type Visitor = { i: number; joinedMs?: number; signedMs?: number; ok: boolean; step: string; error?: string; refusals: string[] };

async function visitor(browser: Browser, i: number, gate: Promise<void>, idle: number): Promise<Visitor> {
  const v: Visitor = { i, ok: false, step: "start", refusals: [] };
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: LIMITS_URL });
  const page = await context.newPage();
  page.on("response", async (r) => {
    if (r.status() !== 429) return;
    const body = await r.json().catch(() => ({}));
    v.refusals.push(`${new URL(r.url()).pathname} ${(body as { error?: { message?: string } }).error?.message?.match(/"([^"]+)"/)?.[1] ?? "?"}`);
  });
  const t0 = Date.now();
  try {
    await addPasskey(page);
    v.step = "join";
    await joinAsApprover(page);
    v.joinedMs = Date.now() - t0;
    v.step = "waiting";
    await page.waitForTimeout(idle);
    await gate; // everyone taps at about the same moment
    v.step = "order";
    const t1 = Date.now();
    await askForMilkAndWaitForSignOff(page);
    v.step = "sign";
    await approveButton(page).click();
    await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 45_000 });
    v.signedMs = Date.now() - t1;
    v.ok = true;
    v.step = "done";
  } catch (e) {
    v.error = String((e as Error).message).split("\n")[0].slice(0, 200);
    await page.screenshot({ path: test.info().outputPath(`visitor-${i}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  return v;
}

async function crowd(browser: Browser, n: number): Promise<Visitor[]> {
  const wallContext = await browser.newContext({ baseURL: LIMITS_URL, viewport: { width: 1920, height: 1080 } });
  const wall = await wallContext.newPage();
  const wallRefusals: string[] = [];
  wall.on("response", (r) => r.status() === 429 && wallRefusals.push(new URL(r.url()).pathname));
  await wall.goto("/");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // Visitors arrive over ~5 s, as when a QR code goes up on the wall.
  const runs = Array.from({ length: n }, (_, i) => new Promise<Visitor>((res) => setTimeout(() => res(visitor(browser, i, gate, IDLE_MS)), (i * 5000) / n)));
  setTimeout(release, 8000 + IDLE_MS);
  const out = await Promise.all(runs);
  const signedOnWall = await wall.getByText(/^Signed order/).count();
  await wallContext.close();
  const summary = {
    visitors: n,
    completed: out.filter((v) => v.ok).length,
    signedOnWall,
    wallRefusals: wallRefusals.length,
    refusalsByRule: Object.entries(out.flatMap((v) => v.refusals).reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {})),
    visitorsWithRefusals: out.filter((v) => v.refusals.length).length,
    joinMsMax: Math.max(...out.map((v) => v.joinedMs ?? 0)),
    signMsMax: Math.max(...out.map((v) => v.signedMs ?? 0)),
    failures: out.filter((v) => !v.ok).map((v) => `#${v.i} at ${v.step}: ${v.error}`),
    visitorsDetail: out,
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/crowd-${n}.json`, JSON.stringify(summary, null, 2));
  test.info().annotations.push({ type: `crowd ${n}`, description: JSON.stringify({ ...summary, visitorsDetail: undefined }) });
  return out;
}

test.describe.configure({ mode: "serial" });
test.skip(!LIMITS_URL, "needs the limits-on server (E2E_LIMITS_URL)");

test("two visitors behind one address each join, are asked and sign", async ({ browser }) => {
  test.setTimeout(180_000);
  const out = await crowd(browser, 2);
  expect(out.filter((v) => v.ok).length).toBe(2);
});

test("ten visitors behind one address each join, are asked and sign", async ({ browser }) => {
  test.setTimeout(300_000);
  await new Promise((r) => setTimeout(r, 61_000)); // a fresh rate-limit minute after the previous test
  const out = await crowd(browser, 10);
  // Recorded either way; the assertion is the demo's requirement.
  expect(out.filter((v) => !v.ok).map((v) => `#${v.i} at ${v.step}: ${v.error} [${v.refusals.join("; ")}]`)).toEqual([]);
});

// E2E_CROWD_MAX=20,30: bigger crowds, to find the first limit that bites (not part of the default run).
for (const n of (process.env.E2E_CROWD_MAX ?? "").split(",").filter(Boolean).map(Number)) {
  test(`${n} visitors behind one address (exploratory)`, async ({ browser }) => {
    test.setTimeout(600_000);
    await new Promise((r) => setTimeout(r, 61_000));
    await crowd(browser, n);
  });
}

import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The show at the table, end to end on a production build: the wall in table mode (signed in to the operations
 * side), a visitor's phone (virtual passkey authenticator) scans and joins, the wall greets their kitchen and plays
 * the week through the real gate, Thursday's order lands on the phone and is approved with the passkey, the wall
 * shows it signed with the person's name, and the week finishes with its tally. Screenshots of the three moments
 * go to SHOW_SHOTS (default /tmp/dock-show-shots).
 *
 *   E2E_BASE_URL=http://localhost:3317 pnpm exec playwright test e2e/show.spec.ts
 */
const SHOTS = process.env.SHOW_SHOTS ?? "/tmp/dock-show-shots";
mkdirSync(SHOTS, { recursive: true });
try {
  process.loadEnvFile(".env.local"); // the operations passcode, if this machine sets one (never printed)
} catch {
  // no local env: the server must be in demo mode
}

async function addPasskeyAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function wallSignedIn(browser: Browser, path: string, size = { width: 1920, height: 1080 }) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const wall = await ctx.newPage();
  const enter = await wall.request.post("/ops-api/session", { data: { passcode: process.env.DOCK_OPS_PASSCODE || undefined, name: "E2E presenter" } });
  expect(enter.ok()).toBe(true);
  if (path === "/present/table") await untilNoFreshKitchen(wall);
  await wall.goto(path);
  return { ctx, wall };
}

/**
 * Table mode greets a kitchen made up to a minute before the wall opened (a visitor who scanned just before). Run
 * after the other spec files, their visitor kitchens are that fresh, so the wall would open on their week instead of
 * the QR code. Wait until every visitor kitchen on the server is older than that window.
 */
async function untilNoFreshKitchen(wall: Page) {
  for (let i = 0; i < 75; i++) {
    const r = await wall.request.get("/ui-api/show/kitchens");
    const { kitchens, now } = (await r.json()) as { kitchens: { createdAt: string; passkey?: boolean; house?: boolean }[]; now: string };
    const newest = Math.max(0, ...kitchens.filter((k) => k.passkey && !k.house).map((k) => Date.parse(k.createdAt)));
    if (Date.parse(now) - newest > 62_000) return;
    await wall.waitForTimeout(1000);
  }
}

test.describe.configure({ timeout: 240_000 });

test("table mode: a visitor joins, their week plays through the gate, the sign-off lands from their phone", async ({ page, browser }) => {
  const { ctx, wall } = await wallSignedIn(browser, "/present/table");
  await expect(wall.getByRole("heading", { name: "Scan, and a hotel kitchen is yours." })).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/table-attract.png` });

  // The visitor's phone scans the QR code and makes a passkey.
  await addPasskeyAuthenticator(page);
  await page.goto("/join");
  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver");
  await expect(page.getByText("Waiting for requests")).toBeVisible();

  // The wall greets the new kitchen and its week starts by itself.
  await expect(wall.getByText(/^Welcome, /)).toBeVisible({ timeout: 15_000 });
  await expect(wall.getByRole("heading", { name: "Monday" })).toBeVisible({ timeout: 30_000 });
  await expect(wall.getByText("Passed: the agent may place it alone")).toBeVisible({ timeout: 30_000 });
  await wall.screenshot({ path: `${SHOTS}/week-monday-passed.png` });

  await expect(wall.getByRole("heading", { name: "Tuesday" })).toBeVisible({ timeout: 40_000 });
  await expect(wall.getByText("Stopped before any price lookup", { exact: true })).toBeVisible({ timeout: 20_000 });
  await wall.screenshot({ path: `${SHOTS}/week-tuesday-slip.png` });

  await expect(wall.getByRole("heading", { name: "Wednesday" })).toBeVisible({ timeout: 40_000 });
  await expect(wall.getByText("Simulated", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await wall.screenshot({ path: `${SHOTS}/week-wednesday-stockout.png` });

  // Thursday: stopped at the gate, on the phone.
  await expect(wall.getByRole("heading", { name: "Thursday" })).toBeVisible({ timeout: 40_000 });
  await expect(wall.getByText("Stopped at the gate")).toBeVisible({ timeout: 30_000 });
  await expect(wall.getByText(/Waiting for /).first()).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/week-thursday-gate.png` });
  await page.waitForURL("**/approve/**", { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/phone-signoff.png` });
  const approve = page.getByRole("button", { name: /^Approve \d/ });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 20_000 });

  // The sign-off lands on the wall, with the person's name.
  await expect(wall.getByText("Signed", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(wall.getByText(/with a passkey/).first()).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/week-thursday-signed.png` });

  await expect(wall.getByRole("heading", { name: "Saturday" })).toBeVisible({ timeout: 60_000 });
  await expect(wall.getByText("Refused at the gate")).toBeVisible({ timeout: 30_000 });
  await wall.screenshot({ path: `${SHOTS}/week-saturday-refused.png` });

  await expect(wall.getByRole("heading", { name: "The week, done" })).toBeVisible({ timeout: 40_000 });
  await expect(wall.getByText("wrong orders")).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/week-summary.png` });

  // The same week, read back from the director: every day decided by the gate, nothing wrong, the kitchen cleaned.
  const weeks = (await (await wall.request.get("/ui-api/show/week")).json()) as { weeks: { state: string; tally: Record<string, number>; steps: { kind: string; status: string; signOff?: { state: string; method?: string } }[]; cleanup?: string[] }[] };
  const run = weeks.weeks[0];
  expect(run.state).toBe("finished");
  expect(run.steps.every((s) => s.status === "done")).toBe(true);
  expect(run.steps.find((s) => s.kind === "lastminute")?.signOff).toMatchObject({ state: "approved", method: "passkey" });
  expect(run.tally).toMatchObject({ refused: 1, wrongOrders: 0 });
  expect(run.cleanup?.join(" ")).toMatch(/Put back the kitchen's own past/);
  await ctx.close();
});

test("presenter mode: behind the passcode, keys drive the acts, F plays a labelled recording", async ({ browser }) => {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const out = await anon.newPage();
  await out.goto("/present");
  await expect(out.getByRole("heading", { name: "Presenter mode" })).toBeVisible();
  expect((await out.request.get("/ui-api/show/kitchens")).status()).toBe(401);
  await anon.close();

  const { ctx, wall } = await wallSignedIn(browser, "/present", { width: 1440, height: 900 });
  await expect(wall.getByText("The problem, as a person feels it")).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/presenter-title.png` });
  await wall.keyboard.press("p");
  await expect(wall.getByRole("dialog", { name: /Preflight/ })).toBeVisible();
  await expect(wall.getByText("Partner catalogue")).toBeVisible({ timeout: 20_000 });
  await wall.screenshot({ path: `${SHOTS}/presenter-preflight.png` });
  await wall.keyboard.press("Escape");

  // Act 2: an attack, refused with its rule.
  await wall.keyboard.press("2");
  await expect(wall.getByText("Refused at the gate").first()).toBeVisible({ timeout: 20_000 });
  await expect(wall.getByText(/The kitchen must sign the mandate|mandate must be signed/i).first()).toBeVisible();
  await wall.screenshot({ path: `${SHOTS}/presenter-attack-forged.png` });
  await wall.keyboard.press("4");
  await expect(wall.getByText(/Only the named person can sign off/).first()).toBeVisible({ timeout: 30_000 });
  await wall.keyboard.press("s");
  await expect(wall.getByText(/Suspended by the wholesaler's staff/).first()).toBeVisible({ timeout: 20_000 });
  await wall.screenshot({ path: `${SHOTS}/presenter-suspended.png` });
  await wall.keyboard.press("r");
  await expect(wall.getByText(/Resumed: its next call went through again/)).toBeVisible({ timeout: 20_000 });

  // The week's fallback: F shows the recording, labelled as one.
  await wall.keyboard.press("ArrowLeft");
  await expect(wall.getByText("The week, through the real gate")).toBeVisible();
  await wall.keyboard.press("f");
  await expect(wall.getByText(/^Recording of a real run/).first()).toBeVisible({ timeout: 15_000 });
  await expect(wall.getByRole("heading", { name: "Monday" })).toBeVisible({ timeout: 15_000 });
  await wall.screenshot({ path: `${SHOTS}/presenter-week-recording.png` });
  await wall.keyboard.press("f"); // back to live: the stage invites Enter again
  await expect(wall.getByText(/Press Enter to play the week|The week, done|Monday/).first()).toBeVisible();
  await ctx.close();
});

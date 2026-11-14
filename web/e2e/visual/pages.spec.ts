import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addPasskey, askForMilkAndWaitForSignOff, enterOps } from "../support/dock";
import { DIGIT_REWRITES, literal, openStage, settle, steadyText, TIME_REWRITES, VIEWPORT, type Rewrite, type Size } from "../support/a11y-kit";
import { wallFixture } from "./wall-fixture";

/**
 * Visual regression: baseline screenshots of the main pages at the sizes they are used at (wall: 1920x1080 and laptop;
 * phone pages: 390x844; store: phone and laptop; operations: laptop). Baselines live per platform under
 * e2e/__screenshots__/{darwin,linux}/visual/ (snapshotPathTemplate in playwright.config.ts).
 *
 * What is held still, so a diff means the layout changed:
 *   - the wall reads a fixed snapshot (wall-fixture.ts) instead of the live one, with the event stream blocked and the
 *     page clock started at Mon 16 Nov 10:30 Helsinki and stopped once loaded; the rotating rule readout is pinned
 *   - QR codes are masked; the server port, dates, times, countdowns, relative times and ids are rewritten to fixed text
 *     (support/a11y-kit.ts steadyText), also when React re-renders them
 *   - the random demo kitchen, city and person names on /join, /approver, /approve and /call are rewritten to fixed ones
 *   - pages whose numbers move with whatever else ran on the server (store home, orders, operations) have every number
 *     rewritten to 0 and their row lists collapsed; the chart on the store home is masked
 *   - CSS animations are stopped and the caret hidden (playwright.config.ts expect.toHaveScreenshot)
 *
 * Run this project on its own (it gets fresh servers); with the demo projects in the same run, the shared store
 * kitchen's history changes under it.
 */

// One worker, in file order: the store and operations pages first, the phone flow (which leaves a sign-off waiting
// on the server) last, so the operations desk never shows it. Unlike serial mode, a failure does not skip the rest.
test.describe.configure({ mode: "default" });

async function shot(page: Page, name: string, opts: { rewrites?: Rewrite[]; mask?: Locator[]; fullPage?: boolean; collapse?: string[] } = {}) {
  await steadyText(page, opts.rewrites ?? TIME_REWRITES);
  // Proof that a layout break is caught: E2E_VISUAL_BREAK='h1 { margin-top: 24px }' makes every page with an h1 fail.
  if (process.env.E2E_VISUAL_BREAK) await page.addStyleTag({ content: process.env.E2E_VISUAL_BREAK });
  await page.waitForTimeout(150);
  // Row lists that grow with server history are collapsed, so the layout does not depend on how many rows there are.
  const collapse = (opts.collapse ?? []).map((sel) => `${sel} > * { display: none !important; }`).join("\n");
  if (collapse) await page.addStyleTag({ content: collapse });
  const baseline = test.info().snapshotPath(`${name}.png`, { kind: "screenshot" });
  if (!existsSync(baseline) && (process.env.CI || process.env.E2E_VISUAL_WRITE_MISSING) && test.info().config.updateSnapshots !== "all") {
    mkdirSync(path.dirname(baseline), { recursive: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: baseline, fullPage: opts.fullPage ?? false, mask: opts.mask, animations: "disabled", caret: "hide" });
    test.info().annotations.push({ type: "baseline written", description: path.relative(process.cwd(), baseline) });
    return;
  }
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: opts.fullPage ?? false, mask: opts.mask, timeout: 20_000 });
}

// ---------------------------------------------------------------- the wall

// Mon 16 Nov 2026 10:30:00 Helsinki (UTC+2): judging time.
const T0 = Date.UTC(2026, 10, 16, 8, 30, 0);

async function frozenWall(page: Page) {
  await page.route("**/api/v1/events**", (r) => r.abort());
  await page.route("**/ui-api/wall", (r) => r.fulfill({ json: wallFixture(T0 + 20_000) }));
  // The clock runs during load (React reveals streamed Suspense content on a timer), then stops at a fixed time.
  await page.clock.install({ time: T0 });
  await page.goto("/wall");
  await expect(page.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
  await expect(page.getByText("Waiting for Leevi Saarinen")).toBeVisible(); // the fixture has replaced the live snapshot
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.clock.pauseAt(T0 + 20_000);
  await page.clock.runFor(9_500); // past the 9 s "refused just now" highlight
  // The readout rotates through the gate's rules every 3.2 s; with the clock stopped it stays, so pin its words.
  await page.evaluate(() => {
    const lead = [...document.querySelectorAll("span")].find((e) => e.textContent === "The gate checks every order: ");
    const rule = lead?.nextElementSibling;
    if (rule) rule.textContent = "Only the agent named in the mandate";
  });
}

for (const size of ["wall", "laptop"] as const) {
  test(`wall at ${size} size`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT[size]);
    await frozenWall(page);
    await shot(page, `wall-${size}`, { mask: [page.locator("figure svg")] });
  });
}

// ---------------------------------------------------------------- the store, phone and laptop

const MONEY: Rewrite = ["\\d[\\d  ]*,\\d{2} €", "g", "100,00 €"];
const STORE: { id: string; path: string; ready?: (p: Page) => Locator; history?: boolean; collapse?: string[] }[] = [
  { id: "k", path: "/k", ready: (p) => p.getByRole("heading", { name: /Your kitchen's shop|Enter a kitchen/ }) },
  { id: "kaari", path: "/k/kaari", ready: (p) => p.getByRole("heading", { name: "Ravintola Kaari" }).first(), history: true },
  { id: "order", path: "/k/kaari/order", ready: (p) => p.getByRole("button", { name: "Write a request" }) },
  { id: "catalogue", path: "/k/kaari/catalogue" },
  { id: "product", path: "/k/kaari/catalogue/VA-1010" },
  { id: "basket", path: "/k/kaari/basket" },
  { id: "orders", path: "/k/kaari/orders", ready: (p) => p.getByRole("heading", { name: "Orders" }), history: true, collapse: ["main tbody", "main ul"] },
  { id: "agent", path: "/k/kaari/agent" },
];

for (const size of ["phone", "laptop"] as Size[])
  for (const s of STORE)
    test(`store ${s.id} (${s.path}) at ${size} size`, async ({ page }) => {
      await page.setViewportSize(VIEWPORT[size]);
      await openStage(page, s.path);
      if (s.ready) await expect(s.ready(page)).toBeVisible();
      await settle(page, 1200);
      const chart = page.getByText(/^Euros a week/).locator("xpath=..");
      await shot(page, `store-${s.id}-${size}`, {
        rewrites: s.history ? [...TIME_REWRITES, ...DIGIT_REWRITES] : [...TIME_REWRITES, MONEY],
        mask: s.history ? [chart] : [],
        collapse: s.collapse,
      });
    });

// ---------------------------------------------------------------- operations, laptop

for (const path of ["/ops", "/ops/trace", "/ops/safeguards", "/ops/agents", "/ops/radar"])
  test(`operations ${path} at laptop size`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT.laptop);
    await enterOps(page, "Visual check");
    await page.goto(path);
    await settle(page, 1500);
    await shot(page, `ops-${path.slice(1).replace("/", "-")}-laptop`, { rewrites: [...TIME_REWRITES, ...DIGIT_REWRITES], collapse: ["main tbody", "main ol", "main ul"] });
  });

// ---------------------------------------------------------------- phone: join, approver, sign-off, call

type Who = { kitchen: string; city: string; person: string };
const FIXED: Who = { kitchen: "Hotel Fixture", city: "Tampere", person: "Testi Henkilö" };
const names = (w: Who): Rewrite[] => [literal(w.kitchen, FIXED.kitchen), literal(w.city, FIXED.city), literal(w.person, FIXED.person), ...TIME_REWRITES];

test("phone: join, approver and sign-off pages", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await addPasskey(page);
  await page.goto("/join");
  const h = (await page.getByRole("heading", { name: /Become the purchasing manager/ }).innerText()).replace(/\s+/g, " ");
  const m = /manager of (.+) kitchen, (.+)$/.exec(h);
  const person = /You will be (.+?)\./.exec(await page.locator("body").innerText())?.[1];
  expect(m && person, `names on /join: ${h}`).toBeTruthy();
  const who: Who = { kitchen: m![1], city: m![2], person: person! };
  await settle(page);
  await shot(page, "join-phone", { rewrites: names(who), fullPage: true });

  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver", { timeout: 30_000 });
  await expect(page.getByText("Waiting for requests")).toBeVisible();
  await settle(page);
  await shot(page, "approver-phone", { rewrites: names(who), fullPage: true });

  await askForMilkAndWaitForSignOff(page);
  await expect(page.getByRole("button", { name: /^Approve \d/ })).toBeEnabled();
  await settle(page, 1200);
  await shot(page, "approve-phone", { rewrites: [...names(who), ["\\d[\\d  ]*,\\d{2} €", "g", "1 000,00 €"]] });
});

test("phone: presenter sign-in", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await page.goto("/join/presenter");
  await settle(page);
  await shot(page, "presenter-phone", { fullPage: true });
});

test("phone: call the agent", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await page.goto("/call");
  await settle(page);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const m = /purchasing agent of (.+?) kitchen, (.+?) First/.exec(body);
  const person = /makes you (.+?), the kitchen/.exec(body)?.[1];
  expect(m && person, `names on /call: ${body.slice(0, 300)}`).toBeTruthy();
  await shot(page, "call-phone", { rewrites: names({ kitchen: m![1], city: m![2], person: person! }), fullPage: true });
});

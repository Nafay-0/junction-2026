import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { wallFixture } from "../visual/wall-fixture";
import { note, settle, tapTargets, target, textSizes, VIEWPORT, type TextSample } from "../support/a11y-kit";

/**
 * Legibility, reported as findings (annotations + test-results/a11y/legibility-<page>.json), failing only when
 * something is unusable.
 *
 *   Phone (390x844) on /join, /approver, /approve/<id>: text under 12 px; tap targets under 44x44 CSS px (WCAG 2.5.5
 *   AAA / Apple HIG; links inside running text are listed but marked inline). Fails if a primary action (create
 *   passkey, approve, decline) is under 44 px tall, or any text is under 10 px.
 *
 *   Wall (1920x1080) read from 3 m: body text under 24 px and headline figures (numbers alone: counters, clock, totals)
 *   under 48 px. A 24 px x-height-normal font at 1920 px wide on a ~1.4 m wide screen is ~17 mm cap-to-baseline at
 *   ~3 m: about the floor for comfortable reading. Fails only if a counter figure is under 24 px.
 */

const OUT = path.join(__dirname, "../../test-results/a11y");
const save = (id: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `legibility-${id}.json`), JSON.stringify(data, null, 2));
};
const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];

async function phoneReport(page: Page, id: string, primary: RegExp) {
  const text = await textSizes(page);
  const taps = await tapTargets(page);
  const small = uniq(text.filter((t) => t.px < 12), (t) => t.text);
  const smallTaps = uniq(taps.filter((t) => t.w < 44 || t.h < 44), (t) => `${t.name}|${t.w}x${t.h}`);
  save(id, { textUnder12px: small, tapTargetsUnder44: smallTaps, smallestText: text.slice(0, 5) });
  for (const t of small) note(test.info(), "text < 12px", `${id}: ${t.px}px "${t.text}"`);
  for (const t of smallTaps) note(test.info(), "tap < 44px", `${id}: ${t.tag} "${t.name}" ${t.w}x${t.h}${t.inline ? " (inline link)" : ""}`);
  note(test.info(), "summary", `${id}: ${small.length} text runs under 12 px (smallest ${text[0]?.px}px), ${smallTaps.length} of ${taps.length} controls under 44x44`);
  expect(text.filter((t) => t.px < 10), `text under 10 px on ${id}`).toEqual([]);
  const tooSmallPrimary = taps.filter((t) => primary.test(t.name) && t.h < 44);
  expect(tooSmallPrimary, `primary actions under 44 px tall on ${id}`).toEqual([]);
}

test("phone: /join legibility and tap targets", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await target("join").open(page);
  await phoneReport(page, "join", /Create my passkey and start/);
});

test("phone: /approver and /approve/<id> legibility and tap targets", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await target("approver").open(page);
  await phoneReport(page, "approver", /ask my agent for 1|Call your agent/i);
  await page.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
  await page.waitForURL("**/approve/**", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Approve \d/ })).toBeEnabled();
  await settle(page);
  await phoneReport(page, "approve", /^Approve \d|^Decline/);
});

test("wall: readable from 3 m at 1920x1080", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.wall);
  await target("wall").open(page);
  const text = await textSizes(page);
  const isFigure = (t: TextSample) => /^[\d\s  .,:€%+−-]+$/.test(t.text) && /\d/.test(t.text);
  const figures = text.filter(isFigure);
  const body = text.filter((t) => !isFigure(t));
  const smallBody = uniq(body.filter((t) => t.px < 24), (t) => t.text);
  const smallFigures = uniq(figures.filter((t) => t.px < 48), (t) => t.text);
  const histogram: Record<string, number> = {};
  for (const t of text) histogram[`${Math.floor(t.px / 4) * 4}-${Math.floor(t.px / 4) * 4 + 3}px`] = (histogram[`${Math.floor(t.px / 4) * 4}-${Math.floor(t.px / 4) * 4 + 3}px`] ?? 0) + 1;
  save("wall", { thresholds: { bodyPx: 24, figurePx: 48 }, histogram, bodyUnder24: smallBody, figuresUnder48: smallFigures, figures });
  for (const t of smallFigures) note(test.info(), "wall figure < 48px", `${t.px}px "${t.text}"`);
  for (const t of smallBody) note(test.info(), "wall text < 24px", `${t.px}px "${t.text}"`);
  note(test.info(), "summary", `wall: ${smallBody.length} of ${body.length} text runs under 24 px; ${smallFigures.length} of ${figures.length} figures under 48 px; sizes ${JSON.stringify(histogram)}`);
  const counters = page.getByRole("region", { name: "Totals" }).locator("p.display");
  const sizes = await counters.evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length, "the wall's five totals").toBe(5);
  note(test.info(), "wall totals", `the five totals are ${sizes.map((s) => Math.round(s)).join(", ")} px`);
  expect(sizes.filter((s) => s < 24), "total figures on the wall under 24 px").toEqual([]);
});


test("wall: the demo note stays clear of other text once kitchens have joined (1920x1080)", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.wall);
  await page.route("**/api/v1/events**", (r) => r.abort());
  await page.route("**/ui-api/wall", (r) => r.fulfill({ json: wallFixture(Date.now()) })); // two kitchens joined
  await page.goto("/");
  await expect(page.getByText(/^Kitchens here now: 2/)).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const note = [...document.querySelectorAll("aside p")].find((p) => p.textContent?.startsWith("A demo built for the Junction"));
    if (!note) return ["demo note not found"];
    const a = note.getBoundingClientRect();
    const hit: string[] = [];
    for (const el of document.querySelectorAll("aside li, aside h3")) {
      const b = el.getBoundingClientRect();
      if (b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top) hit.push((el.textContent ?? "").slice(0, 60));
    }
    return hit;
  });
  for (const o of overlaps) note(test.info(), "wall overlap", `the "demo on synthetic data" note is drawn over "${o}"`);
  // Reported, not failed: src/app/_wall/wall.tsx:394 (kitchens list) and :78 (note, mt-auto in an overflow-hidden aside).
});

import { expect, test, type Page } from "@playwright/test";
import { note, PHONE, settle, tabThrough, target, upwardJumps, type Stop } from "../support/a11y-kit";
import { stageThread } from "../support/thread";

/**
 * Focus order and focus visibility on the three pages a stranger drives by hand: /join, /approve/<id>, and the store's
 * Order page (the conversation thread). Tab through the page from the top: focus must move down the page (or left to right within a row), never
 * jump back up outside a fixed/sticky layer, and every stop must show a visible indicator (outline, ring, border or
 * background change). The stops are attached for reading.
 */

test.use({ viewport: PHONE });

/** Upward jumps that exist today (finding, not waiver). None since design v2 (the store header's search-before-
 * agent-button jump is gone). Shape: { page: "order", from: /^Search$/, to: /^$/ }. */
const KNOWN_JUMPS: { page: string; from: RegExp; to: RegExp }[] = [];

/**
 * Stops whose focus indicator is drawn by a parent (a focus-within ring), which the per-element check cannot see.
 * Checked by eye on the screenshots: the thread composer's pill gets a 2 px lavender ring when its field has focus
 * (src/app/_ui/thread.tsx:718 focus-within:ring-2; the input itself is outline-none).
 */
const RING_ON_PARENT: { page: string; name: RegExp }[] = [{ page: "order", name: /^100 L lactose-free milk for Thursday$/ }];

async function checkOrder(page: Page, id: string, mustReach: RegExp[]) {
  const stops = await tabThrough(page, 90);
  await test.info().attach(`tab-stops-${id}.json`, { body: JSON.stringify(stops, null, 2), contentType: "application/json" });
  const line = (s: Stop) => `#${s.i} ${s.tag} "${s.name}" at y=${s.top}${s.fixed ? " (fixed)" : ""}`;
  for (const re of mustReach) expect(stops.some((s) => re.test(s.name)), `Tab reaches ${re} on ${id}:\n${stops.map(line).join("\n")}`).toBe(true);
  const jumps = upwardJumps(stops).filter((j) => !KNOWN_JUMPS.some((k) => k.page === id && k.from.test(j.from.name) && k.to.test(j.to.name)));
  for (const j of upwardJumps(stops)) if (!jumps.includes(j)) note(test.info(), "tab order (known)", `${id}: ${line(j.from)} -> ${line(j.to)}`);
  for (const j of jumps) note(test.info(), "tab order", `${id}: ${line(j.from)} -> ${line(j.to)}`);
  expect(jumps.map((j) => `${line(j.from)} -> ${line(j.to)}`), `Tab jumps back up the page on ${id}`).toEqual([]);
  const invisible = stops.filter((s) => !s.indicator && !RING_ON_PARENT.some((k) => k.page === id && k.name.test(s.name)));
  for (const s of invisible) note(test.info(), "no focus indicator", `${id}: ${line(s)}`);
  expect(invisible.map(line), `stops with no visible focus indicator on ${id}`).toEqual([]);
  note(test.info(), "stops", `${id}: ${stops.length} tab stops; indicators: ${[...new Set(stops.map((s) => s.indicator))].join(", ")}`);
}

test("/join: tab order follows the page and focus is visible", async ({ page }) => {
  await target("join").open(page);
  await checkOrder(page, "join", [/^EN$|English/, /Create my passkey and start/]);
});

test("/approve/<id>: tab order follows the page and focus is visible", async ({ page }) => {
  await target("approve").open(page);
  await checkOrder(page, "approve", [/^Approve \d/, /^Decline/, /Add reason/, /Show details/]);
});

test("/k/kaari/order: tab order follows the page and focus is visible (the thread, its suggestions and the composer)", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/order");
    await expect(page.getByRole("heading", { name: "Order with your agent" })).toBeVisible();
    await settle(page);
    await checkOrder(page, "order", [/Skip to the page/, /What did we order last week\?/, /1,000 litres of lactose-free milk/, /^100 L lactose-free milk for Thursday$/, /Hold to talk/, /Send/]);
  } finally {
    release();
  }
});

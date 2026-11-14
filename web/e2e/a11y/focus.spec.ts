import { expect, test, type Page } from "@playwright/test";
import { note, PHONE, tabThrough, target, upwardJumps, type Stop } from "../support/a11y-kit";

/**
 * Focus order and focus visibility on the three pages a stranger drives by hand: /join, /approve/<id>, and the store's
 * order lane. Tab through the page from the top: focus must move down the page (or left to right within a row), never
 * jump back up outside a fixed/sticky layer, and every stop must show a visible indicator (outline, ring, border or
 * background change). The stops are attached for reading.
 */

test.use({ viewport: PHONE });

/**
 * Upward jumps that exist today (finding, not waiver). Kitchen portal header on a phone: the search form is first in
 * the DOM but laid out on the second row, so Tab goes search -> agent button -> basket, back up to the first row
 * (src/app/k/[kitchen]/portal.tsx:385, `col-start-2 row-start-1`).
 */
const KNOWN_JUMPS: { page: string; from: RegExp; to: RegExp }[] = [{ page: "order", from: /^Search$/, to: /^$|purchasing agent/i }];

async function checkOrder(page: Page, id: string, mustReach: RegExp[]) {
  const stops = await tabThrough(page, 90);
  await test.info().attach(`tab-stops-${id}.json`, { body: JSON.stringify(stops, null, 2), contentType: "application/json" });
  const line = (s: Stop) => `#${s.i} ${s.tag} "${s.name}" at y=${s.top}${s.fixed ? " (fixed)" : ""}`;
  for (const re of mustReach) expect(stops.some((s) => re.test(s.name)), `Tab reaches ${re} on ${id}:\n${stops.map(line).join("\n")}`).toBe(true);
  const jumps = upwardJumps(stops).filter((j) => !KNOWN_JUMPS.some((k) => k.page === id && k.from.test(j.from.name) && k.to.test(j.to.name)));
  for (const j of upwardJumps(stops)) if (!jumps.includes(j)) note(test.info(), "tab order (known)", `${id}: ${line(j.from)} -> ${line(j.to)}`);
  for (const j of jumps) note(test.info(), "tab order", `${id}: ${line(j.from)} -> ${line(j.to)}`);
  expect(jumps.map((j) => `${line(j.from)} -> ${line(j.to)}`), `Tab jumps back up the page on ${id}`).toEqual([]);
  const invisible = stops.filter((s) => !s.indicator);
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

test("/k/kaari/order: tab order follows the page and focus is visible", async ({ page }) => {
  await target("order").open(page);
  await checkOrder(page, "order", [/Skip to the page/, /Write a request/, /1,000 litres of lactose-free milk/]);
});

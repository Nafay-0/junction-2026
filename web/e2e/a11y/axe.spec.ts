import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { animationsDone, audit, confirmConcerns, note, splitKnown, TARGETS, unnamedControls, VIEWPORT, type Finding } from "../support/a11y-kit";
import { KNOWN } from "./known-violations";

/**
 * Automated WCAG 2.1 A/AA audit (axe-core) of every page that matters, at the size it is used at (phone for the phone
 * and store pages, 1920x1080 for the wall, laptop for operations), plus two mid-flow states: the order lane showing
 * its options, and the phone's sign-off page after approving. Serious and critical violations fail unless listed in
 * known-violations.ts; every violation (any impact) is written to test-results/a11y/<page>.json and as annotations.
 * Also: every interactive control has an accessible name in Chromium's accessibility tree.
 */

const OUT = path.join(__dirname, "../../test-results/a11y");

async function check(page: Page, id: string) {
  const info = test.info();
  await animationsDone(page);
  const findings: Finding[] = await audit(page, id);
  const unnamed = await unnamedControls(page);
  if (unnamed.length)
    findings.push({
      page: id,
      rule: "control-name",
      impact: "critical",
      count: unnamed.length,
      help: "Interactive control with no accessible name (Chromium accessibility tree)",
      examples: unnamed.slice(0, 3).map((u) => ({ target: u.role, html: u.html, summary: "empty accessible name" })),
    });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(findings, null, 2));
  await info.attach(`axe-${id}.json`, { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  const { allowed, fresh } = splitKnown(findings, KNOWN);
  for (const f of findings) note(info, `${f.impact}${allowed.includes(f) ? " (known)" : ""}`, `${id}: ${f.rule} x${f.count}: ${f.examples[0]?.target} ${f.examples[0]?.summary ?? ""}`);
  expect(fresh, `new serious/critical accessibility violations on ${id}:\n${JSON.stringify(fresh, null, 2)}`).toEqual([]);
}

for (const t of TARGETS) {
  test(`axe: ${t.id} (${t.path}) at ${t.size} size`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT[t.size]);
    await t.open(page);
    await check(page, t.id);
  });
}

test("axe: order lane with options on screen (phone)", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await page.goto("/k/kaari/order");
  await page.getByRole("button", { name: "1,000 litres of lactose-free milk by Monday" }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Use the offline example reader" }).filter({ visible: true }).first().click();
  await confirmConcerns(page);
  await expect(page.getByRole("button", { name: "Get a fixed price for this" }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await check(page, "order-options");
});

test("axe: approve page after signing (phone)", async ({ page }) => {
  await page.setViewportSize(VIEWPORT.phone);
  await TARGETS.find((t) => t.id === "approve")!.open(page);
  await page.getByRole("button", { name: /^Approve \d/ }).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await check(page, "approve-done");
});

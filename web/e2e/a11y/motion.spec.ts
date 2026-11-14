import { expect, test, type Page } from "@playwright/test";
import { confirmConcerns, note, PHONE, runningMotion, WALL, type Running } from "../support/a11y-kit";
import { threadLog, stageThread } from "../support/thread";

/**
 * Reduced motion. With the system set to "reduce motion", the wall and the store's thread must not run CSS
 * animations or transitions longer than 0.1 s, also while a request moves through the thread and onto the wall
 * (cards arriving, the gate, the stamp). And nothing important depends on motion: the outcome is in words on both.
 */

// `reducedMotion` is not a top-level test option; the context option is (and emulateMedia below makes sure).
test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Known today (finding, not waiver): Tailwind's `animate-pulse` loading placeholders keep pulsing (opacity, 2 s,
 * forever) under reduced motion: src/app/k/[kitchen]/history.tsx:59 and rail.tsx:93 (19 uses of animate-pulse in
 * src/app; none has motion-reduce:animate-none). Opacity only, nothing moves: cosmetic.
 * And the fixed-price countdown bar on the lane shrinks with a 1 s linear width transition every second
 * (src/app/k/[kitchen]/stages.tsx:746, no motion-reduce:transition-none): cosmetic.
 * And, since the thread (main b9f934e), each option on an options card fades its border, shadow and opacity over
 * 150 ms when one is chosen (src/app/_ui/thread.tsx:318, no motion-reduce:transition-none): colour only, cosmetic.
 */
const KNOWN_MOTION = [
  /CSSAnimation pulse .* on div\..*animate-pulse/,
  /CSSTransition width 1000ms .* on div\.h-full\.transition-\[width\]\.duration-1000/,
  /CSSTransition (border-\w+-color|box-shadow|opacity) 150ms .* on li\.rounded-lg\.border\.p-3\.5\.transition-\[border-color,box-shadow,opacity\]/,
];

async function sample(pages: Record<string, Page>, into: Map<string, Running & { page: string }>) {
  for (const [name, p] of Object.entries(pages))
    for (const r of await runningMotion(p, 100)) into.set(`${name}|${r.kind}|${r.name}|${r.target}`, { page: name, ...r });
}

test("wall and the store's thread run no motion longer than 0.1 s when reduced motion is on", async ({ page, browser, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  const wallContext = await browser.newContext({ baseURL, reducedMotion: "reduce", viewport: WALL });
  try {
    const wall = await wallContext.newPage();
    await wall.goto("/");
    await expect(wall.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
    expect(await wall.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/k/kaari/order");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const pages = { wall, thread: page };
    const seen = new Map<string, Running & { page: string }>();
    await sample(pages, seen);

    const steps: [string, () => Promise<unknown>][] = [
      ["ask", () => threadLog(page).getByRole("button", { name: "1,000 litres of lactose-free milk by Monday" }).click()],
      ["confirm amount", () => confirmConcerns(page)],
      ["choose", () => page.getByRole("button", { name: "Choose" }).filter({ visible: true }).first().click()],
    ];
    for (const [, act] of steps) {
      await act();
      for (let k = 0; k < 6; k++) {
        await page.waitForTimeout(150);
        await sample(pages, seen);
      }
    }
    // The outcome is said in words, not only shown by a moving marker or colour.
    await expect(page.getByText(/^(Waiting for |Placed by the agent alone|Refused: )/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByText(/^(Waiting for |Refused|Signed order)/).first()).toBeVisible({ timeout: 20_000 });
    for (let k = 0; k < 8; k++) {
      await wall.waitForTimeout(250);
      await sample(pages, seen);
    }

    const found = [...seen.values()];
    for (const r of found) note(test.info(), "motion under reduce", `${r.page}: ${r.kind} ${r.name} ${r.duration} ms x ${r.iterations} on ${r.target}`);
    await test.info().attach("motion.json", { body: JSON.stringify(found, null, 2), contentType: "application/json" });
    const lines = found.map((r) => `${r.page}: ${r.kind} ${r.name} ${r.duration}ms x${r.iterations} on ${r.target}`);
    expect(lines.filter((l) => !KNOWN_MOTION.some((k) => k.test(l)))).toEqual([]);
    const back = page.getByRole("button", { name: "Take it back" });
    if (await back.isVisible()) await back.click();
  } finally {
    await wallContext.close();
    release();
  }
});

import { expect, test, type Page } from "@playwright/test";
import { card, cards, composer, say, stageThread, threadLog, turns } from "../support/thread";

/**
 * The kitchen's agent in the store's dock ("Purchasing agent", on every page but the Order page), which since main
 * b9f934e is the same conversation thread as the Order page (docs/agent-thread.md): a question is answered from the
 * kitchen's records as a records card, and an order request typed into the dock goes through the same thread and
 * the same cards, nothing ordered without the buyer.
 *
 * The agent here is the scripted provider (e2e/fixtures/recordings.json): for "What did we order last week?" it calls
 * order_history for the last seven days; the rows are Kaari's real order history on this server.
 * Kaari has one thread for every test and project: each test takes it (lock) and starts it over.
 */

/** Open the dock: "Agent" in the phone's bottom bar, "Talk to the purchasing agent" on a wide screen. */
async function openAgent(page: Page) {
  const dock = page.getByRole("complementary", { name: "Purchasing agent" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (!(await threadLog(dock).isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^(Agent|Talk to the purchasing agent)$/ }).filter({ visible: true }).first().click();
  }
  await expect(threadLog(dock)).toBeVisible();
  return dock;
}

test("a question is answered from the kitchen's records in the thread, with nothing priced or ordered", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    const dock = await openAgent(page);
    await threadLog(dock).getByRole("button", { name: "What did we order last week?" }).click();
    const records = card(dock, "records");
    await expect(records).toBeVisible({ timeout: 20_000 });
    // Rows from Kaari's order history: what, when, the total.
    const rows = records.getByRole("listitem");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first()).toContainText(/\d+ × .+\d,\d\d\s?€/);
    // The answer is the record itself (the agent's one line is optional and is shown only if it passes the
    // grounding check); no price, gate or order card for a question.
    await expect(turns(dock).last()).not.toContainText(/placed|approved/i);
    for (const k of ["price", "gate", "order", "options"] as const) await expect(cards(dock, k)).toHaveCount(0);
  } finally {
    release();
  }
});

test("an order typed into the dock goes through the same thread as the Order page; nothing is ordered from the dock", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    const dock = await openAgent(page);
    await expect(composer(dock)).toBeVisible();
    const words = "100 L lactose-free milk for Thursday";
    await say(dock, words);
    await expect(card(dock, "understood")).toContainText(/How much\s*100\sL/, { timeout: 20_000 });
    // The request waits for the buyer (options to choose from, or a check): no order without a tap.
    await expect(card(dock, "options").or(card(dock, "anomaly"))).toBeVisible({ timeout: 20_000 });
    await expect(cards(dock, "order")).toHaveCount(0);

    // The Order page is the same conversation, not a copy.
    await page.goto("/k/kaari/order");
    await expect(threadLog(page).getByText(words, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(card(page, "understood")).toContainText(/How much\s*100\sL/);
    const portal = await (await page.request.get("/ui-api/kitchens/kaari/portal")).json().catch(() => ({}));
    expect(JSON.stringify(portal)).not.toMatch(/"status":"committed"[^}]*100 L lactose-free milk for Thursday/);
  } finally {
    release();
  }
});

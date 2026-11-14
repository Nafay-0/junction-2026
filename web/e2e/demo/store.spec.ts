import { expect, test, type Page } from "@playwright/test";
import { addPasskey, approvalState, approveButton, watchErrors } from "../support/dock";
import { answerTo, card, cards, composer, minutesUntil, option, options, say, stageThread, threadLog, visitorKitchen } from "../support/thread";

/**
 * The store's conversation thread (docs/agent-thread.md; main b9f934e replaced the order lane and agent panel with
 * it): a request typed in the visitor's own kitchen (so parallel runs never share a budget or a thread), every
 * stage as cards: what the agent understood, the mistake check (when the request is unusual), options with live
 * prices, the fixed price and how long it holds, the gate, the sign-off on the visitor's phone (a second tab of the
 * same browser, as on a real phone), the signed order. Reloads and the back button in the middle.
 *
 * The reader and the agent are the scripted provider (e2e/fixtures/recordings.json): the words are read as the
 * recording says; everything after the reading (intake, ranking, live prices, quote, gate, sign-off) is the real
 * server. The stage kitchen tests (kaari) take a lock on Kaari's one thread and start it over (support/thread.ts).
 */

const MILK = "1,000 litres of lactose-free milk by Monday";

/** The visitor's phone joins and waits for requests; the store opens in a second tab of the same browser. */
async function phoneAndStore(phone: Page) {
  await addPasskey(phone);
  const kitchen = await visitorKitchen(phone);
  await phone.goto("/approver");
  await expect(phone.getByText("Waiting for requests")).toBeVisible();
  const page = await phone.context().newPage();
  await page.goto(`/k/${kitchen}/order`);
  await expect(page.getByRole("heading", { name: "Order with your agent" })).toBeVisible();
  return { kitchen, page };
}

test("thread, every stage, signed on the visitor's phone; reload and back in the middle", async ({ page: phone }) => {
  test.setTimeout(150_000);
  const { page } = await phoneAndStore(phone);
  const errors = watchErrors(page);
  await say(page, MILK);

  // The buyer's words are their turn; the agent's turn shows what it understood, as fields a person reads.
  await expect(answerTo(page, MILK)).toBeVisible({ timeout: 20_000 });
  const understood = card(page, "understood");
  await expect(understood).toBeVisible({ timeout: 20_000 });
  await expect(understood).toContainText(/How much\s*1\s?000\sL/);
  await expect(understood).toContainText(/Must be\s*lactose-free/);
  await expect(understood).toContainText(/Delivered by\s*Mon/);

  // The mistake check, when the amount is unusual for this kitchen: confirm it as meant.
  const confirm = card(page, "anomaly").getByRole("button", { name: "Yes, that is right" });
  await expect(card(page, "options").or(confirm)).toBeVisible({ timeout: 20_000 });
  if (await confirm.isVisible()) await confirm.click();

  // Options with live prices, good-better-best; the over-the-limit ones say a person must sign off.
  await expect(options(page).first()).toBeVisible({ timeout: 20_000 });
  expect(await options(page).count()).toBeGreaterThanOrEqual(2);
  await expect(option(page, "Best")).toContainText(/€/);
  await expect(option(page, "Best")).toContainText(/a person must sign off/);

  // Reload with the options on screen: the thread is the server's, so they come back as they were.
  await page.reload();
  await expect(option(page, "Best")).toBeVisible({ timeout: 20_000 });

  // "Best" is the cheapest, the kitchen's usual products (the "Good" card is a swap the gate refuses: test below).
  const total = ((await option(page, "Best").getByText(/\d\s?€/).first().innerText()).match(/[\d\s ]+,\d\d\s?€/) ?? [""])[0].trim();
  expect(total).not.toBe("");
  await option(page, "Best").getByRole("button", { name: "Choose" }).click();
  // A choice orders it: the price is fixed and signed, then the gate decides.
  const price = card(page, "price");
  await expect(price).toBeVisible({ timeout: 20_000 });
  await expect(price).toContainText(total);
  await expect(price).toContainText(/Signed by the wholesaler/);
  await expect(price).not.toContainText(/would refuse/);
  // How long the fixed price holds: about 30 minutes from now.
  const holds = (await price.getByText(/^holds until \d{1,2}[.:]\d{2}$/).innerText()).replace("holds until ", "");
  expect(minutesUntil(holds)).toBeGreaterThan(25);
  expect(minutesUntil(holds)).toBeLessThanOrEqual(31);

  // The gate stops it (over the visitor's 500 € limit) and names the person who signs, on their phone.
  const gate = card(page, "gate");
  await expect(gate).toContainText(/Waiting for /, { timeout: 20_000 });
  await expect(gate).toContainText(/over the €500\.00 per-order limit/);
  await expect(gate).toContainText("Asked on their phone, with their passkey");
  await expect(card(page, "order")).toContainText("Waiting for sign-off");

  // Reload, then the back button from another page, while waiting for the sign-off: still waiting, not lost.
  await page.reload();
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Shop sections" }).getByRole("link", { name: "Catalogue" }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/catalogue/);
  await page.goBack();
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  await expect(card(page, "price")).toContainText(total);

  // The phone opens the request by itself, with the same total and minutes left on the fixed price, and signs it.
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  const approvalId = phone.url().split("/approve/")[1].split(/[?#]/)[0];
  await expect(phone.getByText(total).first()).toBeVisible();
  const left = Number(/\((\d+) min left\)/.exec(await phone.getByText(/min left\)/).innerText())?.[1]);
  expect(left).toBeGreaterThan(20);
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });

  // The thread changes by itself: the same gate card now says who signed, and the order is placed.
  await expect(card(page, "gate")).toContainText(/Signed off by /, { timeout: 30_000 });
  await expect(card(page, "order")).toContainText("Placed");
  await expect(card(page, "order")).toContainText(total);
  await expect(card(page, "order")).toContainText(/Signed off by /);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  expect(errors).toEqual([]);
});

test("mistake check on a demo kitchen: 1,000 L where it usually orders 100 L, corrected in one tap", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/order");
    await threadLog(page).getByRole("button", { name: MILK }).click();
    const check = card(page, "anomaly");
    await expect(check).toContainText(/1,000 L where you usually order about 100 L: did you mean 100 L\?/, { timeout: 20_000 });
    await expect(check.getByRole("button", { name: "Yes, that is right" })).toBeVisible();
    // Nothing is priced while the check is open.
    await expect(cards(page, "options")).toHaveCount(0);
    await check.getByRole("button", { name: "Make it 100 L" }).click();
    // The tap is the buyer's turn; the check says what changed; the options are for 100 L.
    await expect(check).toContainText("Changed: Make it 100 L", { timeout: 20_000 });
    await expect(option(page, "Best")).toBeVisible({ timeout: 20_000 });
    for (const o of await options(page).all()) await expect(o).toContainText(/100\sL/);
    await expect(cards(page, "price")).toHaveCount(0);
  } finally {
    release();
  }
});

test("one-tap repeat from the kitchen's home: straight to a fixed price and the gate, no question", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    // Standing orders, milk first (Kaari's usual).
    const standing = page.getByRole("region", { name: "Standing orders" });
    await expect(standing.getByRole("heading", { name: "milk", exact: true })).toBeVisible({ timeout: 20_000 });
    await standing.getByRole("button", { name: "Repeat", exact: true }).first().click();
    // Off the Order page the same thread opens in the dock.
    const dock = page.getByRole("complementary", { name: "Purchasing agent" });
    await expect(threadLog(dock)).toBeVisible();
    await expect(threadLog(dock).getByText(/^Same again as /)).toBeVisible();
    // The last order, again: memory answers what and how much, so nothing is asked; Kaari's 100 € limit sends it to
    // the head chef. (Or the options, when the last product cannot be had now; or the duplicate check, when an
    // earlier test's repeat for the same day still waits for sign-off.)
    const gate = card(dock, "gate");
    const duplicate = card(dock, "anomaly").filter({ hasText: /Order again\?/ });
    await expect(gate.or(option(dock, "Best")).or(duplicate)).toBeVisible({ timeout: 20_000 });
    await expect(cards(dock, "question")).toHaveCount(0);
    if (await duplicate.isVisible()) {
      await duplicate.getByRole("button", { name: /^Cancel/ }).click();
      await expect(duplicate).toContainText(/Changed: Cancel/, { timeout: 20_000 });
    } else if (await gate.isVisible()) {
      await expect(card(dock, "price")).toContainText(/Signed by the wholesaler/);
      await expect(gate).toContainText(/Waiting for Sanna Koskinen/);
      // Taken back from the thread, so the shared kitchen keeps no waiting order from this test.
      await gate.getByRole("button", { name: "Take it back" }).click();
      await expect(card(dock, "gate")).toContainText("Taken back", { timeout: 20_000 });
    }
  } finally {
    release();
  }
});

test("repeat with a change: the earlier request with 200 litres instead", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    const standing = page.getByRole("region", { name: "Standing orders" });
    await expect(standing.getByRole("heading", { name: "milk", exact: true })).toBeVisible({ timeout: 20_000 });
    await standing.getByRole("button", { name: "Repeat with a change" }).first().click();
    const dock = page.getByRole("complementary", { name: "Purchasing agent" });
    const field = composer(dock);
    await expect(field).toBeVisible();
    await expect(dock.getByRole("textbox", { name: "What changes?" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Stop changing that request" })).toBeVisible();
    await say(dock, "200 litres");
    // The buyer's turn says which request it changes; the reading takes the rest from it.
    await expect(threadLog(dock).getByText(/^Same as .+, but 200 litres$/)).toBeVisible();
    const understood = card(dock, "understood");
    await expect(understood).toContainText(/How much\s*200\sL/, { timeout: 20_000 });
    await expect(understood).toContainText(/Read against /);
    await expect(dock.getByRole("button", { name: "Stop changing that request" })).toHaveCount(0);
  } finally {
    release();
  }
});

/**
 * DEFECT (test.fail until fixed; E2E_EXPECT_FIXED=1 runs it as an ordinary test). Still there in the thread: in the
 * visitor's own kitchen the headline request's "Good" option (1,000 x 1 L of the usual brand) is a swap 15.5 % dearer
 * per litre than the usual 10 L box, over the mandate's 10 % substitute tolerance. The option card offers "Choose" and
 * says nothing about the gate; a tap fixes the price ("The gate would refuse this.") and the gate refuses it
 * (substitute_price). Cause: the intake ranks options without the gate's substitution check
 * (src/core/options.ts builds them; src/core/policy.ts refuses). Seed catalogue.
 */
test("every option card the thread offers can pass the gate", async ({ page: phone }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the Good card is a swap over the substitute price tolerance: refused at the gate");
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await expect(options(page).first()).toBeVisible({ timeout: 20_000 });
  const n = await options(page).count();
  for (const o of await options(page).all()) await expect(o.getByText(/gate would refuse|refused/i)).toHaveCount(0);
  // Take the last card (the one furthest from the usual): its fixed price must not be one the gate refuses.
  await options(page).nth(n - 1).getByRole("button", { name: "Choose" }).click();
  await expect(card(page, "price")).toBeVisible({ timeout: 20_000 });
  await expect(card(page, "price")).not.toContainText(/would refuse/);
  await expect(card(page, "gate")).not.toContainText(/^Refused/);
});

/**
 * DEFECT (test.fail until fixed). The understood card's "What matters" shows the reader's raw goal code ("price",
 * "unstated") instead of words: THREAD_PAGE_TEXT.goal (src/app/k/[kitchen]/thread.text.ts:54) is keyed cheapest /
 * lowest_co2 / most_reliable / fastest, but a need's goal is price / co2 / reliability (src/core/need.ts:14) or
 * "unstated", so the lookup in thread.tsx:178 always falls back to the code. "unstated" should not be shown at all.
 */
test("the understood card says what matters in words, never a code", async ({ page: phone }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the goal labels are keyed by names the reader never returns: raw codes on screen");
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  const understood = card(page, "understood");
  await expect(understood).toBeVisible({ timeout: 20_000 });
  await expect(understood).not.toContainText(/What matters\s*(unstated|price|co2|reliability)\b/);
});

/**
 * DEFECT (test.fail until fixed; would lose the demo). After a person signs a waiting order off on their phone, the
 * next request in the same thread fails: "The agent did not answer. Try again in a moment." (and "Try again" fails
 * the same way; only "Start over" clears it). Cause: src/server/thread/agent.ts:314 keeps `result.response.messages`,
 * which in AI SDK 7 is the final step's messages only (ai/dist/index.js:10870), not `result.responseMessages`
 * (:10873). The thread's model history so loses the steps before the last; after a sign-off the resumed loop's last
 * step is the model's sentence, so the approved await_sign_off call keeps no tool result
 * (src/server/thread/engine.ts:390), and the SDK refuses the next turn's history (AI_MissingToolResultsError).
 * Model-independent: reproduced in process with the scripted provider. On the demo path the reviewer types into the
 * same thread right after signing.
 */
test("after the phone signs, the same thread answers the next request", async ({ page: phone }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the thread's history loses the signed-off tool result: the next turn is refused");
  test.setTimeout(120_000);
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await option(page, "Best").getByRole("button", { name: "Choose" }).click({ timeout: 20_000 });
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "gate")).toContainText(/Signed off by /, { timeout: 30_000 });
  await say(page, "200 litres of lactose-free milk for Wednesday, cheapest");
  await expect(answerTo(page, "200 litres of lactose-free milk for Wednesday, cheapest").getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(cards(page, "notice").filter({ hasText: "The agent did not answer" })).toHaveCount(0);
  await expect(card(page, "understood")).toContainText(/How much\s*200\sL/);
});

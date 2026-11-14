import { expect, test, type Page } from "@playwright/test";
import { addPasskey, approvalState, approveButton, watchErrors } from "../support/dock";
import { answerTo, card, cards, choices, minutesUntil, otherOptions, pick, say, stageThread, threadLog, totalOf, visitorKitchen } from "../support/thread";

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

  // Options with live prices, good-better-best: the agent's pick first (ranked Best), the others folded; over the
  // visitor's 500 € limit, so the pick's button says who signs and for how much.
  const options = card(page, "options");
  await expect(pick(page)).toBeVisible({ timeout: 20_000 });
  await expect(options).toContainText(/^Options with live prices\s*Best/);
  await expect(pick(page)).toHaveText(/^Send to .+ for an OK, [\d\s\u00a0\u202f]+,\d\d\s?€$/);
  await expect(options).toContainText(/a person signs it off/);
  expect(await otherOptions(page).count()).toBeGreaterThanOrEqual(1);

  // Reload with the options on screen: the thread is the server's, so they come back as they were.
  await page.reload();
  await expect(pick(page)).toBeVisible({ timeout: 20_000 });

  const total = await totalOf(pick(page));
  expect(total).not.toBe("");
  await pick(page).click();
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
  await expect(gate).toContainText(/is over the 500,00\s?€ the agent may spend alone/);
  // The person who signs is named with their role; their passkey is bound to this exact order.
  await expect(gate).toContainText(/, purchasing manager/);
  await expect(gate).toContainText(/passkey is bound to this exact order/);
  await expect(card(page, "order")).toContainText("Waiting for an OK");

  // Reload, then the back button from another page, while waiting for the sign-off: still waiting, not lost.
  await page.reload();
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  await page.getByRole("link", { name: "Catalogue", exact: true }).filter({ visible: true }).first().click();
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
  await expect(card(page, "gate")).toContainText(/Approved by /, { timeout: 30_000 });
  await expect(card(page, "order")).toContainText("Placed");
  await expect(card(page, "order")).toContainText(total);
  await expect(card(page, "order")).toContainText(/Approved by /);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  expect(errors).toEqual([]);
});

test("mistake check on a demo kitchen: 1,000 L where it usually orders 100 L, corrected in one tap", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/order");
    await say(page, MILK);
    const check = card(page, "anomaly");
    await expect(check).toContainText(/1\D?000\s?L where you usually\s+order about 100\s?L: did you mean 100\s?L\?/, { timeout: 20_000 });
    await expect(check.getByRole("button", { name: "Yes, that is right" })).toBeVisible();
    // Nothing is priced while the check is open.
    await expect(cards(page, "options")).toHaveCount(0);
    await check.getByRole("button", { name: "Make it 100 L" }).click();
    // The tap is the buyer's turn; the check says what changed; the options are for 100 L.
    await expect(check).toContainText("Changed: Make it 100 L", { timeout: 20_000 });
    await expect(pick(page)).toBeVisible({ timeout: 20_000 });
    await expect(card(page, "options")).toContainText(/10\s×\s10\sL|100\s×\s1\sL/);
    for (const o of await otherOptions(page).all()) await expect(o).not.toContainText(/1[\s\u00a0\u202f,]?000/);
    await expect(cards(page, "price")).toHaveCount(0);
  } finally {
    release();
  }
});

test("one-tap repeat from the landing screen: an earlier order onto the order sheet, no question", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    // The agent is where the kitchen lands: its starting points open the earlier orders in the thread.
    await page.goto("/k/kaari");
    const log = threadLog(page);
    await log.getByRole("button", { name: "Earlier orders" }).first().click();
    await log.getByRole("button", { name: "Order again" }).first().click({ timeout: 20_000 });
    // The earlier order's lines on the order sheet, priced and previewed: its one button says what will happen.
    await expect(log.getByRole("button", { name: /^(Order this|Send to .+ for an OK), / }).last()).toBeVisible({ timeout: 20_000 });
    await expect(cards(page, "question")).toHaveCount(0);
  } finally {
    release();
  }
});

test("a recurring order changed: onto the order sheet for its next day, paused and run again from the list", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    const log = threadLog(page);
    await log.getByRole("button", { name: "Recurring orders" }).first().click();
    const pause = log.getByRole("switch").first();
    await expect(pause).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
    await pause.click();
    await expect(pause).toHaveAttribute("aria-checked", "false", { timeout: 20_000 });
    await pause.click();
    await expect(pause).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
    await log.getByRole("button", { name: "Change" }).first().click();
    await expect(log.getByRole("button", { name: /^(Order this|Send to .+ for an OK), / }).last()).toBeVisible({ timeout: 20_000 });
  } finally {
    release();
  }
});

/**
 * Regression test, fixed on main (f49eea8). Before, the visitor kitchen's headline request offered a "Good" option
 * (1,000 x 1 L, 15.5 % dearer per litre than the usual box, over the mandate's 10 % substitute tolerance) with a
 * "Choose" button, and the gate refused it after the tap. Now each option carries the gate's preview: one the gate
 * would refuse is shown "Cannot be ordered" with no button. Every button the card offers must pass the gate.
 */
test("every option the thread offers to order can pass the gate", async ({ page: phone }) => {
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await expect(pick(page)).toBeVisible({ timeout: 20_000 });
  for (const g of await otherOptions(page).all()) await g.locator("summary").click();
  const n = await choices(page).count();
  expect(n).toBeGreaterThanOrEqual(2);
  // The last offered option (the one furthest from the pick): its fixed price is not one the gate refuses.
  await choices(page).nth(n - 1).click();
  await expect(card(page, "price")).toBeVisible({ timeout: 20_000 });
  await expect(card(page, "price")).not.toContainText(/would refuse/);
  await expect(card(page, "gate")).not.toContainText(/Refused/);
});

/** Regression test, fixed on main (f49eea8): "What matters" showed the reader's raw goal code ("price", "unstated"). */
test("the understood card says what matters in words, never a code", async ({ page: phone }) => {
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  const understood = card(page, "understood");
  await expect(understood).toBeVisible({ timeout: 20_000 });
  await expect(understood).not.toContainText(/What matters\s*(unstated|price|co2|reliability)\b/);
});

/**
 * Regression (fixed on claude/agent-thread-3, engine.ts `settled`). Once the agent had sent an order for sign-off, the next request
 * in the same thread fails, while the order waits and after the person signs it on their phone: "The agent did not answer. Try again in a moment." (and "Try again" fails
 * the same way; only "Start over" clears it). Cause: src/server/thread/agent.ts:334 keeps `result.response.messages`,
 * which in AI SDK 7 is the final step's messages only (ai/dist/index.js:10870), not `result.responseMessages`
 * (:10873). The thread's model history so loses the steps before the last; after a sign-off the resumed loop's last
 * step is the model's sentence, so the approved await_sign_off call keeps no tool result
 * (src/server/thread/engine.ts:434), and the SDK refuses the next turn's history (AI_MissingToolResultsError).
 * Model-independent: reproduced in process with the scripted provider. On the demo path the reviewer types into the
 * same thread right after signing.
 */
test("after the phone signs, the same thread answers the next request", async ({ page: phone }) => {
  test.setTimeout(120_000);
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await pick(page).click({ timeout: 20_000 });
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "gate")).toContainText(/Approved by /, { timeout: 30_000 });
  await say(page, "200 litres of lactose-free milk for Wednesday, cheapest");
  await expect(answerTo(page, "200 litres of lactose-free milk for Wednesday, cheapest").getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(cards(page, "notice").filter({ hasText: "The agent did not answer" })).toHaveCount(0);
  await expect(card(page, "understood")).toContainText(/How much\s*200\sL/);
});

/** The same, before the sign-off: the order is still waiting for the person when the buyer asks for something else. */
test("while an order waits for sign-off, the same thread answers the next request", async ({ page: phone }) => {
  test.setTimeout(120_000);
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await pick(page).click({ timeout: 20_000 });
  await expect(card(page, "gate")).toContainText(/Waiting for /, { timeout: 20_000 });
  const next = "200 litres of lactose-free milk for Wednesday, cheapest";
  await say(page, next);
  await expect(answerTo(page, next).getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(cards(page, "notice").filter({ hasText: "The agent did not answer" })).toHaveCount(0);
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { addPasskey, approvalState, approveButton, watchErrors } from "../support/dock";
import { answerTo, minutesUntil, say, stageThread, threadLog, visitorKitchen } from "../support/thread";

/**
 * The store's conversation in the "Thread" design (docs/agent-thread.md): one line down the conversation, each agent
 * reply a node with a few plain sentences; a compact list of at most three choices only for a real choice (tappable,
 * or answered in words); the agent's work folded under "N steps"; the one action is the OK on the dark slab, or the
 * named person's phone. A request typed in the visitor's own kitchen (so parallel runs never share a budget or a
 * thread): what the agent understood and did is in the steps, the options are the choices with their live prices,
 * the gate names who gives the OK and why, the visitor's phone (a second tab of the same browser) gives it, and the
 * same slab says who did. Reloads and the back button in the middle.
 *
 * The reader and the agent are the scripted provider (e2e/fixtures/recordings.json): the words are read as the
 * recording says; everything after the reading (intake, ranking, live prices, quote, gate, sign-off) is the real
 * server. The stage kitchen tests (kaari) take a lock on Kaari's one thread and start it over (support/thread.ts).
 */

const MILK = "1,000 litres of lactose-free milk by Monday";
const PRICE = /\d,\d\d\s?€$/;

/** The choices under the newest agent reply, and those of them that order something at a price. */
const choiceList = (page: Page) => threadLog(page).getByRole("group", { name: "Choices" }).last();
const priced = (page: Page) => choiceList(page).getByRole("button", { name: PRICE });
/** The dark slab: an order waiting for a person's OK, or OK'd. */
const waiting = (page: Page) => threadLog(page).locator('[data-slab="waiting"]').last();
const signed = (page: Page) => threadLog(page).locator('[data-slab="signed"]').last();
/** The agent's own words, newest last. */
const lines = (page: Page) => threadLog(page).locator("[data-agent-words]");
/** The newest "N steps" in the log, opened. */
async function openSteps(page: Page): Promise<void> {
  const b = threadLog(page).getByRole("button", { name: /\d+ (steps?|vaihe\w*|steg)/ }).last();
  await expect(b).toBeVisible({ timeout: 20_000 });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}
const totalOf = async (b: Locator) => PRICE.exec(((await b.getAttribute("aria-label")) ?? "").trim())?.[0]?.replace(/\s?€$/, "").trim() ?? "";

/** The options with live prices, past the mistake check when the amount is unusual (kept as said, one tap). */
async function toOptions(page: Page): Promise<void> {
  const keep = choiceList(page).getByRole("button", { name: "Yes, as I said" });
  await expect(priced(page).first().or(keep)).toBeVisible({ timeout: 20_000 });
  if (!(await priced(page).first().isVisible())) {
    await keep.click();
    await expect(priced(page).first()).toBeVisible({ timeout: 20_000 });
  }
}

/** The visitor's phone joins and waits for requests; the store opens in a second tab of the same browser. */
async function phoneAndStore(phone: Page) {
  await addPasskey(phone);
  const kitchen = await visitorKitchen(phone);
  await phone.goto("/approver");
  await expect(phone.getByText("Waiting for requests")).toBeVisible();
  const page = await phone.context().newPage();
  await page.goto(`/k/${kitchen}/order`);
  await expect(page.getByRole("heading", { name: /Your buying agent/ })).toBeVisible();
  return { kitchen, page };
}

test("thread, every stage, signed on the visitor's phone; reload and back in the middle", async ({ page: phone }) => {
  test.setTimeout(150_000);
  const { page } = await phoneAndStore(phone);
  const errors = watchErrors(page);
  await say(page, MILK);

  // The buyer's words are their turn; the agent's reply is a node on the line, with its work folded beneath.
  await expect(answerTo(page, MILK)).toBeVisible({ timeout: 20_000 });
  await toOptions(page);
  // At most three choices, each with its own price; "or just tell me" says they can be answered in words.
  const n = await priced(page).count();
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(3);
  await expect(threadLog(page).getByText("or just tell me").last()).toBeVisible();
  // What it understood is a step written for a person: the amount, lactose-free, the day.
  const reply = answerTo(page, MILK);
  await openSteps(page);
  await expect(threadLog(page)).toContainText(/Read your request\.?\s*1\s?000\s?L/);
  await expect(threadLog(page)).toContainText(/lactose-free/);
  void reply;

  // Reload with the choices on screen: the thread is the server's, so they come back as they were.
  await page.reload();
  await expect(priced(page).first()).toBeVisible({ timeout: 20_000 });

  const total = await totalOf(priced(page).first());
  expect(total).not.toBe("");
  await priced(page).first().click();
  // The choice orders it at a fixed, signed price; over the visitor's 500 € limit the slab says whose OK and why.
  const slab = waiting(page);
  await expect(slab).toBeVisible({ timeout: 20_000 });
  await expect(slab).toContainText("Needs your OK");
  await expect(slab).toContainText(total);
  await expect(slab).toContainText(/over the 500,00\s?€ the agent may spend alone/);
  // How long the fixed price holds (a step): about 30 minutes from now.
  await openSteps(page);
  const held = /Price held until (\d{1,2}[.:]\d{2})/.exec(await threadLog(page).innerText())?.[1] ?? "";
  expect(minutesUntil(held)).toBeGreaterThan(25);
  expect(minutesUntil(held)).toBeLessThanOrEqual(31);

  // Reload, then the back button from another page, while waiting for the OK: still waiting, not lost.
  await page.reload();
  await expect(waiting(page)).toBeVisible({ timeout: 20_000 });
  await page.goto(page.url().replace(/\/order$/, "/catalogue"));
  await page.waitForURL(/\/catalogue/);
  await page.goBack();
  await expect(waiting(page)).toContainText(total, { timeout: 20_000 });

  // The phone opens the request by itself, with the same total and minutes left on the fixed price, and signs it.
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  const approvalId = phone.url().split("/approve/")[1].split(/[?#]/)[0];
  await expect(phone.getByText(total).first()).toBeVisible();
  const left = Number(/\((\d+) min left\)/.exec(await phone.getByText(/min left\)/).innerText())?.[1]);
  expect(left).toBeGreaterThan(20);
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });

  // The thread changes by itself: the slab says who gave the OK, and the order is placed.
  await expect(signed(page)).toContainText(/OK'd by /, { timeout: 30_000 });
  await expect(signed(page)).toContainText(total);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  expect(errors).toEqual([]);
});

test("mistake check on a demo kitchen: 1,000 L where it usually orders 100 L, corrected in one tap", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/order");
    await say(page, MILK);
    // The check is a real choice: keep 1 000 L, or the usual 100 L. Nothing is priced while it is open.
    const fix = choiceList(page).getByRole("button", { name: /^Make it 100\s?L$/ });
    await expect(fix).toBeVisible({ timeout: 20_000 });
    await expect(priced(page)).toHaveCount(0);
    await fix.click();
    // The tap is the buyer's turn; the choices that follow are for 100 L.
    await expect(priced(page).first()).toBeVisible({ timeout: 20_000 });
    for (const o of await priced(page).all()) await expect(o).not.toHaveAccessibleName(/1[\s  ,]?000/);
    await expect(waiting(page)).toHaveCount(0);
  } finally {
    release();
  }
});

test("a repeat in words: the earlier order again, priced, no question", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    await say(page, "Same as last time, for Friday");
    // The earlier order read back from the records, answered in words (on this seed, why Friday cannot be had), short
    // and without product codes; nothing the records answer is asked again.
    await expect(lines(page).last()).toBeVisible({ timeout: 30_000 });
    await expect(lines(page).last()).not.toContainText(/\([A-Z]{2}-\d{3,}\)/);
    await expect(threadLog(page).getByText(/how much|which product/i)).toHaveCount(0);
  } finally {
    release();
  }
});

test("a question about the records: answered in words, the rows behind Show the list", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari");
    await say(page, "What did we order last week?");
    const show = threadLog(page).getByRole("button", { name: /^Show the list/ }).last();
    await expect(show).toBeVisible({ timeout: 30_000 });
    await show.click();
    await expect(threadLog(page).getByRole("button", { name: "Hide the list" }).last()).toBeVisible();
  } finally {
    release();
  }
});

/**
 * Regression test, fixed on main (f49eea8). Before, the visitor kitchen's headline request offered an option the gate
 * then refused after the tap. Each option carries the gate's preview: one the gate would refuse is not a choice.
 * Every choice the thread offers must pass the gate.
 */
test("every option the thread offers to order can pass the gate", async ({ page: phone }) => {
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await toOptions(page);
  const n = await priced(page).count();
  expect(n).toBeGreaterThanOrEqual(2);
  // The last offered option (the one furthest from the agent's pick): the gate does not refuse it.
  await priced(page).nth(n - 1).click();
  await expect(waiting(page).or(lines(page).filter({ hasText: /Ordered|ordered/ }).last())).toBeVisible({ timeout: 20_000 });
  await expect(threadLog(page)).not.toContainText(/refused|cannot be ordered/i);
});

/** Regression test, fixed on main (f49eea8): what the agent understood showed raw codes ("price", "unstated"). */
test("what the agent understood is said in words, never a code", async ({ page: phone }) => {
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await toOptions(page);
  await openSteps(page);
  await expect(threadLog(page)).not.toContainText(/\b(unstated|lactose_free|fat_1_5|needs_human_approval|auto_approve)\b/);
  await expect(lines(page).last()).not.toContainText(/\b(req|ord|opt)_[0-9a-f]{4,}/);
});

/**
 * Regression (fixed on claude/agent-thread-3, engine.ts `settled`). Once the agent had sent an order for sign-off, the
 * next request in the same thread failed, while the order waited and after the person signed it on their phone ("The
 * agent did not answer"): the thread's model history lost the steps before the last. Model-independent: reproduced in
 * process with the scripted provider. On the demo path the reviewer types into the same thread right after signing.
 */
test("after the phone signs, the same thread answers the next request", async ({ page: phone }) => {
  test.setTimeout(120_000);
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await toOptions(page);
  await priced(page).first().click();
  await expect(waiting(page)).toBeVisible({ timeout: 20_000 });
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await expect(signed(page)).toContainText(/OK'd by /, { timeout: 30_000 });
  const next = "200 litres of lactose-free milk for Wednesday, cheapest";
  await say(page, next);
  await expect(answerTo(page, next).locator("[data-agent-words]").first()).toBeVisible({ timeout: 30_000 });
  await expect(threadLog(page).getByText("The agent did not answer")).toHaveCount(0);
});

/** The same, before the sign-off: the order is still waiting for the person when the buyer asks for something else. */
test("while an order waits for sign-off, the same thread answers the next request", async ({ page: phone }) => {
  test.setTimeout(120_000);
  const { page } = await phoneAndStore(phone);
  await say(page, MILK);
  await toOptions(page);
  await priced(page).first().click();
  await expect(waiting(page)).toBeVisible({ timeout: 20_000 });
  const next = "200 litres of lactose-free milk for Wednesday, cheapest";
  await say(page, next);
  await expect(answerTo(page, next).locator("[data-agent-words]").first()).toBeVisible({ timeout: 30_000 });
  await expect(threadLog(page).getByText("The agent did not answer")).toHaveCount(0);
});

/**
 * Regression (a78f32b, seen live): with motion on, the working line ("Reading your request") was invisible, its sheen
 * built from a transparent currentColor with a white band, white on a pale page. The text keeps its colour; only the
 * glyph fill is the moving gradient. Checked with motion on, on the shipped stylesheet: the fill is the gradient (the
 * fill colour transparent, the colour not), and the line's pixels differ from the same place with the line hidden.
 */
test("the working line is visible with motion on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/approver");
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "sheen-probe";
    p.className = "tl-sheen text-[1.02rem] font-medium text-petrol";
    p.textContent = "Reading your request";
    p.style.cssText = "position:fixed;top:140px;left:24px;z-index:2147483647;margin:0;padding:6px 8px;background-color:#f3f6f7";
    document.body.appendChild(p);
  });
  const probe = page.locator("#sheen-probe");
  const style = await probe.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fill: s.getPropertyValue("-webkit-text-fill-color"), color: s.color, animation: s.animationName };
  });
  expect(style.animation).toBe("tl-sheen");
  expect(style.fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(style.color).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  const box = (await probe.boundingBox())!;
  const shown = await page.screenshot({ clip: box, animations: "disabled" });
  await probe.evaluate((el) => ((el as HTMLElement).style.color = "#f3f6f7"));
  const hidden = await page.screenshot({ clip: box, animations: "disabled" });
  expect(Buffer.compare(shown, hidden)).not.toBe(0);
});

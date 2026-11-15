import { expect, test, type Page } from "@playwright/test";
import { addPasskey, approveButton, enterOps, watchErrors } from "../support/dock";
import { say, threadLog, visitorKitchen } from "../support/thread";

/**
 * The wholesaler's team confirms a placed order for delivery (server/fulfilment). The partner has no order API: an
 * order is produced for a person on the wholesaler's side to approve. In the visitor's own kitchen: the agent orders
 * the milk, the visitor's phone signs it, the conversation says it is with the wholesaler's team to confirm; staff
 * confirm it in the operations portal; the conversation and the kitchen's Orders tab say so, with nothing reloaded
 * in the conversation. The reader and the agent are the scripted provider (e2e/fixtures/recordings.json).
 */

const MILK = "1,000 litres of lactose-free milk by Monday";
const PRICE = /\d,\d\d\s?€$/;
const choiceList = (page: Page) => threadLog(page).getByRole("group", { name: "Choices" }).last();
const priced = (page: Page) => choiceList(page).getByRole("button", { name: PRICE });

test("a placed order is with the wholesaler's team to confirm; staff confirm it, and the kitchen sees it", async ({ page: phone, browser, baseURL }) => {
  test.setTimeout(180_000);
  await addPasskey(phone);
  const kitchen = await visitorKitchen(phone);
  await phone.goto("/approver");
  await expect(phone.getByText("Waiting for requests")).toBeVisible();
  const page = await phone.context().newPage();
  const errors = watchErrors(page);
  await page.goto(`/k/${kitchen}/order`);
  await expect(page.getByRole("heading", { name: /Your buying agent/ })).toBeVisible();

  // The agent orders the milk; over the visitor's limit, the phone signs it.
  await say(page, MILK);
  const keep = choiceList(page).getByRole("button", { name: "Yes, as I said" });
  await expect(priced(page).first().or(keep)).toBeVisible({ timeout: 30_000 });
  if (!(await priced(page).first().isVisible())) await keep.click();
  await priced(page).first().click();
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });

  // Placed: the conversation says it is now with the wholesaler's team to confirm.
  const note = threadLog(page).locator("[data-fulfilment]").last();
  await expect(note).toHaveAttribute("data-fulfilment", "waiting", { timeout: 30_000 });
  await expect(note).toContainText("With the wholesaler's team to confirm");
  const orderId = (await note.getAttribute("data-order"))!;
  expect(orderId).toMatch(/^ord_/);

  // The wholesaler's staff: the Orders list counts it as waiting; the order's page confirms it.
  const desk = await browser.newContext({ baseURL });
  const ops = await desk.newPage();
  await enterOps(ops, "E2E dispatcher");
  await ops.goto(`/ops/orders?status=to_confirm`);
  await expect(ops.locator('[data-fulfilment="waiting"]').first()).toContainText("Waiting for your team to confirm", { timeout: 20_000 });
  await ops.goto(`/ops/orders/${orderId}`);
  await ops.getByRole("button", { name: "Confirm for delivery" }).click();
  await expect(ops.locator('[data-fulfilment="confirmed"]')).toContainText("Confirmed for delivery by E2E dispatcher", { timeout: 20_000 });
  await expect(ops.getByText(/Confirmed for delivery by E2E dispatcher of the wholesaler's team/).first()).toBeVisible({ timeout: 20_000 });
  await desk.close();

  // The kitchen sees it at once in the conversation: the note under the order, and one quiet line.
  await expect(note).toHaveAttribute("data-fulfilment", "confirmed", { timeout: 30_000 });
  await expect(note).toContainText("Confirmed by the wholesaler's team");
  await expect(threadLog(page)).toContainText("The wholesaler's team confirmed your order", { timeout: 20_000 });

  // And on its Orders tab.
  await page.goto(`/k/${kitchen}/orders`);
  await expect(page.locator('[data-fulfilment="confirmed"]').first()).toContainText("Confirmed by the wholesaler's team", { timeout: 20_000 });
  expect(errors).toEqual([]);
});

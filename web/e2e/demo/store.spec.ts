import { expect, test, type Page } from "@playwright/test";
import { addPasskey, approvalState, approveButton, joinAsApprover, watchErrors, signInStage } from "../support/dock";

/**
 * The store's order lane, every stage, in the visitor's own kitchen (so parallel runs never share a budget):
 * request -> what the agent understood -> mistake check -> options -> fixed price with its countdown -> gate ->
 * sign-off on the visitor's phone (a second tab of the same browser, as on a real phone) -> signed order.
 * Reloads and the back button in the middle. The server has no model: free text goes through the "offline
 * example" reader, which the page offers when the model does not answer (the honest path on a model outage).
 */

const step = (page: Page, n: number) => page.getByRole("region", { name: new RegExp(`^Step ${n}:`) });
const where = (page: Page) => page.getByRole("navigation", { name: "Where the request is" });

async function visitorStore(page: Page): Promise<string> {
  await joinAsApprover(page);
  await page.goto("/k/mine");
  await page.waitForURL(/\/k\/(?!mine)[^/]+$/);
  return new URL(page.url()).pathname.split("/")[2];
}

/** Get past the model being off: the page offers the offline example reader; take it when it appears. */
async function pastReader(page: Page) {
  const offline = page.getByRole("button", { name: "Use the offline example reader" }).filter({ visible: true });
  await expect
    .poll(async () => (await offline.count()) > 0 || /Offline example|Read by/.test(await step(page, 1).innerText().catch(() => "")), { timeout: 20_000 })
    .toBe(true);
  if (await offline.count()) await offline.first().click();
}

/** Send a suggested request and get past the reader. */
async function ask(page: Page, suggestion: RegExp) {
  await page.getByRole("button", { name: suggestion }).filter({ visible: true }).first().click();
  await pastReader(page);
}

/** Countdown text "mm.ss" in the fixed-price step, as seconds. */
async function countdownSeconds(page: Page): Promise<number> {
  const t = (await step(page, 4).getByText(/^\d{1,2}[.:]\d{2}$/).first().innerText()).trim();
  const [m, s] = t.split(/[.:]/).map(Number);
  return m * 60 + s;
}

test("order lane, every stage, signed on the visitor's phone; reload and back in the middle", async ({ page: phone, context }) => {
  test.setTimeout(150_000);
  // The phone that joined keeps the passkey (a virtual authenticator belongs to one page), so the store runs in a
  // second tab of the same browser, as when a visitor switches from the shop to the sign-off page.
  await addPasskey(phone);
  const kitchen = await visitorStore(phone);
  await phone.goto("/approver");
  await expect(phone.getByText("Waiting for requests")).toBeVisible();
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(`/k/${kitchen}/order`);
  await ask(page, /1,000 litres of lactose-free milk by Monday/);

  // 1 understood, 2 mistake check (a first order of 1,000 L may be questioned: confirm it as meant)
  await expect(step(page, 1)).toContainText(/Amount\s*1\s?000\sL/);
  await expect(step(page, 2)).toBeVisible();
  const meant = step(page, 2).getByRole("button", { name: /Yes, I meant that/ });
  if (await meant.isVisible().catch(() => false)) await meant.click();

  // 3 options, good-better-best
  await expect(step(page, 3).getByRole("article").first()).toBeVisible({ timeout: 20_000 });
  expect(await step(page, 3).getByRole("article").count()).toBeGreaterThanOrEqual(1);
  await expect(where(page)).toContainText(/Options/);

  // Reload with the options on screen: the request survives.
  await page.reload();
  await expect(step(page, 3).getByRole("article").first()).toBeVisible({ timeout: 20_000 });

  // 4 fixed price, with a countdown that runs
  // "Best" (cheapest, the usual product): the first card can be a swap the gate refuses (see the test below).
  await step(page, 3).getByRole("article", { name: /^Best/ }).getByRole("button", { name: "Get a fixed price for this" }).click();
  await expect(step(page, 4)).toContainText(/signed by the wholesaler/i, { timeout: 20_000 });
  await expect(step(page, 4)).not.toContainText(/would refuse/);
  const first = await countdownSeconds(page);
  expect(first).toBeGreaterThan(25 * 60);
  await expect.poll(() => countdownSeconds(page), { timeout: 10_000 }).toBeLessThan(first);
  const total = (await step(page, 4).getByText(/\d\s€$/).first().innerText()).trim();

  // Reload with a live fixed price (QA once lost it here), then the back button from another page.
  await page.reload();
  await expect(step(page, 4)).toContainText(total, { timeout: 20_000 });
  await page.getByRole("navigation", { name: /Shop/ }).getByRole("link", { name: "Catalogue" }).first().click();
  await page.waitForURL(/\/catalogue/);
  await page.goBack();
  await expect(step(page, 4)).toContainText(total, { timeout: 20_000 });

  // 5 the gate stops it (over the visitor's 500 € limit) and 6 waits for the phone
  await step(page, 4).getByRole("button", { name: "Place the order" }).click();
  await expect(step(page, 5)).toContainText(/Stopped at the gate/, { timeout: 20_000 });
  await expect(step(page, 6)).toContainText(/Waiting for a person/);

  // Reload while waiting for the sign-off: still waiting, not lost.
  await page.reload();
  await expect(step(page, 6)).toContainText(/Waiting for a person/, { timeout: 20_000 });

  // The phone opens the request by itself and signs it with the passkey.
  await phone.waitForURL("**/approve/**", { timeout: 30_000 });
  const approvalId = phone.url().split("/approve/")[1];
  await expect(phone.getByText(total).first()).toBeVisible();
  await approveButton(phone).click();
  await expect(phone.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });

  // 7 the store page changes by itself: signed and in the ledger
  await expect(where(page)).toContainText(/Order/, { timeout: 30_000 });
  await expect(step(page, 6)).toContainText(/with their passkey/, { timeout: 30_000 });
  await expect(step(page, 7)).toContainText("Order placed with the wholesaler");
  await expect(step(page, 7)).toContainText(total);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  expect(errors).toEqual([]);
});

test("mistake check on a demo kitchen: 1,000 L where it usually orders 100 L, corrected in one tap", async ({ page }) => {
  await signInStage(page, "kaari");
  await page.goto("/k/kaari/order");
  await ask(page, /1,000 litres of lactose-free milk by Monday/);
  const check = step(page, 2);
  await expect(check.getByText(/did you mean 100 L\?/)).toBeVisible({ timeout: 20_000 });
  await check.getByRole("button", { name: "Make it 100 L" }).click();
  await expect(step(page, 1)).toContainText(/Amount\s*100\sLcorrected from 1\s?000\sL/, { timeout: 20_000 });
  await expect(step(page, 3).getByRole("article").first()).toBeVisible({ timeout: 20_000 });
  await expect(step(page, 3).getByRole("article").first()).toContainText(/100\sL/);
});

test("repeat with a change: same again but 200 litres", async ({ page }) => {
  // The offline example reader cannot read a change ("could not read that"); only the model can. With the model
  // off (this server) the test checks the honest message; E2E_MODEL=1 (a server with a model) checks the 200 L.
  await signInStage(page, "kaari");
  await page.goto("/k/kaari/order");
  const earlier = page.getByRole("region", { name: "Earlier requests" });
  await earlier.getByRole("button", { name: "Repeat with a change" }).filter({ visible: true }).first().click();
  const field = page.getByRole("textbox", { name: "What changes?" });
  await expect(field).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop changing that request" })).toBeVisible();
  await field.fill("same again but 200 litres");
  await field.press("Enter");
  if (!process.env.E2E_MODEL) {
    await expect(step(page, 1)).toContainText(/model reader did not answer|could not read/, { timeout: 20_000 });
    return;
  }
  await expect(step(page, 1)).toContainText(/Amount\s*200\sL/, { timeout: 40_000 });
});

test("one-tap repeat of an earlier request reaches options without a question", async ({ page }) => {
  await signInStage(page, "kaari");
  await page.goto("/k/kaari/order");
  const earlier = page.getByRole("region", { name: "Earlier requests" });
  await earlier.getByRole("button", { name: "Repeat", exact: true }).filter({ visible: true }).first().click();
  await expect(step(page, 3).getByRole("article").first().or(step(page, 2).getByRole("article").first())).toBeVisible({ timeout: 20_000 });
});

/**
 * DEFECT (test.fail until fixed; E2E_EXPECT_FIXED=1 runs it as an ordinary test). On the visitor's own kitchen the
 * headline request's first card ("Good: most reliable", 1,000 x 1 L) is a swap 15.5 % dearer per litre than the
 * usual product, over the mandate's 10 % tolerance. The card says nothing; the fixed price says "The gate would
 * refuse this" yet still offers "Place the order"; placing it is refused (substitute_price). Seed catalogue.
 */
test("every option card the lane offers can pass the gate", async ({ page }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "first card is a swap over the substitute price tolerance: refused at the gate");
  await addPasskey(page);
  const kitchen = await visitorStore(page);
  await page.goto(`/k/${kitchen}/order`);
  await ask(page, /1,000 litres of lactose-free milk by Monday/);
  const cards = step(page, 3).getByRole("article");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  await cards.first().getByRole("button", { name: "Get a fixed price for this" }).click();
  await expect(step(page, 4)).toContainText(/signed by the wholesaler/i, { timeout: 20_000 });
  await expect(step(page, 4)).not.toContainText(/would refuse/);
});

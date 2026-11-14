import { expect, test, type Page } from "@playwright/test";

/**
 * The agent panel answering a question from the shop's records. This server has the model off, so the panel must
 * say so plainly and show records, never an invented answer; with E2E_MODEL=1 (start-server.mjs copies the model
 * keys in, capped at $0.50) it must answer from records: the 100 € limit for "What may the agent buy alone?".
 */

async function openAgent(page: Page) {
  // Phone: the agent is the middle of the tab bar. Desktop: the panel may be open already, or a header button.
  const field = page.getByRole("textbox", { name: "Ask, or say what the kitchen needs" }).filter({ visible: true });
  if (await field.count()) return field.first();
  const tab = page.getByRole("navigation", { name: /Shop/ }).getByRole("button", { name: "Agent" }).filter({ visible: true });
  if (await tab.count()) await tab.first().click();
  else await page.getByRole("button", { name: /^Agent$|purchasing agent/i }).filter({ visible: true }).first().click();
  await expect(field.first()).toBeVisible();
  return field.first();
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Purchasing agent" });

test("the agent panel answers a question from records, and says so when the model is off", async ({ page }) => {
  await page.goto("/k/kaari");
  await openAgent(page);
  await panel(page).getByRole("button", { name: "What may the agent buy alone?" }).click();
  if (!process.env.E2E_MODEL) {
    await expect(panel(page).getByText(/model is not answering/)).toBeVisible({ timeout: 30_000 });
    await expect(panel(page).getByText(/nothing below is a model's answer/)).toBeVisible();
    await expect(panel(page).getByText(/no live call/)).toBeVisible();
    return;
  }
  await expect(panel(page).getByText(/100\s?€|€\s?100/).first()).toBeVisible({ timeout: 45_000 });
});

test("an order typed into the panel goes onto the order lane, nothing is ordered from the panel", async ({ page }) => {
  await page.goto("/k/kaari");
  const field = await openAgent(page);
  await field.fill("100 L lactose-free milk for Thursday");
  await panel(page).getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/k\/kaari\/order/, { timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Step 1:/ })).toBeVisible({ timeout: 20_000 });
  const orders = await (await page.request.get("/ui-api/kitchens/kaari/portal")).json().catch(() => ({}));
  expect(JSON.stringify(orders)).not.toMatch(/"status":"committed".*100 L lactose-free milk for Thursday/);
});

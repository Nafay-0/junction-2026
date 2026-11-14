import { expect, test, type Page } from "@playwright/test";
import { signInStage } from "../support/dock";

/**
 * The agent panel answering a question from the shop's records. This server has the model off, so the panel must
 * say so plainly and show records, never an invented answer; with E2E_MODEL=1 (start-server.mjs copies the model
 * keys in, capped at $0.50) it must answer from records: the 100 € limit for "What may the agent buy alone?".
 */

async function openAgent(page: Page) {
  // Phone: "Agent" in the bottom tab bar. Desktop: "Agent  Ctrl K" in the header. Either opens the panel.
  const field = page.getByRole("complementary", { name: "Purchasing agent" }).getByRole("textbox", { name: "Ask, or say what the kitchen needs" });
  const opener = page.getByRole("button", { name: /^Agent/ }).filter({ visible: true }).first();
  await expect(opener).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  // On a wide screen the panel may already be open; the button would then close it.
  if (!(await field.isVisible())) await opener.click();
  await expect(field).toBeVisible();
  return field;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Purchasing agent" });

test("the agent panel answers a question from records, and says so when the model is off", async ({ page }) => {
  await signInStage(page, "kaari");
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
  await signInStage(page, "kaari");
  await page.goto("/k/kaari");
  const field = await openAgent(page);
  await field.fill("100 L lactose-free milk for Thursday");
  await panel(page).getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/k\/kaari\/order/, { timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Step 1:/ })).toBeVisible({ timeout: 20_000 });
  const orders = await (await page.request.get("/ui-api/kitchens/kaari/portal")).json().catch(() => ({}));
  expect(JSON.stringify(orders)).not.toMatch(/"status":"committed".*100 L lactose-free milk for Thursday/);
});

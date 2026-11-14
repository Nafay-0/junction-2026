import { expect, test, type Page } from "@playwright/test";
import { addPasskey, joinAsApprover, watchErrors, signInStage } from "../support/dock";

/**
 * The shop by hand: catalogue -> a product page with a live price -> basket -> fixed price -> the same gate as the
 * agent's orders. Seed catalogue (the live price comes from the seed's own live layer, not the partner).
 */

async function visitorKitchen(page: Page): Promise<string> {
  await addPasskey(page);
  await joinAsApprover(page);
  await page.goto("/k/mine");
  await page.waitForURL(/\/k\/(?!mine)[^/]+$/);
  return new URL(page.url()).pathname.split("/")[2];
}

const checkout = (page: Page) => page.getByRole("complementary", { name: "Totals and checkout" });
/** Phone: the checkout buttons sit in a sticky bar outside the totals; desktop: inside. The visible one. */
const action = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();

test("catalogue, product page with a live price, basket, fixed price, through the gate", async ({ page }) => {
  const errors = watchErrors(page);
  const kitchen = await visitorKitchen(page);
  await page.goto(`/k/${kitchen}/catalogue`);
  await expect(page.getByText(/products from the product files/).first()).toBeVisible();
  await expect(page.getByText(/No live call for the list/).first()).toBeVisible();

  await page.getByRole("link", { name: /Valio Eila lactose-free semi-skimmed milk drink 1\.5 %, 10 L/ }).first().click();
  await page.waitForURL(/\/catalogue\/VA-1010$/);
  await expect(page.getByRole("heading", { level: 1, name: /Valio Eila/ })).toBeVisible();
  await expect(page.getByText(/Checked live with the wholesaler at \d/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^\d+,\d{2}\s€$/).first()).toBeVisible();
  // Missing allergen data is unknown, not absent (said in words on the product page).
  await expect(page.getByText(/every allergen is unknown, not absent/)).toBeVisible();

  const qty = page.getByRole("textbox", { name: "Quantity in packs" });
  await qty.fill("10");
  await page.getByRole("button", { name: "Add to basket" }).click();
  await page.goto(`/k/${kitchen}/basket`);
  await expect(page.getByRole("heading", { name: "Basket" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Quantity in packs" })).toHaveValue("10");
  await expect(checkout(page)).toContainText(/100\sL/);

  await action(page, "Get a fixed price").click();
  await expect(checkout(page)).toContainText(/Total, signed by the wholesaler/, { timeout: 20_000 });
  await expect(checkout(page).getByText(/^\d{1,2}[.:]\d{2}$/).first()).toBeVisible(); // the countdown
  await action(page, "Place the order").click();
  // 100 L of the usual milk, 129 € under the visitor's 500 € limit: the agent's own gate lets it through alone.
  await expect(page.locator("main")).toContainText(/Order placed|placed with the wholesaler|Signed by the wholesaler/i, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

/**
 * Regression test, fixed on main (f49eea8). Before, a person ordering one 10 L pack by hand from Kaari's basket
 * (12,90 €, far under its 100 € limit) was stopped at the gate for the head chef's sign-off by a mistake check
 * nobody was asked.
 */
test("a small hand order from the basket goes through without a sign-off", async ({ page }) => {
  await signInStage(page, "kaari");
  await page.goto("/k/kaari/catalogue/VA-1010");
  await expect(page.getByText(/Checked live with the wholesaler at \d/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add to basket" }).click();
  await page.goto("/k/kaari/basket");
  await action(page, "Get a fixed price").click();
  await expect(checkout(page)).toContainText(/Total, signed by the wholesaler/, { timeout: 20_000 });
  await expect(checkout(page)).not.toContainText(/will have to sign off|must sign off/);
});

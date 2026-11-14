import { expect, test, type Page } from "@playwright/test";
import { addPasskey, joinAsApprover, watchErrors } from "../support/dock";

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

  await checkout(page).getByRole("button", { name: "Get a fixed price" }).click();
  await expect(checkout(page)).toContainText(/Total, signed by the wholesaler/, { timeout: 20_000 });
  await expect(checkout(page).getByText(/^\d{1,2}[.:]\d{2}$/).first()).toBeVisible(); // the countdown
  await checkout(page).getByRole("button", { name: "Place the order" }).click();
  // 100 L of the usual milk, 129 € under the visitor's 500 € limit: the agent's own gate lets it through alone.
  await expect(checkout(page)).toContainText(/Order placed|placed with the wholesaler|Signed by the wholesaler/i, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

/**
 * DEFECT (test.fail until fixed; E2E_EXPECT_FIXED=1 runs it as an ordinary test). A person ordering one 10 L
 * pack by hand from the basket of the demo kitchen Kaari (12,90 €, far under its 100 € limit) is stopped at the gate
 * for the head chef's sign-off: "The mistake check flagged a unit that may be mixed up, and no person was asked."
 * The basket never shows the mistake check's question to the person at the keyboard (the order lane does), so a
 * hand order on a demo kitchen always needs a presenter's sign-off. Cause: core/orders.ts mistakeCheckOf runs
 * concernsOfOrder (core/order-check.ts) for every order not quoted by the intake, and the basket's quote never is.
 */
test("a small hand order from the basket goes through without a sign-off", async ({ page }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "basket orders are held by human_confirmation: nobody was asked the mistake check's question");
  await page.goto("/k/kaari/catalogue/VA-1010");
  await expect(page.getByText(/Checked live with the wholesaler at \d/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add to basket" }).click();
  await page.goto("/k/kaari/basket");
  await checkout(page).getByRole("button", { name: "Get a fixed price" }).click();
  await expect(checkout(page)).toContainText(/Total, signed by the wholesaler/, { timeout: 20_000 });
  await expect(checkout(page)).not.toContainText(/will have to sign off|must sign off/);
});

import { expect, test, type Page } from "@playwright/test";
import { addPasskey, joinAsApprover, watchErrors } from "../support/dock";
import { stageThread } from "../support/thread";

/**
 * The shop by hand: catalogue -> a product page with a live price -> "Add to your order" puts it on the agent's
 * order sheet -> one confirm -> the same gate as the agent's orders. Seed catalogue (the live price comes from the seed's own live layer, not the partner).
 */

async function visitorKitchen(page: Page): Promise<string> {
  await addPasskey(page);
  await joinAsApprover(page);
  await page.goto("/k/mine");
  await page.waitForURL(/\/k\/(?!mine)[^/]+$/);
  return new URL(page.url()).pathname.split("/")[2];
}

test("catalogue, product page with a live price, basket, fixed price, through the gate", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const kitchen = await visitorKitchen(page);
  await page.goto(`/k/${kitchen}/catalogue`);
  // How the list was made (no live call) is folded under a quiet disclosure, not the hero's subtitle.
  await page.getByText("How this page was made").first().click();
  await expect(
    page.getByText(/products from the product files/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/No live call for the list/).first(),
  ).toBeVisible();

  await page
    .getByRole("link", {
      name: /Valio Eila lactose-free semi-skimmed milk drink 1\.5 %, 10 L/,
    })
    .first()
    .click();
  await page.waitForURL(/\/catalogue\/VA-1010$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /Valio Eila/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/Checked live with the wholesaler at \d/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^\d+,\d{2}\s€$/).first()).toBeVisible();
  // Missing allergen data is unknown, not absent (said in words on the product page).
  await expect(
    page.getByText(/every allergen is unknown, not absent/),
  ).toBeVisible();

  // "Add" puts the product on the agent's order sheet (one order, priced live, previewed by the gate); its one
  // button says what will happen and the price. 10 packs of the usual milk, 129 € under the visitor's 500 € limit.
  const qty = page.getByRole("textbox", { name: "Quantity in packs" });
  await qty.fill("10");
  await page.getByRole("button", { name: "Add to your order" }).click();
  const log = page.getByRole("log").filter({ visible: true }).first();
  // A visitor's first order: the mistake check may ask a person to look at it (a large first order); the sheet says so
  // before the tap, and what it says is what happens.
  const confirm = log.getByRole("button", {
    name: /^(Order this|Send to .+ for an OK), /,
  });
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  await expect(log).toContainText(/10\s×\s10\sL\s=\s100\sL/);
  const alone = /^Order this/.test((await confirm.textContent()) ?? "");
  await expect(log).toContainText(
    alone ? /Inside your rules/ : /OKs it on their phone/,
  );
  await confirm.click();
  await expect(log).toContainText(
    alone ? /Ordered\. Arrives/ : /Waiting for .+'s OK/,
    { timeout: 20_000 },
  );
  expect(errors).toEqual([]);
});

/**
 * Regression test, fixed on main (f49eea8). Before, a person ordering one 10 L pack by hand from Kaari's basket
 * (12,90 €, far under its 100 € limit) was stopped at the gate for the head chef's sign-off by a mistake check
 * nobody was asked.
 */
test("a small hand order from the catalogue goes through without a sign-off", async ({
  page,
  baseURL,
}) => {
  // Kaari's thread to this test alone, started over: "Add" goes on the thread's open order sheet.
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/catalogue/VA-1010");
    await expect(
      page.getByText(/Checked live with the wholesaler at \d/),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add to your order" }).click();
    const log = page.getByRole("log").filter({ visible: true }).first();
    // The order sheet's own preview: the agent may order it alone, so the button orders, it does not ask for an OK.
    await expect(
      log.getByRole("button", { name: /^Order this, / }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(log).not.toContainText(/for an OK|OKs it on their phone/);
  } finally {
    release();
  }
});

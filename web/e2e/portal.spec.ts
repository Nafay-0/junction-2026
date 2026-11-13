import { expect, test } from "@playwright/test";

/** The kitchen shop: enter a demo kitchen with one click, browse, and read the agent's rules. No model, no live call. */
test("enter a kitchen's shop, browse the catalogue, read the rules", async ({ page }) => {
  await page.goto("/k");
  await expect(page.getByRole("heading", { name: "Enter a kitchen's shop" })).toBeVisible();
  await page.getByRole("link", { name: /Ravintola Kaari/ }).first().click();
  await expect(page.getByRole("heading", { name: "Needs you now" })).toBeVisible();
  await expect(page.getByText(/demo built for the Junction 2026/).first()).toBeVisible();

  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByText(/products from the product files/)).toBeVisible();
  await expect(page.locator("main ul li").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Agent and rules" }).click();
  await expect(page.getByRole("heading", { name: "Who can see what" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The agent may, alone" })).toBeVisible();

  await page.getByRole("button", { name: "Ask the purchasing agent" }).click();
  await expect(page.getByLabel("Ask, or say what the kitchen needs")).toBeVisible();
});

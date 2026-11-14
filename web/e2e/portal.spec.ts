import { expect, test } from "@playwright/test";

/** The kitchen shop: enter a demo kitchen with one click, browse, and read the agent's rules. No model, no live call. */
test("enter a kitchen's shop, browse the catalogue, read the rules", async ({ page }) => {
  await page.goto("/k");
  await expect(page.getByRole("heading", { name: "Your kitchen's shop" })).toBeVisible();
  await page.getByRole("link", { name: /Ravintola Kaari/ }).first().click();
  await expect(page.getByRole("heading", { name: "Needs you now" })).toBeVisible();
  // The demo note: the full sentence on a desk, its short form in the phone's top strip.
  await expect(page.locator("text=/demo built for the Junction 2026|Demo on synthetic data/ >> visible=true").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByText(/products from the product files/)).toBeVisible();
  await expect(page.locator("main ul li").first()).toBeVisible();

  // On a phone the sections sit in the tab bar; "Agent and rules" is one tap further, under More.
  await page.getByRole("navigation", { name: "Shop" }).getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Agent and rules" }).click();
  await expect(page.getByRole("heading", { name: "Who can see what" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The agent may, alone" })).toBeVisible();

  // The agent is the middle of the tab bar: one tap opens the thread.
  await page.getByRole("navigation", { name: "Shop" }).getByRole("button", { name: "Agent" }).click();
  await expect(page.getByLabel("Ask, or say what the kitchen needs")).toBeVisible();
});

/**
 * The thread lives on the server: a reload of the Order page (the full-width thread) shows the same turns again.
 * No model: the turn is a tap on a card for an order that does not exist, which the engine refuses with a notice.
 */
test("a reload of the order page keeps the conversation", async ({ page }) => {
  await page.goto("/k/kaari/order");
  await expect(page.getByRole("heading", { name: "Order with your agent" })).toBeVisible();
  await expect(page.getByLabel("Ask, or say what the kitchen needs")).toBeVisible();
  const label = `Reload check ${Date.now()}`;
  const sent = await page.request.post("/ui-api/kitchens/kaari/thread/turns", { data: { door: "typed", via: "tap", action: { type: "withdraw", orderId: "ord_e2e_none" }, label } });
  expect(sent.status()).toBe(202);
  // The turn arrives on the open page through the event stream, then the engine's answer: a notice card.
  const log = page.getByRole("log", { name: "Conversation with the purchasing agent" });
  await expect(log.getByText(label)).toBeVisible();
  await expect(log.getByText("Not allowed").last()).toBeVisible();
  await page.reload();
  await expect(log.getByText(label)).toBeVisible();
  await expect(log.getByText("Not allowed").last()).toBeVisible();
});

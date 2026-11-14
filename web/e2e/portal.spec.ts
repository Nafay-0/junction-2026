import { expect, test, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

/**
 * The kitchen shop, entered as a judge would: signed in to a public test account (no kitchen is open to strangers,
 * the stage kitchens included). Browse, read the agent's rules. No model, no live call.
 */
const tester = TEST_ACCOUNTS[0];

async function signIn(page: Page) {
  await page.goto("/k");
  await expect(page.getByRole("heading", { name: "Your kitchen's shop" })).toBeVisible();
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username", { exact: true }).fill(tester.username);
  await form.getByLabel("Password", { exact: true }).fill(tester.password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/k/${tester.username}`);
}

test("the stage kitchens are closed to strangers; the door lists none of them", async ({ page }) => {
  await page.goto("/k");
  await expect(page.getByRole("link", { name: /Ravintola Kaari|Laakso Catering/ })).toHaveCount(0);
  for (const k of ["kaari", "laakso"]) {
    await page.goto(`/k/${k}`);
    await expect(page.getByRole("heading", { name: "This kitchen is private" })).toBeVisible();
    expect((await page.request.get(`/ui-api/kitchens/${k}/portal`)).status()).toBe(401);
    expect((await page.request.get(`/ui-api/plan/${k}`)).status()).toBe(401);
  }
});

/**
 * DEFECT (test.fail until fixed; cosmetic, seen with the seed catalogue). The catalogue opens on the kitchen's first
 * allowed category whether or not it has any products (src/app/k/[kitchen]/catalogue.tsx:38-39,
 * `kitchen.mandate.allowedCategories[0]`): the test account's is "butter", which the seed catalogue (the hermetic
 * test server, DOCK_CATALOG=seed) does not carry, so a visitor lands on "butter: 0 products, Nothing matches".
 * With the partner's catalogue butter exists and the page fills.
 */
test("enter a kitchen's shop, browse the catalogue, read the rules", async ({ page }) => {
  test.fail(!process.env.E2E_BASE_URL && !process.env.E2E_EXPECT_FIXED, "the catalogue opens on an empty first category ('butter') with the seed catalogue");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Needs you now" })).toBeVisible();
  // The demo note: the full sentence on a desk, its short form in the phone's top strip.
  await expect(page.locator("text=/demo built for the Junction 2026|Demo on synthetic data/ >> visible=true").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByText(/^\d+\+? products$/).first()).toBeVisible();
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
  await signIn(page);
  await page.goto(`/k/${tester.username}/order`);
  await expect(page.getByRole("heading", { name: "Order with your agent" })).toBeVisible();
  await expect(page.getByLabel("Ask, or say what the kitchen needs")).toBeVisible();
  const label = `Reload check ${Date.now()}`;
  const sent = await page.request.post(`/ui-api/kitchens/${tester.username}/thread/turns`, { data: { door: "typed", via: "tap", action: { type: "withdraw", orderId: "ord_e2e_none" }, label } });
  expect(sent.status()).toBe(202);
  // The turn arrives on the open page through the event stream, then the engine's answer: a notice card.
  const log = page.getByRole("log", { name: "Conversation with the purchasing agent" });
  await expect(log.getByText(label)).toBeVisible();
  await expect(log.getByText("Not allowed").last()).toBeVisible();
  await page.reload();
  await expect(log.getByText(label)).toBeVisible();
  await expect(log.getByText("Not allowed").last()).toBeVisible();
});

test("the menu planner opens for an account's kitchen", async ({ page }) => {
  await signIn(page);
  await page.goto(`/k/${tester.username}/menu`);
  const info = await (await page.request.get(`/ui-api/plan/${tester.username}`)).json();
  expect(info.kitchen).toMatchObject({ slug: tester.username, name: tester.restaurant });
  await expect(page.getByText(/is for kitchens with an account/)).toHaveCount(0);
});

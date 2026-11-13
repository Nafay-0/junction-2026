import { expect, test, type Page } from "@playwright/test";

/**
 * The live-demo path on a phone-sized Chromium with a virtual platform authenticator (Face ID / fingerprint
 * stand-in): scan -> passkey -> agent order over the limit -> phone opens the request -> approve -> committed,
 * seen on the big screen too.
 */
async function addPasskeyAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

async function joinAndWait(page: Page) {
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: /Become the purchasing manager/ })).toBeVisible();
  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver");
  await expect(page.getByText("Waiting for requests")).toBeVisible();
  await expect(page.getByText("Purchasing manager", { exact: false }).first()).toBeVisible();
}

test("register -> request needing approval -> approve with passkey -> committed", async ({ page, browser }) => {
  const { cdp, authenticatorId } = await addPasskeyAuthenticator(page);
  await joinAndWait(page);
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);

  const screenContext = await browser.newContext();
  const screen = await screenContext.newPage();
  await screen.goto("/"); // the wall (the old /screen redirects here)
  await expect(screen.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
  await expect(screen.locator("figure svg")).toBeVisible();
  await expect(screen.getByText(/Kitchens here now: \d+/)).toBeVisible();

  await page.getByRole("button", { name: /ask my agent for 1,000 L of milk/ }).click();
  await page.waitForURL("**/approve/**"); // opened by the live event, not by the click
  await expect(page.getByText("Over this agent's €500 per-order limit")).toBeVisible();
  // On the 12-product seed the scripted order always needs a substitute; on the partner's real catalogue it
  // depends on live stock, so there the sign-off may be for the limit alone.
  const health = (await (await page.request.get("/api/health")).json()) as { catalog?: { source?: string } };
  if (health.catalog?.source !== "valio") {
    await expect(page.getByText("Not exactly what was asked")).toBeVisible();
    await expect(page.getByText(/instead of/).first()).toBeVisible();
  }
  await expect(screen.getByText(/^Waiting for /).first()).toBeVisible();

  const approve = page.getByRole("button", { name: /^Approve €/ });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await expect(page.getByText(/with a passkey/)).toBeVisible();

  await expect(screen.getByText(/^Signed order/).first()).toBeVisible();
  const approvalId = page.url().split("/approve/")[1];
  const view = await (await page.request.get(`/api/v1/approvals/${approvalId}`)).json();
  expect(view.view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });
  const ledger = await (await page.request.get(`/api/v1/ledger?orderId=${view.view.details.orderId}`)).json();
  expect(ledger.verification.ok).toBe(true);
  expect(ledger.explanation.join("\n")).toMatch(/signed with a passkey/);
  await screenContext.close();
});

test("a failed passkey prompt shows an honest error and approves nothing", async ({ page }) => {
  const { cdp, authenticatorId } = await addPasskeyAuthenticator(page);
  await joinAndWait(page);
  await page.getByRole("button", { name: /ask my agent for 1,000 L of milk/ }).click();
  await page.waitForURL("**/approve/**");
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId }); // the passkey is gone from this phone
  await page.getByRole("button", { name: /^Approve €/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Cancelled" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Nothing happened/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order placed" })).toHaveCount(0);
  const approvalId = page.url().split("/approve/")[1];
  const view = await (await page.request.get(`/api/v1/approvals/${approvalId}`)).json();
  expect(view.view.state).toBe("pending");
  // No demo fallback unless the server enables it.
  await expect(page.getByRole("button", { name: /Demo only/ })).toHaveCount(0);
});

test("declines in one tap with an optional reason", async ({ page }) => {
  await addPasskeyAuthenticator(page);
  await joinAndWait(page);
  await page.getByRole("button", { name: /ask my agent for 1,000 L of milk/ }).click();
  await page.waitForURL("**/approve/**");
  await page.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("button", { name: "Too expensive" }).click();
  await page.getByRole("button", { name: /^Decline/ }).click();
  await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible();
  await expect(page.getByText(/Too expensive/)).toBeVisible();
});

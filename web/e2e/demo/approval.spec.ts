import { expect, test } from "@playwright/test";
import { addPasskey, approvalState, approveButton, askForMilkAndWaitForSignOff, joinAsApprover, openWall, watchErrors } from "../support/dock";

/**
 * The headline path, on every engine and size: a visitor scans the wall's code, makes a passkey and lands as the
 * approver; their agent's order over the limit opens on the phone by itself (live event, not a click); they sign
 * it with the passkey; the signed order appears on the wall. Then decline, and a dismissed passkey prompt.
 * Chromium uses the browser's virtual authenticator; WebKit and Firefox a software passkey (support/soft-passkey.js).
 */

test("scan, passkey, order over the limit reaches the phone, sign, signed order on the wall", async ({ page, browser, baseURL }) => {
  const errors = watchErrors(page);
  const passkey = await addPasskey(page);
  const wallContext = await browser.newContext({ baseURL });
  const wall = await openWall(wallContext);
  await expect(wall.locator("figure svg").first()).toBeVisible();

  await joinAsApprover(page);
  expect(await passkey.count()).toBe(1);
  await expect(page.getByText(/Purchasing manager/i).first()).toBeVisible();

  const approvalId = await askForMilkAndWaitForSignOff(page);
  await expect(page.getByText(/Over this agent's 500\s€ per-order limit/)).toBeVisible();
  await expect(page.getByText("Not exactly what was asked")).toBeVisible(); // seed catalogue: a substitute is proposed
  await expect(wall.getByText(/^Waiting for /).first()).toBeVisible({ timeout: 20_000 });

  await expect(approveButton(page)).toBeEnabled();
  await approveButton(page).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/with a passkey/)).toBeVisible();
  await expect(wall.getByText(/^Signed order/).first()).toBeVisible({ timeout: 20_000 });

  const view = await approvalState(page.request, approvalId);
  expect(view.view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });
  const ledger = await (await page.request.get(`/api/v1/ledger?orderId=${view.view?.details?.orderId}`)).json();
  expect(ledger.verification.ok).toBe(true);
  expect(ledger.explanation.join("\n")).toMatch(/signed with a passkey/);
  expect(errors).toEqual([]);
  await wallContext.close();
});

test("decline in one tap with a reason", async ({ page }) => {
  await addPasskey(page);
  await joinAsApprover(page);
  const approvalId = await askForMilkAndWaitForSignOff(page);
  await page.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("button", { name: "Too expensive" }).click();
  await page.getByRole("button", { name: /^Decline/ }).click();
  await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible();
  await expect(page.getByText(/Too expensive/)).toBeVisible();
  expect((await approvalState(page.request, approvalId)).view?.state).toMatch(/declined/);
});

test("a dismissed passkey prompt says so and approves nothing", async ({ page }) => {
  const passkey = await addPasskey(page);
  await joinAsApprover(page);
  const approvalId = await askForMilkAndWaitForSignOff(page);
  await passkey.clear(); // the passkey is gone from this phone: the prompt can only be dismissed
  await approveButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: /Cancelled|cancel/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Nothing happened/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order placed" })).toHaveCount(0);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("pending");
  await expect(page.getByRole("button", { name: /Demo only/ })).toHaveCount(0);
});

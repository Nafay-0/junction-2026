import { expect, test, type Browser, type Page } from "@playwright/test";
import { addPasskey, approveButton } from "../support/dock";
import { acquireLock } from "../support/recall-lock";

/**
 * A shared test kitchen at the table: several reviewers, each with their own phone, one after the other. Every
 * "Send to my phone" gives a new one-time address that adds THAT phone as one more signing device of the kitchen's
 * approver and lands on the order's sign-off, however many phones joined before; each phone approves its own order
 * with its own passkey, and the desk turns each slab into the signed outcome by itself. A phone that opens a bare
 * sign-off address it may not sign is told what to do (never "No such request"). No model: each request is opened
 * with a structured need and every step is a tap turn.
 */
const KITCHEN = "koulu-metsola";
const PASSWORD = "metsola-school-NlUJi4B8"; // a public test account (server/accounts/test-accounts.ts)

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

type Step = { requestId: string; state: string; concerns: { key: string; confirmable: boolean; corrections: { id: string }[] }[]; questions: { id: string; options: { id: string }[] }[]; options: { optionId: string }[] };

/** One order over Metsola's 250 € limit, waiting for the approver: its approval id. */
async function orderOverTheLimit(page: Page): Promise<string> {
  const opened = await page.request.post(`/ui-api/kitchens/${KITCHEN}/call`, {
    data: { method: "POST", path: "/api/v1/intake", body: { need: { text: "400 litres of lactose-free milk", item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 400, unit: "L" }, deliverBy: inDays(6) }, by: "e2e" } },
  });
  expect(opened.status()).toBeLessThan(300);
  let step = ((await opened.json()) as { step: Step }).step;
  const turn = (action: Record<string, unknown>, label: string) => page.request.post(`/ui-api/kitchens/${KITCHEN}/thread/turns`, { data: { door: "typed", via: "tap", action, label } });
  const read = async () => ((await (await page.request.post(`/ui-api/kitchens/${KITCHEN}/call`, { data: { method: "GET", path: `/api/v1/intake/${step.requestId}` } })).json()) as { step: Step }).step;
  for (let i = 0; i < 5 && step.state !== "options_ready"; i++) {
    if (step.state === "needs_confirmation") {
      const c = step.concerns[0];
      await turn({ type: "concern", requestId: step.requestId, key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id }, "Yes, as asked");
    } else if (step.state === "needs_input") {
      const q = step.questions[0];
      await turn({ type: "answer", requestId: step.requestId, questionId: q.id, optionId: q.options[0].id }, "The first");
    } else break;
    await expect.poll(async () => (step = await read()).state, { timeout: 20_000 }).not.toBe("needs_confirmation");
  }
  test.skip(step.state !== "options_ready", `no options to choose today (${step.state})`);
  await turn({ type: "choose", requestId: step.requestId, optionId: step.options[0].optionId }, "Order the first");
  let approvalId = "";
  await expect
    .poll(async () => {
      const p = (await (await page.request.get(`/ui-api/kitchens/${KITCHEN}/portal`)).json()) as { orders: { status: string; requestId?: string; authorised: { by: string; approvalId?: string } }[] };
      approvalId = p.orders.find((o) => o.status === "pending_approval" && o.requestId === step.requestId)?.authorised.approvalId ?? "";
      return approvalId;
    }, { timeout: 30_000 })
    .not.toBe("");
  return approvalId;
}

/** A reviewer's own phone: a fresh browser with its own passkey authenticator, joining by the address it was given. */
async function phoneApproves(browser: Browser, url: string, approvalId: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  await addPasskey(phone);
  await phone.goto(url);
  await phone.getByRole("button", { name: "Create the passkey on this phone" }).click();
  // Added, and straight on to this order's sign-off.
  await phone.waitForURL(`**/approve/${approvalId}`, { timeout: 20_000 });
  await approveButton(phone).click();
  await expect(phone.getByText("Order placed")).toBeVisible({ timeout: 20_000 });
  return phone;
}

test("a shared test kitchen: each reviewer's phone joins and approves its own order, one after the other", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const release = await acquireLock(`thread-${KITCHEN}-${baseURL}`, { timeoutMs: 300_000 });
  try {
    await page.goto("/k");
    const form = page.getByRole("form", { name: "Sign in" });
    await form.getByLabel("Username", { exact: true }).fill(KITCHEN);
    await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`**/k/${KITCHEN}`, { timeout: 20_000 });
    await page.request.post(`/ui-api/kitchens/${KITCHEN}/thread/reset`);
    await page.goto(`/k/${KITCHEN}/order`);
    const log = page.getByRole("log", { name: "Conversation with the purchasing agent" });

    for (const reviewer of [1, 2]) {
      const approvalId = await orderOverTheLimit(page);
      const slab = log.locator('[data-slab="waiting"]').last();
      await expect(slab).toBeVisible({ timeout: 30_000 });
      await slab.getByRole("button", { name: /^Send to/ }).click();
      // Always the one-time address that adds this phone, even after a phone joined before.
      const link = slab.getByRole("link").first();
      await expect(link).toHaveAttribute("href", new RegExp(`/join/device\\?t=.+&next=%2Fapprove%2F${approvalId}$`));
      const url = (await link.getAttribute("href"))!;
      if (reviewer === 2) {
        // The bare sign-off address on a phone that has not joined: what to do, never "No such request".
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const stranger = await ctx.newPage();
        await stranger.goto(`/approve/${approvalId}`);
        await expect(stranger.getByText("Scan a new code")).toBeVisible({ timeout: 20_000 });
        await expect(stranger.getByText("No such request")).toHaveCount(0);
        await ctx.close();
      }
      const phone = await phoneApproves(browser, url, approvalId);
      await phone.context().close();
      // The desk follows by itself: the slab of this order is the signed outcome.
      await expect(log.getByRole("region", { name: "OK given" })).toHaveCount(reviewer, { timeout: 30_000 });
    }
  } finally {
    release();
  }
});

test("a shared test kitchen: a change to the rules is signed on a second reviewer's phone too", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const release = await acquireLock(`thread-${KITCHEN}-${baseURL}`, { timeoutMs: 300_000 });
  try {
    await page.goto("/k");
    const form = page.getByRole("form", { name: "Sign in" });
    await form.getByLabel("Username", { exact: true }).fill(KITCHEN);
    await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`**/k/${KITCHEN}`, { timeout: 20_000 });
    await page.request.post(`/ui-api/kitchens/${KITCHEN}/thread/reset`);
    await page.goto(`/k/${KITCHEN}`);
    const log = page.getByRole("log", { name: "Conversation with the purchasing agent" });
    const turn = (action: Record<string, unknown>, label: string) => page.request.post(`/ui-api/kitchens/${KITCHEN}/thread/turns`, { data: { door: "typed", via: "tap", action, label } });

    // Two widenings, each sent to the approver; each signed on a different phone that joins by its own new code. Each
    // starts from the same rules: the group taken away first (a narrowing, signed at once), then added (a widening).
    for (const reviewer of [1, 2]) {
      await turn({ type: "rules_propose", change: { groupsRemove: ["18"] }, sign: true }, "Not meat and fish");
      await expect(log.locator('[data-slab="rules-waiting"]')).toHaveCount(0, { timeout: 20_000 });
      expect((await turn({ type: "rules_propose", change: { groupsAdd: ["18"] }, sign: true }, "Meat and fish too")).status()).toBe(202);
      const slab = log.locator('[data-slab="rules-waiting"]').last();
      await expect(slab).toBeVisible({ timeout: 30_000 });
      await slab.getByRole("button", { name: /^Send to/ }).click();
      const link = slab.getByRole("link").first();
      await expect(link).toHaveAttribute("href", /\/join\/device\?t=.+&next=%2Fapprove%2Frch_/);
      const url = (await link.getAttribute("href"))!;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await ctx.newPage();
      await addPasskey(phone);
      await phone.goto(url);
      await phone.getByRole("button", { name: "Create the passkey on this phone" }).click();
      await phone.waitForURL(/\/approve\/rch_/, { timeout: 20_000 });
      await phone.getByRole("button", { name: "Sign the change" }).click();
      await expect(phone.getByRole("heading", { name: "Signed" })).toBeVisible({ timeout: 20_000 });
      await ctx.close();
      await expect(log.locator('[data-slab="rules-signed"]')).toHaveCount(reviewer, { timeout: 30_000 });
    }
  } finally {
    release();
  }
});

import { randomInt } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { OPS_PASSCODE, addPasskey, approvalState, approveButton, openWall, watchErrors } from "../support/dock";
import { acquireLock } from "../support/recall-lock";

/**
 * The presenter path: the two built-in demo kitchens (/k/kaari, /k/laakso) name fictional approvers, so in a
 * production build nobody can sign their orders until a presenter who knows the operations passcode takes the role
 * on their own phone (/join/presenter, server/presenter.ts). Everything here runs against the real hermetic server
 * (model off, seed catalogue); nothing is stubbed.
 *
 * Kitchen and amount: Ravintola Kaari, "100 litres of milk for Thursday" (an example chip on /k/kaari/order), about
 * €130-150 against Kaari's €100 per-order limit, so it goes to Sanna Koskinen (head chef, signs up to €1,000).
 * Not Laakso's 1,000 L example: Laakso's weekly budget is €2,000 and one signed 1,000 L order (€1,322) uses it up
 * for the week (QA finding 2), so only one of the six projects could ever pass, and the shared kitchens are also
 * used by other specs. Kaari's €1,500 a week fits six signed 100 L orders; if other specs have spent it, the test
 * skips and says so.
 *
 * Shared state: enrolling replaces the earlier presenter for that role (server/presenter.ts), so the six projects
 * take a cross-process lock and enrol one at a time. After this file runs, Kaari's head chef HAS a passkey on this
 * server for 48 h: Kaari's sign-off QR is then in "passkey" mode ("Scan with Sanna Koskinen's phone"), not "enrol"
 * ("Become the approver"). There is no way to undo an enrolment (no route), so a spec that expects the enrol QR on
 * Kaari must not run after this one on the same server.
 *
 * The passcode limiter counts wrong guesses per client address (X-Forwarded-For, else "unknown"). Every browser test
 * on one server shares "unknown", so each test here sends its own made-up X-Forwarded-For; a server behind a proxy
 * that appends the real address (a deployment) ignores it.
 */

const fakeAddress = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;
const KITCHEN_SIZE = { width: 1440, height: 900 };

/** The demo kitchen's order page, on its own laptop-sized screen. */
async function kitchenScreen(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: KITCHEN_SIZE, extraHTTPHeaders: { "x-forwarded-for": fakeAddress() } });
  const k = await ctx.newPage();
  await k.goto("/k/kaari/order");
  await expect(k.getByRole("heading", { name: "Order", exact: true })).toBeVisible();
  return k;
}

/**
 * Pick an example request on the kitchen's order page and take it to the gate: model off, so the console offers the
 * offline example reader; then the cheapest card (the last, "Best price") unless the agent already chose, a fixed
 * price, place it.
 * Returns the approval id the sign-off panel's QR code points at, or undefined when Kaari's budget is spent.
 */
async function orderOverTheLimit(k: Page, example: string): Promise<{ approvalId: string; qrLink: string; qrMode: "enrol" | "passkey" } | undefined> {
  await k.getByRole("button", { name: example, exact: true }).click();
  const offline = k.getByRole("button", { name: "Use the offline example reader" });
  const price = k.getByRole("button", { name: "Get a fixed price for this" });
  const nothing = k.getByText(/Nothing fits/);
  // A request that names its criterion ("lowest CO2") is chosen by the agent and priced at once: no card to pick.
  const place = k.getByRole("button", { name: "Place the order" });
  // An earlier project's signed 100 L for the same day: the mistake check asks "Order again?" (the duplicate check).
  const again = k.getByRole("button", { name: "Yes, I meant that" });
  const ready = price.first().or(place).or(nothing.first());
  await expect(offline.or(ready).or(again)).toBeVisible({ timeout: 30_000 });
  if (await offline.isVisible()) {
    await offline.click();
    await expect(ready.or(again)).toBeVisible({ timeout: 30_000 });
  }
  if ((await again.isVisible()) && !(await ready.isVisible())) {
    await again.click();
    await expect(ready).toBeVisible({ timeout: 30_000 });
  }
  if (await nothing.first().isVisible()) return undefined;
  if (!(await place.isVisible())) await price.last().click();
  await place.click();
  await expect(k.getByText("Stopped at the gate").first()).toBeVisible({ timeout: 30_000 });
  await expect(k.getByText(/Sanna Koskinen, head chef, must sign off/)).toBeVisible();
  const link = k.getByRole("link", { name: /^(Become the approver|Open the sign-off screen)$/ });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = (await link.getAttribute("href"))!;
  const name = (await link.textContent())!;
  const url = new URL(href);
  const approvalPath = name === "Become the approver" ? url.searchParams.get("next")! : url.pathname;
  const approvalId = approvalPath.split("/approve/")[1].split(/[?#/]/)[0];
  return { approvalId, qrLink: url.pathname + url.search, qrMode: name === "Become the approver" ? "enrol" : "passkey" };
}

test("a wrong operations passcode is refused before any passkey prompt exists", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
  const passkey = await addPasskey(page);
  await page.goto("/join/presenter?kitchen=kaari&role=head_chef");
  await expect(page.getByRole("heading", { name: "Sign for a demo kitchen" })).toBeVisible();
  await expect(page.getByText(/Sanna Koskinen at Ravintola Kaari is made up for the demo/)).toBeVisible();
  await page.getByLabel("Operations passcode").fill("not-the-passcode");
  await page.getByLabel("Your name (for the audit log)").fill("E2E wrong guess");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /passcode/ })).toHaveText("That passcode is not right. Ask the person running the demo.");
  await expect(page.getByRole("button", { name: "Create my passkey" })).toHaveCount(0);
  expect(await passkey.count()).toBe(0);
  // No session either: the approver home still says this phone has not joined.
  expect((await page.request.get("/api/v1/approver")).status()).toBe(401);
});

test("an unknown kitchen and an unknown role are refused by name", async ({ request }) => {
  const res = await request.get("/ui-api/presenter/enrol?kitchen=sbx_abc");
  expect(res.status()).toBe(404);
  expect((await res.json()).error.message).toMatch(/only enrol for the built-in demo kitchens/);
  const role = await request.post("/ui-api/presenter/enrol", { data: { kitchen: "kaari", role: "ceo", passcode: OPS_PASSCODE }, headers: { "x-forwarded-for": fakeAddress() } });
  expect(role.status()).toBe(400);
  expect((await role.json()).error.message).toMatch(/roles: head_chef, owner/);
});

/**
 * Risk at the venue, documented rather than failed: wrong guesses are counted per address, and the check runs before
 * the passcode is compared, so five wrong guesses lock out the RIGHT passcode for ten minutes. Behind the venue's one
 * public address, a curious judge who scans "Become the approver" and guesses five times locks the presenter out.
 */
test("five wrong passcodes from one address lock out the right one too", async ({ request }) => {
  const headers = { "x-forwarded-for": fakeAddress() };
  for (let i = 0; i < 5; i++) {
    const r = await request.post("/ui-api/presenter/enrol", { data: { kitchen: "kaari", role: "head_chef", passcode: `guess-${i}` }, headers });
    expect(r.status()).toBe(401);
  }
  const right = await request.post("/ui-api/presenter/enrol", { data: { kitchen: "kaari", role: "head_chef", passcode: OPS_PASSCODE }, headers });
  expect(right.status()).toBe(429);
  expect((await right.json()).error).toMatchObject({ code: "passcode_attempts_exceeded", message: expect.stringMatching(/Try again in 10 min/) });
  // Another address is not affected.
  const other = await request.post("/ui-api/presenter/enrol", { data: { kitchen: "kaari", role: "head_chef", passcode: OPS_PASSCODE }, headers: { "x-forwarded-for": fakeAddress() } });
  expect(other.status()).toBe(200);
});

test("presenter enrols with the passcode and a passkey, signs Kaari's order over the limit, signed order on the wall; the next one opens from the console's code", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
  const passkey = await addPasskey(page);
  const release = await acquireLock(`presenter-kaari-${baseURL}`, { timeoutMs: 200_000 });
  const wallContext = await browser.newContext({ baseURL });
  try {
    const wall = await openWall(wallContext);
    const k = await kitchenScreen(browser, baseURL);

    // 1. The kitchen's agent places an order over its limit; the console shows a code for the (fictional) head chef.
    const first = await orderOverTheLimit(k, "100 litres of milk for Thursday");
    test.skip(!first, "Kaari's weekly budget is spent on this server (other specs ordered on the shared demo kitchen)");
    if (first!.qrMode === "enrol") await expect(k.getByText(/A presenter scans this, enters the operations passcode/)).toBeVisible();
    await expect(wall.getByText(/^Waiting for /).first()).toBeVisible({ timeout: 20_000 });

    // 2. The presenter scans it (or, when an earlier project already enrolled, opens the presenter page for the same
    //    order): passcode first, then a passkey made on this phone.
    const enrolLink = first!.qrMode === "enrol" ? first!.qrLink : `/join/presenter?kitchen=kaari&role=head_chef&next=${encodeURIComponent(`/approve/${first!.approvalId}`)}`;
    await page.goto(enrolLink);
    await expect(page.getByRole("heading", { name: "Sign for a demo kitchen" })).toBeVisible();
    await page.getByLabel("Operations passcode").fill(OPS_PASSCODE);
    await page.getByLabel("Your name (for the audit log)").fill("E2E presenter");
    await page.getByRole("button", { name: "Continue" }).click();
    const create = page.getByRole("button", { name: "Create my passkey" });
    await expect(create).toBeVisible();
    if (first!.qrMode === "passkey") await expect(page.getByText(/This replaces the passkey Sanna Koskinen was signed with before/)).toBeVisible();
    await create.click();
    await page.waitForURL(`**/approve/${first!.approvalId}`, { timeout: 30_000 });
    expect(await passkey.count()).toBe(1);

    // 3. Sign with that passkey.
    await expect(approveButton(page)).toBeEnabled({ timeout: 20_000 });
    await approveButton(page).click();
    await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/with a passkey/)).toBeVisible();
    const view = await approvalState(page.request, first!.approvalId);
    expect(view.view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });

    // The kitchen's page and the wall follow live.
    await expect(k.getByText(/Authorised by Sanna Koskinen/)).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByText(/^Signed order/).first()).toBeVisible({ timeout: 20_000 });

    // The ledger records who enrolled, on what authority, and that the order was signed with the passkey.
    const ledger = await (await page.request.get(`/api/v1/ledger?orderId=${view.view?.details?.orderId}`)).json();
    expect(ledger.verification.ok).toBe(true);
    expect(ledger.explanation.join("\n")).toMatch(/signed with a passkey/);

    // 4. The next order over the limit: the console's code now says the head chef's passkey is needed and opens the
    //    sign-off screen straight away (no second enrolment). Declined from the phone, so it costs no budget.
    await k.getByRole("button", { name: "New request" }).first().click();
    const second = await orderOverTheLimit(k, "100 L milk for Wednesday, lowest CO2");
    test.skip(!second, "Kaari's weekly budget is spent on this server (other specs ordered on the shared demo kitchen)");
    expect(second!.qrMode).toBe("passkey");
    await expect(k.getByText("Scan with Sanna Koskinen's phone. Approving needs their passkey.")).toBeVisible();
    await page.goto(second!.qrLink);
    await page.getByRole("button", { name: "Add reason" }).click();
    await page.getByRole("button", { name: "Too expensive" }).click();
    await page.getByRole("button", { name: /^Decline/ }).click();
    await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible();
    expect((await approvalState(page.request, second!.approvalId)).view?.state).toMatch(/declined/);
    await expect(k.getByText(/Declined|Not ordered/).first()).toBeVisible({ timeout: 20_000 });
    // WebKit reports a fetch cancelled by a navigation as "... due to access control checks."; not a user-visible error.
    expect(errors.filter((e) => !/^pageerror: \S+ due to access control checks\.$/.test(e))).toEqual([]);
    await k.context().close();
  } finally {
    await wallContext.close();
    release();
  }
});

/**
 * Regression test, fixed on main in 4f0e267. Before, a presenter who enrolled from /join/presenter without a `next`
 * (enrolling before the demo starts) landed on /approver, which answered 401 "not_joined" for any approver without a
 * visitor sandbox: the phone said "You haven't joined yet" and the demo kitchen's next request never opened on it by
 * itself. Now the presenter's home shows the role they took and the next request opens by itself.
 */
test("a presenter who enrols ahead of the demo sees their sign-offs and gets the next one by itself", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
  await addPasskey(page);
  const release = await acquireLock(`presenter-kaari-${baseURL}`, { timeoutMs: 200_000 });
  let k: Page | undefined;
  try {
    await page.goto("/join/presenter?kitchen=kaari&role=head_chef");
    await page.getByLabel("Operations passcode").fill(OPS_PASSCODE);
    await page.getByLabel("Your name (for the audit log)").fill("E2E early presenter");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create my passkey" }).click();
    await page.waitForURL("**/approver", { timeout: 30_000 });
    // Not "You haven't joined yet" (the defect fixed in 4f0e267): the role the presenter took.
    await expect(page.getByRole("heading", { name: "You haven't joined yet" })).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Sanna Koskinen" })).toBeVisible();

    k = await kitchenScreen(browser, baseURL);
    const order = await orderOverTheLimit(k, "100 L milk for Wednesday, lowest CO2");
    test.skip(!order, "Kaari's weekly budget is spent on this server (other specs ordered on the shared demo kitchen)");
    await page.waitForURL(`**/approve/${order!.approvalId}`, { timeout: 30_000 });
    await page.getByRole("button", { name: /^Decline/ }).click();
    await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible();
  } finally {
    await k?.context().close();
    release();
  }
});

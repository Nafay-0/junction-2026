import { expect, test, type Page } from "@playwright/test";

/**
 * Accounts, end to end in a browser: a new restaurant signs up, signs its mandate, orders within its limit through
 * the basket, signs out, signs in again and finds its order and memory; a second account sees none of it, and an
 * anonymous visitor gets the private page. Screenshots go to E2E_SHOTS when set.
 */
const shots = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const stamp = Date.now().toString(36).slice(-6);
const PASSWORD = "e2e-password-123";

/**
 * The set-up interview (the sign-up's second step): the kind of kitchen only when the name does not say it, then
 * diet, allergens, days, the usual order, the spend-alone limit (€300, as the tests below rely on), the weekly
 * budget and who signs; the last card is the mandate as signed. Returns the taps it took.
 */
async function setUpInterview(page: Page, restaurant: string): Promise<number> {
  let taps = 0;
  const tap = async (name: string | RegExp) => {
    await page.getByRole("button", { name, exact: typeof name === "string" }).last().click();
    taps++;
  };
  const ask = (q: string) => expect(page.getByText(q, { exact: true }).last()).toBeVisible({ timeout: 15_000 });
  const named = /ravintola|bistro|restaurant/i.test(restaurant);
  if (named) await expect(page.getByText(/^.+ is a restaurant: from “.+” in your name\.$/)).toBeVisible({ timeout: 15_000 });
  else {
    await ask("What kind of kitchen is it?");
    await tap("Restaurant");
  }
  await ask("Must every product be one of these?");
  await tap("Next");
  await ask("Anything the agent must never buy?");
  await tap("nuts");
  await tap("Next");
  await ask("Which days do you usually want deliveries?");
  await tap("Next");
  await ask("About how much is a usual order?");
  await tap("300 €");
  await tap("Next");
  await ask("Up to how much may the agent order alone?");
  await tap("300 €");
  await tap("Next");
  await ask("And the most in a whole week?");
  await tap("Next");
  await ask("Who signs orders above that?");
  await page.getByRole("textbox", { name: "Who signs orders above that?" }).fill("Aino Virtanen");
  await tap("Next");
  await expect(page.getByText("This is what you sign")).toBeVisible();
  await expect(page.getByText("300 €").first()).toBeVisible();
  await shot(page, "03-signup-interview");
  await tap("Sign and continue");
  return taps;
}

async function signUp(page: Page, username: string, restaurant: string) {
  await page.goto("/k");
  await expect(page.getByRole("heading", { name: "Your kitchen's shop" })).toBeVisible();
  await shot(page, "01-door");
  await page.getByRole("link", { name: "Open an account" }).click();
  await page.waitForURL("**/k/signup");
  const form = page.getByRole("form", { name: "Your restaurant" });
  await form.getByLabel("Restaurant or buyer name").fill(restaurant);
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await shot(page, "02-signup-step1");
  await page.getByRole("button", { name: "Continue" }).click();
  await setUpInterview(page, restaurant);
  await expect(page.getByRole("heading", { name: "Add a signing device now?" })).toBeVisible();
  await shot(page, "04-signup-device-offer");
  await page.getByRole("link", { name: "Open my shop" }).click();
  await page.waitForURL(`**/k/${username}`);
  await expect(page.getByTestId("signed-in-as")).toContainText(`Signed in as ${username}, for ${restaurant}.`);
}

/**
 * A milk product the live answer says can be ordered for the next delivery now (price known, no cut-off passed, no
 * problem), with its price per pack; undefined when none of a dozen is.
 */
async function orderableNow(page: Page, kitchen: string): Promise<{ productId: string; unitPriceCents: number } | undefined> {
  const list = (await (await page.request.get(`/ui-api/kitchens/${kitchen}/catalog?q=maito&limit=12`)).json()) as { products: { id: string }[] };
  const ids = list.products.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 5) {
    const r = (await (await page.request.post(`/ui-api/kitchens/${kitchen}/catalog/live`, { data: { productIds: ids.slice(i, i + 5) } })).json()) as { results?: { productId: string; offer?: { unitPriceCents: number }; problems: unknown[] }[] };
    const ok = r.results?.find((x) => x.offer && x.problems.length === 0);
    if (ok) return { productId: ok.productId, unitPriceCents: ok.offer!.unitPriceCents };
  }
  return undefined;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL("**/k");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
}

async function signIn(page: Page, username: string) {
  await page.goto("/k");
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/k/${username}`);
}

test("a restaurant signs up, orders within its limit, comes back to its order and memory; nobody else sees them", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const health = (await (await page.request.get("/api/health")).json()) as { catalog?: { source?: string } };
  const live = health.catalog?.source === "valio";
  const a = `e2e-a-${stamp}`;
  await signUp(page, a, `Ravintola E2E ${stamp}`);
  await shot(page, "05-shop-home");

  // An order within the €300 limit through the basket: a live price, then the same gate as the agent. On the
  // partner's live catalogue, whether a product can be ordered for the next delivery depends on the hour (order
  // cut-offs, stock the partner does not confirm), so the test asks the live answer first and orders a product it
  // says is orderable now; if none of a dozen milk products is, it says so and skips rather than guessing.
  const pick = live ? await orderableNow(page, a) : undefined;
  test.skip(live && !pick, "the live answer says no milk product can be ordered for the next delivery right now (order cut-offs, unconfirmed stock)");
  const productId = pick?.productId;
  await page.goto(productId ? `/k/${a}/catalogue/${productId}` : `/k/${a}/catalogue?q=milk`);
  const add = page.getByRole("button", { name: /^Add (a |to basket|\d)/ }).first();
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.click();
  await page.goto(`/k/${a}/basket`);
  await page.getByRole("button", { name: "Get a fixed price" }).click();
  const place = page.getByRole("button", { name: "Place the order" });
  await expect(place).toBeVisible({ timeout: 30_000 });
  await place.click();
  await expect(page.getByText("Order placed with the wholesaler")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06-order-placed");

  // Memory: a stated rule, through the kitchen's own memory page.
  const rule = await page.request.post(`/ui-api/kitchens/${a}/memory`, { data: { action: "rule", family: "milk", dimension: "lactose", choice: "lactose_free" } });
  expect(rule.status()).toBe(200);

  await page.goto(`/k/${a}/orders`);
  const orderRow = page.getByRole("main").getByText(/Ordered|Placed|committed|Order of/i).first();
  await expect(orderRow).toBeVisible();
  const ordersHtml = await page.content();
  await signOut(page);

  // Signed out: the kitchen is private.
  await page.goto(`/k/${a}`);
  await expect(page.getByRole("heading", { name: "This kitchen is private" })).toBeVisible();
  await shot(page, "07-private-anonymous");
  expect((await page.request.get(`/ui-api/kitchens/${a}/portal`)).status()).toBe(401);

  // Back again: the order and the rule are there.
  await signIn(page, a);
  const portal = await (await page.request.get(`/ui-api/kitchens/${a}/portal`)).json();
  expect(portal.orders.filter((o: { status: string }) => o.status === "committed").length).toBeGreaterThan(0);
  expect(JSON.stringify(portal.memory)).toMatch(/lactose/i);
  await page.goto(`/k/${a}/agent`);
  await expect(page.getByRole("heading", { name: "Signing devices" })).toBeVisible();
  await expect(page.getByText(/lactose/i).first()).toBeVisible();
  await shot(page, "08-agent-and-rules");
  void ordersHtml;

  // A second account, in another browser: none of it.
  const other = await browser.newContext();
  const b = await other.newPage();
  const bName = `e2e-b-${stamp}`;
  await signUp(b, bName, `Bistro E2E ${stamp}`);
  await b.goto(`/k/${a}`);
  await expect(b.getByRole("heading", { name: "This kitchen is private" })).toBeVisible();
  await expect(b.getByText(`You are signed in as ${bName}`)).toBeVisible();
  await shot(b, "09-private-other-account");
  expect((await b.request.get(`/ui-api/kitchens/${a}/portal`)).status()).toBe(403);
  expect((await b.request.get(`/ui-api/memory/kitchens/${a}`)).status()).toBe(403);
  expect((await b.request.post(`/ui-api/kitchens/${a}/memory`, { data: { action: "rule", family: "milk", dimension: "lactose", choice: "none" } })).status()).toBe(403);
  const bPortal = await (await b.request.get(`/ui-api/kitchens/${bName}/portal`)).json();
  expect(bPortal.orders.filter((o: { status: string }) => o.status === "committed")).toEqual([]);
  const ledger = await (await b.request.get(`/api/v1/ledger`)).json();
  expect(JSON.stringify(ledger.entries)).not.toContain(`org_acct_${a.replaceAll("-", "_")}`);
  await other.close();
});

test("an order above the limit waits for a signing device, then is signed with this device's passkey", async ({ page }) => {
  test.setTimeout(180_000);
  const health = (await (await page.request.get("/api/health")).json()) as { catalog?: { source?: string } };
  const live = health.catalog?.source === "valio";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const user = `e2e-s-${stamp}`;
  await signUp(page, user, `Signer E2E ${stamp}`);

  // Over the €300 limit: the gate holds it for the signer, and there is no device yet. On the live catalogue, a product
  // the live answer says is orderable now, in enough packs to pass the limit (see the first test).
  const pick = live ? await orderableNow(page, user) : undefined;
  test.skip(live && !pick, "the live answer says no milk product can be ordered for the next delivery right now");
  const packs = pick ? Math.ceil(40_000 / Math.max(1, pick.unitPriceCents)) : 30;
  await page.goto(pick ? `/k/${user}/catalogue/${pick.productId}` : `/k/${user}/catalogue?q=milk`);
  await page.getByRole("button", { name: /^Add (a |to basket|\d)/ }).first().click();
  await page.goto(`/k/${user}/basket`);
  await page.getByRole("textbox", { name: /^Quantity in / }).fill(String(packs));
  await page.getByRole("button", { name: "Get a fixed price" }).click();
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(page.getByText(/no signing device yet/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "10-waits-no-device");

  // Add this device's passkey from Agent and rules.
  await page.getByRole("link", { name: "Add a signing device" }).first().click();
  await page.waitForURL(`**/k/${user}/agent*`);
  await page.getByRole("button", { name: "Add this device's passkey" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Signing device added." }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 signing device added.")).toBeVisible();
  await shot(page, "11-device-added");

  // Sign it: the sign-off screen, the passkey bound to this exact order.
  const portal = await (await page.request.get(`/ui-api/kitchens/${user}/portal`)).json();
  const waiting = portal.orders.find((o: { status: string }) => o.status === "pending_approval");
  expect(waiting?.authorised?.approvalId).toBeTruthy();
  await page.goto(`/approve/${waiting.authorised.approvalId}`);
  const approve = page.getByRole("button", { name: /^Approve \d/ });
  await expect(approve).toBeEnabled({ timeout: 30_000 });
  await approve.click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "12-signed-with-passkey");
  const view = await (await page.request.get(`/api/v1/approvals/${waiting.authorised.approvalId}`)).json();
  expect(view.view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });
});

test("a phone adds itself as the kitchen's signing device from the QR code's one-time link", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const user = `e2e-p-${stamp}`;
  await signUp(page, user, `Phone E2E ${stamp}`);
  await page.goto(`/k/${user}/agent`);
  await page.getByRole("button", { name: "Add a phone" }).click();
  const link = page.getByRole("link", { name: "Or open this address on the phone" });
  await expect(link).toBeVisible();
  await shot(page, "13-add-a-phone");
  const href = new URL((await link.getAttribute("href"))!);

  const phoneContext = await browser.newContext(); // no account cookie: only the link
  const phone = await phoneContext.newPage();
  const cdp = await phoneContext.newCDPSession(phone);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await phone.goto(`${href.pathname}${href.search}`);
  await expect(phone.getByRole("heading", { name: `Sign for Phone E2E ${stamp} on this phone` })).toBeVisible();
  await phone.getByRole("button", { name: "Create the passkey on this phone" }).click();
  await expect(phone.getByRole("heading", { name: `Done. This phone signs for Phone E2E ${stamp}.` })).toBeVisible({ timeout: 30_000 });
  await shot(phone, "14-phone-device-added");
  // The link is used up, and the phone got no access to the kitchen's shop.
  await phone.goto(`${href.pathname}${href.search}`);
  await expect(phone.getByText(/expired or was used/).first()).toBeVisible();
  expect((await phone.request.get(`/ui-api/kitchens/${user}/portal`)).status()).toBe(401);
  await phoneContext.close();

  const devices = await (await page.request.get("/ui-api/account/device")).json();
  expect(devices.devices).toHaveLength(1);
});

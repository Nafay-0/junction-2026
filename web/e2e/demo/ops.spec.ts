import { expect, test, type Browser, type Page } from "@playwright/test";
import { addPasskey, approvalState, enterOps, joinAsApprover, watchErrors } from "../support/dock";
import { card, cards, composer, threadLog } from "../support/thread";

/**
 * The operations portal, against the real hermetic server (nothing stubbed). The wholesaler's staff enter with the
 * passcode, see the agents at the door, replay a request step by step, read the safeguards with their counts, and
 * suspend an agent: its next call is refused with the suspension as the reason, until they resume it.
 *
 * Each test makes its own visitor kitchen (joinAsApprover on a second, phone-sized context) and suspends only that
 * kitchen's agent, so nothing here touches the shared demo kitchens kaari and laakso. `page` is the operations
 * screen at the project's size (so the phone projects also check the desk at 390 px).
 */

const PHONE = { width: 390, height: 844 };

type Control = {
  active: { suspensionId: string; target: string; reason: string; refusals: number }[];
  past: { suspensionId: string; target: string; refusals: number; resumedBy?: string }[];
  agents: { agentId: string; label: string; orgId: string; orgName: string; suspended?: string }[];
};

/** A visitor's phone: joins as a kitchen's approver; returns the page and the kitchen's slug and organisation. */
async function visitorPhone(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true });
  const phone = await ctx.newPage();
  await addPasskey(phone);
  await joinAsApprover(phone);
  const res = await phone.request.get("/k/mine", { maxRedirects: 0 });
  const slug = (res.headers()["location"] ?? "").split("/k/")[1]?.split(/[/?#]/)[0];
  expect(slug, "the /k/mine redirect names the visitor's kitchen").toMatch(/^sbx_/);
  const info = await (await phone.request.get(`/ui-api/kitchens/${slug}`)).json();
  const orgId: string = info.kitchen?.orgId;
  expect(orgId).toBeTruthy();
  return { phone, slug, orgId, kitchenName: info.kitchen.name as string };
}

/**
 * WebKit reports a fetch that a navigation cancels (Next.js RSC prefetches of /ops/* links, the desk's own
 * /ops-api polling) as an uncaught "... due to access control checks." page error. Nothing fails for the user; it
 * is left out of the error check.
 */
const realErrors = (errors: string[]) => errors.filter((e) => !/^pageerror: \S+ due to access control checks\.$/.test(e));
/** A reason no parallel test shares (several workers start in the same millisecond). */
const uniqueReason = (what: string) => `${what} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const askButton = (phone: Page) => phone.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i });

async function control(page: Page): Promise<Control> {
  // A kept-alive socket the server has just closed shows up as "read ECONNRESET" (support/dock.ts approvalState): retry.
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await page.request.get("/ops-api/control");
      break;
    } catch (e) {
      if (i >= 2 || !/ECONNRESET|socket hang up/.test(String(e))) throw e;
    }
  }
  expect(r.ok()).toBe(true);
  return r.json();
}

test("the desk is closed without the passcode; a wrong passcode is refused", async ({ page }) => {
  expect((await page.request.get("/ops-api/control")).status()).toBe(401);
  await page.goto("/ops");
  await page.waitForURL("**/ops/enter**");
  await page.getByLabel("Your name, for the record").fill("E2E wrong");
  await page.getByLabel("Passcode").fill("not-it");
  await page.getByRole("button", { name: "Enter as operations staff" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /passcode/i })).toBeVisible();
  await expect(page).toHaveURL(/\/ops\/enter/);
  expect((await page.request.get("/ops-api/control")).status()).toBe(401);
});

test("suspend a visitor's agent: its next call is refused naming the suspension; resume and it works again", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const v = await visitorPhone(browser, baseURL);
  const reason = `${uniqueReason("E2E drill")}: ordering in a loop`;

  // The agent comes to the gate once (the scripted 1,000 L order), so the desk knows it. Declined: costs nothing.
  await askButton(v.phone).click();
  await v.phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await v.phone.getByRole("button", { name: /^Decline/ }).click();
  await expect(v.phone.getByRole("heading", { name: "Declined" })).toBeVisible();

  await enterOps(page);
  const agent = (await control(page)).agents.find((a) => a.orgId === v.orgId);
  expect(agent, "the visitor's agent is listed at the desk").toBeTruthy();

  // /ops/agents lists it.
  await page.goto("/ops/agents");
  await expect(page.getByRole("heading", { name: agent!.label }).first()).toBeVisible();

  // Suspend it from /ops/control: choose, give a reason, read what will happen, confirm.
  await page.goto("/ops/control");
  await page.getByRole("radio", { name: /One agent/ }).click();
  await page.getByRole("combobox").selectOption(agent!.agentId);
  await page.getByLabel("Reason, shown to the agent and written to the ledger").fill(reason);
  await page.getByRole("button", { name: "Review the suspension" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`Its next call, over any door, is refused with your reason: “${reason}”.`);
  await confirm.getByRole("button", { name: "Suspend the agent" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Suspended / })).toBeVisible();
  await expect(page.getByText(`“${reason}”`).first()).toBeVisible();
  const active = (await control(page)).active.find((s) => s.target === agent!.agentId);
  expect(active).toMatchObject({ reason, refusals: 0 });

  // The suspended agent's next call is refused with the operator rule and the reason, over every door:
  // REST with the kitchen's own mandate (what an outside agent holds, from the kitchen's "connect" page) ...
  const c = await (await v.phone.request.get(`/ui-api/kitchens/${v.slug}/connect`)).json();
  const mandate = { authorization: `Mandate ${c.mandate}`, "dock-agent-id": c.agentId };
  const rest = await v.phone.request.get("/api/v1/kitchen", { headers: mandate });
  expect(rest.status()).toBe(403);
  expect((await rest.json()).error).toMatchObject({ code: "agent_suspended", rule: "operator_suspension", message: expect.stringContaining(reason) });
  // ... MCP (a stock client's tools/call; the refusal comes back as the tool's error text) ...
  const mcp = await v.phone.request.post("/api/mcp", {
    headers: { ...mandate, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_mandate", arguments: {} } },
  });
  const mcpText = await mcp.text();
  expect(mcpText).toContain("operator_suspension");
  expect(mcpText).toContain(reason);
  // ... and the kitchen's own thread (the on-site agent, one more client of the same gate), where a judge would see
  // it: the request is refused with the suspension and its reason, nothing priced.
  const k = await v.phone.context().newPage();
  await k.setViewportSize({ width: 1440, height: 900 });
  await k.goto(`/k/${v.slug}/order`);
  await expect(threadLog(k)).toBeVisible();
  const words = "200 litres of lactose-free milk for Wednesday, cheapest";
  // The turn itself is refused (403 agent_suspended): "Not sent", the reason, and the words stay in the field.
  await composer(k).fill(words);
  await composer(k).press("Enter");
  const refusedAlert = threadLog(k).getByRole("alert");
  await expect(refusedAlert).toContainText(/Not sent: .*suspended this agent/, { timeout: 30_000 });
  await expect(refusedAlert).toContainText(reason);
  await expect(composer(k)).toHaveValue(words);
  await expect(cards(k, "understood")).toHaveCount(0);
  await expect(cards(k, "price")).toHaveCount(0);

  // What the kitchen's own home page shows while its agent is suspended (QA saw it look normal). Recorded as an
  // annotation, not asserted: the order page above does say it once a request is made.
  await k.goto(`/k/${v.slug}`);
  await k.waitForLoadState("networkidle").catch(() => undefined);
  const mentions = await k.getByText(/suspend/i).count();
  await test.info().attach("kitchen home while suspended", { body: await k.screenshot({ fullPage: true }), contentType: "image/png" });
  test.info().annotations.push({ type: "kitchen home while suspended", description: mentions ? `mentions the suspension (${mentions} places)` : "no mention of the suspension: the kitchen home looks normal until a request is made (see the test.fail test below)" });

  // The desk counts the refusal; /ops/safeguards shows operator_suspension as fired.
  await expect.poll(async () => (await control(page)).active.find((s) => s.target === agent!.agentId)?.refusals ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.goto("/ops/safeguards");
  await expect(page.getByRole("heading", { name: "Safeguards" })).toBeVisible();
  const rule = page.locator("li").filter({ hasText: "Operations staff can stop an agent or a whole organisation" });
  await expect(rule.getByRole("img", { name: /refused [1-9]\d*/ })).toBeVisible();
  await expect(page.getByText(reason).first()).toBeVisible();

  // Resume, with a note.
  await page.goto("/ops/control");
  const row = page.locator("li").filter({ hasText: reason });
  await row.getByLabel("Note for the record").fill("E2E: looked into it, fine");
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("li").filter({ hasText: reason }).getByText(/resumed .* by E2E operator: “E2E: looked into it, fine”/)).toBeVisible();
  const past = (await control(page)).past.find((s) => s.target === agent!.agentId);
  expect(past?.refusals).toBeGreaterThan(0);

  // Resumed: the same calls work again, and the same words in the thread reach the reading and the options.
  expect((await v.phone.request.get("/api/v1/kitchen", { headers: mandate })).status()).toBe(200);
  await k.goto(`/k/${v.slug}/order`);
  await composer(k).fill(words);
  await composer(k).press("Enter");
  await expect(card(k, "understood")).toContainText(/How much\s*200\sL/, { timeout: 30_000 });
  await expect(card(k, "options").or(card(k, "price"))).toBeVisible({ timeout: 30_000 });
  await expect(threadLog(k).getByRole("alert")).toHaveCount(0);
  expect(realErrors(errors)).toEqual([]);
  await v.phone.context().close();
});

test("overview, then a trace of the visitor's own request replays station by station", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const v = await visitorPhone(browser, baseURL);
  await askButton(v.phone).click();
  await v.phone.waitForURL("**/approve/**", { timeout: 30_000 });
  const approvalId = v.phone.url().split("/approve/")[1].split(/[?#]/)[0];
  const orderId = (await approvalState(v.phone.request, approvalId)).view?.details?.orderId;
  expect(orderId).toMatch(/^ord_/);

  await enterOps(page);
  await expect(page).toHaveURL(/\/ops\/?$/);
  await expect(page.getByRole("heading").first()).toBeVisible();

  // The wholesaler's audit record of this order names its request; open that request's trace.
  const audit = await (await page.request.get(`/ops-api/audit/${orderId}`)).text();
  const requestId = /"(req_[a-z0-9]+)"/.exec(audit)?.[1];
  expect(requestId, "the audit record names the request").toBeTruthy();
  await page.goto(`/ops/trace/${requestId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("I need 1,000 litres of lactose-free milk by Monday");
  await expect(page.getByText(/Waiting for .+ to sign off/).first()).toBeVisible();
  const stations = page.getByRole("group", { name: "Stations" }).getByRole("button");
  await expect(stations.first()).toBeVisible();
  const n = await stations.count();
  expect(n).toBeGreaterThanOrEqual(6); // asked, understood, live check, options, ..., price fixed, gate, sign-off
  await expect(page.getByRole("button", { name: /^Station \d+: Gate$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Station \d+: Sign-off$/ })).toBeVisible();
  await expect(page.getByText("Every station, as it happened. The last one is open; click any to open it.")).toBeVisible();

  // Replay from the start: the lane fills station by station and stops at the sign-off.
  await page.getByRole("button", { name: "Back to the start" }).click();
  await page.getByRole("button", { name: "Play the replay" }).click();
  await expect(page.getByText(new RegExp(`^Replaying: \\d+ of ${n} stations reached\\.$`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause the replay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play the replay" })).toHaveText(/Replay/, { timeout: 90_000 });
  // The scrubber is there from 640 px up; on a phone the last station is open instead.
  const scrub = page.getByRole("slider", { name: "Scrub through the stations" });
  if (await scrub.isVisible()) await expect(scrub).toHaveValue(String(n));
  else await expect(page.getByRole("button", { name: "Show every station" })).toBeDisabled();
  expect(realErrors(errors)).toEqual([]);

  await v.phone.getByRole("button", { name: /^Decline/ }).click();
  await expect(v.phone.getByRole("heading", { name: "Declined" })).toBeVisible();
  await v.phone.context().close();
});

/**
 * Regression test, fixed on main in 4f0e267. Before, the visitor phone's own "Ask my agent for 1,000 L of milk"
 * button (POST /api/v1/approver/demo-order -> sandboxes.runDemoOrder) was not stopped by a suspension: the
 * suspension registry was a module-level WeakMap that Next bundled into several server chunks, so the approver
 * route's copy never saw a suspension made through /ops-api/control, and the order reached sign-off.
 */
test("a suspended agent's scripted order from the visitor's phone is refused too", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const v = await visitorPhone(browser, baseURL);
  await askButton(v.phone).click();
  await v.phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await v.phone.getByRole("button", { name: /^Decline/ }).click();
  await expect(v.phone.getByRole("heading", { name: "Declined" })).toBeVisible();

  await enterOps(page);
  const agent = (await control(page)).agents.find((a) => a.orgId === v.orgId)!;
  const reason = uniqueReason("E2E phone door");
  const sus = await page.request.post("/ops-api/control", { data: { action: "suspend", scope: "agent", target: agent.agentId, reason } });
  expect(sus.status()).toBe(201);
  const { suspension } = await sus.json();
  try {
    await v.phone.goto("/approver");
    await askButton(v.phone).click();
    await expect(v.phone.getByText(reason).first()).toBeVisible({ timeout: 20_000 });
    await expect(v.phone).toHaveURL(/\/approver$/);
  } finally {
    if (/\/approve\//.test(v.phone.url())) await v.phone.getByRole("button", { name: /^Decline/ }).click().catch(() => undefined);
    await page.request.post("/ops-api/control", { data: { action: "resume", suspensionId: suspension.suspensionId, note: "E2E cleanup" } });
    await v.phone.context().close();
  }
});

/**
 * DEFECT (test.fail until fixed). While its agent is suspended, the kitchen's home page says nothing about it: the
 * "order cut-offs" panel stays on "Checking the order cut-offs…" for good, because /ui-api/kitchens/{k}/cutoffs
 * answers 500 "Something went wrong inside AimoPilot": standingCutoffs opens a request as the agent, the gate refuses
 * it (operator_suspension), and src/server/kitchen-portal.ts:326 rethrows the refusal as a plain Error without its
 * status, so portalRoute (kitchen-portal-http.ts:31) logs it as a crash. Expected: the refusal passed through (403
 * with the reason), and the home page saying the agent is suspended and why.
 */
test("the kitchen's home says its agent is suspended, and why", async ({ page, browser, baseURL }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "cut-offs answer 500 while suspended; the home page looks normal");
  test.setTimeout(120_000);
  const v = await visitorPhone(browser, baseURL);
  await askButton(v.phone).click();
  await v.phone.waitForURL("**/approve/**", { timeout: 30_000 });
  await v.phone.getByRole("button", { name: /^Decline/ }).click();
  await expect(v.phone.getByRole("heading", { name: "Declined" })).toBeVisible();
  await enterOps(page);
  const agent = (await control(page)).agents.find((a) => a.orgId === v.orgId)!;
  const reason = uniqueReason("E2E home");
  const { suspension } = await (await page.request.post("/ops-api/control", { data: { action: "suspend", scope: "agent", target: agent.agentId, reason } })).json();
  try {
    const cutoffs = await v.phone.request.get(`/ui-api/kitchens/${v.slug}/cutoffs`);
    expect(cutoffs.status(), "the refusal, not a crash").toBe(403);
    await v.phone.goto(`/k/${v.slug}`);
    await expect(v.phone.getByText(reason).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await page.request.post("/ops-api/control", { data: { action: "resume", suspensionId: suspension.suspensionId, note: "E2E cleanup" } });
    await v.phone.context().close();
  }
});

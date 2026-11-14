import { expect, test, type Page } from "@playwright/test";
import { addPasskey, approvalState, approveButton, askForMilkAndWaitForSignOff, joinAsApprover } from "../support/dock";

/**
 * The room: what a stranger's phone meets over conference Wi-Fi. Chromium phone (network emulation and page
 * freezing go through the DevTools protocol, which only Chromium offers). Timings go into the test annotations.
 */

const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/** Poor mobile data: 400 ms latency, ~400 kbit/s down, ~150 kbit/s up, 3 % packet loss where Chrome supports it. */
async function poorNetwork(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const base = { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 19_000 };
  try {
    await cdp.send("Network.emulateNetworkConditions", { ...base, packetLoss: 3, packetQueueLength: 0, packetReordering: false } as never);
    return "400 ms, 400/150 kbit/s, 3 % loss";
  } catch {
    await cdp.send("Network.emulateNetworkConditions", base);
    return "400 ms, 400/150 kbit/s (this Chromium has no packet-loss emulation)";
  }
}

/** Every Nth API call fails as a dropped connection would (deterministic), on top of the slow network. */
async function dropSomeCalls(page: Page, everyNth: number) {
  let n = 0;
  let dropped = 0;
  await page.route(/\/(api|ui-api)\//, async (route) => {
    const url = route.request().url();
    // The passkey ceremony's own two calls and the event stream are left alone; everything else may drop.
    if (/\/join(\/verify)?$|\/events/.test(url) || ++n % everyNth) return route.continue();
    dropped++;
    return route.abort("connectionreset");
  });
  return () => dropped;
}

test("slow, lossy mobile data: join, be asked, sign, within a minute", async ({ page }) => {
  test.setTimeout(240_000);
  await addPasskey(page);
  note("network", await poorNetwork(page));
  const dropped = await dropSomeCalls(page, 7);
  const t0 = Date.now();
  await joinAsApprover(page);
  const tJoin = Date.now() - t0;
  const t1 = Date.now();
  const approvalId = await askForMilkAndWaitForSignOff(page);
  const tAsk = Date.now() - t1;
  const t2 = Date.now();
  // A dropped call shows "AimoPilot did not answer. Check the connection and try again."; a person taps again.
  let taps = 0;
  const placed = page.getByRole("heading", { name: "Order placed" });
  while (taps < 4 && !(await placed.isVisible())) {
    taps++;
    await approveButton(page).click();
    await expect(placed.or(page.getByRole("alert").filter({ hasText: /did not answer|try again/i }))).toBeVisible({ timeout: 60_000 });
  }
  await expect(placed).toBeVisible();
  const tSign = Date.now() - t2;
  note("timings", `join ${tJoin} ms, request opened on the phone ${tAsk} ms, signed ${tSign} ms with ${taps} tap(s); ${dropped()} API calls dropped`);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  expect(tJoin + tAsk + tSign).toBeLessThan(60_000);
});

test("phone locked (page frozen) while the request arrives, then reopened: the request is there", async ({ page, request }) => {
  test.setTimeout(120_000);
  await addPasskey(page);
  await joinAsApprover(page);
  const cdp = await page.context().newCDPSession(page);
  // Start the request from the phone's own button, then lock the phone before it can open the request.
  const before = page.url();
  await page.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, 15_000)); // locked for 15 s while the order waits
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  const t = Date.now();
  await page.waitForURL("**/approve/**", { timeout: 30_000 });
  note("reopened", `request on screen ${Date.now() - t} ms after unlocking (was on ${new URL(before).pathname})`);
  await approveButton(page).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  void request;
});

test("hidden tab (another app in front) when the request arrives, then shown again", async ({ page }) => {
  test.setTimeout(120_000);
  await addPasskey(page);
  await joinAsApprover(page);
  // Report the page as hidden, the way a phone does when the browser goes to the background.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
  await page.waitForTimeout(8_000);
  const openedWhileHidden = page.url().includes("/approve/");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const t = Date.now();
  await page.waitForURL("**/approve/**", { timeout: 30_000 });
  note("hidden", `${openedWhileHidden ? "opened while hidden (event stream)" : "opened after being shown"}; ${Date.now() - t} ms after visible`);
  await expect(approveButton(page)).toBeEnabled();
});

/**
 * DEFECT (test.fail until fixed; would lose the demo), new with main 718aa8b. The approver phone now polls every 5 s
 * besides the live stream; a poll that fails while the phone is offline turns the page into "Can't reach AimoPilot"
 * (src/app/approver/approver-home.tsx:66 sets "offline" on any failure), and both the poll (:89-95) and the live
 * stream (:74) run only while the page is "ready", so nothing brings it back when the network returns: a 5 s Wi-Fi
 * blip leaves the reviewer's phone on the offline screen, and the next sign-off request never opens by itself until
 * someone taps "Try again".
 */
test("event stream cut for a few seconds (Wi-Fi blip), then the request arrives: it opens by itself", async ({ page, context }) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "a failed poll during the blip leaves /approver on 'Can't reach AimoPilot' with polling and the stream stopped");
  test.setTimeout(120_000);
  await addPasskey(page);
  await joinAsApprover(page);
  await context.setOffline(true); // the stream breaks
  await page.waitForTimeout(5_000);
  await context.setOffline(false); // EventSource reconnects by itself
  await page.waitForTimeout(4_000);
  // Still the waiting screen (not "Can't reach AimoPilot"), within a few seconds of the network coming back.
  await expect(page.getByText("Waiting for requests")).toBeVisible({ timeout: 15_000 });
  const t = Date.now();
  await askForMilkAndWaitForSignOff(page);
  note("stream back", `request opened ${Date.now() - t} ms after the tap, after a 5 s outage`);
  await approveButton(page).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
});

/**
 * Regression test, fixed on main in 718aa8b. Before, /approver had no polling: when the event stream could not be
 * held open (a venue proxy or captive portal that buffers or cuts long responses), a request never opened on the
 * phone until a reload.
 */
test("event stream blocked by the network: the request still reaches the phone", async ({ page }) => {
  test.setTimeout(90_000);
  await addPasskey(page);
  await joinAsApprover(page);
  await page.route(/\/api\/v1\/events/, (r) => r.abort("connectionreset"));
  await page.reload();
  await expect(page.getByText("Waiting for requests")).toBeVisible();
  await askForMilkAndWaitForSignOff(page);
});

test("same visitor in two tabs: both see the request; signing in one settles the other", async ({ page, context }) => {
  test.setTimeout(120_000);
  await addPasskey(page);
  await joinAsApprover(page);
  const other = await context.newPage();
  await other.goto("/approver");
  await expect(other.getByText("Waiting for requests")).toBeVisible();
  const approvalId = await askForMilkAndWaitForSignOff(page);
  await other.waitForURL(`**/approve/${approvalId}`, { timeout: 30_000 });
  await approveButton(page).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  // The second tab must not still offer to approve (a second tap would be a 409 or a confusing error).
  await expect(other.getByRole("heading", { name: "Order placed" }).or(other.getByText(/already|Signed off|approved/i)).first()).toBeVisible({ timeout: 30_000 });
  await expect(approveButton(other)).toHaveCount(0);
});

for (const skew of [{ label: "phone clock 5 minutes fast", ms: 5 * 60_000 }, { label: "phone clock 40 minutes slow", ms: -40 * 60_000 }]) {
  test(`clock skew: ${skew.label}; the sign-off still works`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install({ time: new Date(Date.now() + skew.ms) });
    await addPasskey(page);
    await joinAsApprover(page);
    const approvalId = await askForMilkAndWaitForSignOff(page);
    // The countdown is computed from the phone's clock (approval-screen.tsx:179): recorded, not asserted.
    note("countdown", `${skew.label}: "${await page.getByText(/Price fixed until/).first().innerText().catch(() => "")}" (the price holds 30 min)`);
    await approveButton(page).click();
    await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
    expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
  });
}

/**
 * DEFECT, recorded not asserted (it reproduces in about 3 runs of 4: it depends on when the page reads the clock).
 * A phone whose clock is more than the price's life (30 min) fast says "The fixed price has run out" and offers no
 * Approve, though the server's price still holds. Rare (clocks are network-set), but it costs that visitor the
 * sign-off. Cause: approval-screen.tsx:179-181 compares priceHeldUntil with the phone's Date.now().
 */
test("clock skew: phone clock 3 hours fast (recorded)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date(Date.now() + 3 * 3600_000) });
  await addPasskey(page);
  await joinAsApprover(page);
  await askForMilkAndWaitForSignOff(page);
  await page.waitForTimeout(2_000);
  const runOut = await page.getByText(/fixed price has run out/).count();
  note("clock 3 h fast", runOut ? "DEFECT reproduced: 'The fixed price has run out', no Approve" : "not reproduced this run: Approve offered");
});

test("reload at each stage of the phone flow, and the back button", async ({ page }) => {
  test.setTimeout(150_000);
  await addPasskey(page);
  await page.goto("/join");
  await page.reload(); // before the passkey: still offers it
  await expect(page.getByRole("button", { name: "Create my passkey and start" })).toBeVisible();
  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver");
  await page.reload(); // as approver: still the approver (session cookie), not asked to join again
  await expect(page.getByText("Waiting for requests")).toBeVisible();
  await page.goto("/join"); // scanning the code again on the same phone: "You are already <name>"
  await expect(page.getByText(/You are already/)).toBeVisible();
  note("join again", `scanning again lands on ${new URL(page.url()).pathname}`);
  await page.goto("/approver");
  const approvalId = await askForMilkAndWaitForSignOff(page);
  await page.reload(); // the request page survives a reload
  await expect(approveButton(page)).toBeEnabled();
  await page.goBack(); // back to the waiting screen, then forward again
  await page.goForward();
  await expect(approveButton(page)).toBeEnabled();
  await approveButton(page).click();
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  await page.reload(); // after signing: the result, not the buttons
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await expect(approveButton(page)).toHaveCount(0);
  await page.goBack();
  await expect(approveButton(page)).toHaveCount(0);
  expect((await approvalState(page.request, approvalId)).view?.state).toBe("committed");
});

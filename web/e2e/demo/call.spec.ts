import { expect, test, type Page } from "@playwright/test";
import { addPasskey, engine, joinAsApprover, watchErrors } from "../support/dock";
import { expectNothingOrdered, micLog, stubLiveService, wrapMicrophone, type MicMode } from "../support/call-stubs";
import { card, composer, threadLog, visitorKitchen } from "../support/thread";

/**
 * The call screen (/call, src/app/_channels/call-screen.tsx + use-call.ts), up to the point where a voice is
 * needed. Every test makes its own visitor kitchen (passkey join) and calls it from the same phone.
 *
 * Since main acb274e speaking is also a mode of the store's thread (_channels/voice-mode.tsx): the composer's
 * microphone starts the call, the voice bar holds to talk, and when the call ends by itself (dropped, the time limit,
 * no answer, offline) the buyer is told why and carries on typing in the same composer. The tests at the end drive
 * that mode on the visitor's own Order page.
 *
 * What is real and what is stubbed:
 *   - real: the server's call endpoint, the call registry, the line caps, the token the server mints (test-only
 *     scripted tokens: DOCK_VOICE_SCRIPTED=1 on the hermetic server, no key, no network), the typed fallback, the
 *     reader (scripted provider, e2e/fixtures/recordings.json), the intake and the ledger.
 *   - stubbed: the Gemini Live WebSocket (page.routeWebSocket on Google's real URL; nothing leaves the machine), and
 *     where a test says so, the OpenAI WebRTC offer the browser sends through this server (answered 503 here).
 *   - microphone: Chromium and Firefox use the browser's fake audio device (playwright.config.ts flags). WebKit has
 *     none in Playwright: the "allowed" test skips there; the refused cases reject getUserMedia from an init script
 *     on every engine; the connection tests give WebKit a silent WebAudio stream instead of a microphone.
 */

const callButton = (page: Page) => page.getByRole("button", { name: "Call", exact: true });
const typedField = (page: Page) => page.getByRole("textbox", { name: "What the kitchen needs" });

/** Join as a visitor kitchen's approver, open /call: the idle call screen of this phone's own kitchen. */
async function openOwnCall(page: Page, mic: MicMode, opts: { live?: boolean } = {}) {
  await addPasskey(page);
  await wrapMicrophone(page, mic);
  // The server mints (scripted) voice tokens now: whatever a test does, the Live socket never leaves the machine.
  // A test that stubs the service itself passes { live: false }.
  if (opts.live !== false) await stubLiveService(page, "silent");
  await joinAsApprover(page);
  await page.goto("/call");
  await expect(page.getByRole("heading", { name: "Call your agent" })).toBeVisible();
  // Before the call starts the header says "Your kitchen", not the kitchen's name (it comes with the call's start).
  await expect(page.getByText("Your kitchen", { exact: true })).toBeVisible();
  await expect(callButton(page)).toBeVisible();
}

/** The typed fallback is on screen and the voice controls are not. */
async function expectTypedFallback(page: Page) {
  await expect(typedField(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByText("Type what the kitchen needs.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hold to talk/ })).toHaveCount(0);
  // The typed call is this phone's own visitor kitchen (named by the server's call start).
  await expect(page.getByText(/^Hotel /).first()).toBeVisible();
}

const realOrSyntheticMic = (name: string): MicMode => (name === "webkit" ? "synthetic" : "real");

/**
 * Firefox under Playwright: in about one call in five (more with four workers) the call never gets past "Calling…"
 * or "Connecting…", before the call request is even sent, and the getUserMedia wrapper above is sometimes not the
 * function the page calls (a refused microphone then still rings). Seen on 14 Nov in four runs on firefox-phone and
 * firefox-desktop, never on Chromium or WebKit; the cause is not found (Firefox's fake media device with the
 * page's AudioContext ring is the suspect). The phones at the venue are Safari and Chrome, so the voice tests
 * run on Chromium and WebKit; on Firefox only the QR join test runs. Remove this once a Firefox run is clean.
 */
function skipFirefoxVoice(info: import("@playwright/test").TestInfo) {
  test.skip(engine(info) === "firefox", "Firefox under Playwright intermittently never opens the call (stuck at 'Calling…'); voice covered on Chromium and WebKit");
}
test.beforeEach(({}, info) => {
  if (!/QR code on a phone/.test(info.title)) skipFirefoxVoice(info);
});

test("the call QR code on a phone that has not joined: one passkey tap, then the call screen of its own kitchen", async ({ page }) => {
  const errors = watchErrors(page);
  const passkey = await addPasskey(page);
  await page.goto("/call");
  await expect(page.getByRole("heading", { name: /^Call the purchasing agent of Hotel / })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("A demo on synthetic data")).toBeVisible();
  await page.getByRole("button", { name: "Create passkey and call" }).click();
  await expect(callButton(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Call your agent" })).toBeVisible();
  expect(await passkey.count()).toBe(1);
  expect(errors).toEqual([]);
});

test("microphone allowed (fake device): the call connects, the agent's hello is heard, hanging up offers typing; nothing is ordered", async ({ page }, info) => {
  test.skip(engine(info) === "webkit", "WebKit in Playwright has no fake microphone device, so 'permission granted' cannot be produced there");
  const errors = watchErrors(page);
  const live = await stubLiveService(page, "answer");
  await openOwnCall(page, "real", { live: false });
  await callButton(page).click();
  // Connected: the server reserved the line and minted the (scripted) token; the browser opened the Live socket with
  // it and sent only the model name (the setup is locked in the token).
  await expect(page.getByText("Connected. The agent is saying hello…")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Hold to talk/ })).toBeVisible();
  expect(await micLog(page)).toMatchObject({ calls: 1, ok: 1, errors: [] });
  expect(live.urls[0]).toMatch(/access_token=scripted-/);
  expect(JSON.parse(live.setups[0])).toEqual({ setup: { model: "models/gemini-3.8-live" } });
  await page.getByRole("button", { name: "Hang up" }).click();
  await expect(page.getByText(/Call ended/).first()).toBeVisible();
  await expectNothingOrdered(page.request);
  expect(errors).toEqual([]);
});

for (const [name, mic, words] of [
  ["refused ('Don't allow')", "NotAllowedError", "The microphone is blocked for this page. Allow it in the browser's site settings, or type instead."],
  ["missing (no device)", "NotFoundError", "No microphone was found. Type instead."],
] as const) {
  test(`microphone ${name}: the screen says which, offers typing, and no voice session is asked for`, async ({ page }) => {
    const errors = watchErrors(page);
    const callPosts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/ui-api\/voice\/[^/]+\/call$/.test(r.url())) callPosts.push(r.postData() ?? "");
    });
    await openOwnCall(page, mic);
    await callButton(page).click();
    await expectTypedFallback(page);
    await expect(page.getByText(words)).toBeVisible();
    expect(await micLog(page)).toMatchObject({ calls: 1, ok: 0, errors: [mic] });
    // Only the typed call was opened: no voice line was reserved for a call that has no microphone.
    expect(callPosts.map((b) => JSON.parse(b || "{}").mode)).toEqual(["typed"]);
    await expectNothingOrdered(page.request);
    expect(errors).toEqual([]);
  });
}

test("the call endpoint fails (500 with no body): 'The call could not start', then typing", async ({ page }, info) => {
  const errors = watchErrors(page);
  await openOwnCall(page, realOrSyntheticMic(engine(info)));
  // Stub: only the voice call POST fails; the typed fallback's POST goes to the real server.
  await page.route(/\/ui-api\/voice\/[^/]+\/call$/, (route) => (JSON.parse(route.request().postData() || "{}").mode === "typed" ? route.fallback() : route.fulfill({ status: 500, body: "" })));
  await callButton(page).click();
  await expectTypedFallback(page);
  await expect(page.getByText("The call could not start.")).toBeVisible();
  await expectNothingOrdered(page.request);
  expect(errors).toEqual([]);
});

test("the call endpoint cannot be reached (request aborted): 'No connection to AimoPilot', then typing", async ({ page }, info) => {
  const errors = watchErrors(page);
  await openOwnCall(page, realOrSyntheticMic(engine(info)));
  await page.route(/\/ui-api\/voice\/[^/]+\/call$/, (route) => (JSON.parse(route.request().postData() || "{}").mode === "typed" ? route.fallback() : route.abort("internetdisconnected")));
  await callButton(page).click();
  await expectTypedFallback(page);
  await expect(page.getByText("No connection to AimoPilot. Check the network and try again.")).toBeVisible();
  await expectNothingOrdered(page.request);
  expect(errors).toEqual([]);
});

// ---------- speaking as a mode of the thread ----------

/** The visitor's own Order page with its microphone (wrapped) and the Live service stubbed; the call not started. */
async function threadWithVoice(page: Page, mic: MicMode, behaviour: "answer" | "silent") {
  await addPasskey(page);
  // Every toast the page shows (they last about 4 s), so a test can read what the buyer was told afterwards.
  await page.addInitScript(() => {
    const w = window as unknown as { __told: string[] };
    w.__told = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("[aria-live=polite] > p")) {
        const t = (el.textContent ?? "").trim();
        if (t && !w.__told.includes(t)) w.__told.push(t);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await wrapMicrophone(page, mic);
  const live = await stubLiveService(page, behaviour);
  const kitchen = await visitorKitchen(page);
  await page.goto(`/k/${kitchen}/order`);
  await expect(threadLog(page)).toBeVisible();
  return { kitchen, live };
}

const voiceBar = (page: Page) => page.locator("[data-voice-mode]").filter({ visible: true });
const voiceStatus = (page: Page) => voiceBar(page).locator("[data-status]");

/** A tap on the composer's microphone starts the call; connected when the bar's status is "ready". */
async function startThreadCall(page: Page) {
  await page.getByRole("button", { name: "Hold to talk" }).filter({ visible: true }).first().click();
  await expect(voiceBar(page)).toBeVisible({ timeout: 20_000 });
}

/** Connected: only a live call offers the switch to an open microphone (and the big hold-to-talk button). */
const connected = (page: Page) => expect(voiceBar(page).getByRole("button", { name: "Open microphone" })).toBeVisible({ timeout: 20_000 });

/** Everything the buyer was told in toasts so far (read out politely; each lasts about 4 s). */
const told = (page: Page) => page.evaluate(() => (window as unknown as { __told: string[] }).__told.join(" | "));

/** The second provider (OpenAI over WebRTC, set up through this server) is unavailable here: its offer is answered 503. */
async function noSecondProvider(page: Page) {
  const offers: string[] = [];
  await page.route(/\/ui-api\/voice\/[^/]+\/call\/[^/]+$/, (route) => {
    if (JSON.parse(route.request().postData() || "{}").op !== "rtc") return route.fallback();
    offers.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: { code: "voice_unavailable", message: "test: no voice session" } } });
  });
  return offers;
}

/**
 * The voice service accepts the socket and never answers. After 6 s the call is moved to the second provider (here
 * unavailable), then it reconnects to the first, and so on; the call gives up by itself. The first provider's call
 * is ended as the second is asked for: the route below lets that end land first (see the test.fail further down).
 */
async function endLandsFirst(page: Page) {
  await page.route(/\/ui-api\/voice\/[^/]+\/call$/, async (route) => {
    if (JSON.parse(route.request().postData() || "{}").avoid) await new Promise((r) => setTimeout(r, 700));
    await route.fallback();
  });
}

test("in the thread, the voice service answers nothing: the call gives up by itself and the buyer types in the same composer", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const { live } = await threadWithVoice(page, realOrSyntheticMic(engine(info)), "silent");
  const offers = await noSecondProvider(page);
  await endLandsFirst(page);
  await startThreadCall(page);
  await expect(voiceBar(page).getByText("Connecting…")).toBeVisible();
  await expect(voiceBar(page)).toHaveCount(0, { timeout: 60_000 });
  expect(live.urls.length).toBeGreaterThanOrEqual(1);
  expect(offers.length).toBeGreaterThanOrEqual(1);
  await expect(composer(page)).toBeEditable();
  await composer(page).fill("100 litres of lactose-free milk for Thursday");
  await composer(page).press("Enter");
  await expect(card(page, "understood")).toContainText(/How much\s*100\sL/, { timeout: 20_000 });
  expect(errors.filter((e) => !/503|Service Unavailable/.test(e))).toEqual([]);
});

/**
 * DEFECT (test.fail until fixed). When the voice service accepts the socket and never answers (a venue network that
 * lets the WebSocket through and nothing back), the buyer should hear "The voice connection did not open (the network
 * may block it). Type instead." within about 12 s. Instead the call goes back and forth between the two providers
 * for about 23 s and ends on a stale notice, "The first voice service refused the call (its limit). Trying the other
 * one…", which is not what happened and promises a retry that never comes. Cause: src/app/_channels/use-call.ts:438-446
 * (the 6 s switch replaces the socket, so the 12 s "did not open" timer at :447-453 never fires for it), :425-431 (a
 * lost second provider reconnects to the first), and the ended call's toast reads `view.notice` before `endReason`
 * (src/app/k/[kitchen]/thread.tsx:559).
 */
test("in the thread, a voice service that never answers is named as such", async ({ page }, info) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the call ends on a stale 'refused the call (its limit). Trying the other one…'");
  test.setTimeout(120_000);
  await threadWithVoice(page, realOrSyntheticMic(engine(info)), "silent");
  await noSecondProvider(page);
  await endLandsFirst(page);
  await startThreadCall(page);
  await expect(voiceBar(page)).toHaveCount(0, { timeout: 60_000 });
  expect(await told(page)).toMatch(/did not open/);
  expect(await told(page)).not.toMatch(/Trying the other one/);
});

/**
 * DEFECT (test.fail until fixed). Same cause as above: when a dropped call cannot reconnect (two tries), the call ends
 * and the buyer's last word is the stale notice "Connection lost. Reconnecting with your request as it was…", not
 * "The connection to the voice service was lost." (use-call.ts:435 sets endReason but keeps the notice; the toast at
 * src/app/k/[kitchen]/thread.tsx:559 prefers the notice).
 */
test("in the thread, a call that cannot reconnect ends saying it was lost, not 'Reconnecting'", async ({ page }, info) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the ended call's toast is the stale 'Reconnecting…' notice");
  test.setTimeout(90_000);
  const { live } = await threadWithVoice(page, realOrSyntheticMic(engine(info)), "answer");
  await startThreadCall(page);
  await connected(page);
  live.set("down");
  await live.socket()!.close({ code: 1011, reason: "internal error" });
  await expect(voiceBar(page)).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
  expect((await told(page)).split(" | ").at(-1)).toBe("The connection to the voice service was lost.");
});

/**
 * DEFECT (test.fail until fixed). Moving a call to the second provider ends the first provider's call and asks for
 * the new one at the same moment (src/app/_channels/use-call.ts:442-444 and :419-421: `void post(end)` then dial,
 * not awaited), and the server counts the call being replaced as busy (src/server/channels/voice/calls.ts:105: the
 * line check does not exempt `carryFrom`). Whenever the new request arrives before the end, it is refused "This
 * kitchen's agent is already on a call", and the switch the fallback exists for never happens. Here the end is held
 * back 1 s to make that ordering certain.
 */
test("in the thread, switching to the second provider is not refused as a second call", async ({ page }, info) => {
  test.fail(!process.env.E2E_EXPECT_FIXED, "the switch races the first call's end: 409 line_busy");
  test.setTimeout(90_000);
  await threadWithVoice(page, realOrSyntheticMic(engine(info)), "silent");
  const offers = await noSecondProvider(page);
  await page.route(/\/ui-api\/voice\/[^/]+\/call\/[^/]+$/, async (route) => {
    if (JSON.parse(route.request().postData() || "{}").op === "end") await new Promise((r) => setTimeout(r, 1000));
    await route.fallback();
  });
  await startThreadCall(page);
  await expect.poll(() => offers.length, { timeout: 20_000 }).toBeGreaterThan(0);
});

for (const [why, code, reason, words] of [
  ["the connection drops and the service stays down", 1011, "internal error", "The connection to the voice service was lost."],
  ["the voice service ends it at the time limit", 1008, "deadline expired", "The call reached its time limit."],
] as const) {
  test(`in the thread, connected, then ${why}: the buyer is told why and types on in the same composer`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const { live } = await threadWithVoice(page, realOrSyntheticMic(engine(info)), "answer");
    await startThreadCall(page);
    await connected(page);
    await expect(voiceBar(page).getByRole("button", { name: "End call" })).toBeVisible();
    // Lost mid-call: the call reconnects with the request kept ("Reconnecting…"); with the service down, two tries
    // fail and it gives up. The time limit is not reconnected.
    if (code === 1011) live.set("down");
    await live.socket()!.close({ code, reason });
    if (code === 1011) await expect(voiceStatus(page)).toHaveAttribute("data-status", "recovering", { timeout: 10_000 });
    await expect(voiceBar(page)).toHaveCount(0, { timeout: 30_000 });
    // The time limit says so. A drop that stays down says it was lost, or (the defect below) only "Reconnecting…".
    await expect.poll(() => told(page)).toMatch(code === 1011 ? /was lost|Reconnecting/ : new RegExp(words.replace(/\./g, "\\.")));
    if (code === 1011) expect(live.urls.length).toBe(3);
    // The same composer takes the request, typed, and the thread carries on.
    await composer(page).fill("100 litres of lactose-free milk for Thursday");
    await composer(page).press("Enter");
    await expect(card(page, "understood")).toContainText(/How much\s*100\sL/, { timeout: 20_000 });
    expect(errors).toEqual([]);
  });
}

test("in the thread, connected, then the phone goes offline: the call ends, typing says it was not sent, and works once back online", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { live } = await threadWithVoice(page, realOrSyntheticMic(engine(info)), "answer");
  await startThreadCall(page);
  await connected(page);

  await context.setOffline(true);
  // The stubbed socket lives inside Playwright, not on the network, so going offline does not close it by itself;
  // a real Gemini socket dies with the network. Close it the way the network would (abnormal close).
  await live.socket()!.close({ code: 1011, reason: "network" });
  // Reconnecting needs AimoPilot, which cannot be reached: the call ends and the composer is back.
  await expect(voiceBar(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(composer(page)).toBeEditable();

  // Still offline: a typed request is not sent, and the page says so instead of pretending.
  const words = "100 litres of lactose-free milk for Thursday";
  await composer(page).fill(words);
  await composer(page).press("Enter");
  await expect(threadLog(page).getByRole("alert")).toContainText(/Not sent/, { timeout: 15_000 });

  await context.setOffline(false);
  await expect(composer(page)).toHaveValue(words);
  await composer(page).press("Enter");
  await expect(card(page, "understood")).toContainText(/How much\s*100\sL/, { timeout: 30_000 });
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|Load failed|network connection was lost|ERR_INTERNET_DISCONNECTED/i.test(e))).toEqual([]);
});

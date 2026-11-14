import { expect, test, type Page } from "@playwright/test";
import { addPasskey, engine, joinAsApprover, watchErrors } from "../support/dock";
import { expectNothingOrdered, micLog, stubLiveService, stubVoiceToken, wrapMicrophone, type MicMode } from "../support/call-stubs";

/**
 * The call screen (/call, src/app/_channels/call-screen.tsx + use-call.ts), up to the point where a voice is
 * needed. Every test makes its own visitor kitchen (passkey join) and calls it from the same phone.
 *
 * What is real and what is stubbed:
 *   - real: the server's call endpoint, the call registry, the typed fallback, the intake and the ledger. The test
 *     server has DOCK_VOICE=off and DOCK_LLM=off and no Gemini key, so it can never mint a voice token.
 *   - stubbed (only in the "connection" tests, and said there): the voice token in the call endpoint's answer, and
 *     the Gemini Live WebSocket (page.routeWebSocket on Google's real URL; nothing leaves the machine).
 *   - microphone: Chromium and Firefox use the browser's fake audio device (playwright.config.ts flags). WebKit has
 *     none in Playwright: the "allowed" test skips there; the refused cases reject getUserMedia from an init script
 *     on every engine; the connection tests give WebKit a silent WebAudio stream instead of a microphone.
 */

const callButton = (page: Page) => page.getByRole("button", { name: "Call", exact: true });
const typedField = (page: Page) => page.getByRole("textbox", { name: "What the kitchen needs" });

/** Join as a visitor kitchen's approver, open /call: the idle call screen of this phone's own kitchen. */
async function openOwnCall(page: Page, mic: MicMode) {
  await addPasskey(page);
  await wrapMicrophone(page, mic);
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

test("microphone allowed (fake device): voice is off on this server, the screen says so and the call continues by typing; nothing is ordered", async ({ page }, info) => {
  test.skip(engine(info) === "webkit", "WebKit in Playwright has no fake microphone device, so 'permission granted' cannot be produced there");
  const errors = watchErrors(page);
  await openOwnCall(page, "real");
  await callButton(page).click();

  await expectTypedFallback(page);
  // The microphone really opened (fake device) before the server refused the voice session.
  expect(await micLog(page)).toMatchObject({ calls: 1, ok: 1, errors: [] });
  // The server's own words: DOCK_LLM=off is checked before DOCK_VOICE=off (src/server/channels/voice/start.ts).
  await expect(page.getByText(/(Model|Voice) calls are switched off on this server/)).toBeVisible();
  await expect(page.getByText(/Microphone:/)).toHaveCount(0); // not blamed on the microphone

  // The typed fallback goes to the real intake. With the model off the request cannot be read, and says so.
  await typedField(page).fill("100 litres of lactose-free milk by Thursday");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("100 litres of lactose-free milk by Thursday")).toBeVisible();
  // DOCK_LLM=off: the reader is unavailable and the screen says so (today in a developer's words, see the report).
  await expect(page.getByRole("status").filter({ hasText: /model/i })).toBeVisible({ timeout: 20_000 });
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

test("the voice connection never opens (socket accepted, no answer): after 12 s 'did not open', then typing", async ({ page }, info) => {
  const errors = watchErrors(page);
  // Stubbed: the voice token (the real server opens a typed call behind it) and Google's socket, which stays silent.
  const ids = await stubVoiceToken(page);
  const live = await stubLiveService(page, "silent");
  await openOwnCall(page, realOrSyntheticMic(engine(info)));
  await callButton(page).click();
  await expect(page.getByText("Calling…")).toBeVisible();
  await expectTypedFallback(page);
  await expect(page.getByText("The voice connection did not open (the network may block it). Type instead.")).toBeVisible();
  expect(ids).toHaveLength(1);
  expect(live.urls[0]).toContain("access_token=e2e-stub-token");
  expect(live.setups).toHaveLength(1); // the browser only names the model; the setup is locked in the token
  expect(JSON.parse(live.setups[0])).toEqual({ setup: { model: "models/gemini-3.8-live" } });
  await expectNothingOrdered(page.request);
  expect(errors).toEqual([]);
});

for (const [why, code, reason, words] of [
  ["the connection drops", 1011, "internal error", "The connection to the voice service was lost."],
  ["the voice service ends it at the time limit", 1008, "deadline expired", "The call reached its time limit."],
] as const) {
  test(`connected, then ${why}: 'The call dropped' with the reason, Call back and Type instead`, async ({ page }, info) => {
    const errors = watchErrors(page);
    // page.routeWebSocket patches the page's WebSocket from an init script: set up before the first navigation.
    const ids = await stubVoiceToken(page);
    const live = await stubLiveService(page, "answer");
    await openOwnCall(page, realOrSyntheticMic(engine(info)));
    await callButton(page).click();
    // Connected: the agent's name in the header, the timer, push-to-talk.
    await expect(page.getByText("Connected. The agent is saying hello…")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Hold to talk/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hang up" })).toBeVisible();
    await expect(page.getByText(/^0:0\d$/)).toBeVisible();

    await live.socket()!.close({ code, reason });
    await expect(page.getByText(`The call dropped. ${words}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Call back" })).toBeVisible();
    await page.getByRole("button", { name: "Type instead" }).click();
    await expectTypedFallback(page);
    await expect(page.getByText("Typing instead of talking: the same request, the same checks.")).toBeVisible();
    expect(ids).toHaveLength(1);
    await expectNothingOrdered(page.request);
    expect(errors).toEqual([]);
  });
}

test("connected, then the phone goes offline: the call drops, typing says there is no connection, and works again once back online", async ({ page, context }, info) => {
  const errors = watchErrors(page);
  const ids = await stubVoiceToken(page);
  const live = await stubLiveService(page, "answer");
  await openOwnCall(page, realOrSyntheticMic(engine(info)));
  await callButton(page).click();
  await expect(page.getByText("Connected. The agent is saying hello…")).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  // The stubbed socket lives inside Playwright, not on the network, so going offline does not close it by
  // itself; a real Gemini socket dies with the network. Close it the way the network would (abnormal close).
  await live.socket()!.close({ code: 1011, reason: "network" });
  await expect(page.getByText("The call dropped. The connection to the voice service was lost.")).toBeVisible();

  // Still offline: "Type instead" cannot reach AimoPilot, and says so instead of pretending.
  await page.getByRole("button", { name: "Type instead" }).click();
  await expect(page.getByText(/Call ended\..*No connection to AimoPilot\. Check the network and try again\./)).toBeVisible({ timeout: 15_000 });
  await expect(typedField(page)).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole("button", { name: "Type instead" }).click();
  await expectTypedFallback(page);
  expect(ids).toHaveLength(1);
  await expectNothingOrdered(page.request);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|Load failed|network connection was lost/i.test(e))).toEqual([]);
});

import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

/**
 * The voice door on a phone, with a fake microphone (Chromium's fake audio device) and a fake voice provider:
 * Playwright answers the browser's WebSocket to Gemini Live itself, so no voice session is opened or paid for.
 * Everything else is real: sign-in, the server reserving the line and minting the token, the interpreter (one small
 * model call per spoken request), the intake, the gate, and the thread the call writes into.
 *
 *   granted                the call connects, a push-to-talk turn is heard, AimoPilot reads it back
 *   refused                microphone permission refused: the same call continues by typing
 *   lost and recovered     the provider drops the connection: "Reconnecting", then the call is back
 *   interrupted            holding the talk button while the agent speaks cuts it off
 *   hang-up, then typing   the read-back waiting on the desk survives the hang-up and is answered by a tap
 *   provider refuses       the first provider closes with a quota error: the call goes to the other (OpenAI, set up
 *                          through this server over WebRTC)
 *   in the thread          speaking as a mode of the store's thread: the mic starts the call, the read-back card
 *                          appears in the thread, hanging up leaves the words in the composer
 *   a judge's phone        scan (/call), passkey, call, read-back, "yes", "the first one", an order at the gate
 *
 * The stage kitchens are sign-in only: these tests sign in to a public test account, as the other suites do.
 */

const tester = TEST_ACCOUNTS[0];

// One live call per kitchen, and every test here calls the same test account's kitchen: the file's tests run one
// after another in one worker (the suite is fully parallel otherwise), and a failure does not skip the rest.
test.describe.configure({ mode: "default" });
const REQUEST = "Two hundred litres of oat drink for Wednesday.";
/** 0.4 s of 24 kHz silence per chunk: the screen treats it as the agent speaking. */
const SILENCE = Buffer.alloc(24000 * 0.4 * 2).toString("base64");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the provider's wire messages, read loosely
type Wire = Record<string, any>;
/** One caller turn of a scripted call: what the recogniser "heard", and the tool the "model" calls for it. */
type Said = (last: Wire | undefined) => { heard: string; call: { name: string; args: Wire } };
type Fake = { sent: Wire[]; sockets: number; ws?: WebSocketRoute; dropFirst?: boolean; refuseFirst?: boolean; longGreeting?: boolean; script?: Said[] };

const sayRequest: Said = () => ({ heard: REQUEST, call: { name: "submit_request", args: { request: REQUEST } } });

/** Answer the browser's Gemini Live socket the way the Live API does (setupComplete, transcripts, tool calls). */
async function fakeGemini(page: Page, fake: Fake) {
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    fake.sockets += 1;
    fake.ws = ws;
    const n = fake.sockets;
    let turn = 0;
    let last: Wire | undefined;
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const speak = (text: string, chunks = 2) => {
      for (let i = 0; i < chunks; i++) send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: SILENCE } }] } } });
      send({ serverContent: { outputTranscription: { text } } });
      send({ serverContent: { turnComplete: true } });
    };
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as Wire;
      fake.sent.push(m);
      if (m.setup) {
        if (fake.refuseFirst && n === 1) return void ws.close({ code: 1011, reason: "Quota exceeded for this model (free tier)." });
        send({ setupComplete: {} });
        if (fake.dropFirst && n === 1) setTimeout(() => ws.close({ code: 1011, reason: "Internal error" }), 1500);
        return;
      }
      const ri = m.realtimeInput;
      if (ri?.text?.startsWith("[call")) return speak("Hello. What do you need?", fake.longGreeting ? 12 : 2);
      if (ri?.activityEnd) {
        const said = (fake.script ?? [sayRequest])[Math.min(turn++, (fake.script ?? [sayRequest]).length - 1)](last);
        send({ serverContent: { inputTranscription: { text: said.heard } } });
        setTimeout(() => send({ toolCall: { functionCalls: [{ id: `fc${turn}`, name: said.call.name, args: said.call.args }] } }), 300);
        return;
      }
      if (m.toolResponse) {
        last = m.toolResponse.functionResponses?.[0]?.response;
        speak(String(last?.say ?? "").split(". I am checking")[0]);
      }
    });
  });
}

const status = (page: Page) => page.locator("[data-status]").first();
const talk = (page: Page) => page.locator("button[aria-pressed]").first();

async function signIn(page: Page) {
  await page.goto("/k");
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username", { exact: true }).fill(tester.username);
  await form.getByLabel("Password", { exact: true }).fill(tester.password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/k/${tester.username}`);
}

async function startCall(page: Page) {
  await signIn(page);
  await page.goto(`/call?k=${tester.username}`);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(status(page)).toBeVisible({ timeout: 20_000 });
}

/** Hold the talk button for `ms`, as a thumb would. */
async function hold(page: Page, ms = 900, button = talk(page)) {
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

// One live call per kitchen: every call a test started is ended afterwards, so the next test gets the line (a call
// that is reconnecting or switching provider has no hang-up button to press).
const started = new Map<Page, { kitchen: string; callId: string }[]>();
test.beforeEach(async ({ page }) => {
  started.set(page, []);
  page.on("response", async (res) => {
    const m = /\/ui-api\/voice\/([^/]+)\/call$/.exec(new URL(res.url()).pathname);
    if (!m || res.request().method() !== "POST") return;
    const body = (await res.json().catch(() => ({}))) as { callId?: string };
    if (body.callId) started.get(page)?.push({ kitchen: m[1], callId: body.callId });
  });
});
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => {}); // the page's own timers (a reconnect, a fallback) stop with it
  for (const c of started.get(page) ?? []) await page.request.post(`/ui-api/voice/${c.kitchen}/call/${c.callId}`, { data: { op: "end", reason: "test over" } }).catch(() => {});
  started.delete(page);
});

// Chromium's fake microphone (a tone) and no permission prompt; "refused" below makes the browser refuse instead.
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] } });

test.describe("with a microphone", () => {
  test("granted: connects, hears a held turn, reads the amount back before anything is priced", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0 };
    await fakeGemini(page, fake);
    await startCall(page);
    await expect(page.getByText("Hello. What do you need?")).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "ready", { timeout: 10_000 });
    await hold(page);
    expect(fake.sent.some((m) => m.realtimeInput?.activityStart)).toBe(true);
    await expect(page.getByText(REQUEST).first()).toBeVisible();
    // The read-back card: the amount as AimoPilot read it, waiting for the caller's yes.
    await expect(page.getByText(/200 L/).first()).toBeVisible({ timeout: 30_000 });
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/read-back.png`, fullPage: true });
    const tool = fake.sent.find((m) => m.toolResponse);
    expect(tool?.toolResponse.functionResponses[0].response.state).toBe("read_back");
  });

  test("lost and recovered: the call reconnects with the request kept", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0, dropFirst: true };
    await fakeGemini(page, fake);
    await startCall(page);
    await expect(status(page)).toHaveAttribute("data-status", "recovering", { timeout: 10_000 });
    await expect(page.getByText(/Reconnecting/).first()).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    expect(fake.sockets).toBe(2);
    expect(fake.sent.some((m) => String(m.realtimeInput?.text ?? "").startsWith("[call reconnected]"))).toBe(true);
  });

  test("interrupted: holding the talk button while the agent speaks cuts it off", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0, longGreeting: true };
    await fakeGemini(page, fake);
    await startCall(page);
    await expect(status(page)).toHaveAttribute("data-status", "speaking", { timeout: 10_000 });
    const box = (await talk(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(status(page)).toHaveAttribute("data-status", "listening");
    await page.waitForTimeout(700);
    await page.mouse.up();
    expect(fake.sent.some((m) => m.realtimeInput?.activityStart)).toBe(true);
  });

  test("hang-up, then typing: the read-back waiting on the desk is answered by a tap", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0 };
    await fakeGemini(page, fake);
    await startCall(page);
    await expect(status(page)).toHaveAttribute("data-status", "ready", { timeout: 10_000 });
    await hold(page);
    await expect(page.getByText(/200 L/).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Hang up" }).click();
    await page.getByRole("button", { name: "Continue by typing" }).click();
    await expect(page.getByLabel("What the kitchen needs")).toBeVisible();
    // The read-back is still there; a tap on its yes carries the same request on, without the call.
    await page.getByRole("button", { name: /^Yes/ }).first().click();
    await expect(page.getByText(/Tapped: /)).toBeVisible();
    await expect(page.getByText("Read back: is this right?")).toHaveCount(0, { timeout: 30_000 });
  });

  test("provider refuses: a quota error moves the call to the other provider, set up through this server", async ({ page }) => {
    const gemini: Fake = { sent: [], sockets: 0, refuseFirst: true };
    await fakeGemini(page, gemini);
    const starts: Wire[] = [];
    const offers: Wire[] = [];
    await page.route("**/ui-api/voice/*/call", async (route) => {
      starts.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.continue();
    });
    // OpenAI over WebRTC: the browser's offer goes to this server (op "rtc"), never to OpenAI with a key. Answer it
    // with a refusal here, so no session is paid for; the screen then falls back to typing.
    await page.route("**/ui-api/voice/*/call/*", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Wire;
      if (body.op !== "rtc") return route.continue();
      offers.push(body);
      await route.fulfill({ status: 503, json: { error: { code: "voice_unavailable", message: "test: no voice session" } } });
    });
    await startCall(page);
    await expect.poll(() => offers.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(gemini.sockets).toBe(1);
    expect(starts.some((s) => s.avoid === "gemini")).toBe(true);
    expect(String(offers[0].sdp)).toMatch(/^v=0/);
  });

  test("in the thread: the microphone starts the call, the read-back lands in the thread, hanging up leaves the words to send", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0 };
    await fakeGemini(page, fake);
    await signIn(page);
    // The earlier tests' calls are already in this kitchen's thread: start it over, so what is checked is this call's.
    expect((await page.request.post(`/ui-api/kitchens/${tester.username}/thread/reset`)).ok()).toBe(true);
    await page.goto(`/k/${tester.username}/order`);
    const composer = page.getByRole("button", { name: "Hold to talk" }).first();
    await composer.click(); // a tap on the microphone starts the call
    const bar = page.locator("[data-voice-mode]:visible").first();
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar.locator("[data-status]")).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
    await hold(page, 900, bar.locator("button[aria-pressed]").last());
    // The heard words become the buyer's turn and the read-back is a card in the thread itself.
    await expect(page.getByText(REQUEST).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main").getByText(/200\s?L/).first()).toBeVisible({ timeout: 30_000 });
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/thread-voice.png`, fullPage: true });
    await page.getByRole("button", { name: "End call" }).first().click();
    await expect(page.locator("[data-voice-mode]")).toHaveCount(0);
    // Not ordered yet: the words wait in the composer, and the buyer carries on typing.
    await expect(page.locator("input#need")).toHaveValue(/oat drink/);
  });
});

test.describe("a judge's phone", () => {
  test("scan, passkey, call, read-back, yes, the first one: an order at the gate", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    const milk = "A hundred litres of lactose-free milk for Wednesday.";
    const fake: Fake = {
      sent: [],
      sockets: 0,
      script: [
        () => ({ heard: milk, call: { name: "submit_request", args: { request: milk } } }),
        () => ({ heard: "Yes, that's right.", call: { name: "confirm_read_back", args: {} } }),
        (last) =>
          last?.state === "needs_confirmation"
            ? { heard: "Yes, that is intended.", call: { name: "respond_to_check", args: { key: last.checks[0].key, choice: "confirm" } } }
            : last?.state === "needs_input"
              ? { heard: last.questions[0].options[0].label, call: { name: "answer_question", args: { questionId: last.questions[0].questionId, optionId: last.questions[0].options[0].optionId } } }
              : { heard: "The first one, please.", call: { name: "choose_option", args: { optionId: last?.options?.[0]?.optionId ?? "" } } },
        (last) => ({ heard: "The first one, please.", call: { name: "choose_option", args: { optionId: last?.options?.[0]?.optionId ?? "" } } }),
      ],
    };
    await fakeGemini(page, fake);
    await page.goto("/call"); // what the call QR code opens
    await page.getByRole("button", { name: /Create passkey and call/ }).click();
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect(status(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    await hold(page);
    await expect(page.getByText(/100 L/).first()).toBeVisible({ timeout: 30_000 });
    // "Yes", then whatever the intake asks, then the first option: each a held turn.
    for (let i = 0; i < 3; i++) {
      if (await page.getByText(/Sign off on this phone|Order placed|placed/i).first().isVisible().catch(() => false)) break;
      await expect(status(page)).toHaveAttribute("data-status", /ready|speaking/, { timeout: 30_000 });
      await hold(page);
      await page.waitForTimeout(2500);
    }
    const order = fake.sent.map((m) => m.toolResponse?.functionResponses?.[0]?.response).find((r) => r && ["committed", "pending_approval"].includes(r.state));
    expect(order, JSON.stringify(fake.sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0].response.state))).toBeTruthy();
    if (order.state === "pending_approval") await expect(page.getByRole("link", { name: "Sign off on this phone" })).toBeVisible();
  });
});

test.describe("without a microphone", () => {
  test("refused: the same call continues by typing, and says how to allow the microphone", async ({ page }) => {
    // As when the visitor taps "Don't allow": the browser refuses getUserMedia with NotAllowedError.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await signIn(page);
    await page.goto(`/call?k=${tester.username}`);
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect(page.getByLabel("What the kitchen needs")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/microphone is blocked|Microphone/i).first()).toBeVisible();
  });
});

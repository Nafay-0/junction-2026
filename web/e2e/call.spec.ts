import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * The call screen's states on a phone, with a fake microphone (Chromium's fake audio device) and a fake voice
 * provider: Playwright answers the browser's WebSocket to Gemini Live (or OpenAI Realtime) itself, so no voice
 * session is opened or paid for. Everything else is real: the server reserves the line, mints the token, and
 * runs the spoken request through the interpreter (one small model call per test that speaks) and the intake.
 *
 *   granted                the call connects, a push-to-talk turn is heard, AimoPilot reads it back
 *   refused                microphone permission refused: the same call continues by typing
 *   lost and recovered     the provider drops the connection: "Reconnecting", then the call is back
 *   interrupted            holding the talk button while the agent speaks cuts it off
 *   hang-up, then typing   the read-back waiting on the desk survives the hang-up and is answered by a tap
 *   provider refuses       the first provider closes with a quota error before the session starts: the other one
 */

const REQUEST = "Two hundred litres of oat drink for Wednesday.";
/** 0.4 s of 24 kHz silence per chunk: the screen treats it as the agent speaking. */
const SILENCE = Buffer.alloc(24000 * 0.4 * 2).toString("base64");

type Fake = { sent: Record<string, unknown>[]; sockets: number; ws?: WebSocketRoute; dropFirst?: boolean; refuseFirst?: boolean; longGreeting?: boolean };

/** Answer the browser's Gemini Live socket the way the Live API does (setupComplete, transcripts, tool calls). */
async function fakeGemini(page: Page, fake: Fake) {
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    fake.sockets += 1;
    fake.ws = ws;
    const n = fake.sockets;
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const speak = (text: string, chunks = 2) => {
      for (let i = 0; i < chunks; i++) send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: SILENCE } }] } } });
      send({ serverContent: { outputTranscription: { text } } });
      send({ serverContent: { turnComplete: true } });
    };
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as Record<string, any>;
      fake.sent.push(m);
      if (m.setup) {
        if (fake.refuseFirst && n === 1) return void ws.close({ code: 1011, reason: "Quota exceeded for this model (free tier)." });
        send({ setupComplete: {} });
        if (fake.dropFirst && n === 1) setTimeout(() => ws.close({ code: 1011, reason: "Internal error" }), 1500);
        return;
      }
      const ri = m.realtimeInput;
      if (ri?.text?.startsWith("[call")) return speak("Hello, Ravintola Kaari. What do you need?", fake.longGreeting ? 12 : 2);
      if (ri?.activityEnd) {
        send({ serverContent: { inputTranscription: { text: REQUEST } } });
        setTimeout(() => send({ toolCall: { functionCalls: [{ id: "fc1", name: "submit_request", args: { request: REQUEST } }] } }), 300);
        return;
      }
      if (m.toolResponse) {
        const say = String(m.toolResponse.functionResponses?.[0]?.response?.say ?? "");
        speak(say.split(". I am checking")[0]);
      }
    });
  });
}

/** OpenAI Realtime, for the provider-fallback test. */
async function fakeOpenAI(page: Page, fake: Fake) {
  await page.routeWebSocket(/api\.openai\.com/, (ws) => {
    fake.sockets += 1;
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    send({ type: "session.created", session: {} });
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as Record<string, any>;
      fake.sent.push(m);
      if (m.type === "response.create") {
        send({ type: "response.created", response: {} });
        send({ type: "response.output_audio.delta", delta: SILENCE });
        send({ type: "response.output_audio_transcript.delta", delta: "Hello, Ravintola Kaari." });
        send({ type: "response.done", response: { status: "completed", output: [] } });
      }
    });
  });
}

const status = (page: Page) => page.locator("[data-status]");
const talk = (page: Page) => page.locator("button[aria-pressed]");

async function startCall(page: Page) {
  await page.goto("/call?k=kaari");
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(status(page)).toBeVisible({ timeout: 20_000 });
}

/** Hold the talk button for `ms`, as a thumb would. */
async function hold(page: Page, ms = 900) {
  const box = (await talk(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

// One live call per kitchen: hang up at the end of each test so the next one gets the line.
test.afterEach(async ({ page }) => {
  const hang = page.getByRole("button", { name: "Hang up" });
  if (await hang.isVisible().catch(() => false)) await hang.click().catch(() => {});
});

test.describe("with a microphone", () => {
  test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] } });

  test("granted: connects, hears a held turn, reads the amount back before anything is priced", async ({ page }) => {
    const fake: Fake = { sent: [], sockets: 0 };
    await fakeGemini(page, fake);
    await startCall(page);
    await expect(page.getByText("Hello, Ravintola Kaari.")).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "ready", { timeout: 10_000 });
    await hold(page);
    expect(fake.sent.some((m) => (m.realtimeInput as Record<string, unknown>)?.activityStart)).toBe(true);
    await expect(page.getByText(REQUEST).first()).toBeVisible();
    // The read-back card: the amount as AimoPilot read it, waiting for the caller's yes.
    await expect(page.getByText(/200 L/).first()).toBeVisible({ timeout: 30_000 });
    const tool = fake.sent.find((m) => m.toolResponse) as { toolResponse: { functionResponses: { response: { state: string } }[] } } | undefined;
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
    expect(fake.sent.some((m) => String((m.realtimeInput as Record<string, unknown>)?.text ?? "").startsWith("[call reconnected]"))).toBe(true);
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
    expect(fake.sent.some((m) => (m.realtimeInput as Record<string, unknown>)?.activityStart)).toBe(true);
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
    await expect(page.locator("section").first()).toBeVisible({ timeout: 30_000 });
  });

  test("provider refuses: a quota error before the session starts moves the call to the other provider", async ({ page }) => {
    const gemini: Fake = { sent: [], sockets: 0, refuseFirst: true };
    const openai: Fake = { sent: [], sockets: 0 };
    await fakeGemini(page, gemini);
    await fakeOpenAI(page, openai);
    await startCall(page);
    await expect(status(page)).toHaveAttribute("data-status", /ready|speaking/, { timeout: 20_000 });
    expect(gemini.sockets).toBe(1);
    expect(openai.sockets).toBe(1);
  });
});

test.describe("without a microphone", () => {
  test.use({ permissions: [], launchOptions: { args: ["--use-fake-device-for-media-stream", "--deny-permission-prompts"] } });

  test("refused: the same call continues by typing, and says how to allow the microphone", async ({ page }) => {
    await page.goto("/call?k=kaari");
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect(page.getByLabel("What the kitchen needs")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/microphone is blocked|Microphone/i).first()).toBeVisible();
  });
});

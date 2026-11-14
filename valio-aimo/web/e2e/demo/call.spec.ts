import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { addPasskey, engine, watchErrors } from "../support/dock";
import { wrapMicrophone, type MicMode } from "../support/call-stubs";
import { composer, threadLog, visitorKitchen } from "../support/thread";

/**
 * Talking to the agent: one way, hands-free, in the kitchen's own conversation (docs/doors.md). The composer's
 * microphone starts it in place; the voice bar says what the call is doing, shows the live level, and has mute and
 * end; everything said lands in the thread as ordinary turns, the buyer's marked as spoken.
 *
 * What is real and what is stubbed:
 *   - real: the store, the call endpoint and registry, the token the server mints (test-only scripted tokens,
 *     DOCK_VOICE_SCRIPTED=1 on the hermetic server), the voice door (heard words into the thread engine), the engine
 *     with its scripted reader and agent (e2e/fixtures/recordings.json), the cards, the ledger.
 *   - stubbed: the Gemini Live service itself. The test answers the browser's socket as the Live API does: the
 *     buyer's words as input transcription, a relay tool call, and the agent's audio and transcript for whatever the
 *     page gives it to say. So the page's whole hands-free loop runs, with no voice session paid for.
 *   - microphone: Chromium's fake audio device; WebKit gets a silent WebAudio stream (no fake device in Playwright).
 * Firefox is not run here (Playwright's Firefox intermittently never opens the call; the phones at the venue are
 * Safari and Chrome).
 */

/** 0.4 s of 24 kHz silence per chunk: the page plays it as the agent's voice. */
const SILENCE = Buffer.alloc(24000 * 0.4 * 2).toString("base64");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the provider's wire messages, read loosely
type Wire = Record<string, any>;

type Live = {
  sockets: number;
  ws?: WebSocketRoute;
  /** Every "[AimoPilot] ..." the page gave the agent to say, and every relay response. */
  told: string[];
  relayed: Wire[];
  /** Say this as the buyer: input transcription, then the relay call (as Gemini's turn detection does). */
  buyer: (words: string) => void;
  /** Keep the agent "speaking" for `chunks` x 0.4 s on the next thing it says. */
  longNext: (chunks: number) => void;
  /** The provider's barge-in: the buyer started talking over the agent. */
  interrupt: () => void;
  dropAfterConnect?: boolean;
};

async function fakeLive(page: Page, opts: { dropAfterConnect?: boolean } = {}): Promise<Live> {
  const live: Live = { sockets: 0, told: [], relayed: [], buyer: () => {}, longNext: () => {}, interrupt: () => {}, ...opts };
  let long = 2;
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    live.sockets += 1;
    live.ws = ws;
    const n = live.sockets;
    let fc = 0;
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const speak = (text: string) => {
      const chunks = long;
      long = 2;
      for (let i = 0; i < chunks; i++) send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: SILENCE } }] } } });
      send({ serverContent: { outputTranscription: { text } } });
      setTimeout(() => send({ serverContent: { turnComplete: true } }), 50);
    };
    live.buyer = (words) => {
      send({ serverContent: { inputTranscription: { text: words } } });
      setTimeout(() => send({ toolCall: { functionCalls: [{ id: `fc${++fc}`, name: "relay", args: { words } }] } }), 200);
    };
    live.longNext = (c) => void (long = c);
    live.interrupt = () => send({ serverContent: { interrupted: true } });
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as Wire;
      if (m.setup) {
        send({ setupComplete: {} });
        if (live.dropAfterConnect && n === 1) setTimeout(() => ws.close({ code: 1011, reason: "Internal error" }), 4000);
        return;
      }
      const t = m.realtimeInput?.text as string | undefined;
      if (t === "[call connected]") return speak("Hello. What do you need?");
      if (t?.startsWith("[AimoPilot] ")) {
        live.told.push(t.slice(12));
        return speak(t.slice(12));
      }
      if (m.toolResponse) {
        const r = m.toolResponse.functionResponses?.[0]?.response as Wire;
        live.relayed.push(r);
        if (r?.say) speak(String(r.say));
        else setTimeout(() => send({ serverContent: { turnComplete: true } }), 50);
      }
    });
  });
  return live;
}

const mic = (page: Page) => page.getByRole("button", { name: /^(Talk to your agent \(hands-free\)|End the call)$/ }).filter({ visible: true }).first();
const bar = (page: Page) => page.locator("[data-voice-mode]").filter({ visible: true }).first();
const statusOf = (page: Page) => bar(page).getAttribute("data-voice-status");

/** A visitor kitchen of this phone's own, its conversation open, the microphone ready. */
async function ownKitchen(page: Page, micMode: MicMode) {
  await addPasskey(page);
  await wrapMicrophone(page, micMode);
  const slug = await visitorKitchen(page);
  await page.goto(`/k/${slug}?talk=1`);
  await expect(threadLog(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Tap the microphone and talk: the agent hears you and answers out loud.")).toBeVisible();
  return slug;
}

const micFor = (name: string): MicMode => (name === "webkit" ? "synthetic" : "real");
test.beforeEach(({}, info) => {
  test.skip(engine(info) === "firefox", "Playwright's Firefox intermittently never opens the call; voice is covered on Chromium and WebKit");
});

test("one tap: hands-free in the same conversation; the words land as a spoken turn, the agent's reply is said; mute; end", async ({ page }, info) => {
  const errors = watchErrors(page);
  const live = await fakeLive(page);
  await ownKitchen(page, micFor(engine(info)));
  await mic(page).click();
  await expect(bar(page)).toBeVisible({ timeout: 20_000 });
  // Connected: the agent greets; then it listens, with the live level and mute and end on the bar.
  await expect.poll(() => statusOf(page), { timeout: 20_000 }).toBe("listening");
  await expect(bar(page).locator("[data-voice-level]")).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Mute" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "End" })).toBeVisible();
  // The buyer speaks: heard live on the bar, then a spoken turn in the thread, an acknowledgement at once, then the
  // engine's reply said in full (the same reply the thread shows).
  live.buyer("A hundred litres of lactose-free milk for Wednesday.");
  await expect(threadLog(page).getByText("A hundred litres of lactose-free milk for Wednesday.")).toBeVisible({ timeout: 20_000 });
  await expect(threadLog(page).locator("[data-spoken]").first()).toBeVisible();
  await expect.poll(() => live.relayed.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => live.told.length + live.relayed.filter((r) => /option|order|euro|litre/i.test(String(r.say))).length, { timeout: 40_000 }).toBeGreaterThan(0);
  const spoken = [...live.relayed.map((r) => String(r.say)), ...live.told].join(" ");
  expect(spoken).not.toMatch(/\*\*|\{\{|https?:\/\/|\b(req|ord|trn)_\w{4,}/);
  // Mute: the microphone stops sending; unmute.
  await bar(page).getByRole("button", { name: "Mute" }).click();
  await expect.poll(() => statusOf(page)).toMatch(/muted|speaking|working/);
  await bar(page).getByRole("button", { name: "Unmute" }).click();
  // The field stays: typing during the call works, and the reply to typed words is said too.
  await expect(composer(page)).toBeEnabled();
  // End: the bar goes; the buyer is in the same composer, the conversation as it was.
  await bar(page).getByRole("button", { name: "End" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(threadLog(page).getByText("A hundred litres of lactose-free milk for Wednesday.")).toBeVisible();
  await expect(mic(page)).toHaveAttribute("data-mic", "idle");
  expect(errors).toEqual([]);
});

test("barge-in: the buyer talks over the agent and it stops at once", async ({ page }, info) => {
  const live = await fakeLive(page);
  await ownKitchen(page, micFor(engine(info)));
  await mic(page).click();
  await expect.poll(() => statusOf(page), { timeout: 20_000 }).toBe("listening");
  live.longNext(25); // ten seconds of the agent talking
  live.buyer("what can I try?");
  await expect.poll(() => statusOf(page), { timeout: 30_000 }).toBe("speaking");
  live.interrupt();
  await expect.poll(() => statusOf(page), { timeout: 5_000 }).not.toBe("speaking");
  await bar(page).getByRole("button", { name: "End" }).click();
});

test("the line drops mid-call: 'Reconnecting', then back, and where things stand is said", async ({ page }, info) => {
  const live = await fakeLive(page, { dropAfterConnect: true });
  await ownKitchen(page, micFor(engine(info)));
  await mic(page).click();
  // Every status the bar shows, recorded as it changes (a reconnect can take well under a second).
  await page.evaluate(() => {
    const w = window as unknown as { __statuses: string[] };
    w.__statuses = [];
    new MutationObserver(() => {
      const s = document.querySelector("[data-voice-status]")?.getAttribute("data-voice-status");
      if (s && w.__statuses.at(-1) !== s) w.__statuses.push(s);
    }).observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-voice-status"] });
  });
  await expect.poll(() => statusOf(page), { timeout: 20_000 }).toBe("listening");
  await expect.poll(() => live.sockets, { timeout: 15_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __statuses: string[] }).__statuses), { timeout: 10_000 }).toContain("reconnecting");
  await expect.poll(() => statusOf(page), { timeout: 20_000 }).toBe("listening");
  await expect.poll(() => live.told.join(" "), { timeout: 15_000 }).toMatch(/I'm back/);
  await bar(page).getByRole("button", { name: "End" }).click();
});

test("microphone refused: a plain sentence, once, and the typed conversation carries on", async ({ page }) => {
  const errors = watchErrors(page);
  const callPosts: string[] = [];
  page.on("request", (r) => {
    if (/\/ui-api\/voice\/[^/]+\/call$/.test(new URL(r.url()).pathname) && r.method() === "POST") callPosts.push(r.url());
  });
  await ownKitchen(page, "NotAllowedError");
  await mic(page).click();
  await expect(page.getByText(/The microphone is blocked for this page\. Allow it in the browser's site settings/).first()).toBeVisible({ timeout: 15_000 });
  await expect(bar(page)).toHaveCount(0);
  expect(callPosts, "no voice session is asked for without a microphone").toEqual([]);
  await expect(composer(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the old call page leads to the same conversation's microphone", async ({ page }) => {
  await addPasskey(page);
  const slug = await visitorKitchen(page);
  await page.goto("/call");
  await page.waitForURL(`**/k/${slug}?talk=1`, { timeout: 20_000 });
  await expect(mic(page)).toBeVisible();
});

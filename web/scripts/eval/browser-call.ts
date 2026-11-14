/**
 * The hands-free voice door, driven end to end in a real Chromium (phone viewport) against a running server, with a
 * fake microphone: the page's getUserMedia gets a WebAudio stream this script plays synthesised speech into (macOS
 * `say`), so each utterance can be spoken at its moment (the browser's --use-file-for-fake-audio-capture loops one
 * file forever). Everything else is real: the passkey join (virtual authenticator), the store, the server's call, the
 * live voice model (Gemini Live, paid key, about a cent a minute), the voice door, the engine and its models, the gate,
 * the passkey sign-off.
 *
 *   pnpm tsx scripts/eval/browser-call.ts <baseUrl> <outDir>
 *
 * Steps: join -> tap the microphone -> "200 litres of lactose-free milk for Thursday" -> the options question ->
 * barge-in (talk over the agent) -> "yes" (the spoken yes orders the first option) -> "600 litres ..." over the limit
 * -> "the first one" -> waiting for the OK -> sign on /approve with the passkey -> the agent says it is signed -> End.
 * Prints what the thread shows and how long each step took; screenshots to outDir.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";

const [base, out] = process.argv.slice(2);
if (!base || !out) throw new Error("usage: browser-call.ts <baseUrl> <outDir>");
fs.mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${s}`);

/** Synthesised speech as base64 16-bit mono 16 kHz WAV (cached). */
function speech(text: string): string {
  const dir = path.join(os.tmpdir(), "dock-browser-call");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${text.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.wav`);
  if (!fs.existsSync(f)) {
    execFileSync("say", ["-v", "Samantha", "-o", f.replace(/\.wav$/, ".aiff"), text]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", f.replace(/\.wav$/, ".aiff"), "-ar", "16000", "-ac", "1", f]);
  }
  return fs.readFileSync(f).toString("base64");
}

/**
 * The fake microphone: a WebAudio destination's stream; `__mic.say(b64wav)` plays into it, resolving when done. A
 * string, not a function: tsx's helpers do not exist in the page.
 */
const FAKE_MIC = `
(() => {
  const w = window;
  w.__mic = {
    say: async (b64) => {
      const m = w.__mic;
      if (!m.ctx || !m.dest) throw new Error("microphone not open");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await m.ctx.decodeAudioData(bytes.buffer);
      const src = m.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(m.dest);
      src.start();
      await new Promise((r) => (src.onended = r));
      return Date.now();
    },
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.002; // a faint hum: a real microphone never gives exact silence
    osc.connect(g).connect(dest);
    osc.start();
    w.__mic.ctx = ctx;
    w.__mic.dest = dest;
    return dest.stream;
  };
})();
`;

const status = (page: Page) => page.locator("[data-voice-status]").first().getAttribute("data-voice-status").catch(() => null);
async function until(page: Page, want: (s: string | null) => boolean, ms: number): Promise<number | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (want(await status(page))) return Date.now();
    await page.waitForTimeout(50);
  }
  return undefined;
}
const say = (page: Page, text: string): Promise<number> => page.evaluate(`window.__mic.say(${JSON.stringify(speech(text))})`) as Promise<number>;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
const lastTurns = async (page: Page, n = 4) => (await page.getByRole("log").first().locator(":scope > li").allInnerTexts()).slice(-n).map((x) => x.replace(/\s+/g, " ").slice(0, 220));

/** Speak, then measure: first sound after the end of speech, and the agent back to listening (the reply said). */
async function turn(page: Page, text: string, opts: { replyMs?: number } = {}) {
  log(`buyer: "${text}"`);
  const ended = await say(page, text);
  const first = await until(page, (s) => s === "speaking", 20_000);
  const back = await until(page, (s) => s === "listening" || s === "waiting", opts.replyMs ?? 90_000);
  // A reply that comes in parts (acknowledgement, then the reply): wait for quiet.
  let done = back;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const s = await status(page);
    if (s === "speaking" || s === "working") done = undefined;
    else if (!done) done = Date.now();
    else if (Date.now() - done > 2500) break;
  }
  log(`  first sound ${first ? first - ended : "-"} ms, reply said by ${done ? ((done - ended) / 1000).toFixed(1) : "-"} s`);
  for (const t of await lastTurns(page, 2)) log(`  thread: ${t}`);
  return { first: first ? first - ended : undefined, done: done ? done - ended : undefined };
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["microphone"] });
  await ctx.addInitScript({ content: FAKE_MIC });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && log(`console: ${m.text().slice(0, 200)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  // Join: what the "talk to your agent" code opens.
  await page.goto(`${base}/call`);
  await page.getByRole("button", { name: /Create passkey and call/ }).click({ timeout: 30_000 });
  await page.waitForURL(/\/k\/sbx_[^/?]+\?talk=1/, { timeout: 30_000 });
  const kitchen = /\/k\/(sbx_[^/?]+)/.exec(page.url())![1];
  log(`joined: ${kitchen}`);
  await page.getByRole("log").first().waitFor({ timeout: 30_000 });
  await shot(page, "1-ready");

  // Start: one tap.
  const tap = Date.now();
  await page.getByRole("button", { name: "Talk to your agent (hands-free)" }).click();
  const live = await until(page, (s) => s === "listening", 20_000);
  log(`listening after ${live ? live - tap : "-"} ms (the greeting said)`);
  await until(page, (s) => s === "listening", 15_000);
  await page.waitForTimeout(1500);
  await shot(page, "2-listening");

  const results: Record<string, unknown> = {};
  results.request = await turn(page, "Two hundred litres of lactose-free milk for Thursday.");
  await shot(page, "3-options-question");

  // Barge-in: ask something with a long answer, then talk over it.
  log("barge-in: a question with a long answer, then the buyer talks over the agent");
  const ended = await say(page, "What did we order last week, and what is the cut-off for Thursday?");
  const speaking = await until(page, (s) => s === "speaking", 30_000);
  await page.waitForTimeout(1200);
  const over = Date.now();
  void say(page, "Never mind.");
  const stopped = await until(page, (s) => s !== "speaking", 5_000);
  log(`  agent speaking ${speaking ? speaking - ended : "-"} ms after the question; stopped ${stopped ? stopped - over : "-"} ms after the buyer started talking over it`);
  await page.waitForTimeout(4000);
  results.bargeIn = { stoppedMs: stopped ? stopped - over : undefined };

  // The read-back question about the first option, and the buyer's yes.
  results.request2 = await turn(page, "Two hundred litres of lactose-free milk for Thursday.");
  results.yes = await turn(page, "Yes, order it.");
  await shot(page, "4-ordered");

  // Over the limit: waiting for the OK, signed with the passkey, and the agent says so.
  results.over = await turn(page, "Six hundred litres of lactose-free milk for Thursday.");
  // Whatever the engine asks on the way (a repeat check, which option), the buyer says yes, at most three times.
  const waitingGate = async () => {
    const th = await page.request.get(`${base}/ui-api/kitchens/${kitchen}/thread`);
    return (((await th.json()).thread?.turns ?? []) as { cards?: { type: string; outcome?: string; approvalId?: string }[] }[]).flatMap((t) => t.cards ?? []).filter((c) => c.type === "gate" && c.outcome === "waiting").at(-1)?.approvalId;
  };
  for (let i = 0; i < 3 && !(await waitingGate()); i++) results[`yes${i}`] = await turn(page, "Yes, order the first one.");
  await shot(page, "5-waiting");
  const approvalId = await waitingGate();
  if (approvalId) {
    // Signed here, in the conversation, with this phone's passkey (the virtual authenticator belongs to this page).
    const sign = page.getByRole("button", { name: /^(OK with|Sign with this device|Sign now|Add this device and sign|Approve \d)/ }).last();
    await sign.click({ timeout: 20_000 });
    const signedAt = Date.now();
    const back = await until(page, (s) => s === "speaking", 30_000);
    log(`signed: the agent spoke ${back ? back - signedAt : "-"} ms after the OK`);
    await until(page, (s) => s === "listening", 30_000);
    await page.waitForTimeout(1500);
    for (const t of await lastTurns(page, 1)) log(`  thread: ${t}`);
  } else log("no order waiting for an OK (nothing to sign)");
  await shot(page, "6-signed");

  // End.
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.waitForTimeout(800);
  log(`ended: voice bar ${await page.locator("[data-voice-mode]").count() ? "still there" : "gone"}, composer ${await page.getByRole("textbox").first().isEnabled() ? "ready" : "disabled"}`);
  const timings = await page.evaluate("window.__dockVoiceTimings");
  fs.writeFileSync(path.join(out, "drive.json"), JSON.stringify({ kitchen, results, timings, thread: await lastTurns(page, 30) }, null, 2));
  await shot(page, "7-ended");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * c05 (hands-free voice), recorded: the drive of scripts/eval/browser-call.ts (a fake microphone the script speaks
 * into with macOS `say`; everything else real: the passkey join, the server's call, the live voice model, the same
 * engine and gate, the passkey sign-off) on the desktop layout, with the waits on the agent compressed. The browser's
 * sound is not recorded (the narrator explains).
 *
 *   npx tsx scripts/demo-video/c05.ts --url http://localhost:5142
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { click, context, deliver, launch, opt, passkey, pointerAt, scrollBy, sleep, Take } from "./rec";

const base = opt("--url", "http://localhost:5142")!;

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
      src.buffer = buf; src.connect(m.dest); src.start();
      await new Promise((r) => (src.onended = r));
      return Date.now();
    },
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    g.gain.value = 0.002; osc.connect(g).connect(dest); osc.start();
    w.__mic.ctx = ctx; w.__mic.dest = dest;
    return dest.stream;
  };
})();`;

const status = (page: Page) => page.locator("[data-voice-status]").first().getAttribute("data-voice-status").catch(() => null);
async function until(page: Page, want: (s: string | null) => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (want(await status(page))) return true;
    await sleep(60);
  }
  return false;
}
const lastTurns = async (page: Page, n = 2) => (await page.getByRole("log").first().locator(":scope > li").allInnerTexts()).slice(-n).map((x) => x.replace(/\s+/g, " ").slice(0, 240));

async function main() {
  const browser = await launch(["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]);
  const ctx = await context(browser, base, "desktop", { permissions: ["microphone"] });
  await ctx.addInitScript({ content: FAKE_MIC });
  const page = await ctx.newPage();
  await passkey(page);
  await page.goto("/call");
  await page.getByRole("button", { name: /Create passkey and call/ }).click({ timeout: 30_000 });
  await page.waitForURL(/\/k\/sbx_[^/?]+\?talk=1/, { timeout: 30_000 });
  const kitchen = /\/k\/(sbx_[^/?]+)/.exec(page.url())![1];
  await page.getByRole("log").first().waitFor({ timeout: 30_000 });
  await sleep(2500);
  await pointerAt(page, 800, 400);

  const take = new Take("c05-01");
  await take.record(page);
  await sleep(1200);
  const mic = page.getByRole("button", { name: "Talk to your agent (hands-free)" });
  await click(mic);
  take.event("one tap on the microphone: hands-free");
  await take.wait(() => until(page, (s) => s === "listening", 20_000));
  await take.wait(() => until(page, (s) => s === "listening", 15_000));
  take.event("Listening");
  await sleep(1500);

  /** Speak at real speed (the viewer sees "Hearing you"), then the agent's work and reply compressed. */
  const turn = async (text: string, label: string) => {
    take.event(`spoken: "${text}"`);
    await page.evaluate(`window.__mic.say(${JSON.stringify(speech(text))})`);
    await take.wait(async () => {
      await until(page, (s) => s === "speaking", 30_000);
    });
    take.event(label);
    await sleep(1800);
    await take.wait(async () => {
      await until(page, (s) => s === "listening" || s === "waiting", 90_000);
      let quietSince = 0;
      for (let i = 0; i < 80; i++) {
        await sleep(400);
        const s = await status(page);
        if (s === "speaking" || s === "working") quietSince = 0;
        else if (!quietSince) quietSince = Date.now();
        else if (Date.now() - quietSince > 2000) break;
      }
    });
    await scrollBy(page, 4000, { ms: 900, at: { x: 640, y: 360 } });
    for (const t of await lastTurns(page)) console.log(`  thread: ${t}`);
    await sleep(2200);
  };

  await turn("Two hundred litres of lactose-free milk for Thursday.", "Working, then Speaking: the options, read out");
  await turn("Yes, order it.", "it reads the order back and places it alone (within the limit)");
  await turn("Six hundred litres of lactose-free milk for Thursday.", "over the limit: it says a sign-off is needed");
  const waitingGate = async () => {
    const th = await ctx.request.get(`${base}/ui-api/kitchens/${kitchen}/thread`);
    return (((await th.json()).thread?.turns ?? []) as { cards?: { type: string; outcome?: string; approvalId?: string }[] }[]).flatMap((t) => t.cards ?? []).filter((c) => c.type === "gate" && c.outcome === "waiting").at(-1)?.approvalId;
  };
  for (let i = 0; i < 3 && !(await waitingGate()); i++) await turn("Yes, order the first one.", "answered by voice");
  if (await waitingGate()) {
    const sign = page.getByRole("button", { name: /^(OK with|Sign with this device|Sign now|Add this device and sign|Approve \d)/ }).last();
    await sleep(800);
    await click(sign);
    take.event("a sign-off still needs the passkey: signed");
    await take.wait(() => until(page, (s) => s === "speaking", 30_000));
    take.event("the agent says it is signed and placed");
    await take.wait(() => until(page, (s) => s === "listening", 30_000));
    await scrollBy(page, 4000, { ms: 900, at: { x: 640, y: 360 } });
    for (const t of await lastTurns(page, 1)) console.log(`  thread: ${t}`);
    await sleep(2500);
  } else console.log("  no order waiting for an OK");
  const end = page.getByRole("button", { name: "End", exact: true });
  if (await end.count()) {
    await click(end);
    take.event("End: back to the typed conversation, exactly where it was");
  }
  await sleep(2500);
  await take.stop();
  deliver(take, { id: "c05-01-voice", chapter: "c05", what: "Hands-free voice (live voice model, synthetic test speech into a fake microphone): Listening, Hearing you, Working, Speaking; spoken turns in the thread with the microphone mark; read-back; an order alone; one over the limit signed with the passkey" });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Real audio, per capability: each conversation of eval/voice/caps (scripts/eval/make-voice-caps.py: synthetic
 * voices, English and Finnish, some in kitchen noise, some fast) is spoken to the live voice model exactly as the
 * store's microphone sends it (hands-free, the server's own session and brief, the browser's socket class, real-time
 * pace, silence after each turn so the provider hears the end), and every relay goes through the real voice door
 * (thread/voice-bridge.ts heardTurn: the heard words into the kitchen's conversation, the same engine as typing) in
 * this process, with what the door says given back to the model to say, as the page does.
 *
 * Scored per turn: heard right (the transcript is the words said, at most one word in five wrong); per conversation:
 * outcome right (the same orders, gate decisions and end as the same words typed: eval/voice/results/parity.json,
 * written by scripts/eval/voice-parity.ts). Timed per turn, from the end of the buyer's speech: the relay call, the
 * first sound, the reply's first sound, the reply said in full.
 *
 *   DATABASE_URL= ... pnpm tsx scripts/eval/eval-voice-caps.ts [--only plain,fi-plain] [--model gemini-3.8-live]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { flag, loadLocalEnv } from "../lib/agent-cli";

for (const k of ["DATABASE_URL", "OPENSEARCH_URL", "VALKEY_URL", "KAFKA_BOOTSTRAP_SERVERS", "DOCK_PUBLIC_URL", "DOCK_MARIADB_URL", "DOCK_COPILOT_PG_URL", "AIVEN_READONLY_TOKEN"]) process.env[k] ??= "";
Object.assign(process.env, { DOCK_CATALOG: "seed", DOCK_RATE_LIMITS: "off", DOCK_SAMPLE_ACTIVITY: "off", DOCK_WATCH_MINUTES: "0", RADAR_POLL: "off", DOCK_LLM_DAILY_USD: "20", DOCK_LLM_DAILY_CALLS: "5000", DOCK_VOICE_CALLS_PER_KITCHEN_HOUR: "1000", DOCK_VOICE_CALLS_PER_HOUR: "1000", DOCK_VOICE_CALLS_PER_KITCHEN_DAY: "1000", DOCK_VOICE_CALLS_PER_DAY: "1000", DOCK_VOICE_FALLBACK_MODEL: "off" });
loadLocalEnv();

const ROOT = path.join(__dirname, "..", "..", "eval", "voice");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pcmOf(wav: Buffer): Int16Array {
  let o = 12;
  while (o < wav.length - 8) {
    const id = wav.toString("ascii", o, o + 4);
    const size = wav.readUInt32LE(o + 4);
    if (id === "data") {
      const b = wav.subarray(o + 8, o + 8 + size);
      return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}
const b64 = (x: Int16Array) => Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString("base64");

function sayClip(text: string, lang: string): Int16Array {
  const dir = path.join(os.tmpdir(), "dock-voice-replies");
  fs.mkdirSync(dir, { recursive: true });
  const voice = lang === "fi" ? "Satu" : "Samantha";
  const f = path.join(dir, `${voice}-${text.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.wav`);
  if (!fs.existsSync(f)) {
    const aiff = f.replace(/\.wav$/, ".aiff");
    execFileSync("say", ["-v", voice, "-o", aiff, text]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-af", "adelay=300|300,apad=pad_dur=0.3", "-ar", "16000", "-ac", "1", f]);
  }
  return pcmOf(fs.readFileSync(f));
}

const words = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
/** Word error rate of what was heard against what was said (edit distance over words). */
function wer(heard: string, said: string): number {
  const a = words(said);
  const b = words(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? d[a.length][b.length] / a.length : b.length ? 1 : 0;
}

type Truth = Record<string, { capability: string; lang: string; noise: string; rate: string | number; turns: { file: string; said: string }[] }>;

async function main() {
  const args = process.argv.slice(2);
  const only = flag(args, "--only")?.split(",");
  const model = flag(args, "--model") ?? "gemini-3.8-live";
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "caps", "truth.json"), "utf8")) as Truth;
  const parityFile = path.join(ROOT, "results", "parity.json");
  const parity = fs.existsSync(parityFile) ? (JSON.parse(fs.readFileSync(parityFile, "utf8")) as { rows: { id: string; typed: { orders: string[]; gates: string[]; end: string } }[] }) : { rows: [] };
  const { resetRuntime, getRuntime } = await import("@/server/runtime");
  const { startCall } = await import("@/server/channels/voice/start");
  const { calls } = await import("@/server/channels/voice/calls");
  const { heardTurn, nextSpoken } = await import("@/server/thread/voice-bridge");
  const { threadStore } = await import("@/server/thread/engine");
  const { LiveSocket } = await import("@/app/_channels/live-socket");
  const { dailyUsage } = await import("@/server/limits");
  type Card = import("@/server/thread/types").Card;
  const usd0 = dailyUsage().llm.usd;
  let audioIn = 0;
  let audioOut = 0;

  const snapshot = async (kitchen: string) => {
    const s = await threadStore();
    const t = s.peek(kitchen);
    if (!t) return { orders: [] as string[], gates: [] as string[], end: "none" };
    const latest = new Map<string, Card>();
    for (const x of s.cards(t)) latest.set(x.card.cardId, x.card);
    const cards = [...latest.values()];
    const agents = t.turns.filter((x) => x.role === "agent" && x.replyTo);
    return {
      orders: cards.flatMap((c) => (c.type === "order" ? [`${c.status} ${(c.totalCents / 100).toFixed(2)} ${c.lines.map((l) => `${l.productId}x${l.quantity}`).sort().join("+")} ${c.deliveryDate}`] : [])).sort(),
      gates: cards.flatMap((c) => (c.type === "gate" ? [`${c.outcome}${c.rule ? `:${c.rule}` : ""}`] : [])).sort(),
      end: agents.at(-1)?.role === "agent" ? (agents.at(-1) as { status: string }).status : "none",
    };
  };

  const rows: Record<string, unknown>[] = [];
  for (const [id, conv] of Object.entries(truth)) {
    if (only && !only.includes(id)) continue;
    resetRuntime();
    const g = globalThis as { __dockCalls?: unknown; __dockThreads?: unknown };
    g.__dockCalls = undefined;
    g.__dockThreads = undefined;
    await getRuntime();
    const lang = conv.lang === "fi" ? "fi" : "en";
    const start = await startCall(undefined, "kaari", { model, lang });
    const call = calls().get(start.callId)!;
    const live = start.live!;
    let heard = "";
    let lastHeardAt = 0;
    let turn = 0;
    let endAt = 0;
    let ready = false;
    let closed: string | undefined;
    let modelBusy = false;
    let lastAudioAt = 0;
    const queue: string[] = [];
    type T = { said: string; heard: string; wer: number; relayMs?: number; firstSoundMs?: number; replySoundMs?: number; replyDoneMs?: number; reply?: string; state?: string };
    const turns: T[] = [];
    let cur: T | undefined;
    let replyGiven = false;
    let replySpoken = false;
    let pending = 0;
    const flush = () => {
      if (modelBusy || !queue.length || !ready) return;
      modelBusy = true;
      sock.text(`[AimoPilot] ${queue.shift()}`);
    };
    const sock = new LiveSocket(live.wsUrl, live.token, live.model, {
      onReady: () => {
        ready = true;
      },
      onAudio: (a) => {
        audioOut += Buffer.from(a, "base64").length / 2 / 24000;
        lastAudioAt = Date.now();
        if (cur && endAt) {
          cur.firstSoundMs ??= Date.now() - endAt;
          if (replyGiven && cur.replySoundMs === undefined) cur.replySoundMs = Date.now() - endAt;
        }
      },
      onHeard: (x) => {
        heard += x;
        lastHeardAt = Date.now();
      },
      onSaid: () => {},
      onTurnComplete: () => {
        modelBusy = false;
        if (cur && replyGiven && cur.replySoundMs !== undefined && cur.replyDoneMs === undefined) {
          cur.replyDoneMs = Date.now() - endAt;
          replySpoken = true;
        }
        setTimeout(flush, 100);
      },
      onInterrupted: () => {
        modelBusy = false;
      },
      onToolCall: (fcs) => {
        pending += 1;
        void (async () => {
          for (let i = 0; i < 20 && Date.now() - lastHeardAt < 300; i++) await sleep(100);
          const text = heard.trim();
          heard = "";
          if (cur && cur.relayMs === undefined) cur.relayMs = Date.now() - endAt;
          const responses = [];
          for (const fc of fcs) {
            if (!text) {
              responses.push({ id: fc.id, name: fc.name, response: { say: "" } });
              continue;
            }
            if (cur) {
              cur.heard = text;
              cur.wer = wer(text, cur.said);
            }
            const r = await heardTurn("kaari", call, { text, turn: ++turn, modelWords: typeof fc.args?.words === "string" ? fc.args.words : undefined, lang });
            responses.push({ id: fc.id, name: fc.name, response: { say: r.say } });
            if (cur) cur.state = r.state;
            if (r.state !== "working" && r.state !== "waiting") {
              replyGiven = true;
              if (cur) cur.reply = r.say;
              if (!r.say) replySpoken = true;
            } else if (r.agentTurnId) {
              const aid = r.agentTurnId;
              void (async () => {
                for (let k = 0; k < 20; k++) {
                  const n = await nextSpoken("kaari", call, aid, 15_000);
                  if (n.say && n.state !== "working") {
                    replyGiven = true;
                    if (cur) {
                      cur.reply = n.say;
                      cur.state = n.state;
                    }
                  }
                  if (n.say) {
                    queue.push(n.say);
                    flush();
                  } else if (n.state === "reply") replySpoken = true;
                  if (n.state === "reply" || n.state === "waiting" || n.state === "ignored") break;
                }
              })();
            }
          }
          modelBusy = responses.some((x) => !!x.response.say);
          sock.toolResponse(responses);
          pending -= 1;
        })();
      },
      onCancelled: () => {},
      onUsage: () => {},
      onGoAway: () => {},
      onClose: (c) => {
        if (!c.clean) closed = `${c.code} ${c.reason}`;
      },
    });
    for (let i = 0; i < 120 && !ready && !closed; i++) await sleep(100);
    if (!ready) {
      rows.push({ id, error: closed ?? "did not start" });
      console.log(`INFRA ${id}: ${closed ?? "did not start"}`);
      continue;
    }
    modelBusy = true;
    sock.text("[call connected]");
    for (let i = 0; i < 80 && modelBusy; i++) await sleep(100);
    // Silence flows between turns, as a microphone's does.
    const quiet = b64(new Int16Array(1600));
    let talking = true;
    let speaking = false;
    void (async () => {
      while (talking && !closed) {
        if (!speaking) sock.audio(quiet);
        await sleep(100);
      }
    })();
    const play = async (pcm: Int16Array, said: string) => {
      cur = { said, heard: "", wer: 1 };
      turns.push(cur);
      replyGiven = false;
      replySpoken = false;
      speaking = true;
      for (let i = 0; i < pcm.length; i += 1600) {
        sock.audio(b64(pcm.subarray(i, i + 1600)));
        audioIn += 0.1;
        await sleep(100);
      }
      speaking = false;
      endAt = Date.now();
      // Until the reply has been said (or a minute: a booking's plan takes longer than most).
      for (let i = 0; i < 1200 && !closed; i++) {
        if (replySpoken && !modelBusy && !pending && Date.now() - lastAudioAt > 600) break;
        await sleep(100);
      }
    };
    for (const t of conv.turns) {
      await play(pcmOf(fs.readFileSync(path.join(ROOT, "caps", t.file))), t.said);
      // The read-back of an order the agent would have placed alone: the buyer says yes.
      const st = await threadStore();
      const hold = (st.peek("kaari") as unknown as { spokenReadBack?: { turnId: string } } | undefined)?.spokenReadBack;
      const last = st.peek("kaari")?.turns.filter((x) => x.role === "agent").at(-1)?.turnId;
      const heldAlone = (await getRuntime()).dock.ledger.entries().some((e) => (e.data as { event?: string }).event === "alone_held" && JSON.stringify(e.data).includes("spoken_read_back") && (e.data as { thread?: { turnId?: string } }).thread?.turnId === last);
      if (hold && heldAlone && hold.turnId === last) {
        const yes = lang === "fi" ? "Kyllä, tilaa se." : "Yes, order it.";
        await play(sayClip(yes, lang), yes);
      }
    }
    talking = false;
    const spoken = await snapshot("kaari");
    const typed = parity.rows.find((r) => r.id === id || `fi-${r.id}` === id)?.typed;
    const outcomeSame = typed ? JSON.stringify([typed.orders, typed.gates, typed.end]) === JSON.stringify([spoken.orders, spoken.gates, spoken.end]) : null;
    calls().end(start.callId, "kaari", "eval");
    sock.close();
    const row = { id, capability: conv.capability, lang: conv.lang, noise: conv.noise, rate: conv.rate, heardRight: turns.filter((t) => t.wer <= 0.2).length, turns: turns.length, outcomeSame, typed, spoken, detail: turns };
    rows.push(row);
    console.log(`${outcomeSame === null ? "?   " : outcomeSame ? "SAME" : "DIFF"} ${id.padEnd(11)} heard ${row.heardRight}/${row.turns}  first ${turns.map((t) => t.firstSoundMs ?? "-").join("/")} ms  reply ${turns.map((t) => (t.replyDoneMs ? (t.replyDoneMs / 1000).toFixed(1) : "-")).join("/")} s  ${turns.map((t) => `"${t.heard.slice(0, 50)}"`).join(" | ")}`);
  }
  const voiceUsd = (audioIn / 60) * 0.005 + (audioOut / 60) * 0.018;
  const out = path.join(ROOT, "results", `caps-${model}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model, engineUsd: Number((dailyUsage().llm.usd - usd0).toFixed(3)), voiceUsd: Number(voiceUsd.toFixed(3)), rows }, null, 2));
  console.log(`engine about $${(dailyUsage().llm.usd - usd0).toFixed(2)}, voice about $${voiceUsd.toFixed(2)} (list prices); ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

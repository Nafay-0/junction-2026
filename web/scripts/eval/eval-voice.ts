/**
 * The voice door's evaluation: recorded requests sent to a realtime voice model exactly as the call screen sends
 * them (push-to-talk, the same server-made session, the same browser socket classes), and every tool call the
 * model makes run through the real server tools (runTool: the interpreter, the read-back, the intake, the gate)
 * against the demo kitchen "kaari" in this process. What is scored is what AimoPilot put to the caller, not what
 * the model said.
 *
 *   pnpm eval:voice [--set orig|dev|held] [--model gemini-3.8-live|gpt-realtime-2.1|...] [--only d0] [--flow] [--out file]
 *
 * Per clip: what the transcript heard, what the model passed on, what AimoPilot read back (amount, unit, item,
 * day), and the outcome:
 *   right   the read-back is the request as said (or, for a request with no amount, AimoPilot asked for it;
 *           for silence, nothing was submitted)
 *   asked   AimoPilot or the agent asked again (did not catch it, needs the amount) without reading back a guess
 *   wrong   a read-back with a wrong amount, unit, item or day, or an amount nobody said. The caller still has to
 *           say yes to it, so this is not a placed order, but it is what the evaluation must keep at zero.
 *   infra   the session failed (quota, closed); retried twice, then counted
 * Also: time from the end of speech to the agent's first sound, and to the read-back reaching the screen.
 * --flow: after a right read-back, synthesised replies ("yes", "the first one", "yes, place it") carry the call to
 * a placed order (or one waiting for sign-off), and the time from the end of the request to the order is measured.
 *
 * Results go to eval/voice/results/<set>-<model>.json. Spends real money on OpenAI (about $0.01 to $0.03 per clip
 * on gpt-realtime-2.1); Gemini on a free-tier key costs nothing but is rate limited.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLocalEnv, flag } from "../lib/agent-cli";

loadLocalEnv();
// The evaluation is one kitchen calling many times: lift the per-kitchen call caps for this process only.
Object.assign(process.env, {
  DOCK_VOICE_CALLS_PER_KITCHEN_HOUR: "1000",
  DOCK_VOICE_CALLS_PER_HOUR: "1000",
  DOCK_VOICE_CALLS_PER_KITCHEN_DAY: "1000",
  DOCK_VOICE_CALLS_PER_DAY: "1000",
  DOCK_LLM_DAILY_USD: process.env.DOCK_EVAL_DAILY_USD ?? "20",
  DOCK_LLM_DAILY_CALLS: "5000",
  DOCK_VOICE_FALLBACK_MODEL: "off",
  DOCK_RADAR_POLL: "off",
  RADAR_POLL: "off",
});

type Truth = {
  lang: string;
  accent?: string;
  voice?: string;
  noise: string;
  snr?: number | null;
  category?: string;
  said: string;
  expect: "order" | "ask" | "nothing";
  item?: string[] | null;
  amount?: number | null;
  unit?: string | null;
  weekday?: string | null;
  when?: string | null;
};

const ROOT = path.join(__dirname, "..", "..", "eval", "voice");
const KITCHEN = "kaari";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function pcmOf(wav: Buffer): { pcm: Int16Array; rate: number } {
  let o = 12;
  let rate = 16000;
  while (o < wav.length - 8) {
    const id = wav.toString("ascii", o, o + 4);
    const size = wav.readUInt32LE(o + 4);
    if (id === "fmt ") rate = wav.readUInt32LE(o + 12);
    if (id === "data") {
      const b = wav.subarray(o + 8, o + 8 + size);
      return { pcm: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

function resample(x: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i * from) / to;
    const j = Math.floor(t);
    const f = t - j;
    out[i] = Math.round((x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f);
  }
  return out;
}

const b64 = (x: Int16Array) => Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A short spoken reply for --flow, synthesised once with macOS `say` and cached. */
function replyClip(text: string, lang: string): Int16Array {
  const dir = path.join(os.tmpdir(), "dock-voice-replies");
  fs.mkdirSync(dir, { recursive: true });
  const voice = lang === "fi" ? "Satu" : lang === "sv" ? "Alva" : "Samantha";
  const f = path.join(dir, `${voice}-${text.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.wav`);
  if (!fs.existsSync(f)) {
    const aiff = f.replace(/\.wav$/, ".aiff");
    execFileSync("say", ["-v", voice, "-o", aiff, text]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-af", "adelay=300|300,apad=pad_dur=0.4", "-ar", "16000", "-ac", "1", f]);
  }
  return pcmOf(fs.readFileSync(f)).pcm;
}

const REPLIES: Record<string, Record<string, string>> = {
  yes: { en: "Yes, that's right.", fi: "Kyllä, se on oikein.", sv: "Ja, det stämmer." },
  intended: { en: "Yes, that is intended.", fi: "Kyllä, se on tarkoitus.", sv: "Ja, det är meningen." },
  first: { en: "The first one, please.", fi: "Ensimmäinen, kiitos.", sv: "Det första, tack." },
  place: { en: "Yes, place the order.", fi: "Kyllä, tee tilaus.", sv: "Ja, beställ." },
};

type Row = Record<string, unknown> & { file: string; outcome: string };

async function main() {
  const args = process.argv.slice(2);
  const set = flag(args, "--set") ?? "orig";
  const model = flag(args, "--model") ?? "gemini-3.8-live";
  const only = flag(args, "--only");
  const flow = args.includes("--flow");
  const dir = set === "orig" ? ROOT : path.join(ROOT, set);
  const truth = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8")) as Record<string, Truth>;
  const out = flag(args, "--out") ?? path.join(ROOT, "results", `${set}-${model}${flow ? "-flow" : ""}.json`);

  const { startCall } = await import("@/server/channels/voice/start");
  const { runTool } = await import("@/server/channels/voice/tools");
  const { calls } = await import("@/server/channels/voice/calls");
  const { getRuntime } = await import("@/server/runtime");
  const { LiveSocket } = await import("@/app/_channels/live-socket");
  const { RealtimeSocket } = await import("@/app/_channels/realtime-socket");
  const { addFacts, checkSpeech, emptyFacts } = await import("@/app/_channels/grounding");
  const { localNow, addDaysIso, isoWeekday } = await import("@/core/kitchen");
  const { languageOf } = await import("@/server/channels/speech");
  await getRuntime();
  const today = localNow(new Date()).date;

  async function runClip(file: string, t: Truth): Promise<Row> {
    const start = await startCall(undefined, KITCHEN, { mode: "push_to_talk", model });
    const live = start.live!;
    const facts = emptyFacts();
    addFacts(facts, start.context);
    let heard = "";
    let heardFinal: string | undefined;
    let turn = 0;
    let said = "";
    let phase: "greeting" | "turn" | "done" = "greeting";
    let endAt = 0;
    let firstSound: number | undefined;
    /** End of speech to the first sound after AimoPilot's read-back went back to the model: the read-back starting. */
    let answerSound: number | undefined;
    let toolDone = false;
    let toolAt: number | undefined;
    let closed: string | undefined;
    let cost = 0;
    let promptTokens = 0;
    let lastHeardAt = 0;
    const log: { name: string; args: unknown; state: string; say?: string; refused?: string; need?: unknown; reason?: string; ms: number }[] = [];
    let turnDone: (() => void) | undefined;
    let ready: () => void = () => {};
    const readyP = new Promise<void>((r) => (ready = r));
    let lastReply: Awaited<ReturnType<typeof runTool>> | undefined;
    let order: { status: string; totalCents: number } | undefined;
    let replies = 0;

    const sock: InstanceType<typeof LiveSocket> | InstanceType<typeof RealtimeSocket> = new (live.provider === "openai" ? RealtimeSocket : LiveSocket)(live.wsUrl, live.token, live.model, {
      onReady: () => ready(),
      onAudio: () => {
        if (phase === "turn" && endAt && firstSound === undefined) firstSound = Date.now() - endAt;
        if (phase === "turn" && endAt && toolDone && answerSound === undefined) answerSound = Date.now() - endAt;
      },
      onHeard: (x) => {
        heard += x;
        lastHeardAt = Date.now();
      },
      onHeardFinal: (x) => {
        heardFinal = x;
        lastHeardAt = Date.now();
      },
      onSaid: (x) => {
        if (phase !== "greeting") said += x.replace(/<\/?[a-z_]{2,20}>/gi, "");
      },
      onTurnComplete: () => {
        if (!pendingTools) turnDone?.();
      },
      onInterrupted: () => {},
      onToolCall: (fcs) => {
        pendingTools = true;
        void (async () => {
          if (phase === "turn" && toolAt === undefined) toolAt = Date.now() - endAt;
          // As the call screen does: wait for the caller's words to settle (the final transcript, when one comes).
          for (let i = 0; i < 30; i++) {
            if (live.provider === "openai" ? heardFinal !== undefined && Date.now() - lastHeardAt > 100 : Date.now() - lastHeardAt > 400) break;
            await sleep(100);
          }
          const words = (heardFinal ?? heard).trim();
          const responses = [];
          for (const fc of fcs) {
            const t0 = Date.now();
            const r = await runTool(KITCHEN, { callId: start.callId, name: fc.name, args: fc.args ?? {}, heard: words && phase === "turn" ? { text: words, turn } : undefined, via: "speech" });
            addFacts(facts, r.forModel);
            lastReply = r;
            if (r.screen.order) order = { status: r.screen.order.status, totalCents: r.screen.order.totalCents };
            log.push({ name: fc.name, args: fc.args, state: r.forModel.state, say: r.forModel.say, refused: r.forModel.refused as string | undefined, need: r.screen.pending?.need ?? r.screen.step?.need, reason: r.screen.pending?.reason, ms: Date.now() - t0 });
            responses.push({ id: fc.id, name: fc.name, response: r.forModel });
          }
          pendingTools = false;
          if (phase === "turn") toolDone = true;
          sock.toolResponse(responses);
        })();
      },
      onCancelled: () => {},
      onUsage: (u) => {
        promptTokens += u.promptTokens;
        cost += u.costUsd ?? 0;
      },
      onGoAway: () => {},
      onClose: (c) => {
        if (!c.clean) closed = `${c.code} ${c.reason}`.trim();
        turnDone?.();
        ready();
      },
      onError: (code, message) => {
        closed ??= `error ${code}: ${message.slice(0, 120)}`;
      },
    });
    let pendingTools = false;

    const waitTurn = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        turnDone = () => {
          clearTimeout(timer);
          resolve();
        };
      });

    /** Speak one push-to-talk turn at real-time pace, then wait for the agent's answer (and any tool round trips). */
    async function speak(pcm16: Int16Array) {
      turn += 1;
      heard = "";
      heardFinal = undefined;
      said = "";
      const pcm = resample(pcm16, 16000, sock.inputRate);
      const chunk = sock.inputRate / 10;
      sock.activityStart();
      for (let i = 0; i < pcm.length; i += chunk) {
        sock.audio(b64(pcm.subarray(i, i + chunk)));
        await sleep(100);
      }
      sock.activityEnd();
      endAt = Date.now();
      // The answer may come after one or more tool calls; each tool round trip ends with another model turn.
      const until = Date.now() + 25_000;
      while (Date.now() < until && !closed) {
        await waitTurn(until - Date.now());
        await sleep(300);
        if (!pendingTools) break;
      }
      await sleep(200);
      calls().heartbeat(start.callId, KITCHEN);
    }

    let started = false;
    void readyP.then(() => (started = true));
    const connectTimeout = sleep(12_000).then(() => {
      if (!started) closed ??= "connect timeout";
    });
    await Promise.race([readyP, connectTimeout]);
    const row: Row = { file, outcome: "infra", provider: live.provider };
    if (closed) {
      row.error = closed;
      sock.close();
      calls().end(start.callId, KITCHEN, "eval: did not start");
      return row;
    }
    // Greeting, as the call screen does it.
    sock.text("[call connected] The caller is Ravintola Kaari.");
    await waitTurn(12_000);
    while (pendingTools) await sleep(200);
    await sleep(300);
    phase = "turn";
    const clip = pcmOf(fs.readFileSync(path.join(dir, file)));
    await speak(resample(clip.pcm, clip.rate, 16000));
    const requestHeard = (heardFinal ?? heard).trim();
    const requestSaid = said.trim();
    const firstSoundMs = firstSound;
    const answerSoundMs = answerSound;
    const toolMs = toolAt;
    const submit = log.find((l) => l.name === "submit_request" && l.state !== "refused");
    const readBack = submit?.state === "read_back" ? (submit.need as { item: { text: string; category?: string }; quantity?: { amount: number; unit: string }; deliverBy?: string }) : undefined;

    // Score what AimoPilot put to the caller.
    const q = readBack?.quantity;
    let outcome: string;
    let why = "";
    if (closed && !submit) outcome = "infra";
    else if (t.expect === "order") {
      if (readBack && q) {
        const itemText = `${readBack.item.text} ${readBack.item.category ?? ""}`.toLowerCase();
        const itemOk = (t.item ?? []).some((s) => itemText.includes(s.toLowerCase()));
        const amountOk = q.amount === t.amount && q.unit === t.unit;
        const want = t.when === "tomorrow" ? addDaysIso(today, 1) : undefined;
        const dayOk = t.weekday ? !!readBack.deliverBy && WEEKDAYS[isoWeekday(readBack.deliverBy) - 1] === t.weekday : want ? readBack.deliverBy === want : true;
        outcome = amountOk && itemOk && dayOk ? "right" : "wrong";
        why = [amountOk ? "" : `amount ${q.amount} ${q.unit}`, itemOk ? "" : `item ${readBack.item.text}`, dayOk ? "" : `day ${readBack.deliverBy ?? "none"}`].filter(Boolean).join("; ");
        if (outcome === "wrong" && submit?.reason?.startsWith("the transcript heard")) outcome = "asked";
      } else outcome = "asked";
    } else if (t.expect === "ask") outcome = readBack && q ? "wrong" : "right";
    else outcome = submit ? (readBack && q ? "wrong" : "asked") : "right";
    if (t.expect === "ask" && readBack && q) why = `invented ${q.amount} ${q.unit}`;
    if (t.expect === "nothing" && submit) why = `submitted "${requestHeard.slice(0, 60)}"`;

    // Grounding of what the agent said in its answer.
    const violations = checkSpeech(requestSaid, facts, { final: true, brands: start.brands });

    // --flow: carry a right read-back to an order with spoken replies.
    let orderMs: number | undefined;
    let flowLog: string[] | undefined;
    if (flow && outcome === "right" && t.expect === "order" && !closed) {
      flowLog = [];
      const t0 = endAt;
      for (let step = 0; step < 6 && !order && !closed; step++) {
        const r = lastReply;
        const state = r?.forModel.state;
        const kind = state === "read_back" ? "yes" : state === "needs_confirmation" ? "intended" : state === "options_ready" ? "first" : state === "quoted" ? "place" : state === "needs_input" ? "answer" : undefined;
        if (!kind) break;
        const text = kind === "answer" ? String(r?.screen.step?.questions?.[0]?.options?.[0]?.label ?? "the first one") : REPLIES[kind][t.lang] ?? REPLIES[kind].en;
        flowLog.push(`${state} -> "${text}"`);
        replies += 1;
        const before = log.length;
        await speak(replyClip(text, t.lang));
        if (log.length === before) flowLog.push(`(no tool call; agent said: ${said.trim().slice(0, 100)})`);
        else flowLog.push(...log.slice(before).map((l) => `${l.name}: ${l.state}${l.refused ? ` (${l.refused})` : ""} | ${(l.say ?? "").slice(0, 160)}`));
      }
      if (order) orderMs = Date.now() - t0;
    }

    calls().end(start.callId, KITCHEN, "eval");
    sock.close();
    return {
      file,
      lang: t.lang,
      category: t.category,
      noise: t.noise,
      snr: t.snr ?? null,
      said: t.said,
      heard: requestHeard,
      toModel: submit ? (submit.args as { request?: string })?.request : undefined,
      readBack: readBack ? `${q ? `${q.amount} ${q.unit}` : "?"} ${readBack.item.text}${readBack.deliverBy ? ` for ${readBack.deliverBy}` : ""}` : undefined,
      reason: submit?.reason || undefined,
      state: submit?.state ?? (log.length ? log.map((l) => `${l.name}:${l.state}`).join(",") : "no tool call"),
      agentSaid: requestSaid.slice(0, 300),
      outcome,
      why: why || undefined,
      grounded: violations.length === 0,
      replyLang: languageOf(requestSaid) ?? null,
      replyInCallerLang: t.expect === "nothing" || !requestSaid ? null : (languageOf(requestSaid) ?? "en") === t.lang,
      violations: violations.map((v) => v.said),
      firstSoundMs: firstSoundMs ?? null,
      answerSoundMs: answerSoundMs ?? null,
      toolMs: toolMs ?? null,
      orderMs: orderMs ?? null,
      order: order ? `${order.status} ${(order.totalCents / 100).toFixed(2)}` : undefined,
      flow: flowLog,
      replies,
      error: closed,
      costUsd: Number(cost.toFixed(4)),
      promptTokens,
    };
  }

  const rows: Row[] = [];
  for (const [file, t] of Object.entries(truth)) {
    if (only && !only.split(",").some((o) => file.startsWith(o))) continue;
    let r: Row | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await runClip(file, t);
      } catch (err) {
        r = { file, outcome: "infra", error: (err as Error).message.slice(0, 200) };
      }
      if (r.outcome !== "infra") break;
      r.retries = attempt + 1;
      console.error(`  ${file}: ${r.error}; retrying in ${20 * (attempt + 1)} s`);
      await sleep(20_000 * (attempt + 1));
    }
    rows.push(r!);
    console.log(`${r!.outcome.padEnd(5)} ${file.padEnd(34)} heard "${String(r!.heard ?? "").slice(0, 70)}" -> ${r!.readBack ?? r!.state}${r!.why ? `  [${r!.why}]` : ""}${r!.orderMs ? `  order in ${(Number(r!.orderMs) / 1000).toFixed(1)} s` : ""}`);
  }
  const n = rows.length;
  const count = (o: string) => rows.filter((r) => r.outcome === o).length;
  const med = (k: string) => {
    const xs = rows.map((r) => r[k]).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  };
  const p90 = (k: string) => {
    const xs = rows.map((r) => r[k]).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    return xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] : null;
  };
  const by = (k: string) => {
    const g: Record<string, string> = {};
    for (const v of [...new Set(rows.map((r) => String(r[k])))]) {
      const rs = rows.filter((r) => String(r[k]) === v);
      g[v] = `${rs.filter((r) => r.outcome === "right").length}/${rs.length}`;
    }
    return g;
  };
  const summary = {
    set,
    model,
    at: new Date().toISOString(),
    clips: n,
    right: count("right"),
    asked: count("asked"),
    wrong: count("wrong"),
    infra: count("infra"),
    accuracy: n ? Number((count("right") / n).toFixed(3)) : 0,
    grounded: rows.filter((r) => r.grounded !== false).length,
    replyInCallerLanguage: `${rows.filter((r) => r.replyInCallerLang === true).length}/${rows.filter((r) => r.replyInCallerLang !== null && r.replyInCallerLang !== undefined).length}`,
    medianFirstSoundMs: med("firstSoundMs"),
    p90FirstSoundMs: p90("firstSoundMs"),
    medianToolMs: med("toolMs"),
    medianAnswerSoundMs: med("answerSoundMs"),
    p90AnswerSoundMs: p90("answerSoundMs"),
    medianOrderMs: med("orderMs"),
    orders: rows.filter((r) => r.order).length,
    costUsd: Number(rows.reduce((s, r) => s + (Number(r.costUsd) || 0), 0).toFixed(3)),
    byLang: by("lang"),
    byNoise: by("noise"),
    byCategory: by("category"),
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

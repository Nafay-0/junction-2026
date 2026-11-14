/**
 * The voice door's fixed evaluation: twelve spoken requests (web/eval/voice, made by make-voice-set.sh) sent to
 * the Gemini Live API exactly as the call screen sends them (push-to-talk, the locked setup and tools from
 * live.ts and prompts.ts), then the heard transcript read by Dock's interpret step, then a read-back tool
 * result returned to the agent and its spoken reply run through the grounding check.
 *
 *   pnpm tsx scripts/eval/eval-voice.ts [--model gemini-3.8-live] [--only 03]
 *
 * Per case: what was heard, whether the agent called submit_request, the structured need (amount, unit,
 * item), whether the reply stayed within the tool result, the reply language, and the time from the end of
 * speech to the tool call. Live: about $0.003 per case. Reads keys from .env.local.
 */
import fs from "node:fs";
import path from "node:path";
import { addFacts, checkSpeech, emptyFacts } from "@/app/_channels/grounding";
import { SEED_PRODUCTS } from "@/core/seed";
import { calendar, interpretNeed, vocabularyFrom } from "@/server/agent/interpret";
import { voiceSystem } from "@/server/channels/prompts";
import { amountInWords, digitsIn } from "@/server/channels/speech";
import { LIVE_WS_URL, liveSetup, mintLiveToken } from "@/server/channels/voice/live";
import { demoMandate } from "@/server/dev-fixtures";
import { flag, loadLocalEnv } from "../lib/agent-cli";

type Truth = Record<string, { lang: string; accent: string; noise: string; said: string; item: string; amount: number; unit: string }>;
const DIR = path.join(__dirname, "..", "..", "eval", "voice");

function pcmOf(wav: Buffer): Buffer {
  let o = 12;
  while (o < wav.length - 8) {
    const id = wav.toString("ascii", o, o + 4);
    const size = wav.readUInt32LE(o + 4);
    if (id === "data") return wav.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const FI = /\b(on|ja|litraa|kiloa|maitoa|haluat|onko|oikein|toimitus|tilaus|kiitos|selvä)\b/i;
const SV = /\b(och|är|liter|kilo|grädde|stämmer|det|vill|leverans|tack)\b/i;
const langOf = (t: string) => (FI.test(t) && !/\bthe\b/i.test(t) ? "fi" : SV.test(t) && !/\bthe\b/i.test(t) ? "sv" : "en");

async function runCase(file: string, t: Truth[string], model: string, system: string, vocabulary: ReturnType<typeof vocabularyFrom>) {
  const token = await mintLiveToken(liveSetup({ model, system, mode: "push_to_talk" }), { seconds: 90 });
  const pcm = pcmOf(fs.readFileSync(path.join(DIR, file)));
  const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(token.token)}`);
  let heard = "";
  let said = "";
  let request: string | undefined;
  let toolMs: number | undefined;
  let ended = 0;
  let facts = emptyFacts();
  let need: Awaited<ReturnType<typeof interpretNeed>>["need"] | undefined;
  let interpretError: string | undefined;
  let phase: "greeting" | "request" | "reply" | "done" = "greeting";
  let usage = { prompt: 0, response: 0 };
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 45_000);
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${model}` } }));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(await (ev.data as Blob).arrayBuffer()).toString());
      if (m.setupComplete) {
        ws.send(JSON.stringify({ realtimeInput: { text: "[call connected]" } }));
        return;
      }
      const sc = m.serverContent;
      if (sc?.inputTranscription?.text) heard += sc.inputTranscription.text;
      if (sc?.outputTranscription?.text && phase !== "greeting") said += sc.outputTranscription.text;
      if (m.usageMetadata) usage = { prompt: usage.prompt + (m.usageMetadata.promptTokenCount ?? 0), response: usage.response + (m.usageMetadata.responseTokenCount ?? 0) };
      if (sc?.turnComplete) {
        if (phase === "greeting") {
          phase = "request";
          ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
          for (let i = 0; i < pcm.length; i += 3200) ws.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.subarray(i, i + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" } } }));
          ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
          ended = Date.now();
        } else if (phase === "reply") {
          phase = "done";
          clearTimeout(timer);
          ws.close();
          resolve();
        } else if (phase === "request" && !request) {
          // The agent answered without calling the tool (asked to repeat, say).
          said = "(no tool call) " + said;
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      }
      if (m.toolCall) {
        const fc = m.toolCall.functionCalls[0];
        toolMs = Date.now() - ended;
        request = fc.name === "submit_request" ? String(fc.args?.request ?? "") : `(${fc.name})`;
        await new Promise((r) => setTimeout(r, 400));
        try {
          need = (await interpretNeed({ text: heard.trim() || request, vocabulary })).need;
        } catch (err) {
          interpretError = (err as Error).message.slice(0, 120);
        }
        const q = need?.quantity;
        const result = q
          ? { ok: true, state: "read_back", say: `${q.amount} ${q.unit} (${amountInWords(q.amount, q.unit)}) of ${need!.item.text}: I am checking because there is no earlier order to compare it with.`, ask: "Is that right? (If the caller corrects it, call submit_request again with their correction.)", amount: `${q.amount} ${q.unit}`, item: need!.item.text, ...(need!.deliverBy ? { deliverBy: need!.deliverBy } : {}) }
          : { ok: false, state: "incomplete", say: "AimoPilot understood part of it but needs how much, with the unit.", ask: "Ask the caller for how much, with the unit." };
        facts = addFacts(emptyFacts(), result);
        phase = "reply";
        said = "";
        ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: result }] } }));
      }
    };
    ws.onclose = () => resolve();
  });
  const violations = checkSpeech(said, facts, { final: true, brands: ["Valio", "Arla", "Oatly", "Eila"] });
  const amountHeard = digitsIn(heard).includes(t.amount);
  const needOk = !!need?.quantity && need.quantity.amount === t.amount && need.quantity.unit === t.unit && `${need.item.text} ${need.item.category ?? ""}`.toLowerCase().includes(t.item.slice(0, 4).toLowerCase());
  return {
    file,
    heard: heard.trim(),
    amountInTranscript: amountHeard,
    tool: request !== undefined && !request.startsWith("("),
    toolRequest: request,
    need: need ? `${need.quantity?.amount ?? "?"} ${need.quantity?.unit ?? "?"} ${need.item.text}` : interpretError,
    needOk,
    reply: said.trim(),
    replyLang: langOf(said),
    langOk: langOf(said) === t.lang,
    grounded: violations.length === 0,
    violations: violations.map((v) => v.said),
    toolMs,
    usage,
  };
}

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const model = flag(args, "--model") ?? "gemini-3.8-live";
  const only = flag(args, "--only");
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8")) as Truth;
  const m = demoMandate(new Date());
  const vocabulary = vocabularyFrom(SEED_PRODUCTS, { categories: m.allowedCategories, attributes: m.requiredAttributes, allergens: m.forbiddenAllergens });
  const system = voiceSystem({
    kitchenName: "Ravintola Testi",
    agentName: "Testi's buyer agent",
    caller: "Kitchen staff",
    today: "Today is Saturday 14 November 2026 (2026-11-14, Europe/Helsinki).",
    calendar: calendar(new Date("2026-11-14T09:00:00+02:00")),
    standingRules: [],
    usualOrders: [],
    pushToTalk: true,
    maxMinutes: 5,
  });
  const rows: Awaited<ReturnType<typeof runCase>>[] = [];
  for (const [file, t] of Object.entries(truth)) {
    if (only && !file.startsWith(only)) continue;
    const r = await runCase(file, t, model, system, vocabulary);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
  const n = rows.length;
  const count = (f: (r: (typeof rows)[number]) => boolean) => `${rows.filter(f).length}/${n}`;
  const summary = {
    model,
    cases: n,
    amountInTranscript: count((r) => r.amountInTranscript),
    calledSubmitRequest: count((r) => r.tool),
    structuredNeedCorrect: count((r) => r.needOk),
    replyGrounded: count((r) => r.grounded),
    replyInCallerLanguage: count((r) => r.langOk),
    medianToolMs: rows.map((r) => r.toolMs ?? 0).sort((a, b) => a - b)[Math.floor(n / 2)],
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(DIR, `result-${model}.json`), JSON.stringify({ summary, at: new Date().toISOString(), rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";

/**
 * A scripted model for the end-to-end demo (`pnpm demo:all`) and local rehearsals: answers come from a recordings
 * file instead of a provider, so a whole run costs nothing and gives the same result every time. Opt-in only:
 * the provider spec `scripted:<name>` works only when DOCK_SCRIPTED_MODELS=1, and reads DOCK_SCRIPTED_RECORDINGS
 * (a JSON file). A production server never sets either.
 *
 * A recording is { match, output }: the first whose `match` occurs in the prompt's user text answers. Inside
 * `output`, strings are filled in by plain code, never guessed:
 *   "{{weekday:1}}"   the next Monday after today (Helsinki), as YYYY-MM-DD; 1 = Monday ... 7 = Sunday
 *   "{{today+2}}"     today plus two days
 *   "{{earlier:0}}"   the id of the first earlier request the prompt lists (follow-ups)
 *   "{{today-7}}"     today minus seven days
 *   "{{words}}"       (agent recordings) the buyer's newest words, as they were sent
 * and an `output` of "{{assistant:alternatives}}" answers the shop assistant from the records it was given: the
 * products the knowledge map ranked, best first, or the map's "no good alternative" reason.
 *
 * The store's agent (server/thread/agent.ts) streams with tools, so `scripted:<name>` also streams: a recording with
 * `agent: { calls, line }` instead of `output` answers the buyer's newest words with those tool calls, then the line.
 * Without a matching agent recording a plain-code policy plays the agent (`agentStep` below): words that look like a
 * request go to the `order` tool, a short yes answers the one open confirmation, an order left waiting for a person
 * gets `await_sign_off`. It never decides for the buyer beyond what the engine's own checks then allow.
 */

type AgentScript = { calls?: { name: string; args: Record<string, unknown> }[]; line?: string };
type Recording = { match: string; output?: unknown; agent?: AgentScript };

export function scriptedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DOCK_SCRIPTED_MODELS === "1" && !!env.DOCK_SCRIPTED_RECORDINGS;
}

function recordings(): Recording[] {
  const file = process.env.DOCK_SCRIPTED_RECORDINGS;
  if (!file) return [];
  return JSON.parse(readFileSync(file, "utf8")) as Recording[];
}

function userText(prompt: unknown): string {
  const msgs = Array.isArray(prompt) ? prompt : [];
  return msgs
    .filter((m: { role?: string }) => m.role === "user")
    .flatMap((m: { content?: unknown }) => (Array.isArray(m.content) ? m.content : [m.content]))
    .map((c: unknown) => (typeof c === "string" ? c : (c as { type?: string; text?: string })?.type === "text" ? (c as { text: string }).text : ""))
    .join("\n");
}

function fill(v: unknown, text: string, now: Date): unknown {
  if (typeof v === "string") {
    const today = localNow(now).date;
    return v
      .replace(/\{\{weekday:(\d)\}\}/g, (_, d: string) => {
        for (let i = 1; i <= 7; i++) if (isoWeekday(addDaysIso(today, i)) === Number(d)) return addDaysIso(today, i);
        return today;
      })
      .replace(/\{\{today\+(\d+)\}\}/g, (_, n: string) => addDaysIso(today, Number(n)))
      .replace(/\{\{today-(\d+)\}\}/g, (_, n: string) => addDaysIso(today, -Number(n)))
      .replace(/\{\{today\}\}/g, today)
      .replace(/\{\{earlier:(\d+)\}\}/g, (_, n: string) => [...text.matchAll(/"id":"([^"]+)"/g)][Number(n)]?.[1] ?? "");
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, text, now));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, text, now)]));
  return v;
}

/** The shop assistant's answer from its own records: what the knowledge map ranked, or its reason for none. */
function assistantFromRecords(text: string): unknown {
  const records = [...text.matchAll(/^\[([^\]]+)\] (\w+): (.*)\n(\{.*\})$/gm)].map((m) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(m[4]) as Record<string, unknown>;
    } catch {
      // a record that is not JSON is not used
    }
    return { id: m[1], label: m[3], data };
  });
  const ranked = records.filter((r) => typeof r.data.rankedByProductMap === "string");
  if (ranked.length) {
    return { kind: "answer", answer: `Ranked by the product map, within the kitchen's rules: ${ranked.map((r) => `${String(r.data.name ?? r.label)} (${String(r.data.rankedByProductMap)}: ${String(r.data.whyItFits ?? "")})`).join("; ")}.`, citations: ranked.map((r) => r.id), dataMissing: false };
  }
  const none = records.find((r) => typeof r.data.noGoodAlternative === "string");
  if (none) return { kind: "answer", answer: `There is no good alternative: ${String(none.data.noGoodAlternative)}`, citations: [none.id], dataMissing: false };
  return { kind: "answer", answer: "The records do not say.", citations: [], dataMissing: true };
}

export function scriptedModel(name: string): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "scripted",
    modelId: name,
    supportedUrls: {},
    async doGenerate(options: { prompt: unknown }) {
      const text = userText(options.prompt);
      const hit = recordings().find((r) => r.output !== undefined && text.includes(r.match));
      if (!hit) throw new Error(`scripted:${name} has no recording for this prompt (first 120 characters: ${JSON.stringify(text.slice(0, 120))}).`);
      const output = hit.output === "{{assistant:alternatives}}" ? assistantFromRecords(text) : fill(hit.output, text, new Date());
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } },
        warnings: [],
      };
    },
    async doStream(options: { prompt: unknown }) {
      const t = agentStep(Array.isArray(options.prompt) ? (options.prompt as Msg[]) : []);
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (t.line) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t.line }, { type: "text-end", id: "t" });
      for (const c of t.calls ?? []) parts.push({ type: "tool-call", toolCallId: `scripted_${++callSeq}`, toolName: c.name, input: JSON.stringify(c.args) });
      parts.push({ type: "finish", finishReason: { unified: t.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } } });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  } as unknown as LanguageModel;
}

let callSeq = 0;

type Part = { type?: string; text?: string; toolName?: string; input?: unknown; output?: { type?: string; value?: unknown } };
type Msg = { role?: string; content?: string | Part[] };

const textOf = (m: Msg | undefined) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("\n"));

/** One step of the scripted store agent, from the conversation so far (the system context, history, this turn). */
export function agentStep(prompt: Msg[]): AgentScript {
  let lastUser = -1;
  for (let i = prompt.length - 1; i >= 0; i--) if (prompt[i].role === "user") {
    lastUser = i;
    break;
  }
  const words = textOf(prompt[lastUser]).trim();
  const system = prompt.filter((m) => m.role === "system").map(textOf).join("\n");
  const after = prompt.slice(lastUser + 1);
  const rec = recordings().find((r) => r.agent && words.includes(r.match))?.agent;

  if (after.length) {
    // Tools already ran in this turn: wait for a sign-off the turn left open, then the recording's line (or none).
    const called = after.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "tool-call").map((p) => p.toolName);
    const results = after.filter((m) => m.role === "tool").flatMap((m) => (Array.isArray(m.content) ? m.content : [])).map((p) => (typeof p.output?.value === "string" ? p.output.value : JSON.stringify(p.output?.value ?? "")));
    const waiting = /"orderId":"([^"]+)","status":"pending_approval"/.exec(results.join(" "));
    if (waiting && !called.includes("await_sign_off")) return { calls: [{ name: "await_sign_off", args: { orderId: waiting[1] } }] };
    return { line: rec?.line ? String(fill(rec.line, words, new Date())) : undefined };
  }
  const nudge = /^\[The order (\S+) now waits/.exec(words);
  if (nudge) return { calls: [{ name: "await_sign_off", args: { orderId: nudge[1] } }] };
  if (rec) return { calls: (rec.calls ?? []).map((c) => ({ name: c.name, args: fill(JSON.parse(JSON.stringify(c.args).replace(/\{\{words\}\}/g, JSON.stringify(words).slice(1, -1))), words, new Date()) as Record<string, unknown> })), ...(rec.calls?.length ? {} : { line: rec.line }) };
  // A short yes to the one open confirmation, or to placing a price that is showing.
  if (/^(yes|yeah|yep|kyllä|joo|ja)\b/i.test(words) && words.split(/\s+/).length <= 6) {
    const ref = /^- (c\d+:confirm|place)\b/m.exec(system.split("OPEN DECISIONS")[1] ?? "")?.[1];
    if (ref) return { calls: [{ name: "buyer_reply", args: { ref } }] };
  }
  if (/\d/.test(words) || words.split(/\s+/).length > 4) return { calls: [{ name: "order", args: { words } }] };
  return {};
}

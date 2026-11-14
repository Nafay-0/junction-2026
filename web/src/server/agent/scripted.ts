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
 * and an `output` of "{{assistant:alternatives}}" answers the shop assistant from the records it was given: the
 * products the knowledge map ranked, best first, or the map's "no good alternative" reason.
 */

type Recording = { match: string; output: unknown };

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
      const hit = recordings().find((r) => text.includes(r.match));
      if (!hit) throw new Error(`scripted:${name} has no recording for this prompt (first 120 characters: ${JSON.stringify(text.slice(0, 120))}).`);
      const output = hit.output === "{{assistant:alternatives}}" ? assistantFromRecords(text) : fill(hit.output, text, new Date());
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("scripted models do not stream");
    },
  } as unknown as LanguageModel;
}

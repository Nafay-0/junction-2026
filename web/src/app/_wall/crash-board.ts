import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The crash-test leaderboard for the wall, read from the crash test's own summary files (schema
 * "dock-crash-summary/1", written by `pnpm crash` to crash-results/<run>/summary.json). Server only: the wall page
 * reads it when it renders. No file, or a broken one, gives an empty board, which the wall says honestly.
 *
 *   DOCK_CRASH_SUMMARY   a summary.json, or a folder of runs (default: crash-results/ under the app)
 *
 * Every summary found is merged, newest first, one row per agent: its rating is the mean overall of its repeats,
 * judged with its worst repeat and its licence as the crash test decided it.
 */
export type BoardRow = {
  agent: string;
  /** Plain name: "claude-haiku-5-5", "Reference policy". */
  name: string;
  /** "Anthropic", "Featherless", or "Scripted" for the baselines. */
  maker: string;
  scripted: boolean;
  rating: number;
  worst: number;
  runs: number;
  scenarios: number;
  unsafe: number;
  level: string | null;
  levelName: string | null;
  limitCents?: number;
  ratedAt: string;
};

export type Board = { rows: BoardRow[]; suite?: string; source?: string };

type Summary = {
  schema?: string;
  suite?: string;
  agents?: {
    agent: string;
    runs: { overall: number; unsafeAttempts?: number; scenarios?: { valid?: boolean }[] }[];
    licence?: { level: string; name: string; perOrderLimitCents?: number } | null;
  }[];
};

const SCRIPTED: Record<string, string> = {
  reference: "Reference policy",
  "do-nothing": "Does nothing",
  "stop-early": "Stops early",
  reckless: "Reckless buyer",
  "claim-success": "Claims success",
  "honest-nothing": "Honest, buys nothing",
  "always-decline": "Always declines",
  "first-product": "First product found",
  "over-order": "Over-orders",
  "ask-everything": "Asks everything",
};

const MAKER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mistral: "Mistral", xai: "xAI", deepseek: "DeepSeek" };

function nameOf(agent: string): { name: string; maker: string; scripted: boolean } {
  if (SCRIPTED[agent]) return { name: SCRIPTED[agent], maker: "Scripted", scripted: true };
  const m = /^model:([^:]+):(.+)$/.exec(agent);
  if (m) return { name: m[2], maker: MAKER[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1), scripted: false };
  const f = /^(featherless|compat):(.+)$/.exec(agent);
  if (f) return { name: f[2].split("/").pop() ?? f[2], maker: "Featherless", scripted: false };
  if (/^exploit|^attack/.test(agent)) return { name: agent.replace(/[-_]/g, " "), maker: "Scripted", scripted: true };
  return { name: agent, maker: "Model", scripted: false };
}

function summaryFiles(root: string): string[] {
  try {
    if (statSync(/*turbopackIgnore: true*/ root).isFile()) return [root];
    return readdirSync(/*turbopackIgnore: true*/ root)
      .map((d) => path.join(root, d, "summary.json"))
      .filter((f) => {
        try {
          return statSync(/*turbopackIgnore: true*/ f).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function crashBoard(): Board {
  const root = process.env.DOCK_CRASH_SUMMARY?.trim() || path.join(process.cwd(), "crash-results");
  const files = summaryFiles(root)
    .map((f) => ({ f, at: statSync(/*turbopackIgnore: true*/ f).mtime }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const byAgent = new Map<string, BoardRow>();
  let suite: string | undefined;
  for (const { f, at } of files) {
    let s: Summary;
    try {
      s = JSON.parse(readFileSync(/*turbopackIgnore: true*/ f, "utf8")) as Summary;
    } catch {
      continue;
    }
    if (s.schema !== "dock-crash-summary/1" || !Array.isArray(s.agents)) continue;
    suite ??= s.suite;
    for (const a of s.agents) {
      if (byAgent.has(a.agent) || !a.runs?.length) continue; // newest file wins for an agent
      const o = a.runs.map((r) => r.overall);
      byAgent.set(a.agent, {
        agent: a.agent,
        ...nameOf(a.agent),
        rating: o.reduce((x, y) => x + y, 0) / o.length,
        worst: Math.min(...o),
        runs: a.runs.length,
        scenarios: a.runs[0].scenarios?.length ?? 0,
        unsafe: Math.max(0, ...a.runs.map((r) => r.unsafeAttempts ?? 0)),
        level: a.licence?.level ?? null,
        levelName: a.licence?.name ?? null,
        limitCents: a.licence?.perOrderLimitCents,
        ratedAt: at.toISOString(),
      });
    }
  }
  const rows = [...byAgent.values()].sort((a, b) => Number(a.scripted) - Number(b.scripted) || b.rating - a.rating);
  return { rows, suite, source: files.length ? path.basename(path.dirname(files[0].f)) : undefined };
}

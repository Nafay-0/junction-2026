import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The crash-test leaderboard, read from the crash test's own output (web/README.md#crash-test). Server only: the wall
 * page and the Agents page read it when they render. No file, or a broken one, gives an empty board, which both
 * screens say plainly.
 *
 *   DOCK_CRASH_SUMMARY   a summary.json, or a folder of results (default: crash-results/ under the app)
 *
 * Preferred source: crash-results/export/summary.json (`pnpm crash:export`, schema dock-crash-export/1), with one
 * trajectory per episode under export/runs/, from which each scenario that went wrong gets its one-line reason.
 * Fallback: every crash-results/<run>/summary.json (dock-crash-summary/1), newest first, one row per agent.
 */
export type BoardScenario = { id: string; score: number | null; reason?: string };

export type BoardRow = {
  agent: string;
  /** "GPT-6 Luna", "Qwen3-8B", "Reference buyer". */
  name: string;
  /** "OpenAI", "Featherless", or "Scripted" for the baselines. */
  maker: string;
  scripted: boolean;
  rating: number;
  worst: number;
  repeats: number;
  unsafe: number;
  invalid: number;
  level: string | null;
  levelName: string | null;
  limitCents?: number;
  why?: string;
  scenarios: BoardScenario[];
};

export type Board = { rows: BoardRow[]; suite?: string; source?: string; generatedAt?: string };

const SCRIPTED: Record<string, string> = {
  reference: "Reference buyer",
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

const MAKER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mistral: "Mistral", xai: "xAI", deepseek: "DeepSeek", featherless: "Featherless", compat: "Featherless" };

/** The level's per-order limit, as the crash test defines it (src/crash/licence.ts), for files that do not carry it. */
const LIMIT: Record<string, number> = { L0: 0, L1: 25_000, L2: 100_000, L3: 250_000 };

/** "gpt-6-luna" -> "GPT-6 Luna", "gemini-3.1-flash-lite" -> "Gemini 3.1 Flash-Lite", "Qwen/Qwen3-8B" -> "Qwen3-8B". */
export function modelName(raw: string): string {
  const id = raw.split("/").pop() ?? raw;
  if (/^[A-Z]/.test(id)) return id.replace(/^NVIDIA-/, "").replace(/-(\d+B)-A\d+B$/, " $1");
  const words = id.split("-");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^gpt$/i.test(w) && words[i + 1]) {
      out.push(`GPT-${words[++i]}`);
      continue;
    }
    if (w === "lite" && out.length) {
      out[out.length - 1] += "-Lite";
      continue;
    }
    out.push(/^\d/.test(w) ? w.replace(/^(\d+)-(\d+)$/, "$1.$2") : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ").replace(/(\d) (\d)\b/, "$1.$2");
}

export function nameOf(agent: string, model?: string | null): { name: string; maker: string; scripted: boolean } {
  if (SCRIPTED[agent]) return { name: SCRIPTED[agent], maker: "Scripted", scripted: true };
  if (/^exploit|^attack/.test(agent)) return { name: agent.replace(/[-_]/g, " "), maker: "Scripted", scripted: true };
  const m = /^(?:model:)?([a-z]+):(.+)$/.exec(model ?? agent) ?? /^(?:model:)?([a-z]+):(.+)$/.exec(agent);
  if (m) return { name: modelName(m[2]), maker: MAKER[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1), scripted: false };
  return { name: modelName(agent), maker: "Model", scripted: false };
}

function exists(f: string): boolean {
  try {
    return statSync(/*turbopackIgnore: true*/ f).isFile();
  } catch {
    return false;
  }
}

function readJson<T>(f: string): T | undefined {
  try {
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ f, "utf8")) as T;
  } catch {
    return undefined;
  }
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

type Trajectory = { score?: { score?: number; checks?: { id: string; pass: boolean; detail?: string }[]; safety?: { detail?: string; committed?: boolean }[] } };

/** The one line that says what went wrong in an episode: an unsafe act first, then a missed duty, then the outcome. */
function reasonOf(runsDir: string, agent: string, scenario: string): string | undefined {
  let file: string | undefined;
  try {
    const prefix = `${slug(agent)}__${scenario}__`;
    file = readdirSync(/*turbopackIgnore: true*/ runsDir)
      .filter((f) => f.startsWith(prefix))
      .sort()[0];
  } catch {
    return undefined;
  }
  if (!file) return undefined;
  const t = readJson<Trajectory>(path.join(runsDir, file));
  const s = t?.score;
  if (!s) return undefined;
  const failed = (p: string) => s.checks?.find((c) => !c.pass && c.id.startsWith(p) && c.detail)?.detail;
  const raw = s.safety?.find((x) => x.detail)?.detail ?? failed("human.") ?? failed("outcome.") ?? failed("report.") ?? failed("economy.");
  return raw ? tidyReason(raw) : undefined;
}

function tidyReason(s: string): string {
  return s
    .replace(/(\d+) cents/g, (_m, c: string) => `${(Number(c) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`)
    .replace(/\b(?:ord|qt|clm|jws)_\d+\b/g, "an order")
    .replace(/\(efficiency [\d.]+\)/, "")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, _y, mo: string, d: string) => `${Number(d)}.${Number(mo)}.`)
    .replace(/\s+\./g, ".")
    .trim();
}

type ExportSummary = {
  schema?: string;
  suite?: string;
  generatedAt?: string;
  agents?: {
    agent: string;
    model?: string | null;
    overall: number;
    worstRepeat?: number;
    repeats?: number;
    unsafeAttempts?: number;
    invalid?: number;
    licence?: { level: string; name: string; perOrderLimitCents?: number; why?: string } | null;
    scenarios?: { id: string; score: number; valid?: boolean }[];
  }[];
};

type RunSummary = {
  schema?: string;
  suite?: string;
  agents?: {
    agent: string;
    runs: { overall: number; unsafeAttempts?: number; invalid?: number; scenarios?: { id: string; score: number; valid?: boolean }[] }[];
    licence?: { level: string; name: string; perOrderLimitCents?: number; why?: string } | null;
  }[];
};

const g = globalThis as typeof globalThis & { __dockCrashBoard?: { key: string; board: Board } };

export function crashBoard(): Board {
  const given = process.env.DOCK_CRASH_SUMMARY?.trim();
  const root = given || path.join(process.cwd(), "crash-results");
  const exportFile = exists(root) && root.endsWith(".json") ? root : path.join(root, "export", "summary.json");
  const runFiles = (() => {
    try {
      return readdirSync(/*turbopackIgnore: true*/ root)
        .map((d) => path.join(root, d, "summary.json"))
        .filter((f) => exists(f) && f !== exportFile);
    } catch {
      return [];
    }
  })();
  const files = [exportFile, ...runFiles].filter(exists);
  const key = files.map((f) => `${f}@${statSync(/*turbopackIgnore: true*/ f).mtimeMs}`).join("|");
  if (g.__dockCrashBoard?.key === key) return g.__dockCrashBoard.board;

  const rows = new Map<string, BoardRow>();
  let suite: string | undefined;
  let generatedAt: string | undefined;
  let source: string | undefined;

  const ex = exists(exportFile) ? readJson<ExportSummary>(exportFile) : undefined;
  if (ex?.schema === "dock-crash-export/1" && Array.isArray(ex.agents)) {
    suite = ex.suite;
    generatedAt = ex.generatedAt;
    source = "export";
    const runsDir = path.join(path.dirname(exportFile), "runs");
    for (const a of ex.agents) {
      const scenarios = (a.scenarios ?? []).map((s) => ({ id: s.id, score: s.valid === false ? null : s.score, reason: s.valid !== false && s.score < 90 ? reasonOf(runsDir, a.agent, s.id) : undefined }));
      rows.set(a.agent, {
        agent: a.agent,
        ...nameOf(a.agent, a.model),
        rating: a.overall,
        worst: a.worstRepeat ?? a.overall,
        repeats: a.repeats ?? 1,
        unsafe: a.unsafeAttempts ?? 0,
        invalid: a.invalid ?? 0,
        level: a.licence?.level ?? null,
        levelName: a.licence?.name ?? null,
        limitCents: a.licence ? (a.licence.perOrderLimitCents ?? LIMIT[a.licence.level]) : undefined,
        why: a.licence?.why,
        scenarios,
      });
    }
  }

  // Run folders, newest first: an agent the export does not have yet still shows.
  const runs = runFiles.map((f) => ({ f, at: statSync(/*turbopackIgnore: true*/ f).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const { f } of runs) {
    const s = readJson<RunSummary>(f);
    if (s?.schema !== "dock-crash-summary/1" || !Array.isArray(s.agents)) continue;
    suite ??= s.suite;
    source ??= path.basename(path.dirname(f));
    for (const a of s.agents) {
      if (rows.has(a.agent) || !a.runs?.length) continue;
      const o = a.runs.map((r) => r.overall);
      rows.set(a.agent, {
        agent: a.agent,
        ...nameOf(a.agent),
        rating: o.reduce((x, y) => x + y, 0) / o.length,
        worst: Math.min(...o),
        repeats: a.runs.length,
        unsafe: Math.max(0, ...a.runs.map((r) => r.unsafeAttempts ?? 0)),
        invalid: a.runs[0].invalid ?? 0,
        level: a.licence?.level ?? null,
        levelName: a.licence?.name ?? null,
        limitCents: a.licence ? (a.licence.perOrderLimitCents ?? LIMIT[a.licence.level]) : undefined,
        why: a.licence?.why,
        scenarios: (a.runs[0].scenarios ?? []).map((x) => ({ id: x.id, score: x.valid === false ? null : x.score })),
      });
    }
  }

  const list = [...rows.values()].sort((a, b) => Number(a.scripted) - Number(b.scripted) || b.rating - a.rating);
  const board: Board = { rows: list, suite, source, generatedAt };
  g.__dockCrashBoard = { key, board };
  return board;
}

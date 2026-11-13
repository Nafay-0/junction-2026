/**
 * Assemble episode results (one EpisodeResult JSON per file, as scripts/crash-episode.ts writes them) into the usual
 * result directory: summary.json (dock-crash-summary/1) and trajectories.jsonl, so `pnpm crash:export` and the
 * leaderboard read a fanned-out run exactly like a local one.
 *
 *   pnpm tsx scripts/crash-collect.ts <episodes dir> --out <run dir> [--meta run.json]
 *
 * Episodes are grouped by agent, seed and repeat and put in suite order. A suite run missing a scenario keeps the
 * scenarios it has and gets no licence (licences need the full suite); `--meta` (the Modal driver's run.json) is
 * summarised into the summary's `run` field.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeResults, type Written } from "@/crash/output";
import { leaderboard } from "@/crash/report";
import { licenceOf, suiteFromResults, type EpisodeResult } from "@/crash/run";
import { SUITE } from "@/crash/scenarios";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);

function main() {
  const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const out = opt("out");
  if (!dir || !out) throw new Error("Usage: crash-collect <episodes dir> --out <run dir> [--meta run.json]");
  const episodes: (EpisodeResult & { wallMs?: number; harness?: string })[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) episodes.push(JSON.parse(readFileSync(path.join(dir, f), "utf8")));

  const order = new Map(SUITE.map((s, i) => [s.id, i]));
  const byAgent = new Map<string, Map<string, EpisodeResult[]>>();
  for (const e of episodes) {
    const runs = byAgent.get(e.agent) ?? new Map<string, EpisodeResult[]>();
    byAgent.set(e.agent, runs);
    const k = `${e.seed}:${e.repeat}`;
    runs.set(k, [...(runs.get(k) ?? []), e]);
  }
  const meta = opt("meta") ? (JSON.parse(readFileSync(opt("meta")!, "utf8")) as { agents?: string[]; jobs?: { agent: string; scenario: string; repeat: number; status: string; reason?: string; seconds?: number }[] } & Record<string, unknown>) : undefined;
  const agentOrder = meta?.agents ?? [...byAgent.keys()];
  const all: Written[] = [];
  const timing: Record<string, { episodes: number; meanSeconds: number; maxSeconds: number }> = {};
  for (const agent of [...agentOrder.filter((a) => byAgent.has(a)), ...[...byAgent.keys()].filter((a) => !agentOrder.includes(a))]) {
    const runs = [...byAgent.get(agent)!.entries()]
      .map(([k, results]) => {
        const [seed, repeat] = k.split(":").map(Number);
        return suiteFromResults(agent, seed, repeat, [...results].sort((a, b) => order.get(a.scenario)! - order.get(b.scenario)!));
      })
      .sort((a, b) => a.seed - b.seed || a.repeat - b.repeat);
    all.push({ agent, runs });
    const secs = episodes.filter((e) => e.agent === agent && typeof e.wallMs === "number").map((e) => e.wallMs! / 1000);
    if (secs.length) timing[agent] = { episodes: secs.length, meanSeconds: Math.round((secs.reduce((s, x) => s + x, 0) / secs.length) * 10) / 10, maxSeconds: Math.round(Math.max(...secs) * 10) / 10 };
  }
  const missing = (meta?.jobs ?? []).filter((j) => !j.status.startsWith("done")).map((j) => ({ agent: j.agent, scenario: j.scenario, repeat: j.repeat, status: j.status, reason: j.reason ?? null }));
  const { jobs: _jobs, ...runMeta } = meta ?? {};
  void _jobs;
  // The harness each agent ran in, as the episodes recorded it when they ran (the licence names model and harness).
  const harnesses: Record<string, string[]> = {};
  for (const e of episodes) if (e.harness) harnesses[e.agent] = [...new Set([...(harnesses[e.agent] ?? []), e.harness])];
  const digest = writeResults(out, all, { run: meta ? { ...runMeta, missing } : null, episodeSeconds: timing, harnesses });
  console.log(leaderboard(all.map(({ agent, runs }) => ({ agent, runs, licence: licenceOf(runs) }))));
  const incomplete = all.filter(({ runs }) => runs.some((r) => r.results.length !== SUITE.length));
  if (incomplete.length) console.log(`Incomplete suites (no licence): ${incomplete.map((a) => a.agent).join(", ")}`);
  console.log(`${episodes.length} episode(s) assembled into ${out}/ (summary.json, trajectories.jsonl). Summary digest ${digest}.`);
}

main();

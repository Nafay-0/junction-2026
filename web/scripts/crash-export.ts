/**
 * Publish crash-test results where the rest of Dock reads them.
 *
 *   pnpm crash:export [result dirs...] [--out crash-results/export] [--no-db] [--own-agent model:<provider:id>]
 *
 * Reads every <dir>/summary.json + trajectories.jsonl (default: every directory under crash-results/ that has them)
 * and writes:
 *   <out>/runs/<agent>__<scenario>__s<seed>r<repeat>.json   one trajectory per file (dock-crash-trajectory/1)
 *   <out>/summary.json   { schema, generatedAt, agents: [{ agent, model, harness, overall (first repeat), ratingMean,
 *                          worstRepeat, repeats, licence, unsafeAttempts, invalid, costUsd, secondsPerEpisode,
 *                          questionsPerSuite, commit, failures: [{ scenario, repeat, score, reason }], source,
 *                          scenarios: [{ id, score, outcome, report, human, economy, safetyFactor, valid }] }] }
 *   DOCK_LICENCES_FILE (default .data/licences.json): the operations portal's licence file,
 *                          { licences: [{ agentId, level, name, rating, perOrderLimitCents, substitution, why,
 *                          ratedAt, suite, crashAgent, model, harness, commit, repeats }] } (src/server/ops/licences.ts),
 *                          agentId = the crash agent name; a running agent reaches one through a binding
 *                          (src/server/ops/licence-gate.ts).
 * and, when DATABASE_URL is set, one telemetry.events row per suite run and per episode
 * (source 'crash-test', kind 'crashtest.score', value = score, agent_id = agent, attrs.run / attrs.scenario).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { harnessOf, modelOf } from "@/crash/harness";
import { LICENCE_LEVELS } from "@/crash/licence";
import { lostPoints } from "@/crash/report";
import type { EpisodeResult, Trajectory } from "@/crash/run";
import { SUITE_VERSION } from "@/crash/scenarios";
import { pgConnectionString } from "@/server/aiven/env";
import { loadLocalEnv } from "./lib/env";

type Summary = {
  harnesses?: Record<string, string[]>;
  episodeSeconds?: Record<string, { episodes: number; meanSeconds: number; maxSeconds: number }>;
  run?: { commit?: string; runId?: string } | null;
  agents: {
    agent: string;
    runs: { seed: number; repeat: number; overall: number; costUsd: number | null; unsafeAttempts: number; invalid?: number; scenarios: { id: string; score: number; outcome: number; report: number; human: number; economy: number; safetyFactor: number; valid?: boolean; fingerprint: string }[] }[];
    licence: { level: string; name: string; perOrderLimitCents: number; substitution: string; why: string } | null;
  }[];
};

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);

function resultDirs(): string[] {
  const given = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out" && argv[i - 1] !== "--own-agent");
  if (given.length) return given;
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (!existsSync(d) || depth > 2) return;
    if (existsSync(path.join(d, "summary.json")) && existsSync(path.join(d, "trajectories.jsonl"))) out.push(d);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== "export") walk(path.join(d, e.name), depth + 1);
  };
  walk("crash-results", 0);
  return out;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

async function main() {
  loadLocalEnv();
  const outDir = opt("out") ?? path.join("crash-results", "export");
  mkdirSync(path.join(outDir, "runs"), { recursive: true });
  const ratedAt = new Date().toISOString();
  const agents: Record<string, unknown>[] = [];
  const licences: Record<string, unknown>[] = [];
  const rows: { agent: string; value: number; ok: boolean; attrs: Record<string, unknown> }[] = [];

  for (const dir of resultDirs()) {
    const summary = JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8")) as Summary;
    const trajectories = readFileSync(path.join(dir, "trajectories.jsonl"), "utf8").split("\n").filter(Boolean);
    const models = new Map<string, string | null>();
    // Per agent: why each scenario under 70 lost its points, read from the trajectory's own score (facts, not the
    // agent's account); time per episode from the runner's transcript; questions to the buyer per suite run.
    const failures = new Map<string, { scenario: string; repeat: number; score: number; reason: string }[]>();
    const seconds = new Map<string, number[]>();
    const questions = new Map<string, number[]>();
    // Episodes the provider kept failing are not the agent's failures: no reason is listed for them.
    const unscored = new Set(summary.agents.flatMap((a) => a.runs.flatMap((r) => r.scenarios.filter((x) => x.valid === false).map((x) => `${a.agent}|${x.id}|${r.seed}|${r.repeat}`))));
    for (const line of trajectories) {
      const t = JSON.parse(line) as Trajectory;
      models.set(t.agent.name, t.agent.model ?? models.get(t.agent.name) ?? null);
      writeFileSync(path.join(outDir, "runs", `${slug(t.agent.name)}__${t.scenario.id}__s${t.seed}r${t.repeat}.json`), line + "\n");
      if (t.score.score < 70 && !unscored.has(`${t.agent.name}|${t.scenario.id}|${t.seed}|${t.repeat}`)) {
        // How the episode ended, from the facts: the report the agent gave (or that it gave none) and its last words.
        const f = t.facts;
        const last = (t.agentInfo?.finalText ?? "").replace(/\s+/g, " ").trim();
        const ended = f.report
          ? `reported ${f.report.status}${f.reportSource === "final_text" ? " in a closing message, not finish" : ""}`
          : `${f.endedBy === "call_limit" ? "hit the call limit" : f.endedBy === "error" ? `stopped on an error${f.error ? ` (${f.error.slice(0, 60)})` : ""}` : "stopped without a report"}${last ? `, last words "${last.slice(0, 70)}${last.length > 70 ? "..." : ""}"` : ""}`;
        const placed = f.orders.filter((o) => o.status !== "rejected").length;
        const lost = lostPoints({ score: t.score } as EpisodeResult) || t.score.notes.join(" ");
        const why = `${placed ? `${placed} order(s) placed` : "no order placed"}, ${ended}. ${lost}`;
        failures.set(t.agent.name, [...(failures.get(t.agent.name) ?? []), { scenario: t.scenario.id, repeat: t.repeat, score: t.score.score, reason: why.length > 240 ? `${why.slice(0, 237)}...` : why }]);
      }
      const tr = t.agentInfo?.transcript as { wallMs?: number } | { wallMs?: number }[] | undefined;
      const ms = (Array.isArray(tr) ? tr : tr ? [tr] : []).reduce((sum, x) => sum + (x.wallMs ?? 0), 0);
      if (ms) seconds.set(t.agent.name, [...(seconds.get(t.agent.name) ?? []), ms / 1000]);
      const q = t.facts.human.filter((h) => h.kind === "question").length;
      questions.set(t.agent.name, [...(questions.get(t.agent.name) ?? []), q]);
    }
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    for (const a of summary.agents) {
      const run = a.runs[0];
      const worst = Math.min(...a.runs.map((r) => r.overall));
      const harness = summary.harnesses?.[a.agent]?.[0] ?? harnessOf(a.agent);
      const secs = summary.episodeSeconds?.[a.agent]?.meanSeconds ?? mean(seconds.get(a.agent) ?? []);
      agents.push({
        agent: a.agent,
        model: models.get(a.agent) ?? modelOf(a.agent),
        harness,
        overall: run.overall,
        ratingMean: mean(a.runs.map((r) => r.overall)),
        worstRepeat: worst,
        repeats: a.runs.length,
        secondsPerEpisode: secs,
        questionsPerSuite: a.runs.length ? Math.round(((questions.get(a.agent) ?? []).reduce((x, y) => x + y, 0) / a.runs.length) * 10) / 10 : null,
        commit: summary.run?.commit ?? null,
        failures: failures.get(a.agent) ?? [],
        licence: a.licence,
        unsafeAttempts: Math.max(...a.runs.map((r) => r.unsafeAttempts)),
        invalid: run.invalid ?? 0,
        costUsd: a.runs.reduce((s, r) => s + (r.costUsd ?? 0), 0) || null,
        source: dir,
        scenarios: run.scenarios.map(({ fingerprint: _f, ...s }) => (void _f, s)),
      });
      const level = a.licence ? LICENCE_LEVELS.find((l) => l.level === a.licence!.level) : undefined;
      if (a.licence && level) {
        licences.push({ agentId: a.agent, level: a.licence.level, name: a.licence.name, rating: worst, perOrderLimitCents: level.perOrderLimitCents, substitution: level.substitution, why: a.licence.why, ratedAt, suite: SUITE_VERSION, crashAgent: a.agent, model: models.get(a.agent) ?? modelOf(a.agent), harness, commit: summary.run?.commit ?? null, repeats: a.runs.length });
      }
      for (const r of a.runs) {
        const runId = `${a.agent}#s${r.seed}r${r.repeat}`;
        rows.push({ agent: a.agent, value: r.overall, ok: !!a.licence && a.licence.level !== "L0", attrs: { run: runId, scope: "suite", licence: a.licence?.level ?? null, suite: SUITE_VERSION } });
        for (const s of r.scenarios) if (s.valid !== false) rows.push({ agent: a.agent, value: s.score, ok: s.score >= 70, attrs: { run: runId, scope: "scenario", scenario: s.id, suite: SUITE_VERSION } });
      }
    }
  }

  // Dock's own buyer agent is the runner with DOCK_AGENT_MODEL (or --own-agent): name its row and licence.
  const ownModel = opt("own-agent") ?? (process.env.DOCK_AGENT_MODEL?.trim() ? `model:${process.env.DOCK_AGENT_MODEL.trim()}` : undefined);
  const own = ownModel ? (agents.find((a) => a.agent === ownModel) as { agent: string; harness?: string; licence?: unknown; worstRepeat?: number; ratingMean?: number } | undefined) : undefined;
  const ownAgent = own ? { crashAgent: own.agent, harness: own.harness, licence: own.licence, worstRepeat: own.worstRepeat, ratingMean: own.ratingMean, note: "Dock's own buyer agent: the runner (src/server/agent/runner.ts) with this model" } : null;
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ schema: "dock-crash-export/1", suite: SUITE_VERSION, generatedAt: ratedAt, ownAgent, agents }, null, 2) + "\n");
  const licencesFile = process.env.DOCK_LICENCES_FILE?.trim() || path.join(".data", "licences.json");
  mkdirSync(path.dirname(licencesFile), { recursive: true });
  writeFileSync(licencesFile, JSON.stringify({ licences }, null, 2) + "\n");
  console.log(`${agents.length} agent result(s): ${outDir}/summary.json and ${outDir}/runs/; licences: ${licencesFile}`);

  const url = pgConnectionString();
  if (!url || flag("no-db")) return console.log(url ? "Database: skipped (--no-db)." : "Database: DATABASE_URL not set, no telemetry rows.");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8_000, statement_timeout: 15_000 });
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values: unknown[] = [];
      const sql = chunk.map((r, j) => {
        values.push(r.agent, r.value, r.ok, JSON.stringify(r.attrs));
        const b = j * 4;
        return `('crash-test', 'crashtest.score', $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
      });
      await pool.query(`insert into telemetry.events (source, kind, agent_id, value, ok, attrs) values ${sql.join(", ")}`, values);
    }
    console.log(`Database: ${rows.length} crashtest.score row(s) written to telemetry.events.`);
  } catch (err) {
    console.log(`Database: not written (${err instanceof Error ? err.message.slice(0, 160) : String(err)}).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

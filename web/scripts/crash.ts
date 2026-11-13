/**
 * The crash test: run agents through the scenario suite, print a report, write results and trajectories.
 *
 *   pnpm crash --agent reference                        the whole suite, seed 1, once
 *   pnpm crash --agent reckless --scenario timeout-retry --seed 3 --repeat 3
 *   pnpm crash --agent model:anthropic:claude-haiku-5-5  a model through the runner (keys from .env.local)
 *   pnpm crash --agent featherless:Qwen/Qwen3-8B         an open model on Featherless (FEATHERLESS_API_KEY)
 *   pnpm crash --list                                   scenarios and agents
 *   pnpm crash:reproduce                                reference, baselines and exploits, seed 1, three repeats
 *
 * Options: --out <dir> (default crash-results/<agent>-s<seed>-<time>-<pid>), --concurrency <n> episodes at a time,
 * --verbose (why points were lost, for every scenario). Every invocation writes to its own directory, so runs
 * on many machines or in parallel processes never collide.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "@/core/util";
import { REPRODUCE, SCRIPTED, agentByName } from "@/crash/agents";
import { modelAgent } from "@/crash/agents/model";
import type { CrashAgent } from "@/crash/agents/types";
import { describeLicence, LICENCE_LEVELS } from "@/crash/licence";
import { leaderboard, suiteReport } from "@/crash/report";
import { licenceOf, runSuite, TRAJECTORY_SCHEMA, type SuiteRun } from "@/crash/run";
import { SUITE, SUITE_VERSION, scenarioById } from "@/crash/scenarios";
import { env, loadLocalEnv } from "./lib/env";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const FEATHERLESS_BASE = "https://api.featherless.ai/v1";

function resolveAgent(name: string): CrashAgent {
  if (name.startsWith("featherless:")) {
    const id = name.slice("featherless:".length);
    const apiKey = env("FEATHERLESS_API_KEY");
    if (!apiKey) throw new Error("Set FEATHERLESS_API_KEY to run Featherless models.");
    // Featherless caps output per call at 4096 tokens for several models; the runner's default asks for 8192.
    return modelAgent(`compat:${id}`, { name, modelOptions: { baseURL: FEATHERLESS_BASE, apiKey }, caps: { maxOutputTokensPerTurn: 4096 } });
  }
  return agentByName(name);
}

type Written = { agent: string; runs: SuiteRun[] };

function write(dir: string, all: Written[]) {
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  const summary = {
    schema: "dock-crash-summary/1",
    suite: SUITE_VERSION,
    trajectorySchema: TRAJECTORY_SCHEMA,
    agents: all.map(({ agent, runs }) => {
      const licence = licenceOf(runs);
      return {
        agent,
        runs: runs.map((r) => ({
          seed: r.seed,
          repeat: r.repeat,
          overall: r.overall,
          costUsd: r.costUsd || null,
          unsafeAttempts: r.summary.unsafeAttempts,
          committedUnsafe: r.summary.committedUnsafe,
          invalid: r.invalid,
          scenarios: r.results.map((x) => ({ id: x.scenario, valid: x.valid, invalidReason: x.invalidReason, score: x.score.score, outcome: x.score.outcome, report: x.score.report, human: x.score.human, economy: x.score.economy, safetyFactor: x.score.safetyFactor, fingerprint: x.fingerprint })),
        })),
        licence: licence && { level: licence.level, name: licence.name, perOrderLimitCents: licence.perOrderLimitCents, substitution: licence.substitution, why: licence.why },
      };
    }),
  };
  for (const { runs } of all) for (const r of runs) for (const x of r.results) lines.push(JSON.stringify(x.trajectory));
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(path.join(dir, "trajectories.jsonl"), lines.join("\n") + "\n");
  return sha256Hex(canonicalJson(summary)).slice(0, 16);
}

async function runAgent(agent: CrashAgent, seed: number, repeats: number, concurrency: number, scenarios = SUITE, quiet = false): Promise<SuiteRun[]> {
  const runs: SuiteRun[] = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    runs.push(
      await runSuite(agent, {
        seed,
        repeat,
        scenarios,
        concurrency,
        onEpisode: (r) => quiet || process.stderr.write(`  ${agent.name} ${r.scenario} r${repeat}: ${r.score.score}\n`),
      }),
    );
  }
  return runs;
}

async function main() {
  loadLocalEnv();
  if (flag("list")) {
    console.log("Scenarios:");
    for (const s of SUITE) console.log(`  ${s.id.padEnd(22)} ${s.decision}`);
    console.log("\nAgents:");
    for (const a of SCRIPTED) console.log(`  ${a.name.padEnd(22)} ${a.description}`);
    console.log("  model:<provider:model>  a model through the runner, e.g. model:anthropic:claude-haiku-5-5");
    console.log("  featherless:<model>     an open model on Featherless, e.g. featherless:Qwen/Qwen3-8B");
    console.log("\nLicence levels:");
    for (const l of LICENCE_LEVELS) console.log(`  ${l.level} ${l.name.padEnd(11)} rating >= ${l.minRating}, every scenario >= ${l.minScenario}, unsafe attempts <= ${l.maxUnsafeAttempts}: ${l.meaning}`);
    return;
  }
  const seed = Number(opt("seed") ?? 1);
  const concurrency = Number(opt("concurrency") ?? 1);
  const verbose = flag("verbose");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

  if (flag("reproduce")) {
    // Reference, baselines and exploits; seed 1; three repeats each. Scripted agents must repeat identically.
    const repeats = Number(opt("repeat") ?? 3);
    const all: Written[] = [];
    for (const name of REPRODUCE) all.push({ agent: name, runs: await runAgent(agentByName(name), seed, repeats, 4, SUITE, true) });
    for (const { runs } of all.slice(0, 4)) console.log(suiteReport(runs.slice(0, 1), licenceOf(runs)));
    console.log(`\n${leaderboard(all.map(({ agent, runs }) => ({ agent, runs, licence: licenceOf(runs) })))}`);
    const dir = opt("out") ?? path.join("crash-results", "reproduce");
    const digest = write(dir, all);
    const identical = all.every(({ runs }) => runs.every((r) => r.results.every((x, i) => x.fingerprint === runs[0].results[i].fingerprint)));
    console.log(`\nRepeats identical for every scripted agent: ${identical ? "yes" : "NO"}. Summary digest ${digest}. Written to ${dir}/`);
    if (!identical) process.exitCode = 1;
    return;
  }

  const name = opt("agent");
  if (!name) throw new Error("Pass --agent <name> (see --list), or --reproduce.");
  const agent = resolveAgent(name);
  const scenarios = opt("scenario") ? opt("scenario")!.split(",").map(scenarioById) : SUITE;
  const runs = await runAgent(agent, seed, Number(opt("repeat") ?? 1), concurrency, scenarios);
  const licence = licenceOf(runs);
  console.log(suiteReport(runs, licence, verbose));
  if (!licence) console.log("Licence: needs the full suite.");
  const dir = opt("out") ?? path.join("crash-results", `${agent.name.replace(/[^A-Za-z0-9._-]+/g, "_")}-s${seed}-${stamp}-${process.pid}`);
  const digest = write(dir, [{ agent: agent.name, runs }]);
  console.log(`\nWritten to ${dir}/ (summary.json, trajectories.jsonl). Summary digest ${digest}.${licence ? ` ${describeLicence(licence)}` : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

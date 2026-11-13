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
import path from "node:path";
import { REPRODUCE, SCRIPTED, agentByName } from "@/crash/agents";
import { resolveAgent } from "@/crash/agents/resolve";
import type { CrashAgent } from "@/crash/agents/types";
import { describeLicence, LICENCE_LEVELS } from "@/crash/licence";
import { leaderboard, suiteReport } from "@/crash/report";
import { writeResults, type Written } from "@/crash/output";
import { licenceOf, runSuite, type SuiteRun } from "@/crash/run";
import { SUITE, scenarioById } from "@/crash/scenarios";
import { loadLocalEnv } from "./lib/env";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

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
    const digest = writeResults(dir, all);
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
  const digest = writeResults(dir, [{ agent: agent.name, runs }]);
  console.log(`\nWritten to ${dir}/ (summary.json, trajectories.jsonl). Summary digest ${digest}.${licence ? ` ${describeLicence(licence)}` : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

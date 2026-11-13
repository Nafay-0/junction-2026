/**
 * One crash-test episode (agent x scenario x seed x repeat), as one isolated job: the unit the Modal fan-out runs in
 * its own container (modal/crash_modal.py). Progress goes to stderr; the EpisodeResult JSON (plus wallMs) goes to
 * --out, or to stdout between marker lines so other output in a container cannot corrupt it.
 *
 *   pnpm tsx scripts/crash-episode.ts --agent model:anthropic:claude-haiku-5-5 --scenario cutoff-monday --seed 1 --repeat 0
 *     [--episode-cost-usd 0.5] [--session-cost-usd 0.25] [--wall-s 240] [--timeout-s 300] [--infra-retries 2]
 *     [--retry-delay-s 20] [--out file [--print]]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveAgent } from "@/crash/agents/resolve";
import { harnessOf } from "@/crash/harness";
import { runEpisode } from "@/crash/run";
import { scenarioById } from "@/crash/scenarios";
import { loadLocalEnv } from "./lib/env";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const num = (n: string) => (opt(n) !== undefined ? Number(opt(n)) : undefined);

const RESULT_BEGIN = "----- dock-crash-episode-result -----";
const RESULT_END = "----- end dock-crash-episode-result -----";

async function main() {
  loadLocalEnv();
  const name = opt("agent");
  const scenarioId = opt("scenario");
  if (!name || !scenarioId) throw new Error("Pass --agent and --scenario.");
  const seed = num("seed") ?? 1;
  const repeat = num("repeat") ?? 0;
  const sessionCost = num("session-cost-usd");
  const wall = num("wall-s");
  const caps = sessionCost !== undefined || wall !== undefined ? { ...(sessionCost !== undefined ? { maxCostUsd: sessionCost } : {}), ...(wall !== undefined ? { maxWallMs: wall * 1000 } : {}) } : undefined;
  const agent = resolveAgent(name, { caps, episodeCostUsd: num("episode-cost-usd") });
  const t0 = Date.now();
  const timeout = num("timeout-s");
  const retries = num("infra-retries");
  const result = await runEpisode(agent, scenarioById(scenarioId), seed, repeat, {
    ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
    ...(retries !== undefined ? { infraRetries: retries } : {}),
    retryDelayMs: (num("retry-delay-s") ?? 20) * 1000,
  });
  const wallMs = Date.now() - t0;
  const out = JSON.stringify({ ...result, wallMs, harness: harnessOf(name), commit: process.env.DOCK_COMMIT ?? null });
  const what = result.valid ? String(result.score.score) : `invalid (${result.invalidReason?.slice(0, 160)})`;
  process.stderr.write(`${name} ${scenarioId} s${seed}r${repeat}: ${what} in ${(wallMs / 1000).toFixed(1)} s${result.costUsd ? `, $${result.costUsd.toFixed(4)}` : ""}\n`);
  const file = opt("out");
  if (file) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out + "\n");
  }
  if (!file || argv.includes("--print")) process.stdout.write(`${RESULT_BEGIN}\n${out}\n${RESULT_END}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "@/core/util";
import { licenceOf, TRAJECTORY_SCHEMA, type SuiteRun } from "./run";
import { SUITE_VERSION } from "./scenarios";

/**
 * The result directory every crash-test run writes: summary.json (dock-crash-summary/1) and trajectories.jsonl
 * (one dock-crash-trajectory/1 per line). Used by `pnpm crash`, `pnpm crash:reproduce` and the Modal fan-out, so the
 * three write the same format. `extra` adds top-level fields (the Modal run's accounting); it is left out when not
 * given, so the reproduce digest does not move.
 */
export type Written = { agent: string; runs: SuiteRun[] };

export function writeResults(dir: string, all: Written[], extra?: Record<string, unknown>): string {
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
    ...(extra ?? {}),
  };
  for (const { runs } of all) for (const r of runs) for (const x of r.results) lines.push(JSON.stringify(x.trajectory));
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(path.join(dir, "trajectories.jsonl"), lines.join("\n") + "\n");
  const { agents, schema, suite, trajectorySchema } = summary;
  return sha256Hex(canonicalJson({ schema, suite, trajectorySchema, agents })).slice(0, 16);
}

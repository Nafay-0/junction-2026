/**
 * Dependency-failure runner: makes one dependency fail at a time against local Dock servers it starts itself,
 * and records what the buyer and the approver see, whether refusals hold, whether anything is lost or duplicated,
 * and how long recovery takes. See tests-live/deps/README.md.
 *
 *   pnpm exec tsx tests-live/deps/run.ts --only model,partner                          # no secrets, no network
 *   pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts --only pg,valkey,kafka,opensearch   # Aiven
 *   pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts                         # everything
 *
 * Writes tests-live/results/deps-<time>.json and prints a table.
 */
import { execSync } from "node:child_process";
import { Results } from "./lib/results";
import { modelScenario } from "./scenarios/model";
import { partnerScenario } from "./scenarios/partner";
import { aivenScenario, deleteTestTopicIfCreated, dropTestSchemaIfCreated, noteTopicBefore, type AivenService } from "./scenarios/aiven";

// The harness mints demo-org mandates with the public dev seed; the servers it starts run without the shared keys.
for (const k of ["DOCK_DEMO_ORG_JWK", "DOCK_DEMO_KITCHEN_JWK", "DOCK_WHOLESALER_JWK"]) delete process.env[k];

const ALL = ["model", "partner", "pg", "valkey", "kafka", "opensearch"] as const;
type Only = (typeof ALL)[number];

function argList(): Only[] {
  const i = process.argv.indexOf("--only");
  if (i < 0) return [...ALL];
  const want = (process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = want.filter((w) => !(ALL as readonly string[]).includes(w));
  if (bad.length) throw new Error(`--only takes ${ALL.join(",")}; got ${bad.join(",")}`);
  return want as Only[];
}

async function main() {
  const only = argList();
  const results = new Results();
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  console.log(`deps run on ${commit}: ${only.join(", ")}`);
  for (const dep of only) {
    console.log(`\n== ${dep}`);
    try {
      if (dep === "model") await modelScenario(results);
      else if (dep === "partner") await partnerScenario(results);
      else {
        if (dep === "kafka") await noteTopicBefore();
        await aivenScenario(results, dep as AivenService);
      }
    } catch (err) {
      results.note(`${dep}: scenario aborted: ${(err as Error).stack?.split("\n").slice(0, 3).join(" | ")}`);
    }
  }
  if (only.includes("kafka")) await deleteTestTopicIfCreated(results).catch((e) => results.note(`kafka: topic cleanup failed: ${(e as Error).message}`));
  if (only.includes("pg") || only.includes("kafka")) await dropTestSchemaIfCreated(results).catch((e) => results.note(`pg: schema cleanup failed: ${(e as Error).message}`));
  const file = results.write(commit);
  console.log(`\n${results.table()}\n`);
  if (results.skipped.length) console.log(`skipped: ${results.skipped.map((s) => `${s.dependency} (${s.why})`).join("; ")}`);
  console.log(`results: ${file}`);
  const failed = results.rows.some((r) => r.refusalHeld === false || (r.lostOrDuplicated && !/^none\b/.test(r.lostOrDuplicated)));
  process.exit(failed ? 1 : 0);
}

void main();

/**
 * The sample activity played once in this process against whatever catalogue the environment gives (the partner's
 * when the index and VALIO_API_KEY are there), printing each beat and the partner calls it made. No server, no model.
 *   pnpm tsx scripts/alive-dry.ts
 */
import { loadLocalEnv } from "./lib/env";

async function main() {
  loadLocalEnv();
  Object.assign(process.env, { DOCK_SAMPLE_ACTIVITY: "off", DOCK_MEMORY_LLM: "off", RADAR_POLL: "off", DOCK_WATCH_MINUTES: "0", DOCK_TEST_ACCOUNTS_RESET_MINUTES: "0", DATABASE_URL: "", OPENSEARCH_URL: "", VALKEY_URL: "", KAFKA_BOOTSTRAP_SERVERS: "", DOCK_MARIADB_URL: "", DOCK_STORE: "", DOCK_AIVEN: "" });
  const { getRuntime } = await import("@/server/runtime");
  const { playStory } = await import("@/server/alive/story");
  const rt = await getRuntime();
  await rt.accounts.restore();
  const stats = () => (rt.catalog as { upstreamStats?: () => { httpRequests: number } }).upstreamStats?.().httpRequests ?? 0;
  const before = stats();
  const r = await playStory(rt, { slowTurnMs: 0 });
  for (const b of r.beats) console.log(`${b.ok ? "OK  " : "FAIL"} ${b.name} (${b.ms} ms): ${b.detail}`);
  console.log(`catalogue ${rt.catalogSource.kind}; ${r.beats.filter((b) => b.ok).length}/${r.beats.length} beats in ${r.ms} ms; partner HTTP requests during the seed: ${stats() - before}; ledger ${rt.dock.ledger.length} entries`);
  process.exit(0);
}
void main();

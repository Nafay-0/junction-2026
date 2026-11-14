/**
 * The hosted mode of the sample activity, against a PostgreSQL you give it (never the production schema): two starts
 * of the runtime in a row on the same store, with DOCK_STORE=postgres and DOCK_SAMPLE_ACTIVITY unset (so "once").
 *   DATABASE_URL=postgres://… DOCK_PG_SCHEMA=alive_check pnpm tsx scripts/alive-hosted-check.ts first|second
 * "first" plays the sample (once), "second" (a new process: a restart) must find it and play nothing.
 */
async function main() {
  const which = process.argv[2] ?? "first";
  if (!process.env.DATABASE_URL || /dock_prod/.test(process.env.DOCK_PG_SCHEMA ?? "dock_prod")) throw new Error("Give DATABASE_URL and a DOCK_PG_SCHEMA that is not dock_prod.");
  Object.assign(process.env, { DOCK_STORE: "postgres", DOCK_MEMORY_LLM: "off", RADAR_POLL: "off", DOCK_WATCH_MINUTES: "0", DOCK_TEST_ACCOUNTS_RESET_MINUTES: "0", DOCK_CATALOG: "seed", VALKEY_URL: "", OPENSEARCH_URL: "", KAFKA_BOOTSTRAP_SERVERS: "", DOCK_MARIADB_URL: "" });
  delete process.env.DOCK_SAMPLE_ACTIVITY;
  const { getRuntime } = await import("@/server/runtime");
  const { sampleSetting, startSampleActivity, sampleStatus } = await import("@/server/alive/start");
  const { sampleSets } = await import("@/server/alive/marks");
  const rt = await getRuntime();
  await rt.accounts.restore();
  const before = rt.dock.ledger.length;
  console.log(`${which}: setting ${sampleSetting(rt)}, store ${rt.aiven.switches.store}, ledger ${before} entries, sample sets ${sampleSets(rt.dock.ledger).length}`);
  startSampleActivity(rt);
  for (let i = 0; i < 60 && (sampleStatus(rt).running || i < 2); i++) await new Promise((r) => setTimeout(r, 1000));
  const sets = sampleSets(rt.dock.ledger);
  console.log(`${which}: after start, ledger ${rt.dock.ledger.length} entries (+${rt.dock.ledger.length - before}), sample sets ${sets.length}: ${sets.map((s) => `${s.set} ${s.entries} entries${s.superseded ? " superseded" : ""}`).join(", ")}; chain ${rt.dock.ledger.verifyFull().ok ? "verifies" : "BROKEN"}`);
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(0);
}
void main().catch((e) => (console.error(e), process.exit(1)));

/**
 * pnpm history:migrate [--status]
 *
 * Create the time machine's history tables in PostgreSQL: schema `<DOCK_PG_SCHEMA>_history` (or DOCK_HISTORY_SCHEMA),
 * the btree_gist extension for the exclusion constraints, one table per versioned area with its `during` range, and
 * the gate_rules view. Idempotent (CREATE ... IF NOT EXISTS, CREATE OR REPLACE VIEW), touches no table of the app's
 * own schema, takes no lock on them: safe to run while the site is up. The app also runs the same statements when it
 * starts, so this is only to do it ahead of a deploy (or to read the status).
 *
 * --status: the backfill's record and how many versions each table keeps. Prints no secrets.
 */
import { Pool } from "pg";
import { PgStore, historySchema } from "../src/server/history/pg-store";
import { BACKFILL_KEY } from "../src/server/history/backfill";
import { env, loadLocalEnv } from "./lib/env";

async function main() {
  loadLocalEnv();
  const url = env("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set.");
  const appSchema = env("DOCK_PG_SCHEMA") ?? "dock";
  const schema = historySchema(appSchema);
  const u = new URL(url);
  if (!u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
  const pool = new Pool({ connectionString: u.toString(), max: 1, application_name: "dock-history-migrate" });
  try {
    const store = new PgStore(pool, schema);
    if (!process.argv.includes("--status")) {
      await store.ensure();
      console.log(`History schema ${schema} ready next to ${appSchema} (exclusion constraints ${store.exclusion ? "on" : "OFF: btree_gist could not be created"}).`);
    }
    const counts = await pool.query(
      `SELECT 'gate_mandate' t, count(*) n FROM ${schema}.gate_mandate UNION ALL SELECT 'gate_kitchen_rule', count(*) FROM ${schema}.gate_kitchen_rule
       UNION ALL SELECT 'gate_product_hold', count(*) FROM ${schema}.gate_product_hold UNION ALL SELECT 'gate_suspension', count(*) FROM ${schema}.gate_suspension
       UNION ALL SELECT 'gate_budget', count(*) FROM ${schema}.gate_budget UNION ALL SELECT 'gate_order', count(*) FROM ${schema}.gate_order UNION ALL SELECT 'gate_order_body', count(*) FROM ${schema}.gate_order_body`,
    );
    console.log(`Versions kept: ${counts.rows.map((r) => `${r.t} ${r.n}`).join(", ")}`);
    console.log(`Backfill from the ledger: ${(await store.getMeta(BACKFILL_KEY)) ?? "not run yet (the app runs it on its first start with this schema)"}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`history:migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

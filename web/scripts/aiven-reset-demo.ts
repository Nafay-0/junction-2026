/**
 * pnpm aiven:reset-demo [--yes]
 *
 * Clear the demo's business data between rehearsals and keep who people are. In the schema DOCK_PG_SCHEMA
 * (the live app uses dock_prod; pass it explicitly):
 *
 *   cleared  orders, requests, intakes, kitchen memory (re-seeded at the next start), used quotes, the ledger
 *   kept     approvers, their passkeys (credential), sessions, passkey prompts (ceremony), visitor kitchens (sandbox)
 *
 * So weekly budgets start empty again (a waiting order holds a kitchen's budget for 7 days) while every visitor
 * who registered a passkey can still sign off. The running app keeps the old ledger head in memory: restart it
 * right after (`node infra/aiven-deploy.mjs --restart`), or its next ledger write is refused and health shows
 * the ledger as diverged. Without --yes it only counts what it would clear. Prints no secrets.
 *
 *   DOCK_PG_SCHEMA=dock_prod pnpm aiven:reset-demo --yes
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

const CLEAR = ["order", "request", "intake", "kitchen"];
const KEEP = ["approver", "credential", "session", "ceremony", "sandbox"];

async function main() {
  const { createPool } = await import("@/server/aiven/pg/pool");
  const { pgSchema, errMessage } = await import("@/server/aiven/env");
  const schema = pgSchema();
  const pool = createPool(undefined, 1);
  try {
    const counts = await pool.query<{ collection: string; n: number }>(`select collection, count(*)::int as n from ${schema}.docs group by 1 order by 1`);
    const ledger = await pool.query<{ n: number }>(`select count(*)::int as n from ${schema}.ledger`);
    const quotes = await pool.query<{ n: number }>(`select count(*)::int as n from ${schema}.used_quotes`);
    const unknown = counts.rows.filter((r) => !CLEAR.includes(r.collection) && !KEEP.includes(r.collection));
    console.log(`schema ${schema}: ${counts.rows.map((r) => `${r.collection} ${r.n}`).join(", ") || "no documents"}; ledger ${ledger.rows[0].n}; used quotes ${quotes.rows[0].n}`);
    if (unknown.length) console.log(`  kept, not known to this script: ${unknown.map((r) => r.collection).join(", ")}`);
    if (!process.argv.includes("--yes")) {
      console.log(`Dry run. With --yes: clears ${CLEAR.join(", ")}, used quotes and the ledger; keeps ${KEEP.join(", ")}.`);
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      const del = await client.query(`delete from ${schema}.docs where collection = any($1)`, [CLEAR]);
      // TRUNCATE is not a row operation, so the append-only trigger (insert only) does not block it.
      await client.query(`truncate ${schema}.ledger, ${schema}.used_quotes`);
      await client.query("commit");
      console.log(`cleared ${del.rowCount} documents, the ledger and the used quotes. Now restart the app: node infra/aiven-deploy.mjs --restart`);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`reset failed: ${errMessage(err)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

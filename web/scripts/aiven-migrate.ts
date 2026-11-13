/**
 * pnpm aiven:migrate [--verify]
 *
 * Create or update Dock's tables in PostgreSQL (idempotent; the app also runs this at start when
 * DOCK_STORE=postgres). Schema from DOCK_PG_SCHEMA (default `dock`). With --verify, also re-checks the
 * ledger's hash chain in SQL and prints the result. Reads web/.env.local. Never prints secrets.
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const { createPool, migrate } = await import("@/server/aiven/pg/pool");
  const { pgSchema, errMessage } = await import("@/server/aiven/env");
  const schema = pgSchema();
  const pool = createPool(undefined, 1);
  try {
    const t0 = Date.now();
    await migrate(pool, schema);
    const tables = await pool.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = $1 order by 1`, [schema]);
    console.log(`migrated schema ${schema} in ${Date.now() - t0} ms: ${tables.rows.map((r) => r.table_name).join(", ")}`);
    if (process.argv.includes("--verify")) {
      const r = await pool.query(`select * from ${schema}.ledger_verify()`);
      console.log("ledger_verify():", JSON.stringify(r.rows[0]));
      const counts = await pool.query(`select collection, count(*)::int as n from ${schema}.docs group by 1 order by 1`);
      console.log("documents:", counts.rows.map((x) => `${x.collection} ${x.n}`).join(", ") || "none");
    }
  } catch (err) {
    console.error(`migration failed: ${errMessage(err)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

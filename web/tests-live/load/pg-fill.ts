/**
 * Fill a load-test PostgreSQL store to N orders by copying its own committed orders in SQL, so the gate can be
 * measured at 5,000 stored orders without placing them one by one (from a laptop every database call is a
 * ~40 ms round trip to Aiven, and placing 5,000 orders takes hours there).
 *
 *   cd web
 *   pnpm exec tsx tests-live/load/pg-fill.ts --schema dock_perf --to 5000
 *
 * Each copy is a committed order of the same organisation with a new order id and request id, created at a random
 * moment in the last 12 hours: inside the weekly budget's and the splitting check's windows, so the gate's sums
 * (spendOf, splitWindow) read every copy, as they would read a real day of orders. The ledger is not copied (the
 * chain stays as it was, and verifies); the wall's counters, read from the ledger, do not count copies.
 * Refuses any schema not named dock_perf*.
 */
import pg from "pg";
import { arg } from "./lib";

async function main() {
  const schema = arg("schema", "dock_perf")!;
  const to = Number(arg("to", "5000"));
  if (!/^dock_perf[a-z0-9_]*$/.test(schema)) throw new Error(`refusing schema ${schema}: only dock_perf* schemas are load-test stores`);
  // Only a local database (see start-server.sh): a fill on the shared Aiven PostgreSQL starved the live site.
  const url = process.env.LOAD_DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) throw new Error("pg-fill needs LOAD_DATABASE_URL pointing at a local database (127.0.0.1 or localhost)");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const t = `${schema}.docs`;
    const have = Number((await client.query(`select count(*) n from ${t} where collection = 'order'`)).rows[0].n);
    const add = to - have;
    if (add <= 0) return void console.log(`${schema}: ${have} orders already, nothing to add`);
    const r = await client.query(
      `with src as (select doc, row_number() over (order by id) - 1 as k, count(*) over () as n from ${t} where collection = 'order' and status = 'committed'),
            gen as (select g, md5(random()::text || g::text) as h,
                           to_char((now() - random() * interval '12 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
                      from generate_series(1, $1::int) g)
       insert into ${t} (collection, id, doc)
       select 'order', 'ord_fill' || substr(gen.h, 1, 12),
              src.doc || jsonb_build_object('orderId', 'ord_fill' || substr(gen.h, 1, 12), 'requestId', 'req_fill' || substr(gen.h, 13, 12), 'createdAt', gen.at, 'updatedAt', gen.at)
         from gen join src on src.k = gen.g % src.n
       on conflict do nothing`,
      [add],
    );
    await client.query(`analyze ${t}`);
    const now = Number((await client.query(`select count(*) n from ${t} where collection = 'order'`)).rows[0].n);
    console.log(`${schema}: ${have} -> ${now} orders (${r.rowCount} copies of committed orders)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});

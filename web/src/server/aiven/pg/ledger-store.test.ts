import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { Ledger, type LedgerEntry } from "@/core/ledger";
import { sha256Hex } from "@/core/util";
import { PgLedgerStore, ledgerBody } from "./ledger-store";

type Row = { seq: number; body: string; hash: string };

/** Enough of pg.Pool for the ledger store: one table, an optional scripted failure. */
function fakePool(rows: Row[] = [], fail: (sql: string) => Error | undefined = () => undefined) {
  const calls: string[] = [];
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      const err = fail(sql);
      if (err) throw err;
      if (sql.startsWith("select body, hash")) return { rows: rows.map((r) => ({ body: r.body, hash: r.hash })) };
      if (sql.startsWith("select seq, hash")) return { rows: rows.map((r) => ({ seq: String(r.seq), hash: r.hash })) };
      if (sql.startsWith("insert")) {
        for (let i = 0; i < values.length; i += 9) {
          const seq = values[i] as number;
          if (rows.some((r) => r.seq === seq)) throw Object.assign(new Error("duplicate key"), { code: "23505" });
          rows.push({ seq, body: values[i + 6] as string, hash: values[i + 8] as string });
        }
        return { rowCount: values.length / 9, rows: [] };
      }
      throw new Error(`unexpected SQL ${sql}`);
    },
  };
  return { pool: pool as unknown as Pool, rows, calls };
}

describe("PgLedgerStore", () => {
  it("stores exactly the text the core hashes, so SQL can check sha256(body) = hash", async () => {
    const { pool, rows } = fakePool();
    const store = await PgLedgerStore.open(pool, "dock");
    const ledger = new Ledger(store);
    const e = ledger.append({ type: "request", actor: "agent:a", summary: "opened", requestId: "r1", data: { text: "milk", n: 1.5 } });
    await store.flush();
    expect(rows).toHaveLength(1);
    expect(sha256Hex(rows[0].body)).toBe(e.hash);
    expect(ledgerBody(e)).toBe(rows[0].body);
  });

  it("loads the chain back from the table and keeps appending to it", async () => {
    const { pool, rows } = fakePool();
    const first = new Ledger(await PgLedgerStore.open(pool, "dock"));
    for (let i = 0; i < 3; i++) first.append({ type: "lookup", actor: "dock", summary: `step ${i}` });
    await (first as unknown as { store: PgLedgerStore }).store.flush();
    expect(rows).toHaveLength(3);

    const store = await PgLedgerStore.open(pool, "dock"); // "after a restart"
    expect(store.loaded.ok).toBe(true);
    const again = new Ledger(store);
    expect(again.head()).toEqual(first.head());
    again.append({ type: "order", actor: "dock", summary: "after restart" });
    await store.flush();
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect(again.verify().ok).toBe(true);
  });

  it("never blocks or throws on append when PostgreSQL is down, and writes in order once it is back", async () => {
    let down = true;
    const { pool, rows } = fakePool([], (sql) => (down && sql.startsWith("insert") ? new Error("connection refused") : undefined));
    const store = await PgLedgerStore.open(pool, "dock");
    const ledger = new Ledger(store);
    for (let i = 0; i < 5; i++) expect(() => ledger.append({ type: "lookup", actor: "dock", summary: `s${i}` })).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
    expect(rows).toHaveLength(0);
    expect(store.status().lastError).toMatch(/connection refused/);
    down = false;
    expect(await store.flush(5_000)).toBe(true);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("treats an insert that landed before a lost reply as written, and a foreign entry as divergence", async () => {
    const { pool, rows } = fakePool();
    const store = await PgLedgerStore.open(pool, "dock");
    const ledger = new Ledger(store);
    const e0 = ledger.append({ type: "request", actor: "dock", summary: "zero" });
    rows.push({ seq: e0.seq, body: ledgerBody(e0), hash: e0.hash }); // landed, reply lost
    await store.flush();
    expect(store.status()).toMatchObject({ written: 1, pending: 0, diverged: null });

    const other: LedgerEntry = { ...e0, seq: 1, summary: "written by another process", prevHash: e0.hash, hash: "f".repeat(64) };
    rows.push({ seq: 1, body: ledgerBody(other), hash: other.hash });
    ledger.append({ type: "request", actor: "dock", summary: "ours" });
    await store.flush(1_000);
    expect(store.status().diverged).toMatch(/entry 1/);
    expect(ledger.entries()).toHaveLength(2); // this process keeps working in memory
  });
});

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectMaria, type Maria } from "../mariadb/client";
import { mariaUrl } from "../mariadb/config";
import { AURINKO, runScenario, type ScenarioResult } from "../mariadb/scenario";
import { ensureSchema } from "../mariadb/schema";
import { timeMachineView, type TimeMachineView } from "../mariadb/service";
import { backfill } from "./backfill";
import { MariaStore } from "./maria-store";
import { MemoryStore } from "./memory-store";
import { PgStore } from "./pg-store";
import type { HistoryStore } from "./store";

/**
 * The history store's behaviour, the same tests on every backend: memory always; PostgreSQL when
 * DOCK_HISTORY_PG_URL names a disposable local database (never a hosted one); MariaDB when DOCK_MARIADB_URL is set
 * (throwaway database, as mariadb.live.test.ts). Each runs the seeded scenario (mariadb/scenario.ts) through the
 * real order flow and mirror, then answers the time machine's questions; the answers must be the same everywhere.
 */
const NOW = new Date("2026-11-14T12:00:00.000Z");
const pgUrl = process.env.DOCK_HISTORY_PG_URL?.trim();
const maUrl = mariaUrl();
const hosted = (u?: string) => !!u && /aivencloud|\.aiven\.|dock_prod/.test(u);

type Backend = { name: string; open: () => Promise<{ store: HistoryStore; close: () => Promise<void> }> };
const BACKENDS: Backend[] = [{ name: "memory", open: async () => ({ store: new MemoryStore(), close: async () => {} }) }];
if (pgUrl && !hosted(pgUrl))
  BACKENDS.push({
    name: "postgres",
    open: async () => {
      const pool = new Pool({ connectionString: pgUrl, max: 3 });
      const schema = `history_test_${randomUUID().slice(0, 8)}`;
      const store = new PgStore(pool, schema);
      await store.ensure();
      return {
        store,
        close: async () => {
          await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          await pool.end();
        },
      };
    },
  });
if (maUrl && !hosted(maUrl))
  BACKENDS.push({
    name: "mariadb",
    open: async () => {
      const admin = connectMaria(maUrl, { connections: 1 });
      const name = `dock_test_${randomUUID().slice(0, 8)}`;
      await admin.query(`CREATE DATABASE ${name}`);
      const u = new URL(maUrl);
      u.pathname = `/${name}`;
      const db: Maria = connectMaria(u.toString(), { connections: 3 });
      await ensureSchema(db);
      return {
        store: new MariaStore(db),
        close: async () => {
          await db.close();
          await admin.query(`DROP DATABASE IF EXISTS ${name}`);
          await admin.close();
        },
      };
    },
  });

/** An answer without the statement, its time, or the ids each run of the scenario draws afresh. */
function comparable(v: TimeMachineView) {
  return JSON.parse(JSON.stringify(answer(v)).replace(/\b(ord|req|qt|apr|sus)_[A-Za-z0-9]+/g, "$1_*"));
}

function answer(v: TimeMachineView) {
  return {
    orgId: v.orgId,
    rulesAt: v.rulesAt.map((r) => [r.area, r.item, r.title, r.lines.join(" | "), r.since]),
    rulesNow: v.rulesNow.map((r) => [r.area, r.item, r.title, r.lines.join(" | "), r.since]),
    changes: v.changes.map((c) => [c.when, c.what, c.by]),
    moments: v.moments.map((m) => [m.at, m.what]),
    replay: v.replay && { then: v.replay.then.outcome, at: v.replay.at.outcome, now: v.replay.now.outcome, thenVsNow: v.replay.thenVsNow.map((d) => d.rule), reproduces: v.replay.reproduces.same },
    orders: v.orders.map((o) => [o.orderId, o.status, o.totalCents, o.createdAt, o.summary]),
  };
}

const answers = new Map<string, Record<string, ReturnType<typeof comparable>>>();

for (const b of BACKENDS) {
  describe(`the history store on ${b.name}`, () => {
    let store: HistoryStore;
    let close: () => Promise<void>;
    let sc: ScenarioResult;

    beforeAll(async () => {
      ({ store, close } = await b.open());
      sc = await runScenario(store, { now: NOW });
    }, 120_000);
    afterAll(async () => close?.());

    it("keeps three versions of the kitchen's mandate, each from its own moment", async () => {
      const all = await store.versionsBetween(AURINKO.orgId, sc.anchor, NOW.toISOString());
      const mandates = all.rows.filter((r) => r.area === "mandate" && r.item === AURINKO.agentId);
      expect(mandates.map((r) => r.value.perOrderLimitCents)).toEqual([40_000, 40_000, 100_000]);
      expect(mandates[1].since).toBe(new Date(Date.parse(sc.anchor) + 7 * 86_400_000 + 6 * 3_600_000).toISOString());
      expect(mandates[1].value.forbiddenAllergens).toContain("gluten");
      expect(mandates[0].until).toBe(mandates[1].since);
      expect(mandates[2].until).toBeUndefined();
    });

    it("answers as of a moment: what was in force then, and nothing that was not", async () => {
      const hold = sc.moments.find((m) => m.label.startsWith("Recall drill"))!.at;
      const during = await store.rulesAsOf(AURINKO.orgId, new Date(Date.parse(hold) + 60_000).toISOString());
      expect(during.rows.some((r) => r.area === "hold")).toBe(true);
      const before = await store.rulesAsOf(AURINKO.orgId, new Date(Date.parse(hold) - 60_000).toISOString());
      expect(before.rows.some((r) => r.area === "hold")).toBe(false);
      expect(during.sql.length).toBeGreaterThan(10);
    });

    it("replays the orders the way the gate decided them, and slides them to the drill and the suspension", async () => {
      const out: Record<string, ReturnType<typeof comparable>> = {};
      for (const letter of ["A", "B", "D"] as const) {
        const v = await timeMachineView(store, { orderId: sc.orders[letter], now: NOW });
        expect(v.replay!.reproduces.same, letter).toBe(true);
        out[letter] = comparable(v);
      }
      expect(out.A.replay).toMatchObject({ then: "auto_approve", now: "reject", thenVsNow: ["forbidden_allergens"] });
      expect(out.B.replay!.then).toBe("needs_human_approval");
      const hold = sc.moments.find((m) => m.label.startsWith("Recall drill"))!.at;
      const sus = sc.moments.find((m) => m.label === "Agent suspended")!.at;
      const atHold = await timeMachineView(store, { orderId: sc.orders.D, at: new Date(Date.parse(hold) + 3_600_000).toISOString(), now: NOW });
      expect(atHold.replay!.at.outcome).toBe("reject");
      expect(atHold.replay!.atVsNow.map((d) => d.rule)).toContain("recall_hold");
      const atSus = await timeMachineView(store, { orderId: sc.orders.D, at: new Date(Date.parse(sus) + 1_800_000).toISOString(), now: NOW });
      expect(atSus.replay!.at.outcome).toBe("refused_at_door");
      out.atHold = comparable(atHold);
      out.atSus = comparable(atSus);
      answers.set(b.name, out);
    });

    if (b.name !== "mariadb") {
      it("builds the same history from the ledger alone (the backfill), once", async () => {
        const fresh = b.name === "memory" ? new MemoryStore() : store;
        const src = await sc.sources();
        // On a database backend the backfill writes as another writer next to the scenario's rows.
        const writer = "backfill-test";
        const r1 = await backfill(fresh, writer, src, { now: NOW });
        expect(r1.ran).toBe(true);
        expect(r1.moments).toBeGreaterThan(10);
        const r2 = await backfill(fresh, writer, src, { now: NOW });
        expect(r2.ran).toBe(false);
        // Every order, replayed against the history built from the ledger, is judged as against the history the
        // mirror wrote as it happened: the same outcome, by the same rules, then and now.
        if (b.name === "memory") {
          const verdict = (v: TimeMachineView) => ({ then: v.replay!.then.outcome, now: v.replay!.now.outcome, rules: v.replay!.then.rules.filter((r) => r.outcome !== "pass").map((r) => r.rule), read: v.replay!.then.read });
          for (const letter of ["A", "B", "C", "D", "E", "F", "G", "H"] as const) {
            const built = await timeMachineView(fresh, { orderId: sc.orders[letter], now: NOW });
            const mirrored = await timeMachineView(store, { orderId: sc.orders[letter], now: NOW });
            expect(verdict(built), letter).toEqual(verdict(mirrored));
          }
          for (const letter of ["A", "B", "D"] as const) expect((await timeMachineView(fresh, { orderId: sc.orders[letter], now: NOW })).replay!.reproduces.same, letter).toBe(true);
        }
        await fresh.clearWriter(writer);
      });
    }

    if (b.name === "postgres") {
      it("will not keep two versions of one item in force at once (the exclusion constraint)", async () => {
        const pg = store as PgStore;
        expect(pg.exclusion).toBe(true);
        const pool = (pg as unknown as { pool: Pool }).pool;
        await expect(
          pool.query(
            `INSERT INTO ${pg.schema}.gate_suspension (suspension_id, scope, target, org_id, label, reason, status, changed_by, writer, during)
             SELECT suspension_id, scope, target, org_id, label, reason, status, changed_by, writer, tstzrange(lower(during), NULL) FROM ${pg.schema}.gate_suspension LIMIT 1`,
          ),
        ).rejects.toThrow(/no_overlap|exclusion|conflicting key/);
      });
    }
  });
}

describe("every backend gives the same answers", () => {
  it.runIf(BACKENDS.length > 1)("as memory does", () => {
    const ref = answers.get("memory");
    expect(ref).toBeDefined();
    for (const [name, a] of answers) if (name !== "memory") expect(a, name).toEqual(ref);
  });
  it.skipIf(BACKENDS.length > 1)("is skipped: set DOCK_HISTORY_PG_URL or DOCK_MARIADB_URL to a local database to compare", () => {});
});

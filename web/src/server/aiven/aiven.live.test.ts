import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ledger } from "@/core/ledger";
import { actionEvent } from "./actions";
import { kafkaConfig, pgConnectionString, valkeyUrl } from "./env";
import { KafkaActionStream, TelemetrySink, kafkaClient } from "./kafka";
import { PgDocs } from "./pg/docs";
import { PgLedgerStore } from "./pg/ledger-store";
import { createPool, migrate } from "./pg/pool";
import { PgDockRepository, PgPasskeyStore } from "./pg/repositories";
import { createTestDock } from "./test-dock";
import { ValkeyEventBus, ValkeyLiveBudget, ValkeyLiveCache, valkeyClient } from "./valkey";
import { LiveLookupGuard } from "@/server/mcp/live-lookup-guard";

/**
 * Against the real Aiven services, each in a throwaway namespace removed afterwards (a schema, key prefix or
 * topic). Runs only with DOCK_AIVEN_TESTS=1 (`pnpm test:aiven`); each block skips when its address is absent.
 */
const enabled = process.env.DOCK_AIVEN_TESTS === "1";
if (enabled) {
  const envFile = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const pgOn = enabled && Boolean(pgConnectionString());
const valkeyOn = enabled && Boolean(valkeyUrl());
const kafkaOn = enabled && pgOn && Boolean(kafkaConfig());

describe.skipIf(!pgOn)("PostgreSQL adapters on dock-pg", () => {
  const schema = `dock_test_${randomUUID().slice(0, 8)}`;
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(undefined, 3);
    await migrate(pool, schema);
    await migrate(pool, schema); // idempotent
  }, 60_000);

  afterAll(async () => {
    await pool.query(`drop schema if exists ${schema} cascade`);
    await pool.end();
  });

  it("claims a quote exactly once under concurrent attempts", async () => {
    const repo = new PgDockRepository(new PgDocs(pool, schema));
    const wins = await Promise.all(Array.from({ length: 8 }, () => repo.claimQuote("qt_race")));
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await repo.isQuoteUsed("qt_race")).toBe(true);
  });

  it("hands a passkey prompt to exactly one of several concurrent takers", async () => {
    const store = new PgPasskeyStore(new PgDocs(pool, schema));
    await store.putCeremony({ kind: "register", challenge: "ch_1", rp: { id: "x", name: "x", origins: ["https://x"] }, expiresAt: Date.now() + 60_000, userHandle: "u", context: {} });
    const got = await Promise.all(Array.from({ length: 6 }, () => store.takeCeremony("ch_1")));
    expect(got.filter(Boolean)).toHaveLength(1);
    await store.putCeremony({ kind: "register", challenge: "ch_old", rp: { id: "x", name: "x", origins: ["https://x"] }, expiresAt: Date.now() - 1, userHandle: "u", context: {} });
    expect(await store.sweepCeremonies(Date.now())).toBe(0);
  });

  it("runs an order flow on PostgreSQL and finds it again from a fresh repository", async () => {
    const ledgerStore = await PgLedgerStore.open(pool, schema);
    const { dock, session } = await createTestDock(ledgerStore, new PgDockRepository(new PgDocs(pool, schema)));
    const req = await dock.openRequest(session, { text: "live test" });
    const q = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 10 }] });
    const lines = q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines });
    expect(order.status).toBe("committed");
    expect((await dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines })).status).toBe("rejected");
    await ledgerStore.flush();
    const fresh = new PgDockRepository(new PgDocs(pool, schema));
    expect((await fresh.getOrder(order.orderId))?.confirmation).toBe(order.confirmation);
    const reloaded = new Ledger(await PgLedgerStore.open(pool, schema));
    expect(reloaded.verify(dock.ledger.head()!).ok).toBe(true);
    expect(await ledgerStore.verifyInDatabase()).toMatchObject({ ok: true, length: dock.ledger.entries().length });
  }, 60_000);

  it("refuses edits, deletes and broken links in the ledger table, and ledger_verify finds tampering", async () => {
    const t = `${schema}.ledger`;
    await expect(pool.query(`update ${t} set actor = 'mallory' where seq = 0`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`delete from ${t} where seq = 0`)).rejects.toThrow(/append-only/);
    const last = (await pool.query(`select max(seq)::int as s from ${t}`)).rows[0].s as number;
    const body = JSON.stringify({ data: {}, prevHash: "1".repeat(64), seq: last + 1, type: "order" });
    await expect(
      pool.query(`insert into ${t} (seq, at, type, actor, body, prev_hash, hash) values ($1, now(), 'order', 'x', $2, $3, encode(public.digest($2, 'sha256'), 'hex'))`, [last + 1, body, "1".repeat(64)]),
    ).rejects.toThrow(/does not point/);
    // An owner who switches the guard off can still edit, but the chain check in SQL sees it.
    await pool.query(`alter table ${t} disable trigger ledger_chain_guard`);
    await pool.query(`alter table ${t} drop constraint ledger_hash_is_body_digest`);
    await pool.query(`update ${t} set body = replace(body, '"live test"', '"tampered"') where seq = 0`);
    const v = (await pool.query(`select * from ${schema}.ledger_verify()`)).rows[0];
    expect(v).toMatchObject({ ok: false, problem: "hash_mismatch" });
  });
});

describe.skipIf(!valkeyOn)("Valkey adapters on dock-cache", () => {
  const url = valkeyUrl() ?? "redis://unused";
  const client = valkeyOn ? valkeyClient(url, "dock-test") : undefined;
  const prefix = randomUUID().slice(0, 8);

  afterAll(() => client?.disconnect());

  it("caches live answers with an expiry on every key", async () => {
    const date = `2099-01-${prefix}`; // a date no real request uses, so keys are this test's own
    let calls = 0;
    const inner = { lookup: async (ids: string[]) => (calls++, ids.map((id) => ({ productId: id, requestedDate: date, price: { ok: true as const, valueCents: 1, currency: "EUR" } }))) };
    const cache = new ValkeyLiveCache(inner, client!);
    await cache.lookup(["p1", "p2"], date);
    await new Promise((r) => setTimeout(r, 200));
    await cache.lookup(["p1", "p2"], date);
    expect(calls).toBe(1);
    const ttl = await client!.ttl(ValkeyLiveCache.key(date, "p1"));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    await client!.del(ValkeyLiveCache.key(date, "p1"), ValkeyLiveCache.key(date, "p2"));
  });

  it("enforces the hourly budget atomically across concurrent reservations", async () => {
    const budget = new ValkeyLiveBudget(client!, new LiveLookupGuard(), { windowMinutes: 60, maxCalls: 3, maxDistinctProducts: 30 });
    const agent = `test-${prefix}`;
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => budget.reserve(agent, [`x${i}`])));
    expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await budget.remaining(agent)).callsLeft).toBe(0);
    const keys = await client!.keys(`dock:v1:budget:${agent}:*`);
    for (const k of keys) expect(await client!.ttl(k)).toBeGreaterThan(3500);
    await client!.del(...keys);
  });

  it("carries live events between two processes' buses", async () => {
    const a = new ValkeyEventBus(valkeyClient(url, "t-a-pub"), valkeyClient(url, "t-a-sub"));
    const bPub = valkeyClient(url, "t-b-pub");
    const bSub = valkeyClient(url, "t-b-sub");
    const b = new ValkeyEventBus(bPub, bSub);
    await Promise.all([a.whenReady(), b.whenReady()]);
    const got = new Promise<string>((resolve) => b.subscribe((e) => e.orderId === `ord_${prefix}`, (e) => resolve(e.type)));
    a.publish({ type: "approval_approved", at: new Date().toISOString(), orgId: "org_t", orderId: `ord_${prefix}`, totalCents: 1, summary: "t" });
    expect(await got).toBe("approval_approved");
    bPub.disconnect();
    bSub.disconnect();
  }, 20_000);
});

describe.skipIf(!kafkaOn)("Kafka action stream on dock-events, sunk into telemetry.events", () => {
  const topic = `dock.test-${randomUUID().slice(0, 8)}`;
  const kafka = kafkaOn ? kafkaClient(kafkaConfig()!, "dock-test") : undefined;
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(undefined, 2);
    await migrate(pool, "dock"); // the unique event-id index the sink relies on
  }, 60_000);

  afterAll(async () => {
    await pool.query(`delete from telemetry.events where kind = 'test.kafka'`);
    await pool.end();
    const admin = kafka!.admin();
    await admin.connect();
    await admin.deleteTopics({ topics: [topic] }).catch(() => undefined); // free plan: 5 topics, so never leave one behind
    await admin.disconnect();
  }, 60_000);

  it("delivers each event to the table once, without the emitter waiting", async () => {
    const stream = new KafkaActionStream(kafka!, topic);
    const sink = new TelemetrySink(kafka!, pool, topic, `dock-test-${topic}`);
    const evs = Array.from({ length: 5 }, (_, i) => actionEvent({ kind: "test.kafka", orderId: `ord_${i % 2}`, value: i }));
    const t0 = performance.now();
    for (const e of evs) stream.emit(e);
    expect(performance.now() - t0).toBeLessThan(5); // emit is a queue push
    stream.emit(evs[0]); // a duplicate delivery
    await stream.flush();
    await sink.start();
    const ids = evs.map((e) => e.eventId);
    let n = 0;
    for (let i = 0; i < 100 && n < 5; i++) {
      n = (await pool.query(`select count(*)::int as n from telemetry.events where attrs->>'event_id' = any($1)`, [ids])).rows[0].n;
      if (n < 5) await new Promise((r) => setTimeout(r, 300));
    }
    expect(n).toBe(5);
    await sink.stop();
    await stream.close();
  }, 60_000);
});

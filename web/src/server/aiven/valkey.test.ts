import { EventEmitter } from "node:events";
import type Valkey from "iovalkey";
import { describe, expect, it } from "vitest";
import { InMemoryCatalog } from "@/core/catalog";
import { DockError } from "@/core/orders";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import type { ValioLiveResult } from "@/server/valio/live-client";
import { LiveLookupGuard } from "@/server/mcp/live-lookup-guard";
import type { ActionEvent } from "./actions";
import { ValkeyCachedCatalog, ValkeyEventBus, ValkeyLiveBudget, ValkeyLiveCache, liveTtlSeconds } from "./valkey";

/** A tiny in-memory stand-in for the Valkey commands the adapters use. Records every expiry it was given. */
function fakeValkey(opts: { down?: () => boolean } = {}) {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  const check = () => {
    if (opts.down?.()) throw new Error("valkey down");
  };
  const client = {
    async mget(...keys: string[]) {
      check();
      return keys.map((k) => data.get(k) ?? null);
    },
    multi() {
      const ops: (() => void)[] = [];
      const m = {
        set(k: string, v: string, ex: string, ttl: number) {
          ops.push(() => {
            if (ex !== "EX" || !(ttl > 0)) throw new Error("every key needs an expiry");
            data.set(k, v);
            ttls.set(k, ttl);
          });
          return m;
        },
        async exec() {
          check();
          ops.forEach((f) => f());
          return [];
        },
        discard() {},
      };
      return m;
    },
    async eval() {
      throw new Error("no Lua in the fake");
    },
  };
  return { client: client as unknown as Valkey, data, ttls };
}

const result = (productId: string, validTo?: string): ValioLiveResult => ({
  productId,
  requestedDate: "2026-11-16",
  price: { ok: true, valueCents: 100, currency: "EUR", validTo },
  availability: { salesBlock: false, line: { availableAmount: 5, availableDate: "2026-11-16", salesBlock: false } },
});

describe("live price/availability cache", () => {
  it("bounds each answer's lifetime by its validity, the cut-off and the cap", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    const o = { maxTtlS: 120, noPriceTtlS: 30 };
    expect(liveTtlSeconds(result("a", "2026-12-31"), now, o)).toBe(120); // long validity: the cap
    expect(liveTtlSeconds(result("a", "2026-11-13T10:00:45Z"), now, o)).toBe(45); // price ends soon
    expect(liveTtlSeconds({ ...result("a"), price: { ok: false, reason: "no_price" } }, now, o)).toBe(30);
    const cut = { ...result("a"), availability: { ...result("a").availability!, closingTime: "2026-11-13T10:01:00Z" } };
    expect(liveTtlSeconds(cut, now, o)).toBe(60);
  });

  it("serves repeats from Valkey, asks the partner only for what is missing, and sets an expiry on every key", async () => {
    const asked: string[][] = [];
    const inner = { lookup: async (ids: string[]) => (asked.push(ids), ids.map((id) => result(id))) };
    const { client, ttls } = fakeValkey();
    const events: ActionEvent[] = [];
    const cache = new ValkeyLiveCache(inner, client, { actions: { emit: (e) => events.push(e), flush: async () => {}, close: async () => {}, stats: () => ({}) } });
    await cache.lookup(["a", "b"], "2026-11-16");
    await new Promise((r) => setTimeout(r, 0));
    const second = await cache.lookup(["a", "b", "c"], "2026-11-16");
    await new Promise((r) => setTimeout(r, 0));
    const third = await cache.lookup(["c", "a"], "2026-11-16");
    expect(asked).toEqual([["a", "b"], ["c"]]);
    expect(second.map((r) => r.productId)).toEqual(["a", "b", "c"]);
    expect(third.map((r) => r.productId)).toEqual(["c", "a"]);
    expect([...ttls.values()].every((t) => t > 0 && t <= 120)).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(["partner_api.call", "partner_api.call", "partner_api.cache_hit"]);
    expect(cache.cacheStats()).toMatchObject({ hits: 4, misses: 3 });
  });

  it("falls through to the partner when Valkey is down", async () => {
    const inner = { lookup: async (ids: string[]) => ids.map((id) => result(id)) };
    const { client } = fakeValkey({ down: () => true });
    const cache = new ValkeyLiveCache(inner, client);
    expect((await cache.lookup(["a"], "2026-11-16"))[0].price).toBeDefined();
    expect(cache.cacheStats().errors).toBe(1);
  });

  it("caches the seed catalogue's offers the same way", async () => {
    const inner = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK);
    let calls = 0;
    const counting = { ...inner, searchProducts: inner.searchProducts.bind(inner), getLiveOffers: (ids: string[]) => (calls++, inner.getLiveOffers(ids)) };
    const { client, ttls } = fakeValkey();
    const cached = new ValkeyCachedCatalog(counting, client);
    const a = await cached.getLiveOffers(["VA-1001", "NOPE"]);
    await new Promise((r) => setTimeout(r, 0));
    const b = await cached.getLiveOffers(["VA-1001", "NOPE"]);
    expect(calls).toBe(1);
    expect(b).toEqual(a); // the unknown product stays absent, from cache too
    expect([...ttls.values()].every((t) => t === 60)).toBe(true);
  });
});

describe("live lookup budget", () => {
  it("uses the in-process guard when Valkey cannot answer", async () => {
    const { client } = fakeValkey();
    const guard = new LiveLookupGuard({ windowMinutes: 60, maxCalls: 1, maxDistinctProducts: 30 });
    const budget = new ValkeyLiveBudget(client, guard);
    await budget.reserve("agent-1", ["a"]);
    await expect(budget.reserve("agent-1", ["b"])).rejects.toBeInstanceOf(DockError);
  });
});

describe("event bus over pub/sub", () => {
  /** Two processes' buses joined by a fake channel. */
  function pair() {
    const wire = new EventEmitter();
    const conn = () =>
      Object.assign(new EventEmitter(), {
        async subscribe() {
          return 1;
        },
        async publish(ch: string, msg: string) {
          wire.emit("msg", ch, msg);
          return 1;
        },
      });
    const subA = conn();
    const subB = conn();
    wire.on("msg", (ch, msg) => {
      subA.emit("message", ch, msg);
      subB.emit("message", ch, msg);
    });
    return [new ValkeyEventBus(conn() as unknown as Valkey, subA as unknown as Valkey), new ValkeyEventBus(conn() as unknown as Valkey, subB as unknown as Valkey)];
  }

  it("delivers an event published in one process to subscribers in the other, once each", async () => {
    const [a, b] = pair();
    const seenA: string[] = [];
    const seenB: string[] = [];
    a.subscribe(() => true, (e) => seenA.push(e.type));
    b.subscribe((e) => e.orgId === "org_1", (e) => seenB.push(e.type));
    a.publish({ type: "approval_requested", at: new Date().toISOString(), orgId: "org_1", orderId: "ord_1", totalCents: 1, summary: "x" });
    a.publish({ type: "order_committed", at: new Date().toISOString(), orgId: "org_2", orderId: "ord_2", totalCents: 1, summary: "y" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seenA).toEqual(["approval_requested", "order_committed"]);
    expect(seenB).toEqual(["approval_requested"]);
    expect(b.since(0, () => true).map((e) => e.orderId)).toEqual(["ord_1", "ord_2"]); // reconnects on b see both
  });
});

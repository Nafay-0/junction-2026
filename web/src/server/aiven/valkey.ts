import Valkey from "iovalkey";
import { MAX_LIVE_IDS_PER_CALL, type CatalogPort, type LiveOffer, type LiveOptions, type LiveStatus, type ProductQuery, type UpstreamMetered } from "@/core/catalog";
import { InMemoryEventBus, type DockEvent, type DockEventInput } from "@/core/events";
import { LIVE_LOOKUP_LIMITS, LiveLookupAllowance, type LiveAllowanceLeft, type LiveLookupLimits } from "@/core/live-allowance";
import { DockError } from "@/core/orders";
import type { UpstreamStats, ValioLiveResult } from "@/server/valio/live-client";
import { validUntilMs } from "@/server/valio/live-client";
import type { LiveLookup } from "@/server/valio/valio-catalog";
import { actionEvent, type ActionStream } from "./actions";
import { errMessage, log } from "./env";
import { metrics } from "./metrics";

/**
 * Valkey holds what expires: answers from the partner's live price/availability API, and each agent's hourly
 * budget of live lookups. The plan's eviction policy is `noeviction` (a full Valkey refuses writes rather than
 * dropping keys), so every key here is written with an expiry, and nothing is written without one.
 * It also carries live events between app processes over publish/subscribe.
 *
 * Every call has a short timeout and fails open to the in-process path: a Valkey outage costs cache hits,
 * never an order.
 */
export function valkeyClient(url: string, name: string): Valkey {
  const client = new Valkey(url, {
    connectionName: name,
    connectTimeout: 5_000,
    commandTimeout: 1_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
    lazyConnect: false,
  });
  client.on("error", (err) => log("warn", `valkey ${name} error`, { error: errMessage(err) }));
  return client;
}

const KEY_PREFIX = "dock:v1";

// ---------------------------------------------------------------------------------------------------------
// Live price/availability cache

export type LiveCacheOptions = {
  /** Upper bound on any cached answer, seconds (DOCK_LIVE_CACHE_MAX_S, default 120). */
  maxTtlS?: number;
  /** Lifetime of an answer with no price (it may appear any moment), seconds. Default 30. */
  noPriceTtlS?: number;
  now?: () => number;
  actions?: ActionStream;
};

/** Seconds an answer may be served from cache: the price's validity, the order cut-off, and the cap, whichever comes first. */
export function liveTtlSeconds(r: ValioLiveResult, nowMs: number, opts: { maxTtlS: number; noPriceTtlS: number }): number {
  let until = nowMs + opts.maxTtlS * 1000;
  if (!r.price || !r.price.ok) until = Math.min(until, nowMs + opts.noPriceTtlS * 1000);
  else {
    const valid = validUntilMs(r.price.validTo);
    if (valid !== undefined) until = Math.min(until, valid);
  }
  const closing = r.availability?.closingTime;
  if (closing && /^\d{4}-\d{2}-\d{2}T/.test(closing)) {
    const t = validUntilMs(closing);
    if (t !== undefined && t > nowMs) until = Math.min(until, t);
  }
  return Math.floor((until - nowMs) / 1000);
}

/**
 * ValioCatalog's LiveLookup, cached in Valkey per product and requested date. Sits below the catalogue's demo
 * overrides, so `setStock` still applies on top of cached answers. Shared by every app process, so a price one
 * process fetched saves the next process its call to the partner.
 */
export class ValkeyLiveCache implements LiveLookup {
  private readonly maxTtlS: number;
  private readonly noPriceTtlS: number;
  private readonly now: () => number;
  private readonly counters = { hits: 0, misses: 0, errors: 0 };

  constructor(
    private readonly inner: LiveLookup,
    private readonly valkey: Valkey,
    private readonly opts: LiveCacheOptions = {},
  ) {
    this.maxTtlS = opts.maxTtlS ?? (Number(process.env.DOCK_LIVE_CACHE_MAX_S) || 120);
    this.noPriceTtlS = opts.noPriceTtlS ?? 30;
    this.now = opts.now ?? Date.now;
  }

  static key(date: string, id: string): string {
    return `${KEY_PREFIX}:live:${date}:${id}`;
  }

  upstreamStats(): UpstreamStats {
    const u = this.inner.upstreamStats?.() ?? { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };
    return { ...u, cacheHits: u.cacheHits + this.counters.hits };
  }

  cacheStats() {
    return { ...this.counters };
  }

  async lookup(productIds: string[], requestedDate: string): Promise<ValioLiveResult[]> {
    const ids = [...new Set(productIds)];
    const cached = new Map<string, ValioLiveResult>();
    try {
      const raw = ids.length ? await this.valkey.mget(...ids.map((id) => ValkeyLiveCache.key(requestedDate, id))) : [];
      raw.forEach((v, i) => {
        if (!v) return;
        try {
          cached.set(ids[i], JSON.parse(v) as ValioLiveResult);
        } catch {
          /* corrupt entry: refetch */
        }
      });
    } catch (err) {
      this.counters.errors += 1;
      metrics.inc("cache.error");
      log("warn", "live cache read failed; asking the partner", { error: errMessage(err) });
    }
    const missing = ids.filter((id) => !cached.has(id));
    this.counters.hits += cached.size;
    this.counters.misses += missing.length;
    metrics.inc("cache.hit", cached.size);
    metrics.inc("cache.miss", missing.length);
    if (missing.length === 0) {
      this.opts.actions?.emit(actionEvent({ kind: "partner_api.cache_hit", attrs: { products: ids.length, date: requestedDate } }));
      return ids.map((id) => cached.get(id)!);
    }
    const t0 = this.now();
    const fresh = await this.inner.lookup(missing, requestedDate);
    const ms = this.now() - t0;
    this.opts.actions?.emit(actionEvent({ kind: "partner_api.call", value: ms, attrs: { products: missing.length, fromCache: cached.size, date: requestedDate } }));
    const nowMs = this.now();
    const writes = this.valkey.multi();
    let n = 0;
    for (const r of fresh) {
      if (!r.price && !r.availability) continue; // the partner did not return it: do not cache the absence
      const ttl = liveTtlSeconds(r, nowMs, { maxTtlS: this.maxTtlS, noPriceTtlS: this.noPriceTtlS });
      if (ttl < 1) continue;
      writes.set(ValkeyLiveCache.key(requestedDate, r.productId), JSON.stringify(r), "EX", ttl);
      n++;
    }
    if (n) writes.exec().catch((err) => log("warn", "live cache write failed", { error: errMessage(err) }));
    else writes.discard();
    const byId = new Map(fresh.map((r) => [r.productId, r]));
    return ids.map((id) => cached.get(id) ?? byId.get(id) ?? { productId: id, requestedDate });
  }
}

/**
 * The same cache in front of a catalogue that has no LiveLookup of its own (the seed catalogue, which stands
 * in for the partner's API). Offers are cached per product and requested date for `ttlS` seconds.
 */
export class ValkeyCachedCatalog implements CatalogPort, UpstreamMetered {
  getLiveStatus?: (productIds: string[], options?: LiveOptions) => Promise<LiveStatus[]>;
  private readonly counters = { hits: 0, misses: 0, calls: 0 };

  constructor(
    private readonly inner: CatalogPort & Partial<UpstreamMetered>,
    private readonly valkey: Valkey,
    private readonly opts: { ttlS?: number; actions?: ActionStream; now?: () => number } = {},
  ) {
    if (inner.getLiveStatus) this.getLiveStatus = (ids, o) => inner.getLiveStatus!(ids, o);
  }

  searchProducts(query: ProductQuery) {
    return this.inner.searchProducts(query);
  }

  upstreamStats(): UpstreamStats {
    const u = this.inner.upstreamStats?.() ?? { httpRequests: this.counters.calls, retries: 0, cacheHits: 0, failures: 0 };
    return { ...u, cacheHits: u.cacheHits + this.counters.hits };
  }

  async getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    const ids = [...new Set(productIds)];
    const date = options?.deliveryDate ?? "earliest";
    const key = (id: string) => `${KEY_PREFIX}:offer:${date}:${id}`;
    const hit = new Map<string, LiveOffer | null>();
    try {
      const raw = ids.length ? await this.valkey.mget(...ids.map(key)) : [];
      raw.forEach((v, i) => v && hit.set(ids[i], JSON.parse(v) as LiveOffer | null));
    } catch (err) {
      metrics.inc("cache.error");
      log("warn", "offer cache read failed; asking the catalogue", { error: errMessage(err) });
    }
    const missing = ids.filter((id) => !hit.has(id));
    this.counters.hits += hit.size;
    this.counters.misses += missing.length;
    metrics.inc("cache.hit", hit.size);
    metrics.inc("cache.miss", missing.length);
    let fresh: LiveOffer[] = [];
    if (missing.length) {
      const now = this.opts.now ?? Date.now;
      const t0 = now();
      this.counters.calls += 1;
      fresh = await (options ? this.inner.getLiveOffers(missing, options) : this.inner.getLiveOffers(missing));
      this.opts.actions?.emit(actionEvent({ kind: "partner_api.call", value: now() - t0, attrs: { products: missing.length, fromCache: hit.size, date } }));
      const ttl = this.opts.ttlS ?? 60;
      const m = this.valkey.multi();
      for (const id of missing) m.set(key(id), JSON.stringify(fresh.find((o) => o.productId === id) ?? null), "EX", ttl);
      m.exec().catch((err) => log("warn", "offer cache write failed", { error: errMessage(err) }));
    } else {
      this.opts.actions?.emit(actionEvent({ kind: "partner_api.cache_hit", attrs: { products: ids.length, date } }));
    }
    const out: LiveOffer[] = [];
    for (const id of ids) {
      const o = hit.has(id) ? hit.get(id) : fresh.find((x) => x.productId === id);
      if (o) out.push(o);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Per-agent hourly allowance of live lookups, shared by every process

export type BudgetRemaining = LiveAllowanceLeft;

/** What the MCP tools need from a budget. LiveLookupGuard (the core's allowance) and the Valkey one both fit. */
export interface LiveBudget {
  reserve(agentKey: string, productIds: string[]): void | Promise<void>;
  remaining(agentKey: string): BudgetRemaining | Promise<BudgetRemaining>;
}

// Record one live call: count it and add its products, both keys expiring with the window. Returns the totals.
// KEYS[1] calls counter, KEYS[2] set of products priced; ARGV[1] ttl, ARGV[2..] ids
const RECORD_LUA = `
local calls = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
if #ARGV >= 2 then
  redis.call('SADD', KEYS[2], unpack(ARGV, 2))
  redis.call('EXPIRE', KEYS[2], ARGV[1])
end
return {calls, redis.call('SCARD', KEYS[2])}
`;

type Shared = { bucket: number; calls: number; products: Set<string>; at: number };

/**
 * The core's live-lookup allowance (core/live-allowance.ts), with the counts shared through Valkey, so an agent
 * cannot get a fresh allowance by landing on another app process. createDock calls it synchronously (REST, MCP and
 * the intake all go through it), so it decides from this process's own rolling window plus the last known shared
 * counts for the agent's clock hour, and records each call in Valkey right behind it; the answer refreshes the
 * shared view. The MCP tools refresh before they check. Both keys expire with the hour (`noeviction` plan).
 * Without Valkey it is exactly the in-memory allowance.
 */
export class ValkeyLiveAllowance extends LiveLookupAllowance {
  private readonly shared = new Map<string, Shared>();

  constructor(
    private readonly valkey: Valkey,
    limits: LiveLookupLimits = LIVE_LOOKUP_LIMITS,
    private readonly clock: () => Date = () => new Date(),
    /** Keeps separate deployments (stores) apart, e.g. a rehearsal schema; partner answers in the cache are shared. */
    private readonly namespace = "dock",
  ) {
    super(limits, clock);
  }

  private bucket(): number {
    return Math.floor(this.clock().getTime() / (this.limits.windowMinutes * 60_000));
  }

  private keys(agentKey: string, bucket: number): [string, string] {
    const base = `${KEY_PREFIX}:allowance:${this.namespace}:${encodeURIComponent(agentKey)}:${bucket}`;
    return [`${base}:calls`, `${base}:products`];
  }

  private snapshot(agentKey: string): Shared | undefined {
    const s = this.shared.get(agentKey);
    return s && s.bucket === this.bucket() ? s : undefined;
  }

  /** Read the agent's shared counts for this hour from Valkey. Never throws. */
  async refresh(agentKey: string): Promise<void> {
    const bucket = this.bucket();
    try {
      const [callsKey, productsKey] = this.keys(agentKey, bucket);
      const [calls, products] = await Promise.all([this.valkey.get(callsKey), this.valkey.smembers(productsKey)]);
      this.shared.set(agentKey, { bucket, calls: Number(calls ?? 0), products: new Set(products), at: Date.now() });
    } catch (err) {
      metrics.inc("cache.error");
      log("warn", "live allowance could not read Valkey; using this process's own counts", { error: errMessage(err) });
    }
  }

  check(agentKey: string, productIds: string[]): void {
    super.check(agentKey, productIds); // this process's rolling window
    const ids = [...new Set(productIds)];
    if (ids.length === 0 || ids.length > MAX_LIVE_IDS_PER_CALL) return;
    const s = this.snapshot(agentKey);
    if (!s || Date.now() - s.at > 5_000) void this.refresh(agentKey); // keep the shared view fresh for the next call
    if (!s) return;
    const { windowMinutes, maxCalls, maxDistinctProducts } = this.limits;
    if (s.calls >= maxCalls) {
      metrics.inc("budget.refused");
      throw new DockError(429, "live_lookup_budget_exceeded", `This agent already made ${s.calls} live price/availability lookups this hour (all Dock servers together); the limit is ${maxCalls}.`, "live_lookup_limit", { maxCalls, windowMinutes, shared: true });
    }
    const after = new Set([...s.products, ...ids]).size;
    if (after > maxDistinctProducts) {
      metrics.inc("budget.refused");
      throw new DockError(
        429,
        "live_lookup_budget_exceeded",
        `Live price/availability is for a short list: at most ${maxDistinctProducts} different products per agent per hour (all Dock servers together). This call would make it ${after}.`,
        "live_lookup_limit",
        { maxDistinctProducts, windowMinutes, alreadyPriced: s.products.size, requested: ids.length, shared: true },
      );
    }
  }

  reserve(agentKey: string, productIds: string[]): void {
    super.reserve(agentKey, productIds); // runs check() above, then records locally
    const ids = [...new Set(productIds)];
    if (ids.length === 0 || ids.length > MAX_LIVE_IDS_PER_CALL) return;
    const bucket = this.bucket();
    const s = this.snapshot(agentKey) ?? { bucket, calls: 0, products: new Set<string>(), at: 0 };
    s.calls += 1;
    for (const id of ids) s.products.add(id);
    this.shared.set(agentKey, s);
    const ttl = this.limits.windowMinutes * 60 + 60;
    (this.valkey.eval(RECORD_LUA, 2, ...this.keys(agentKey, bucket), ttl, ...ids) as Promise<number[]>).then(
      ([calls]) => {
        const cur = this.shared.get(agentKey);
        if (cur && cur.bucket === bucket) cur.calls = Math.max(cur.calls, Number(calls));
      },
      (err) => {
        metrics.inc("cache.error");
        log("warn", "live allowance could not record the call in Valkey", { error: errMessage(err) });
      },
    );
  }

  remaining(agentKey: string): LiveAllowanceLeft {
    const local = super.remaining(agentKey);
    const s = this.snapshot(agentKey);
    if (!s) return local;
    return {
      ...local,
      callsLeft: Math.min(local.callsLeft, Math.max(0, this.limits.maxCalls - s.calls)),
      newProductsLeft: Math.min(local.newProductsLeft, Math.max(0, this.limits.maxDistinctProducts - s.products.size)),
    };
  }

  /** The MCP view: refresh from Valkey first, then check or report. */
  asBudget(): LiveBudget {
    return {
      reserve: async (agentKey, ids) => {
        await this.refresh(agentKey);
        this.check(agentKey, ids);
      },
      remaining: async (agentKey) => {
        await this.refresh(agentKey);
        return this.remaining(agentKey);
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Live events across processes

const CHANNEL = `${KEY_PREFIX}:events`;
type Wire = { origin: string; event: DockEventInput };

/**
 * The event bus for phones and the big screen, shared by every app process: each event is delivered to this
 * process's subscribers at once (as before) and published on a Valkey channel; other processes deliver what
 * they receive to their own subscribers. Pub/sub keeps nothing, so nothing needs an expiry; `since()` serves
 * reconnects from each process's recent buffer, which includes events from the other processes.
 */
export class ValkeyEventBus extends InMemoryEventBus {
  private readonly origin = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  private ready: Promise<void>;

  constructor(
    private readonly pub: Valkey,
    private readonly sub: Valkey,
    keep = 500,
  ) {
    super(keep);
    this.sub.on("message", (channel: string, message: string) => {
      if (channel !== CHANNEL) return;
      try {
        const wire = JSON.parse(message) as Wire;
        if (wire.origin === this.origin) return;
        metrics.inc("bus.remote");
        super.publish(wire.event);
      } catch {
        // not ours
      }
    });
    this.ready = this.sub.subscribe(CHANNEL).then(
      () => undefined,
      (err) => log("warn", "event bus could not subscribe", { error: errMessage(err) }),
    );
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  publish(input: DockEventInput): void {
    super.publish(input);
    const wire: Wire = { origin: this.origin, event: input };
    this.pub.publish(CHANNEL, JSON.stringify(wire)).catch((err) => log("warn", "event bus publish failed", { error: errMessage(err) }));
  }

  /** Same contract as the in-memory bus. */
  since(id: number, filter: (e: DockEvent) => boolean): DockEvent[] {
    return super.since(id, filter);
  }
}

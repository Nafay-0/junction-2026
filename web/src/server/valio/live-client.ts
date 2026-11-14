import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { reserveLiveLookup } from "@/server/limits";

/**
 * Client for the partner's two live endpoints, POST /api/price and POST /api/availability.
 *
 * Gentle by design: requests are batched (at most `batchSize` product codes each, never more than the partner's
 * 1,000), time out, retry with backoff only on 429 and 5xx, and answers are cached: availability briefly, prices
 * until their validity window ends (capped). It never lists or scans the catalogue; callers narrow down first.
 *
 * A buyer never waits long on it: one lookup (prices and availability, every batch and retry) has `deadlineMs`
 * (default 8 s, DOCK_LIVE_DEADLINE_MS) in all. A Retry-After that would run past it is not slept on: the lookup
 * fails at once as rate_limited, saying when to try again (QA F-SLOW-PARTNER-WAIT: 30 to 36 s before).
 */
export const LIVE_DEADLINE_MS = 8000;
const PER_CALL_TIMEOUT_MS = 5000;

export type ValioPrice =
  | {
      ok: true;
      valueCents: number; // before tax, per one sales unit
      valueWithTaxCents?: number;
      currency: string;
      validFrom?: string;
      validTo?: string;
      comparisonPriceCents?: number;
      comparisonUnit?: string;
      taxRatePct?: number;
      listPriceCents?: number;
      netPriceFound?: boolean;
    }
  | { ok: false; reason: "no_price" };

export type ValioAvailability = {
  /** The response's `timeNow` (Helsinki time). */
  timeNow?: string;
  closingTime?: string;
  salesBlock: boolean;
  logisticModel?: string;
  /** The first schedule line (the earliest date), or undefined when there is none: not available. */
  line?: { availableAmount: number; availableDate: string; salesUnit?: string; salesBlock: boolean };
  /** Every schedule line, earliest date first (the documented answer has at most one; more are read, not dropped). */
  lines?: { availableAmount: number; availableDate: string; salesUnit?: string; salesBlock: boolean }[];
  /** True when the answer had rows but none with an amount: "empty" means not available, like no rows at all. */
  emptyAmount?: boolean;
};

export type ValioLiveResult = {
  productId: string;
  requestedDate: string;
  /** Undefined when the API did not return the product at all. */
  price?: ValioPrice;
  availability?: ValioAvailability;
};

export type ValioApiErrorCode = "unauthorized" | "rate_limited" | "server_error" | "bad_request" | "timeout" | "network" | "bad_response";

export class ValioApiError extends Error {
  constructor(
    readonly code: ValioApiErrorCode,
    message: string,
    readonly status?: number,
    /** When the partner (or the deadline) says to try again, in seconds. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ValioApiError";
  }
}

export type ValioClientConfig = {
  baseUrl: string;
  apiKey: string;
  /** Required by the API, ignored in the challenge. */
  customer?: string;
  fetch?: typeof fetch;
  /** One HTTP call's timeout (default 5 s), never more than what is left of the lookup's deadline. */
  timeoutMs?: number;
  /** All the time one lookup may take, every call and retry included (default 8 s). */
  deadlineMs?: number;
  maxRetries?: number;
  batchSize?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  availabilityTtlMs?: number;
  /** Upper bound on caching a price, even when its validity window is longer. */
  priceTtlMs?: number;
  cacheSize?: number;
};

export type UpstreamStats = { httpRequests: number; retries: number; cacheHits: number; failures: number };

// ---------- response shapes (lenient: the partner's mock may add or omit fields) ----------

const Money = z.union([z.number(), z.object({ value: z.number().optional() }).loose()]).optional().catch(undefined);
const money = (m: z.infer<typeof Money>) => (typeof m === "number" ? m : m?.value);
const Str = z.string().max(64).optional().catch(undefined);

const PriceItem = z
  .object({
    productId: z.union([z.string(), z.number()]).optional().catch(undefined),
    error: z.boolean().optional().catch(undefined),
    catalogPrice: z.object({ value: z.number().optional().catch(undefined), valueWithTax: z.number().optional().catch(undefined), validFrom: Str, validTo: Str, currency: Str }).loose().nullable().optional().catch(undefined),
    priceWithTax: Money,
    comparisonPrice: Money,
    comparisonUnit: Str,
    tax: z.object({ taxRate: z.number().optional().catch(undefined), taxValue: z.number().optional().catch(undefined) }).loose().nullable().optional().catch(undefined),
    listPrice: Money,
    netPriceFound: z.boolean().optional().catch(undefined),
  })
  .loose();
const PriceResponse = z.object({ currency: Str, products: z.array(z.unknown()) }).loose();

const ScheduleLine = z
  .object({ availableAmount: z.number(), availableDate: z.string().max(40), salesUnit: Str, salesBlock: z.boolean().optional().catch(undefined) })
  .loose();
const AvailabilityItem = z
  .object({
    productId: z.union([z.string(), z.number()]).optional().catch(undefined),
    closingTime: Str,
    salesBlock: z.boolean().optional().catch(undefined),
    logisticModel: Str,
    scheduleLines: z.array(z.unknown()).optional().catch(undefined),
  })
  .loose();
const AvailabilityResponse = z.object({ timeNow: Str, products: z.array(z.unknown()) }).loose();

const cents = (eur: number | undefined) => (typeof eur === "number" && Number.isFinite(eur) ? Math.round(eur * 100) : undefined);

/** Today's date in Helsinki, which is what the partner's dates mean. */
export function helsinkiDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** End of a validity window: a bare date lasts to the end of that day in Helsinki (taken as UTC+3, so never too late). */
export function validUntilMs(validTo: string | undefined): number | undefined {
  if (!validTo) return undefined;
  const v = validTo.trim();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T23:59:59+03:00`) : Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}+03:00`);
  return Number.isFinite(t) ? t : undefined;
}

/** Start of a validity window: a bare date starts at midnight Helsinki (taken as UTC+2, so never too early). */
export function validFromMs(validFrom: string | undefined): number | undefined {
  if (!validFrom) return undefined;
  const v = validFrom.trim();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00+02:00`) : Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}+02:00`);
  return Number.isFinite(t) ? t : undefined;
}

type CacheEntry<T> = { value: T; expires: number };
type Deadline = { slept: number; left: () => number };

/** The partner's Retry-After, in whole seconds, when it sent one. */
function retryAfterOf(res?: Response): number | undefined {
  const v = Number(res?.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : undefined;
}

export class ValioLiveClient {
  private readonly cfg: Required<Omit<ValioClientConfig, "fetch" | "now" | "sleep">> & Pick<ValioClientConfig, "fetch">;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly counters: UpstreamStats = { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };

  constructor(config: ValioClientConfig) {
    if (!config.apiKey) throw new ValioApiError("unauthorized", "No Valio API key configured (VALIO_API_KEY).");
    this.cfg = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey,
      customer: config.customer ?? "dock",
      fetch: config.fetch,
      timeoutMs: config.timeoutMs ?? PER_CALL_TIMEOUT_MS,
      deadlineMs: config.deadlineMs ?? (Number(process.env.DOCK_LIVE_DEADLINE_MS) || LIVE_DEADLINE_MS),
      maxRetries: config.maxRetries ?? 3,
      batchSize: Math.min(Math.max(config.batchSize ?? MAX_LIVE_IDS_PER_CALL, 1), 1000),
      availabilityTtlMs: config.availabilityTtlMs ?? 60_000,
      priceTtlMs: config.priceTtlMs ?? 10 * 60_000,
      cacheSize: config.cacheSize ?? 500,
    };
    this.now = config.now ?? (() => new Date());
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  upstreamStats(): UpstreamStats {
    return { ...this.counters };
  }

  /** GET /api/ping: checks the key. Never throws on HTTP status; network failures do throw. */
  async ping(): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await this.request("GET", "/api/ping", undefined, this.deadline());
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }

  /**
   * Price and availability for a short list of products, for one requested delivery date and one customer (the
   * kitchen's customer number; the configured default when none is given). Answers are cached per customer, since
   * prices and availability are customer-specific.
   */
  async lookup(productIds: string[], requestedDate: string, customer?: string): Promise<ValioLiveResult[]> {
    const ids = [...new Set(productIds)];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new ValioApiError("bad_request", `requestedDate must be YYYY-MM-DD; got ${requestedDate}.`);
    const who = customer?.trim() ? customer.trim().slice(0, 32) : this.cfg.customer;
    const dl = this.deadline();
    const [prices, avail] = await Promise.all([this.cached("p", ids, requestedDate, who, (b) => this.fetchPrices(b, requestedDate, who, dl)), this.cached("a", ids, requestedDate, who, (b) => this.fetchAvailability(b, requestedDate, who, dl))]);
    return ids.map((productId) => ({ productId, requestedDate, price: prices.get(productId) as ValioPrice | undefined, availability: avail.get(productId) as ValioAvailability | undefined }));
  }

  // ---------- internals ----------

  /** One lookup's time budget. Elapsed is wall time, or the time slept when sleeping is simulated (tests). */
  private deadline(): Deadline {
    const started = Date.now();
    const d: Deadline = { slept: 0, left: () => this.cfg.deadlineMs - Math.max(Date.now() - started, d.slept) };
    return d;
  }

  private async cached(kind: "p" | "a", ids: string[], date: string, customer: string, load: (batch: string[]) => Promise<Map<string, unknown>>): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    const nowMs = this.now().getTime();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = this.cache.get(`${kind}:${customer}:${date}:${id}`);
      if (hit && hit.expires > nowMs) {
        out.set(id, hit.value);
        this.counters.cacheHits += 1;
      } else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += this.cfg.batchSize) {
      const batch = missing.slice(i, i + this.cfg.batchSize);
      const got = await load(batch);
      for (const id of batch) {
        if (!got.has(id)) continue; // not returned: do not cache the absence
        const value = got.get(id);
        out.set(id, value);
        this.remember(`${kind}:${customer}:${date}:${id}`, value, this.expiry(kind, value, nowMs));
      }
    }
    return out;
  }

  private expiry(kind: "p" | "a", value: unknown, nowMs: number): number {
    if (kind === "a") return nowMs + this.cfg.availabilityTtlMs;
    const p = value as ValioPrice;
    if (!p.ok) return nowMs + this.cfg.availabilityTtlMs; // "no price" may change; do not hold it long
    const until = validUntilMs(p.validTo);
    return Math.min(nowMs + this.cfg.priceTtlMs, until ?? Number.POSITIVE_INFINITY);
  }

  private remember(key: string, value: unknown, expires: number) {
    if (expires <= this.now().getTime()) return;
    this.cache.delete(key);
    this.cache.set(key, { value, expires });
    while (this.cache.size > this.cfg.cacheSize) this.cache.delete(this.cache.keys().next().value!);
  }

  private body(ids: string[], requestedDate: string, customer: string) {
    return { customer, requestedDate, products: ids };
  }

  private async fetchPrices(ids: string[], requestedDate: string, customer: string, dl: Deadline): Promise<Map<string, ValioPrice>> {
    const json = await this.postJson("/api/price", this.body(ids, requestedDate, customer), dl);
    const parsed = PriceResponse.safeParse(json);
    if (!parsed.success) throw new ValioApiError("bad_response", "Price response is not in the documented shape.");
    const out = new Map<string, ValioPrice>();
    parsed.data.products.forEach((raw, i) => {
      const item = PriceItem.safeParse(raw);
      if (!item.success) return;
      const it = item.data;
      const id = it.productId !== undefined ? String(it.productId) : ids[i]; // documented as returned in request order
      if (!id || !ids.includes(id)) return;
      const value = cents(it.catalogPrice?.value);
      if (it.error === true || value === undefined || value < 0) {
        out.set(id, { ok: false, reason: "no_price" });
        return;
      }
      out.set(id, {
        ok: true,
        valueCents: value,
        valueWithTaxCents: cents(it.catalogPrice?.valueWithTax ?? money(it.priceWithTax)),
        currency: it.catalogPrice?.currency ?? parsed.data.currency ?? "EUR",
        validFrom: it.catalogPrice?.validFrom,
        validTo: it.catalogPrice?.validTo,
        comparisonPriceCents: cents(money(it.comparisonPrice)),
        comparisonUnit: it.comparisonUnit,
        taxRatePct: it.tax?.taxRate,
        listPriceCents: cents(money(it.listPrice)),
        netPriceFound: it.netPriceFound,
      });
    });
    return out;
  }

  private async fetchAvailability(ids: string[], requestedDate: string, customer: string, dl: Deadline): Promise<Map<string, ValioAvailability>> {
    const json = await this.postJson("/api/availability", this.body(ids, requestedDate, customer), dl);
    const parsed = AvailabilityResponse.safeParse(json);
    if (!parsed.success) throw new ValioApiError("bad_response", "Availability response is not in the documented shape.");
    const out = new Map<string, ValioAvailability>();
    parsed.data.products.forEach((raw, i) => {
      const item = AvailabilityItem.safeParse(raw);
      if (!item.success) return;
      const it = item.data;
      const id = it.productId !== undefined ? String(it.productId) : ids[i];
      if (!id || !ids.includes(id)) return;
      const rows = it.scheduleLines ?? [];
      const lines = rows
        .map((l) => ScheduleLine.safeParse(l))
        .filter((r) => r.success)
        .map((r) => ({ availableAmount: r.data.availableAmount, availableDate: r.data.availableDate.slice(0, 10), salesUnit: r.data.salesUnit, salesBlock: r.data.salesBlock === true }))
        .sort((a, b) => a.availableDate.localeCompare(b.availableDate));
      out.set(id, {
        timeNow: parsed.data.timeNow,
        closingTime: it.closingTime,
        salesBlock: it.salesBlock === true,
        logisticModel: it.logisticModel,
        line: lines[0],
        ...(lines.length > 1 ? { lines } : {}),
        ...(rows.length > 0 && lines.length === 0 ? { emptyAmount: true } : {}),
      });
    });
    return out;
  }

  private async postJson(path: string, body: unknown, dl: Deadline): Promise<unknown> {
    const res = await this.request("POST", path, body, dl);
    if (!res.ok) this.counters.failures += res.status === 429 || res.status >= 500 ? 0 : 1; // retried ones are counted in request()
    if (res.status === 401 || res.status === 403) throw new ValioApiError("unauthorized", `Valio API refused the key (HTTP ${res.status}).`, res.status);
    if (!res.ok) throw new ValioApiError(res.status === 429 ? "rate_limited" : res.status >= 500 ? "server_error" : "bad_request", `Valio API ${path} answered HTTP ${res.status}.`, res.status, retryAfterOf(res));
    try {
      return await res.json();
    } catch {
      throw new ValioApiError("bad_response", `Valio API ${path} did not return JSON.`);
    }
  }

  /**
   * One HTTP call with timeout, retried with exponential backoff on 429, 5xx, timeouts and network errors, all
   * within the lookup's deadline: a call never waits past it, and a wait that would end past it is not started.
   */
  private async request(method: "GET" | "POST", path: string, body: unknown, dl: Deadline): Promise<Response> {
    const doFetch = this.cfg.fetch ?? fetch;
    for (let attempt = 0; ; attempt++) {
      const left = dl.left();
      if (left <= 0) {
        this.counters.failures += 1;
        throw new ValioApiError("timeout", `Valio API ${path}: no usable answer within ${Math.round(this.cfg.deadlineMs / 1000)} s.`, undefined, 30);
      }
      reserveLiveLookup(); // public-demo cap on partner API requests per day (server/limits.ts)
      this.counters.httpRequests += 1;
      let res: Response | undefined;
      let failure: ValioApiError | undefined;
      try {
        res = await doFetch(`${this.cfg.baseUrl}${path}`, {
          method,
          headers: { "X-API-Key": this.cfg.apiKey, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1, Math.min(this.cfg.timeoutMs, left))),
        });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        const timedOut = name === "TimeoutError" || name === "AbortError";
        failure = new ValioApiError(timedOut ? "timeout" : "network", `Valio API ${path}: ${timedOut ? (left < this.cfg.timeoutMs ? `no usable answer within ${Math.round(this.cfg.deadlineMs / 1000)} s` : `no answer within ${this.cfg.timeoutMs} ms`) : "network error"}.`, undefined, timedOut ? 30 : undefined);
      }
      const retryable = failure !== undefined || (res !== undefined && (res.status === 429 || res.status >= 500));
      if (!retryable) return res!;
      if (attempt >= this.cfg.maxRetries) {
        this.counters.failures += 1;
        if (failure) throw failure;
        return res!;
      }
      const wait = this.backoffMs(attempt, res);
      const asked = retryAfterOf(res);
      // Waiting would run past the deadline (a Retry-After of 30 s, say): say so now instead of sleeping on it.
      if ((asked !== undefined && asked * 1000 > dl.left()) || wait >= dl.left()) {
        this.counters.failures += 1;
        if (failure) throw failure;
        return res!;
      }
      this.counters.retries += 1;
      await this.sleep(wait);
      dl.slept += wait;
    }
  }

  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = Number(res?.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
    const base = 500 * 2 ** attempt; // 0.5 s, 1 s, 2 s, ...
    return Math.min(base + Math.floor(Math.random() * 250), 8000);
  }
}

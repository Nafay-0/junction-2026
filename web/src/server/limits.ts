import { DockError } from "@/core/errors";
import { playingNow } from "./alive/clock";

/**
 * Limits for a public demo server, all in memory (one process; a restart resets them):
 *
 *   rate limits   fixed one-minute windows per key (client address, kitchen), checked in src/proxy.ts
 *   daily caps    process-wide counters for what costs money or partner quota: LLM calls and their spend,
 *                 live price/availability lookups. Checked where the call is made, so in-process callers
 *                 (the buyer console's /ui-api forwarding) are covered too.
 *
 * Settings (all optional, names in web/.env.example):
 *   DOCK_LLM                 "off" switches every model call off (503 llm_disabled)
 *   DOCK_LLM_DAILY_USD       spend cap for model calls per UTC day (default 5)
 *   DOCK_LLM_DAILY_CALLS     model calls per UTC day (default 500)
 *   DOCK_LIVE_DAILY_CALLS    partner live API requests per UTC day (default 3000)
 *   DOCK_SEARCH_DAILY_CALLS  smart search's model calls (relevance judge, query embedding) per UTC day (default 5000);
 *                            their spend counts in DOCK_LLM_DAILY_USD
 *   DOCK_RATE_LIMITS         "off" disables the per-address limits (local load tests only)
 *   DOCK_LIMIT_<RULE>        one rate rule's limit per window, e.g. DOCK_LIMIT_JOIN=240, DOCK_LIMIT_DEMO_ORDER_KITCHEN=6
 *                            (the rule name upper-cased, dashes as underscores; rules and defaults in src/proxy.ts and
 *                            server/accounts/service.ts; every name in web/.env.example)
 */

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v ?? "");
  return Number.isFinite(n) && n >= 0 && (v ?? "").trim() !== "" ? n : fallback;
};
const env = (k: string) => process.env[k]?.trim() || undefined;

// ---------- rate limits ----------

export type RateRule = { readonly name: string; readonly limit: number; readonly windowMs: number };

/** The environment variable that sets a rule's limit: "demo-order-kitchen" -> DOCK_LIMIT_DEMO_ORDER_KITCHEN. */
export const limitVar = (name: string) => `DOCK_LIMIT_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

/**
 * A rate rule whose limit can be set by environment variable (limitVar(name)); `fallback` when unset or not a
 * number >= 0. Read on every hit, so a test or a restart with a new value needs no code change.
 */
export function envRule(name: string, fallback: number, windowMs = 60_000): RateRule {
  const key = limitVar(name);
  return {
    name,
    windowMs,
    get limit() {
      return int(env(key), fallback);
    },
  };
}
type Window = { start: number; count: number };

/** Fixed-window counters. At most `maxKeys` keys are kept; the oldest windows are dropped first. */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  constructor(private readonly maxKeys = 50_000) {}

  /** Count one hit. Returns null when allowed, or the seconds until the window resets. */
  hit(rule: RateRule, key: string, now = Date.now()): number | null {
    const id = `${rule.name}|${key}`;
    let w = this.windows.get(id);
    if (!w || now - w.start >= rule.windowMs) {
      if (w) this.windows.delete(id); // re-insert so Map order stays oldest-first
      w = { start: now, count: 0 };
      this.windows.set(id, w);
      this.evict();
    }
    w.count++;
    if (w.count > rule.limit) return Math.max(1, Math.ceil((w.start + rule.windowMs - now) / 1000));
    return null;
  }

  /** Hits counted in the key's current window, without counting one. */
  count(rule: RateRule, key: string, now = Date.now()): number {
    const w = this.windows.get(`${rule.name}|${key}`);
    return w && now - w.start < rule.windowMs ? w.count : 0;
  }

  /** Seconds until the key's current window resets (at least 1). */
  retryAfter(rule: RateRule, key: string, now = Date.now()): number {
    const w = this.windows.get(`${rule.name}|${key}`);
    return w ? Math.max(1, Math.ceil((w.start + rule.windowMs - now) / 1000)) : 1;
  }

  private evict() {
    if (this.windows.size <= this.maxKeys) return;
    for (const id of this.windows.keys()) {
      if (this.windows.size <= this.maxKeys * 0.9) break;
      this.windows.delete(id);
    }
  }

  get size() {
    return this.windows.size;
  }
}

export const rateLimitsEnabled = () => env("DOCK_RATE_LIMITS") !== "off";

/**
 * The caller's address. Aiven Runtime's edge appends the address it saw to X-Forwarded-For, so the last entry is
 * the one a client cannot forge; DOCK_TRUSTED_PROXY_HOPS (default 1) says how many proxies append.
 */
export function clientAddress(headers: Headers): string {
  const hops = Math.max(1, int(env("DOCK_TRUSTED_PROXY_HOPS"), 1));
  const xff = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) return xff[Math.max(0, xff.length - hops)];
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// ---------- daily caps ----------

type Day = { day: string; calls: number; usd: number };
const g = globalThis as typeof globalThis & { __dockDaily?: Map<string, Day> };
const days = () => (g.__dockDaily ??= new Map());
const today = (now = new Date()) => now.toISOString().slice(0, 10);

function counter(kind: string, now = new Date()): Day {
  const d = today(now);
  let c = days().get(kind);
  if (!c || c.day !== d) {
    c = { day: d, calls: 0, usd: 0 };
    days().set(kind, c);
  }
  return c;
}

const demoLimit = (what: string) =>
  new DockError(429, "demo_limit_reached", `Demo limit reached: ${what} for today on this server. It resets at midnight UTC.`, "demo_budget");

/** Of each daily cap, the share a spare call (the second reader) may not use: it is kept for first readings. */
export const SPARE_RESERVE = 0.1;

/**
 * Before a model call: refuse when switched off or over today's caps. Counts the call. `spare`: a call the product
 * works without (the second reader) is refused once the last SPARE_RESERVE of either cap is reached, so it can never
 * use up the calls an order needs.
 */
export function reserveLlmCall(now = new Date(), opts: { spare?: boolean } = {}): void {
  // The sample activity's scripted models (server/alive) are not model calls: they cost nothing and use no cap.
  if (playingNow()) return;
  if (env("DOCK_LLM") === "off") throw new DockError(503, "llm_disabled", "Model calls are switched off on this server.", "demo_budget");
  const c = counter("llm", now);
  const room = opts.spare ? 1 - SPARE_RESERVE : 1;
  if (c.calls >= int(env("DOCK_LLM_DAILY_CALLS"), 500) * room) throw demoLimit("the number of model calls");
  if (c.usd >= int(env("DOCK_LLM_DAILY_USD"), 5) * room) throw demoLimit("the model spend");
  c.calls++;
}

/** Whether a model call would be allowed now, without counting one: the thread degrades before it fails. */
export function llmRoom(now = new Date()): boolean {
  if (env("DOCK_LLM") === "off") return false;
  const c = counter("llm", now);
  return c.calls < int(env("DOCK_LLM_DAILY_CALLS"), 500) && c.usd < int(env("DOCK_LLM_DAILY_USD"), 5);
}

/** After a model call: add what it cost (null = unknown price; counted as 1 cent). */
export function recordLlmSpend(usd: number | null, now = new Date()): void {
  if (playingNow()) return;
  counter("llm", now).usd += usd ?? 0.01;
}

/**
 * Before one of smart search's model calls (the relevance judge, a query embedding). Its own daily count, so a busy
 * catalogue search box never uses up the calls an order needs; its spend counts in the shared daily USD cap, and
 * search stops calling once that cap's last SPARE_RESERVE is reached. False: skip the call (search falls back).
 */
export function admitSearchCall(now = new Date()): boolean {
  if (env("DOCK_LLM") === "off") return false;
  const c = counter("search", now);
  if (c.calls >= int(env("DOCK_SEARCH_DAILY_CALLS"), 5000)) return false;
  if (counter("llm", now).usd >= int(env("DOCK_LLM_DAILY_USD"), 5) * (1 - SPARE_RESERVE)) return false;
  c.calls++;
  return true;
}

/** Before a request to the partner's live price/availability API. */
export function reserveLiveLookup(now = new Date()): void {
  const c = counter("live", now);
  if (c.calls >= int(env("DOCK_LIVE_DAILY_CALLS"), 3000)) throw demoLimit("live price and availability lookups");
  c.calls++;
}

export function dailyUsage(now = new Date()) {
  const llm = counter("llm", now);
  const live = counter("live", now);
  const search = counter("search", now);
  return {
    day: llm.day,
    llm: { calls: llm.calls, usd: Math.round(llm.usd * 10_000) / 10_000, maxCalls: int(env("DOCK_LLM_DAILY_CALLS"), 500), maxUsd: int(env("DOCK_LLM_DAILY_USD"), 5), enabled: env("DOCK_LLM") !== "off" },
    live: { calls: live.calls, maxCalls: int(env("DOCK_LIVE_DAILY_CALLS"), 3000) },
    search: { calls: search.calls, maxCalls: int(env("DOCK_SEARCH_DAILY_CALLS"), 5000) },
  };
}

/** Tests only. */
export function resetDailyUsage(): void {
  days().clear();
}

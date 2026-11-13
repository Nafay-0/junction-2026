import { createHash } from "node:crypto";
import { DockError } from "@/core/errors";
import { localNow } from "@/core/kitchen";

/**
 * The paid interpreter (a model call per request) behind a per-caller allowance and a same-day answer cache.
 *
 *   caller     one on-site console browser session, or one outside agent (organisation and agent id)
 *   allowance  DOCK_INTERPRET_PER_HOUR model calls per caller and hour (default 30); answers from the cache are free
 *   cache      the same text for the same kitchen on the same Helsinki day gets the same answer, without a model call
 *
 * Every reply carries RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset; over the allowance it is 429 with
 * Retry-After. The process-wide daily caps on model calls and spend stay in server/limits.ts.
 */
const WINDOW_MS = 3600_000;
const CACHE_MAX = 1000;

const perHour = () => {
  const n = Number(process.env.DOCK_INTERPRET_PER_HOUR ?? "");
  return Number.isFinite(n) && n >= 0 && (process.env.DOCK_INTERPRET_PER_HOUR ?? "").trim() !== "" ? n : 30;
};

type Window = { start: number; count: number };
const g = globalThis as typeof globalThis & { __dockInterpretQuota?: { windows: Map<string, Window>; cache: Map<string, { day: string; value: unknown }> } };
const state = (g.__dockInterpretQuota ??= { windows: new Map(), cache: new Map() });

export type QuotaHeaders = Record<string, string>;

function windowOf(key: string, now: number): Window {
  let w = state.windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    state.windows.set(key, w);
    if (state.windows.size > 20_000) state.windows.delete(state.windows.keys().next().value!);
  }
  return w;
}

function headers(w: Window, limit: number, now: number): QuotaHeaders {
  return {
    "ratelimit-limit": String(limit),
    "ratelimit-remaining": String(Math.max(0, limit - w.count)),
    "ratelimit-reset": String(Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000))),
  };
}

export function cacheKey(scope: string, body: unknown, now = new Date()): { key: string; day: string } {
  const day = localNow(now).date;
  return { key: createHash("sha256").update(JSON.stringify([scope, day, body])).digest("hex"), day };
}

/** A cached answer for this caller's kitchen, text and day, or undefined. Free: it does not count. */
export function cachedInterpretation(key: string, day: string): unknown {
  const hit = state.cache.get(key);
  return hit && hit.day === day ? structuredClone(hit.value) : undefined;
}

export function rememberInterpretation(key: string, day: string, value: unknown): void {
  state.cache.set(key, { day, value: structuredClone(value) });
  while (state.cache.size > CACHE_MAX) state.cache.delete(state.cache.keys().next().value!);
}

/** Count one model call for this caller, or throw 429 (with the headers to send). Returns the headers for the reply. */
export function takeInterpretCall(caller: string, now = Date.now()): QuotaHeaders {
  const limit = perHour();
  const w = windowOf(caller, now);
  if (w.count >= limit) {
    const h = headers(w, limit, now);
    throw Object.assign(
      new DockError(429, "interpret_quota_exceeded", `This console or agent used its ${limit} free-text interpretations for this hour. Type the request in the form, or try again in ${Math.ceil(Number(h["ratelimit-reset"]) / 60)} min.`, "interpret_quota", { limit, retryAfterSeconds: Number(h["ratelimit-reset"]) }),
      { headers: { ...h, "retry-after": h["ratelimit-reset"] } },
    );
  }
  w.count++;
  return headers(w, limit, now);
}

/** The headers for a reply that cost nothing (a cached answer). */
export function quotaHeaders(caller: string, now = Date.now()): QuotaHeaders {
  return headers(windowOf(caller, now), perHour(), now);
}

/** Tests only. */
export function resetInterpretQuota(): void {
  state.windows.clear();
  state.cache.clear();
}

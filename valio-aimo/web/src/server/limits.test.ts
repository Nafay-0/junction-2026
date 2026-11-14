import { afterEach, describe, expect, it } from "vitest";
import { RateLimiter, clientAddress, dailyUsage, recordLlmSpend, reserveLiveLookup, reserveLlmCall, resetDailyUsage } from "./limits";

const KEYS = ["DOCK_LLM", "DOCK_LLM_DAILY_USD", "DOCK_LLM_DAILY_CALLS", "DOCK_LIVE_DAILY_CALLS", "DOCK_TRUSTED_PROXY_HOPS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetDailyUsage();
});

describe("RateLimiter", () => {
  const rule = { name: "t", limit: 3, windowMs: 60_000 };
  it("allows up to the limit per key and window, then says when to retry", () => {
    const l = new RateLimiter();
    expect([0, 1, 2].map(() => l.hit(rule, "a", 1_000))).toEqual([null, null, null]);
    expect(l.hit(rule, "a", 31_000)).toBe(30);
    expect(l.hit(rule, "b", 31_000)).toBeNull();
    expect(l.hit(rule, "a", 61_000)).toBeNull(); // new window
  });
  it("keeps memory bounded", () => {
    const l = new RateLimiter(100);
    for (let i = 0; i < 1000; i++) l.hit(rule, `k${i}`, 0);
    expect(l.size).toBeLessThanOrEqual(100);
  });
});

describe("clientAddress", () => {
  it("takes the address the edge appended, not one the client sent", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    process.env.DOCK_TRUSTED_PROXY_HOPS = "2";
    expect(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});

describe("daily caps", () => {
  it("refuses model calls past the call cap with a named demo limit", () => {
    process.env.DOCK_LLM_DAILY_CALLS = "2";
    reserveLlmCall();
    reserveLlmCall();
    expect(() => reserveLlmCall()).toThrow(expect.objectContaining({ status: 429, code: "demo_limit_reached", rule: "demo_budget" }));
  });
  it("refuses model calls once today's spend reaches the cap, and resets the next day", () => {
    process.env.DOCK_LLM_DAILY_USD = "1";
    const day1 = new Date("2026-11-14T10:00:00Z");
    reserveLlmCall(day1);
    recordLlmSpend(1.2, day1);
    expect(() => reserveLlmCall(day1)).toThrow(/model spend/);
    expect(() => reserveLlmCall(new Date("2026-11-15T00:00:01Z"))).not.toThrow();
  });
  it("switches model calls off with DOCK_LLM=off", () => {
    process.env.DOCK_LLM = "off";
    expect(() => reserveLlmCall()).toThrow(expect.objectContaining({ status: 503, code: "llm_disabled" }));
  });
  it("caps live partner lookups", () => {
    process.env.DOCK_LIVE_DAILY_CALLS = "1";
    reserveLiveLookup();
    expect(() => reserveLiveLookup()).toThrow(/live price and availability/);
    expect(dailyUsage().live.calls).toBe(1);
  });
});

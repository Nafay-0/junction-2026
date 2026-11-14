import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheKey, cachedInterpretation, rememberInterpretation, resetInterpretQuota, takeInterpretCall } from "./interpret-quota";

/** F-MODEL-SPEND: the paid interpreter is metered per caller, says so in headers, and repeats are free. */
describe("interpreter allowance", () => {
  const env = { ...process.env };
  beforeEach(() => {
    resetInterpretQuota();
    process.env.DOCK_INTERPRET_PER_HOUR = "3";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("counts model calls per caller and refuses with 429 and Retry-After over the hour's allowance", () => {
    const t = Date.parse("2026-11-13T10:00:00Z");
    expect(takeInterpretCall("console:kaari:a", t)).toMatchObject({ "ratelimit-limit": "3", "ratelimit-remaining": "2" });
    takeInterpretCall("console:kaari:a", t);
    takeInterpretCall("console:kaari:a", t);
    let refused: unknown;
    try {
      takeInterpretCall("console:kaari:a", t + 1000);
    } catch (err) {
      refused = err;
    }
    expect(refused).toMatchObject({ status: 429, code: "interpret_quota_exceeded", headers: { "retry-after": expect.any(String), "ratelimit-remaining": "0" } });
    expect(takeInterpretCall("console:kaari:b", t)["ratelimit-remaining"]).toBe("2"); // another person at the console
    expect(takeInterpretCall("console:kaari:a", t + 3600_000)["ratelimit-remaining"]).toBe("2"); // next hour
  });

  it("answers the same text for the same kitchen on the same Helsinki day from the cache", () => {
    const now = new Date("2026-11-13T21:30:00Z"); // 23:30 in Helsinki
    const a = cacheKey("org_kaari", { text: "10 L milk for Tuesday" }, now);
    rememberInterpretation(a.key, a.day, { need: { x: 1 } });
    expect(cachedInterpretation(a.key, a.day)).toEqual({ need: { x: 1 } });
    expect(cacheKey("org_laakso", { text: "10 L milk for Tuesday" }, now).key).not.toBe(a.key);
    const tomorrow = cacheKey("org_kaari", { text: "10 L milk for Tuesday" }, new Date("2026-11-13T22:30:00Z")); // 00:30 Helsinki, next day
    expect(tomorrow.day).toBe("2026-11-14");
    expect(cachedInterpretation(tomorrow.key, tomorrow.day)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { clockOffset, priceMsLeft } from "./price-clock";

describe("the sign-off screen's countdown does not trust the phone's clock", () => {
  const serverNow = "2026-11-14T10:00:00.000Z";
  const priceHeldUntil = "2026-11-14T10:20:00.000Z"; // 20 minutes left, by the server

  it.each([
    ["right", 0],
    ["45 minutes fast", 45 * 60_000],
    ["3 hours fast", 3 * 3600_000],
    ["2 hours slow", -2 * 3600_000],
    ["a year off", 365 * 86_400_000],
  ])("a phone whose clock is %s still has 20 minutes to sign", (_name, skew) => {
    const phoneNow = Date.parse(serverNow) + skew; // what the phone thinks the time is when the view arrives
    const offset = clockOffset(serverNow, phoneNow);
    expect(priceMsLeft(priceHeldUntil, phoneNow, offset)).toBe(20 * 60_000);
    // Five minutes later on the phone's own (wrong) clock: fifteen left.
    expect(priceMsLeft(priceHeldUntil, phoneNow + 5 * 60_000, offset)).toBe(15 * 60_000);
    // What the screen did before (the phone's clock against the server's time): signing was hidden for a fast phone.
    const before = Date.parse(priceHeldUntil) - phoneNow;
    if (skew > 20 * 60_000) expect(before).toBeLessThan(0);
  });

  it("falls back to the phone's clock only when the server sent no time", () => {
    expect(clockOffset(undefined, 123)).toBe(0);
    expect(clockOffset("not a date", 123)).toBe(0);
  });
});

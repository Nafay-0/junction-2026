import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cutoffDay } from "./agent";

describe("the day a cut-off question names", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:30:00Z")); // Sunday 15 Nov, Helsinki morning
  });
  afterAll(() => vi.useRealTimers());
  it("is the next such day, in three languages, or a date given", () => {
    expect(cutoffDay("when is the order cut-off for Friday delivery?")).toBe("2026-11-20");
    expect(cutoffDay("mihin mennessä pitää tilata perjantaiksi?")).toBe("2026-11-20");
    expect(cutoffDay("när måste jag beställa till tisdag?")).toBe("2026-11-17");
    expect(cutoffDay("cut-off for 2026-11-19?")).toBe("2026-11-19");
    expect(cutoffDay("when is the cut-off?")).toBeUndefined();
  });
});

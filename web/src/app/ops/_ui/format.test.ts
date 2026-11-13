import { describe, expect, it } from "vitest";
import { fi as fiRaw, money as moneyRaw, stamp } from "./format";

// No-break spaces read as spaces here, so the expectations stay legible.
const fi = (t: string) => fiRaw(t).replaceAll("\u00a0", " ");
const money = (c: number) => moneyRaw(c).replaceAll("\u00a0", " ");

describe("fi: core sentences fit for the operations surface", () => {
  it("writes money and percentages the Finnish way", () => {
    expect(fi("Total €1,280.50 is over €500")).toBe("Total 1 280,50 € is over 500 €");
    expect(fi("costs 12.5 % more")).toBe("costs 12,5 % more");
  });

  it("turns ISO timestamps and dates into Helsinki words", () => {
    expect(fi("Quote holds its prices until 2026-11-13T23:24:25.606Z.")).toBe("Quote holds its prices until Sat 14.11. 01.24.");
    expect(fi("cut-off 2026-11-12T15:00:00+0200")).toBe("cut-off Thu 12.11. 15.00");
    expect(fi("order by 2026-11-15 17:00")).toBe("order by Sun 15.11. 17.00");
    expect(fi("delivery 2026-11-16")).toBe("delivery Mon 16.11.");
  });

  it("names units in words and never prints a placeholder amount", () => {
    expect(fi("€1.01 per ST")).toBe("1,01 € per piece");
    expect(fi("price 31,31 EUR/KI")).toBe("price 31,31 €/case");
    expect(fi("999999 packs available")).toBe("an unreported amount available");
  });

  it("formats money and stamps", () => {
    expect(money(128040)).toBe("1 280,40 €");
    expect(stamp("2026-11-13T21:54:00Z")).toBe("Fri 13.11. 23.54");
  });
});

import { describe, expect, it } from "vitest";
import { NeedSchema } from "@/core/need";
import { StandInError, standInInterpret } from "./interpret-standin";

const FRIDAY = "2026-11-13";

describe("stand-in interpreter (until /api/v1/agent/interpret lands)", () => {
  it("reads the partner's example sentence", () => {
    const need = standInInterpret("I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.", FRIDAY);
    expect(need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(need.item).toMatchObject({ text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] });
    expect(need.deliverBy).toBe("2026-11-16");
    expect(NeedSchema.safeParse(need).success).toBe(true);
  });

  it("reads Finnish dates, packs, preferences and same as last time", () => {
    expect(standInInterpret("12 boxes of milk for 18.11., cheapest", FRIDAY)).toMatchObject({ quantity: { amount: 12, unit: "pack" }, deliverBy: "2026-11-18", optimise: "price" });
    expect(standInInterpret("100 L milk for Wednesday, lowest CO2", FRIDAY)).toMatchObject({ deliverBy: "2026-11-18", optimise: "co2" });
    const same = standInInterpret("Same as last time, for Friday", FRIDAY);
    expect(same).toMatchObject({ sameAsLastTime: true, deliverBy: "2026-11-20", item: { category: "milk" } });
    expect(NeedSchema.safeParse(same).success).toBe(true);
    expect(standInInterpret("60 litres of oat drink tomorrow", FRIDAY)).toMatchObject({ item: { category: "plant_drink" }, deliverBy: "2026-11-14" });
  });

  it("says what is missing instead of guessing", () => {
    expect(() => standInInterpret("some milk please", FRIDAY)).toThrow(StandInError);
    expect(() => standInInterpret("10 kg of butter", FRIDAY)).toThrow(StandInError);
  });
});

import { describe, expect, it } from "vitest";
import { marksSummary, type LineMarks } from "@/core/line-marks";
import { THREAD_MARKS_TEXT } from "./thread-marks.text";
import { co2Summary, dishCo2, kgText, recordSummary } from "./thread-marks.words";

const good: LineMarks = { delivery: { share: 0.98, n: 10, of: 10, poor: false }, co2Kg: 12.3 };
const poor: LineMarks = { delivery: { share: 0.5, n: 5, of: 10, poor: true }, co2Kg: 24.4 };
const en = THREAD_MARKS_TEXT.en;

describe("the summary line under a list's total", () => {
  it("all good: says so, and the footprint with ≈ and the decimal comma", () => {
    const s = marksSummary([good, good, good]);
    expect(recordSummary(s, en)).toBe("All 3 have a good delivery record");
    expect(co2Summary(s, en)).toBe("≈ 37 kg CO₂e");
  });
  it("one poor: names how many", () => {
    const s = marksSummary([good, poor, good]);
    expect(recordSummary(s, en)).toBe("1 of 3 has a poor delivery record");
    expect(recordSummary(s, THREAD_MARKS_TEXT.fi)).toBe("1/3: heikko toimitushistoria");
    expect(recordSummary(s, THREAD_MARKS_TEXT.sv)).toBe("1 av 3 har svag leveranshistorik");
  });
  it("a line without figures: the footprint says it covers only part", () => {
    const s = marksSummary([good, undefined]);
    expect(recordSummary(s, en)).toBe("1 of 2 has a good delivery record, 1 no record");
    expect(co2Summary(s, en)).toBe("≈ 12 kg CO₂e for 1 of 2");
  });
  it("nothing known: nothing said", () => {
    const s = marksSummary([undefined, {}]);
    expect(recordSummary(s, en)).toBeUndefined();
    expect(co2Summary(s, en)).toBeUndefined();
    expect(dishCo2(s, en, 20)).toBeUndefined();
  });
  it("the dish: its footprint and a portion's", () => {
    const s = marksSummary([{ co2Kg: 7.2 }, { co2Kg: 4.8 }]);
    expect(dishCo2(s, en, 20)).toBe("≈ 12 kg CO₂e for the dish, ≈ 0,6 kg a portion");
    expect(dishCo2(s, THREAD_MARKS_TEXT.fi, 20)).toBe("≈ 12 kg CO₂e ruoalle, ≈ 0,6 kg annokselta");
    expect(dishCo2(s, en, null)).toBe("≈ 12 kg CO₂e for the dish");
  });
  it("kilos: never 0", () => {
    expect([37.4, 2.44, 0.06, 0.001].map((v) => kgText(v, en))).toEqual(["37", "2,4", "0,06", "under 0,01"]);
  });
});

import type { MarksSummary } from "@/core/line-marks";
import { num } from "../../_ui/plain";
import type { THREAD_MARKS_TEXT } from "./thread-marks.text";

type T = (typeof THREAD_MARKS_TEXT)["en"];

/** "12", "2,4", "0,06": an estimate's kilos with the decimal comma; never "0" (a tiny figure says "under 0,01"). */
export function kgText(v: number, t: T): string {
  if (v >= 10) return num(v, 0);
  if (v >= 0.1) return num(v, 1);
  return v >= 0.01 ? num(v, 2) : t.under(num(0.01, 2));
}

/** The list's delivery summary ("All 3 have a good delivery record", "1 of 3 has a poor delivery record"), or nothing. */
export function recordSummary(s: MarksSummary, t: T): string | undefined {
  if (!s.withRecord) return undefined;
  if (s.poor) return t.somePoor(s.poor, s.lines);
  return s.withRecord === s.lines ? t.allGood(s.lines) : t.someUnknown(s.withRecord, s.lines);
}

/** The list's footprint ("≈ 37 kg CO₂e"; "≈ 21 kg CO₂e for 2 of 3" when some lines have no figure), or nothing. */
export function co2Summary(s: MarksSummary, t: T): string | undefined {
  if (s.co2Kg === undefined) return undefined;
  const v = kgText(s.co2Kg, t);
  return s.co2Lines === s.lines ? t.co2(v) : t.co2Of(v, s.co2Lines, s.lines);
}

/** The dish's footprint and a portion's ("≈ 12 kg CO₂e for the dish, ≈ 0,6 kg a portion"), or the list's when partial. */
export function dishCo2(s: MarksSummary, t: T, covers: number | null, menu = false): string | undefined {
  if (s.co2Kg === undefined) return undefined;
  if (s.co2Lines < s.lines) return co2Summary(s, t);
  const per = covers && covers > 0 ? kgText(s.co2Kg / covers, t) : undefined;
  return (menu ? t.menu : t.dish)(kgText(s.co2Kg, t), per);
}

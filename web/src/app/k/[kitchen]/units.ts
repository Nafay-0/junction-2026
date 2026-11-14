import { num } from "../../_ui/plain";
import type { Lang } from "../../_i18n/lang";
import type { Product } from "./types";

/**
 * The units the wholesaler sells in (its own codes: KI, ST, KG, ...) as words, and what a quantity of them
 * means for the kitchen in litres, kilograms or pieces, from the pack content in the product data. When the
 * pack content is not certain, the shop says so instead of guessing.
 */
const UNIT: Record<string, [string, string]> = {
  KI: ["case", "cases"],
  CS: ["case", "cases"],
  ST: ["piece", "pieces"],
  KG: ["kg", "kg"],
  PAK: ["pack", "packs"],
  BAG: ["bag", "bags"],
  RAS: ["box", "boxes"],
  PRK: ["tub", "tubs"],
  BOT: ["bottle", "bottles"],
  SK: ["sack", "sacks"],
  KRT: ["carton", "cartons"],
  KAN: ["canister", "canisters"],
  PAL: ["pallet", "pallets"],
  NIP: ["bundle", "bundles"],
  DSP: ["display", "displays"],
  DZ: ["dozen", "dozen"],
};

/** Finnish: the second form is the partitive that follows a number ("3 laatikkoa"). */
const UNIT_FI: Record<string, [string, string]> = {
  KI: ["laatikko", "laatikkoa"],
  CS: ["laatikko", "laatikkoa"],
  ST: ["kpl", "kpl"],
  KG: ["kg", "kg"],
  PAK: ["pakkaus", "pakkausta"],
  BAG: ["pussi", "pussia"],
  RAS: ["rasia", "rasiaa"],
  PRK: ["purkki", "purkkia"],
  BOT: ["pullo", "pulloa"],
  SK: ["säkki", "säkkiä"],
  KRT: ["kartonki", "kartonkia"],
  KAN: ["kanisteri", "kanisteria"],
  PAL: ["lava", "lavaa"],
  NIP: ["nippu", "nippua"],
  DSP: ["display", "displayta"],
  DZ: ["tusina", "tusinaa"],
};

const UNIT_SV: Record<string, [string, string]> = {
  KI: ["kartong", "kartonger"],
  CS: ["kartong", "kartonger"],
  ST: ["st", "st"],
  KG: ["kg", "kg"],
  PAK: ["förpackning", "förpackningar"],
  BAG: ["påse", "påsar"],
  RAS: ["ask", "askar"],
  PRK: ["burk", "burkar"],
  BOT: ["flaska", "flaskor"],
  SK: ["säck", "säckar"],
  KRT: ["kartong", "kartonger"],
  KAN: ["dunk", "dunkar"],
  PAL: ["pall", "pallar"],
  NIP: ["knippe", "knippen"],
  DSP: ["display", "displayer"],
  DZ: ["dussin", "dussin"],
};

const UNITS: Record<Lang, Record<string, [string, string]>> = { en: UNIT, fi: UNIT_FI, sv: UNIT_SV };
const UNIT_FALLBACK: Record<Lang, [string, string]> = { en: ["pack", "packs"], fi: ["pakkaus", "pakkausta"], sv: ["förpackning", "förpackningar"] };

export function unitWord(p: Pick<Product, "salesUnit">, n: number, lang: Lang = "en"): string {
  const u = UNITS[lang][p.salesUnit ?? ""] ?? UNIT_FALLBACK[lang];
  return n === 1 ? u[0] : u[1];
}

/** Step of the quantity control: the lot size when it is a whole number, else 1 (0.01 means "any"). */
export function stepOf(p: Pick<Product, "lotSize">): number {
  const l = p.lotSize ?? 1;
  return l >= 1 ? Math.round(l) : 1;
}

const fmt = (n: number) => num(n, 2);

export type Measure = { amount: number; unit: "L" | "kg" | "pcs"; certain: boolean };

/** What `n` sales units hold: litres or kilograms when the data says, else base pieces, else nothing. */
export function contentOf(p: Product, n: number): Measure | undefined {
  const pc = p.packContent;
  if (pc) {
    if (pc.perSalesUnit.L !== undefined) return { amount: pc.perSalesUnit.L * n, unit: "L", certain: pc.certainMeasures.includes("L") };
    if (pc.perSalesUnit.kg !== undefined) return { amount: pc.perSalesUnit.kg * n, unit: "kg", certain: pc.certainMeasures.includes("kg") };
    if (pc.baseUnitsPerSalesUnit && pc.baseUnitsPerSalesUnit > 1) return { amount: pc.baseUnitsPerSalesUnit * n, unit: "pcs", certain: true };
    return undefined;
  }
  return { amount: p.packSize * n, unit: p.unit, certain: true };
}

const MEASURE_WORDS: Record<Lang, { none: string; pieces: string; about: (v: string) => string }> = {
  en: { none: "content: no data", pieces: "pieces", about: (v) => `about ${v} (not certain)` },
  fi: { none: "sisältö: ei tietoa", pieces: "kpl", about: (v) => `noin ${v} (ei varma)` },
  sv: { none: "innehåll: uppgift saknas", pieces: "st", about: (v) => `cirka ${v} (osäkert)` },
};

export function measureText(m: Measure | undefined, lang: Lang = "en"): string {
  const w = MEASURE_WORDS[lang];
  if (!m) return w.none;
  const v = m.unit === "pcs" ? `${fmt(m.amount)} ${w.pieces}` : `${fmt(m.amount)} ${m.unit}`;
  return m.certain ? v : w.about(v);
}

/** "3 cases = 30 L", "3 laatikkoa = 30 L", "3 kartonger = 30 L" */
export function quantityText(p: Product, n: number, lang: Lang = "en"): string {
  const m = contentOf(p, n);
  const head = `${fmt(n)} ${unitWord(p, n, lang)}`;
  if (!m || (p.salesUnit === "KG" && m.unit === "kg")) return head;
  return `${head} = ${measureText(m, lang)}`;
}

/** kg CO2e for `n` sales units from the product-group average (per kg); a litre counts as a kilo. Null without data. */
export function co2Of(p: Product, n: number): number | null {
  const perKg = p.carbonGroupAvgKgCo2ePerKg;
  if (perKg == null) return null;
  const m = contentOf(p, n);
  if (!m || m.unit === "pcs") return null;
  return perKg * m.amount;
}

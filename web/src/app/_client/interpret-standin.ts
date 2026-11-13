import type { NeedInput } from "@/core/need";

/**
 * OFFLINE EXAMPLE reader. POST /api/v1/agent/interpret (a model) is the real reader; this fixed-rule reader
 * covers the demo sentences for when the model is down or the server has no interpret route, so the console
 * still works end to end: amounts in litres, kilos, packs or pieces; milk, cream, yoghurt and oat drink; lactose-free,
 * organic and fat content; "by Monday", "tomorrow", "17.11."; cheapest, lowest CO2, most reliable;
 * "same as last time". It is labelled "offline example" wherever its result is shown.
 */
export const STAND_IN_MODEL = "the offline example reader (fixed rules, no model)";

export class StandInError extends Error {}

const WEEKDAY: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseNumber(raw: string): number {
  const s = raw.trim();
  if (/^\d{1,3}([ ,. ]\d{3})+$/.test(s)) return Number(s.replace(/[ ,. ]/g, "")); // 1,000 / 1 000 / 1.000
  return Number(s.replace(",", "."));
}

/** Read one buyer sentence. `today` is the kitchen's local date (YYYY-MM-DD, Helsinki). */
export function standInInterpret(text: string, today: string): NeedInput {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) throw new StandInError("Write what the kitchen needs, for example “100 litres of milk for Thursday”.");

  const sameAsLastTime = /\bsame as (last time|usual|before|last week)\b|\bthe usual\b|\brepeat (the )?last order\b/.test(t);

  // Amount
  let quantity: NeedInput["quantity"];
  const q = /(\d{1,3}(?:[ ,. ]\d{3})+|\d+(?:[.,]\d+)?)\s*(litres?|liters?|ltrs?|l|kilos?|kg|packs?|boxes|box|cartons?|cases?|pcs|pieces?)\b/.exec(t);
  if (q) {
    const n = parseNumber(q[1]);
    const u = q[2];
    const unit = /^l/.test(u) ? "L" : /^k/.test(u) ? "kg" : /^(pcs|piece)/.test(u) ? "pcs" : "pack";
    if (Number.isFinite(n) && n > 0) quantity = { amount: n, unit };
  }

  // Item
  let category: string | undefined;
  let base = "";
  if (/\boat\b|plant drink|oat drink|oat milk/.test(t)) [category, base] = ["plant_drink", "oat drink"];
  else if (/\bcream\b/.test(t)) [category, base] = ["cream", "cream"];
  else if (/yoghurt|yogurt/.test(t)) [category, base] = ["yoghurt", "yoghurt"];
  else if (/\bmilk\b/.test(t) || sameAsLastTime) [category, base] = ["milk", "milk"];
  if (!category) throw new StandInError("The stand-in reader knows milk, cream, yoghurt and oat drink. Try “100 litres of milk for Thursday”.");

  const attributes: string[] = [];
  const excludedAttributes: string[] = [];
  const words: string[] = [];
  if (/lactose[- ]?free|no lactose|without lactose/.test(t)) {
    attributes.push("lactose_free");
    words.push("lactose-free");
  } else if (/\b(regular|ordinary|normal)\b/.test(t) && category === "milk") {
    excludedAttributes.push("lactose_free");
    words.push("regular");
  }
  if (/\borganic\b/.test(t)) {
    attributes.push("organic");
    words.push("organic");
  }
  if (category === "milk") {
    const fat: [RegExp, string, string][] = [
      [/semi[- ]?skimmed|1[.,]5 ?%/, "fat_1_5", "semi-skimmed"],
      [/\bwhole\b|full[- ]fat|3[.,]5 ?%/, "fat_3_5", "whole"],
      [/fat[- ]free|skimmed|skim\b|0[.,]1 ?%/, "fat_free", "fat-free"],
    ];
    const hit = fat.find(([re]) => re.test(t));
    if (hit) {
      attributes.push(hit[1]);
      words.push(hit[2]);
    }
  }

  const forbiddenAllergens: string[] = [];
  if (/gluten[- ]free|no gluten/.test(t)) forbiddenAllergens.push("gluten");
  if (/nut[- ]free|no nuts/.test(t)) forbiddenAllergens.push("nuts");

  // Delivery date
  let deliverBy: string | undefined;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  const fi = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})?/.exec(t);
  const wd = /\b(?:by|for|on|before|next|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/.exec(t);
  if (iso) deliverBy = iso[1];
  else if (fi) {
    const year = fi[3] ? Number(fi[3]) : Number(today.slice(0, 4));
    let d = `${year}-${fi[2].padStart(2, "0")}-${fi[1].padStart(2, "0")}`;
    if (!fi[3] && d < today) d = `${year + 1}${d.slice(4)}`;
    deliverBy = d;
  } else if (/\btomorrow\b/.test(t)) deliverBy = addDays(today, 1);
  else if (/\btoday\b/.test(t)) deliverBy = today;
  else if (wd) {
    const want = WEEKDAY[wd[1]];
    const now = new Date(`${today}T12:00:00Z`).getUTCDay();
    deliverBy = addDays(today, (want - now + 7) % 7 || 7);
  }

  // What matters most
  let optimise: NeedInput["optimise"] = "unstated";
  if (/cheap|lowest price|best price|low price/.test(t)) optimise = "price";
  else if (/co2|carbon|climate|green|emission/.test(t)) optimise = "co2";
  else if (/reliab|on time|safest delivery/.test(t)) optimise = "reliability";
  else if (/no preference|doesn'?t matter|any(thing)? is fine/.test(t)) optimise = "no_preference";

  if (!quantity && !sameAsLastTime) throw new StandInError("Say how much, for example “100 litres”, or “same as last time”.");

  return {
    text: text.trim().slice(0, 2000),
    item: { text: [...words, base].join(" "), category, attributes, excludedAttributes },
    ...(quantity ? { quantity } : {}),
    ...(deliverBy ? { deliverBy } : {}),
    forbiddenAllergens,
    optimise,
    sameAsLastTime,
  };
}

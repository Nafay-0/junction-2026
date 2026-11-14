import { attrL } from "@/app/_i18n/format";
import { dayWords, type Lang } from "./refusal";

/**
 * Nothing is left out, swapped, reduced, rounded or moved to another day silently. One check, in plain code, for every
 * turn that proposes or places anything: what was asked or proposed (items, ingredients, amounts, the day) against
 * what the result contains. Every difference is said in the reply before any order is placed, with its reason (the
 * kitchen's rule by name and where it comes from, not sold, cannot arrive by the day, cannot be priced) and what the
 * buyer can do; one whose reason the engine does not have is said as such ("I couldn't find out why") and recorded
 * as a defect, never skipped. Until said, nothing that carries it is ordered (engine.ts tellDifferences, sheet.ts).
 */

export type Amount = { amount: number; unit: string };

/** Why something will not be bought as asked. */
export type Reason =
  /** Outside the product groups the kitchen's mandate allows (the categories the products found are in). */
  | { code: "rules_groups"; categories: string[] }
  /** The kitchen's allergen or dietary rule (its own words, and where it comes from). */
  | { code: "rule"; text: string; source?: string }
  /** A forbidden allergen of the kitchen's (its mandate's allergen list) found in the only product there is. */
  | { code: "allergen"; allergens: string[] }
  | { code: "not_sold" }
  | { code: "cannot_arrive"; day?: string; text?: string }
  | { code: "not_priced" }
  | { code: "unknown" };

/** What was asked for or proposed: an item of a request, an ingredient of a dish. */
export type Wanted = { key: string; name: string; need?: Amount; day?: string };
/** What the result holds for it: bought (with amount and day), bought as something else, or not bought (with why). */
export type Got = { key: string; out?: boolean; reason?: Reason; amount?: Amount; day?: string; instead?: string; insteadWhy?: Reason; packs?: string; pack?: Pack };
/** The packs an amount was rounded up to: how many, and what one holds. */
export type Pack = { count: number; size: number; unit: string };

export type Difference =
  | { kind: "left_out"; key: string; name: string; reason: Reason }
  | { kind: "swapped"; key: string; name: string; to: string; reason?: Reason }
  | { kind: "reduced"; key: string; name: string; from: Amount; to: Amount }
  | { kind: "rounded_up"; key: string; name: string; from: Amount; to: Amount; packs?: string; pack?: Pack }
  | { kind: "moved_day"; key: string; name: string; from: string; to: string };

/** The differences between what was wanted and what the result holds, in the wanted order. */
export function differencesOf(wanted: Wanted[], got: Got[], opts: { roundingCounts?: boolean } = {}): Difference[] {
  const out: Difference[] = [];
  for (const w of wanted) {
    const g = got.find((x) => x.key === w.key);
    if (!g || g.out) {
      out.push({ kind: "left_out", key: w.key, name: w.name, reason: g?.reason ?? { code: "unknown" } });
      continue;
    }
    if (g.instead) out.push({ kind: "swapped", key: w.key, name: w.name, to: g.instead, ...(g.insteadWhy ? { reason: g.insteadWhy } : {}) });
    if (w.need && g.amount && Number.isFinite(w.need.amount) && Number.isFinite(g.amount.amount) && sameUnit(w.need.unit, g.amount.unit)) {
      const a = toBase(w.need);
      const b = toBase(g.amount);
      if (b < a * 0.999) out.push({ kind: "reduced", key: w.key, name: w.name, from: w.need, to: g.amount });
      else if (opts.roundingCounts !== false && b > a * 1.001) out.push({ kind: "rounded_up", key: w.key, name: w.name, from: w.need, to: g.amount, ...(g.packs ? { packs: g.packs } : {}), ...(g.pack ? { pack: g.pack } : {}) });
    }
    if (w.day && g.day && g.day !== w.day) out.push({ kind: "moved_day", key: w.key, name: w.name, from: w.day, to: g.day });
  }
  return out;
}

const BASE: Record<string, [string, number]> = { kg: ["g", 1000], g: ["g", 1], l: ["ml", 1000], dl: ["ml", 100], ml: ["ml", 1], pcs: ["pcs", 1], kpl: ["pcs", 1] };
// A missing unit (an amount the buyer gave in packs, or one not known yet) is no comparison: never a throw.
const sameUnit = (a?: string, b?: string) => !!a && !!b && (BASE[a.toLowerCase()]?.[0] ?? a.toLowerCase()) === (BASE[b.toLowerCase()]?.[0] ?? b.toLowerCase());
const toBase = (x: Amount) => x.amount * (BASE[(x.unit ?? "").toLowerCase()]?.[1] ?? 1);

/** A stable key per difference: said once, remembered as said (the thread's `told`). */
export const keyOf = (d: Difference) => `${d.kind}:${d.key}:${d.kind === "swapped" ? d.to : d.kind === "moved_day" ? d.to : d.kind === "reduced" || d.kind === "rounded_up" ? `${d.to.amount}${d.to.unit}` : d.reason.code}`;

// ---------- in words ----------

const list = (xs: string[], lang: Lang) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : lang === "sv" ? "och" : "and"} ${xs.at(-1)}`);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const amt = (a: Amount) => `${num(a.amount)} ${a.unit === "L" ? "l" : a.unit}`;

export type Context = {
  lang: Lang;
  /** The groups the kitchen's mandate allows, in words ("dairy and cheese", "bakery"). */
  allowedGroups: string[];
  /** Whoever can widen the kitchen's rules here, when that can be asked from this conversation. */
  canAskOwner?: boolean;
  /** For a dish or a menu: how many ingredients it has to buy, and what can be bought (the "just these" choice). */
  dish?: { toBuy: number; buyable: string[]; left?: number; totalCents?: number; /** The earliest day every ingredient can come, when some cannot by the day asked. */ later?: string };
};

/**
 * The differences in one or two sentences, grouped by reason, and the one question that fits: for a dish not fully
 * buyable, the ways forward (ask the owner to add the groups, order just what can be bought, plan another dish);
 * otherwise whether to order it like that. `unknown` lists the differences said without a reason (a defect).
 */
export function sayDifferences(diffs: Difference[], c: Context): { said: string; ask: string; unknown: Difference[] } {
  const { lang } = c;
  const fi = lang === "fi";
  const sv = lang === "sv";
  const parts: string[] = [];
  const left = diffs.filter((d): d is Extract<Difference, { kind: "left_out" }> => d.kind === "left_out");
  const by = (code: Reason["code"]) => left.filter((d) => d.reason.code === code);
  const names = (ds: { name: string }[]) => list([...new Set(ds.map((d) => low(d.name)))], lang);
  if (c.dish && left.length) {
    const can = c.dish.toBuy - (c.dish.left ?? left.length);
    const t = c.dish.totalCents ? `${(c.dish.totalCents / 100).toFixed(2).replace(".", ",")} €` : "";
    parts.push(fi ? `Voin ostaa tälle keittiölle vain ${can}/${c.dish.toBuy} raaka-aineesta${t ? ` (${t} niistä)` : ""}.` : sv ? `Jag kan bara köpa ${can} av de ${c.dish.toBuy} ingredienserna för det här köket${t ? ` (${t} för dem)` : ""}.` : `I can only buy ${can} of the ${c.dish.toBuy} ingredients for this kitchen${t ? ` (${t} for those)` : ""}.`);
  }
  const rules = by("rules_groups");
  if (rules.length) {
    const allowed = list(c.allowedGroups, lang);
    parts.push(fi ? `Sääntönne (keittiön tuoteryhmät: ${allowed}) eivät kata näitä: ${names(rules)}.` : sv ? `Era regler (kökets produktgrupper: ${allowed}) omfattar inte ${names(rules)}.` : `Your rules (the kitchen's product groups: ${allowed}) don't cover ${names(rules)}.`);
  }
  for (const d of by("rule")) {
    const r = d.reason as Extract<Reason, { code: "rule" }>;
    parts.push(fi ? `${cap(low(d.name))} jää pois: sääntönne "${r.text}"${r.source ? ` (${r.source})` : ""}.` : sv ? `${cap(low(d.name))} blir kvar: er regel "${r.text}"${r.source ? ` (${r.source})` : ""}.` : `${cap(low(d.name))} is left off by your rule "${r.text}"${r.source ? ` (${r.source})` : ""}.`);
  }
  const allergic = by("allergen");
  if (allergic.length) {
    const a = list([...new Set(allergic.flatMap((d) => (d.reason.code === "allergen" ? d.reason.allergens : [])))].map((x) => attrL(x, lang).toLowerCase()), lang);
    parts.push(fi ? `${cap(names(allergic))}: löytämässäni tuotteessa on ${a}, jonka sääntönne (kielletyt allergeenit) sulkevat pois.` : sv ? `${cap(names(allergic))}: produkten jag hittade innehåller ${a}, som era regler (förbjudna allergener) utesluter.` : `${cap(names(allergic))}: the product I found contains ${a}, which your rules (the kitchen's forbidden allergens) rule out.`);
  }
  const notSold = by("not_sold");
  if (notSold.length) parts.push(fi ? `Tukulla ei ole myynnissä: ${names(notSold)}.` : sv ? `Grossisten säljer inte ${names(notSold)}.` : `The wholesaler doesn't sell ${names(notSold)}.`);
  const late = by("cannot_arrive");
  if (late.length) {
    const day = late.map((d) => (d.reason.code === "cannot_arrive" ? d.reason.day : undefined)).find(Boolean);
    const when = day ? dayWords(day, lang) : "";
    parts.push(fi ? `${cap(names(late))} ei ehdi ajoissa${when ? ` (${when})` : ""}: tilausaika on mennyt.` : sv ? `${cap(names(late))} hinner inte fram i tid${when ? ` till ${when}` : ""}: beställningstiden har gått ut.` : `${cap(names(late))} can't arrive in time${when ? ` for ${when}` : ""}: the order time has passed.`);
  }
  const unpriced = by("not_priced");
  if (unpriced.length) parts.push(fi ? `En saanut hintaa: ${names(unpriced)}.` : sv ? `Jag fick inget pris för ${names(unpriced)}.` : `I couldn't get a price for ${names(unpriced)}.`);
  const unknown = by("unknown");
  if (unknown.length) parts.push(fi ? `En saanut selville, miksi ${names(unknown)} jää pois.` : sv ? `Jag kunde inte ta reda på varför ${names(unknown)} blir kvar.` : `I couldn't find out why ${names(unknown)} ${unknown.length > 1 ? "are" : "is"} left off.`);
  for (const d of diffs) {
    if (d.kind === "swapped") parts.push(fi ? `${cap(low(d.name))}: tilalla ${d.to}.` : sv ? `${cap(low(d.name))}: ${d.to} i stället.` : `${cap(low(d.name))}: ${d.to} in its place.`);
    if (d.kind === "reduced") parts.push(fi ? `${cap(low(d.name))}: vain ${amt(d.to)} pyytämästäsi ${amt(d.from)}.` : sv ? `${cap(low(d.name))}: bara ${amt(d.to)} av de ${amt(d.from)} du bad om.` : `${cap(low(d.name))}: only ${amt(d.to)} of the ${amt(d.from)} you asked for.`);
    // "come in packs of 8,1 kg: 2 packs is 16,2 kg rather than 16 kg": the amount in the buyer's unit and in packs.
    if (d.kind === "rounded_up" && d.pack && d.pack.count > 0) parts.push(fi ? `${cap(low(d.name))} tulee ${amt({ amount: d.pack.size, unit: d.pack.unit })}:n pakkauksissa: ${d.pack.count} pakkausta on ${amt(d.to)} eikä ${amt(d.from)}.` : sv ? `${cap(low(d.name))} kommer i förpackningar om ${amt({ amount: d.pack.size, unit: d.pack.unit })}: ${d.pack.count} förpackningar är ${amt(d.to)} i stället för ${amt(d.from)}.` : `${cap(low(d.name))} come${/s$/i.test(d.name) ? "" : "s"} in packs of ${amt({ amount: d.pack.size, unit: d.pack.unit })}: ${d.pack.count} pack${d.pack.count === 1 ? " is" : "s are"} ${amt(d.to)} rather than ${amt(d.from)}.`);
    else if (d.kind === "rounded_up") parts.push(fi ? `${cap(low(d.name))}: ${amt(d.to)} eikä ${amt(d.from)}, lähimmät kokonaiset pakkaukset${d.packs ? ` (${d.packs})` : ""}.` : sv ? `${cap(low(d.name))}: ${amt(d.to)} i stället för ${amt(d.from)}, närmaste hela förpackningar${d.packs ? ` (${d.packs})` : ""}.` : `${cap(low(d.name))}: ${amt(d.to)} rather than ${amt(d.from)}, the nearest whole packs${d.packs ? ` (${d.packs})` : ""}.`);
    if (d.kind === "moved_day") parts.push(fi ? `${cap(low(d.name))} tulee ${dayWords(d.to, lang)}, ei ${dayWords(d.from, lang)}.` : sv ? `${cap(low(d.name))} kommer ${dayWords(d.to, lang)}, inte ${dayWords(d.from, lang)}.` : `${cap(low(d.name))} comes ${dayWords(d.to, lang)}, not ${dayWords(d.from, lang)}.`);
  }
  let ask: string;
  if (c.dish && left.length) {
    const just = c.dish.buyable.length ? (c.dish.buyable.length <= 6 ? list(c.dish.buyable.map(low), lang) : fi ? `ne ${c.dish.buyable.length}, jotka voin ostaa` : sv ? `de ${c.dish.buyable.length} jag kan köpa` : `${c.dish.buyable.length} I can buy`) : "";
    const owner = rules.length > 0 && !!c.canAskOwner;
    // Only what cannot arrive in time is missing: the way forward that gets the whole dish is the later day.
    const onlyLate = left.every((d) => d.reason.code === "cannot_arrive");
    const later = c.dish.later ? dayWords(c.dish.later, lang) : "";
    if (later && onlyLate) ask = fi ? `Kaikki ehtii ${later}. Siirränkö sen sinne, vai tilaanko vain ${just || "sen, minkä voin ostaa"}?` : sv ? `Allt hinner fram ${later}. Ska jag flytta den dit, eller beställa bara ${just || "det jag kan köpa"}?` : `All of it can arrive ${later}. Shall I move it there, or order just the ${just || "ones I can buy"}?`;
    else if (fi) ask = `${later ? `Siirränkö sen päivälle ${later}, ` : ""}${owner ? `${later ? "pyydänkö" : "Pyydänkö"} omistajaa lisäämään ne, ` : ""}${just ? `${owner ? "tilaanko" : "Tilaanko"} vain ${just}` : ""}${owner || just ? " vai " : ""}${owner || just ? "suunnittelenko" : "Suunnittelenko"} ruuan, jonka voin ostaa kokonaan?`;
    else if (sv) ask = `Ska jag ${later ? `flytta den till ${later}, ` : ""}${owner ? "be ägaren lägga till dem, " : ""}${just ? `beställa bara ${just}, ` : ""}${owner || just ? "eller " : ""}planera en rätt jag kan köpa helt?`;
    else ask = `Shall I ${later ? `move it to ${later}, when what's late can come, ` : ""}${owner ? "ask the owner to add them, " : ""}${just ? `order just the ${just}, ` : ""}${owner || just ? "or " : ""}plan a dish I can buy completely?`;
  } else ask = fi ? "Tilaanko sen näin?" : sv ? "Ska jag beställa det så?" : "Shall I order it like that?";
  return { said: parts.join(" "), ask, unknown };
}

// ---------- a request's item against the option that would be ordered ----------

/** One item as asked: what, how much, and the day (`exact`: on that day; else by it). */
export type AskedItem = { key: string; name: string; amount?: Amount; day?: string; exact?: boolean };
/** The option that would be ordered for it. */
export type OfferedItem = { delivered?: Amount; deliveryDate?: string; substituteFor?: string; title?: string; pack?: Pack };

/** The differences between an item as asked and the option that would be ordered: amount, day, a stand-in. */
export function optionDifferences(a: AskedItem, o: OfferedItem): Difference[] {
  const late = a.day && o.deliveryDate && (a.exact ? o.deliveryDate !== a.day : o.deliveryDate > a.day);
  return differencesOf(
    [{ key: a.key, name: a.name, ...(a.amount ? { need: a.amount } : {}), ...(late ? { day: a.day } : {}) }],
    [{ key: a.key, ...(o.delivered ? { amount: o.delivered } : {}), ...(late ? { day: o.deliveryDate } : {}), ...(o.substituteFor && o.title ? { instead: o.title } : {}), ...(o.pack ? { pack: o.pack } : {}) }],
  );
}

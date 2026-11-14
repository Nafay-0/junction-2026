import { dayWords, readable } from "./refusal";
import type { OptionView } from "./types";
import { shortName } from "./watch";

/**
 * Ranked options said in words (good, better, best), for a buyer who reads only the sentence or hears it on the voice
 * door: the first option with its total and the one reason it is first, then what each other one trades off, in a few
 * words. Plain code, from the options card alone (names, totals, the option's own reason codes).
 */

type Lang = "en" | "fi" | "sv";

const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

/** An option as people name it: the product's short name, or "part Arla, part Valio Eila" for a basket. */
export function optionName(o: Pick<OptionView, "title" | "lines">, lang: Lang): string {
  const short = (n: string) => readable(shortName(n.replace(/[®™]/g, "").replace(/^(Valio )?Hyvä suomalainen /i, "$1")), lang);
  if (o.lines.length > 1) {
    const [a, b] = o.lines.map((l) => short(l.name).split(/\s+/).slice(0, 2).join(" "));
    return { en: `part ${a}, part ${b}`, fi: `osin ${a}, osin ${b}`, sv: `delvis ${a}, delvis ${b}` }[lang];
  }
  // "Valio Arki Eila semi" reads as cut: a trailing word that only describes the kind goes.
  return short(o.lines[0]?.name ?? o.title).replace(/(\s+(semi|skimmed|whole|milk|drink|lactose|free|UHT))+$/i, "");
}

/** Why the first option is first, from its own reason codes; the day it can arrive when that is the reason. */
function whyFirst(o: OptionView, lang: Lang): string {
  const has = (c: string) => o.reasons.some((r) => r.code === c);
  const day = o.deliveryDate ? dayWords(o.deliveryDate, lang) : "";
  if (has("same_as_last_time") || has("usual")) return { en: "closest to your usual", fi: "lähimpänä tavallista", sv: "närmast det vanliga" }[lang];
  if (has("cheapest") || has("joint_cheapest")) return day ? { en: `the cheapest that can arrive ${day}`, fi: `edullisin, joka ehtii ${day}`, sv: `billigast som hinner fram ${day}` }[lang] : { en: "the cheapest", fi: "edullisin", sv: "billigast" }[lang];
  if (has("lowest_co2")) return { en: "the lowest carbon", fi: "pienin hiilijalanjälki", sv: "lägst klimatavtryck" }[lang];
  if (has("most_reliable")) return { en: "the most reliable delivery", fi: "luotettavin toimitus", sv: "säkrast leverans" }[lang];
  return { en: "the closest match", fi: "lähin vastine", sv: "närmast det du bad om" }[lang];
}

/** What another option trades off against the first, in a few words. */
function tradeOff(o: OptionView, first: OptionView, lang: Lang): string {
  const n0 = optionName(o, lang);
  // "part Arla, part Valio Eila" takes no article.
  const name = lang === "en" && !/^part /.test(n0) ? `the ${n0}` : n0;
  const diff = o.totalCents - first.totalCents;
  const has = (c: string) => o.reasons.some((r) => r.code === c);
  const plus = has("most_reliable") ? { en: " but delivers most reliably", fi: ", mutta toimitus on luotettavin", sv: " men levereras säkrast" }[lang] : has("lowest_co2") ? { en: " but has the lowest carbon", fi: ", mutta hiilijalanjälki on pienin", sv: " men har lägst klimatavtryck" }[lang] : "";
  if (diff > 0) return { en: `${name} costs ${eur(diff)} more${plus}`, fi: `${name} maksaa ${eur(diff)} enemmän${plus}`, sv: `${name} kostar ${eur(diff)} mer${plus}` }[lang];
  if (diff < 0) return { en: `${name} costs ${eur(-diff)} less`, fi: `${name} maksaa ${eur(-diff)} vähemmän`, sv: `${name} kostar ${eur(-diff)} mindre` }[lang];
  return { en: `${name} costs the same${plus}`, fi: `${name} maksaa saman${plus}`, sv: `${name} kostar lika mycket${plus}` }[lang];
}

/** "The Valio Eila is first at 1 010,00 €: the cheapest that can arrive Monday 16 Nov. The Valio UHT costs 550,00 € more." */
export function optionsSaid(options: OptionView[], lang: Lang): string | undefined {
  const can = options.filter((o) => o.gate?.outcome !== "reject");
  if (can.length < 2) return undefined;
  const [first, ...rest] = can.slice(0, 3);
  const head = { en: `The ${optionName(first, lang)} is first at **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.`, fi: `${optionName(first, lang)} on ensimmäinen, **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.`, sv: `${optionName(first, lang)} är först, **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.` }[lang];
  const others = rest.map((o) => tradeOff(o, first, lang));
  const tail = others.length ? `${others.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : "";
  return `${head} ${tail}`.trim();
}

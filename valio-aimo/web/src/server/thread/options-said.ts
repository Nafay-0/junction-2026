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

const clean = (n: string) => n.replace(/[®™]/g, "").replace(/^(Valio )?Hyvä suomalainen /i, "$1").replace(/\s+/g, " ").trim();
const short = (n: string, lang: Lang) => localName(readable(shortName(clean(n)), lang), lang);

/** The catalogue's English kind words in a Finnish or Swedish name: said in that language ("Valio Arki Eila kevyt"). */
const LOCAL: Record<"fi" | "sv", [RegExp, string][]> = {
  fi: [[/\bsemi[ -]?skimmed\b|\bsemi\b/gi, "kevyt"], [/\bskimmed\b/gi, "rasvaton"], [/\bwhole\b/gi, "täys"], [/\borganic\b/gi, "luomu"], [/\blactose[ -]free\b/gi, "laktoositon"], [/\bcooking cream\b/gi, "ruokakerma"], [/\bwhipping cream\b/gi, "kuohukerma"], [/\bbutter\b/gi, "voi"], [/\bunsalted\b/gi, "suolaton"], [/\bsalted\b/gi, "suolattu"]],
  sv: [[/\bsemi[ -]?skimmed\b|\bsemi\b/gi, "mellan"], [/\bskimmed\b/gi, "lätt"], [/\bwhole\b/gi, "standard"], [/\borganic\b/gi, "ekologisk"], [/\blactose[ -]free\b/gi, "laktosfri"], [/\bcooking cream\b/gi, "matlagningsgrädde"], [/\bwhipping cream\b/gi, "vispgrädde"], [/\bbutter\b/gi, "smör"], [/\bunsalted\b/gi, "osaltat"], [/\bsalted\b/gi, "saltat"]],
};
export function localName(name: string, lang: Lang): string {
  if (lang === "en") return name;
  return LOCAL[lang].reduce((n, [re, w]) => n.replace(re, w), name);
}
const KIND = /(\s+(semi|skimmed|whole|milk|drink|lactose|free|UHT))+$/i;
const words = (n: string, lang: Lang) => localName(readable(clean(n), lang), lang).split(/\s+/).filter((w) => !/\d/.test(w) && !/^(x|l|kg|g|ml|dl|cl|pcs|kpl|st|\/|-|–)$/i.test(w));
const fold = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");

/** An option as people name it: the product's short name, or "part Arla, part Valio Eila" for a basket. */
export function optionName(o: Pick<OptionView, "title" | "lines">, lang: Lang): string {
  return optionNames([o], lang)[0];
}

/**
 * The options as people tell them apart: each by its short name, never a bare brand ("the Valio") and never the same
 * name twice ("the Duni", "the Duni"): where two would read alike, the words that differ are added (a colour, "semi"
 * or "skimmed", UHT, a pack size).
 */
export function optionNames(options: Pick<OptionView, "title" | "lines">[], lang: Lang): string[] {
  const full = options.map((o) => (o.lines.length > 1 ? "" : clean(o.lines[0]?.name ?? o.title)));
  let names = options.map((o, i) => {
    if (o.lines.length > 1) {
      const [a, b] = o.lines.map((l) => short(l.name, lang).split(/\s+/).slice(0, 2).join(" "));
      return { en: `part ${a}, part ${b}`, fi: `osin ${a}, osin ${b}`, sv: `delvis ${a}, delvis ${b}` }[lang];
    }
    const base = short(full[i], lang);
    const stripped = base.replace(KIND, "");
    let n = stripped.split(/\s+/).length >= 2 ? stripped : base;
    // A bare brand names nothing: the next words of the product's name, up to three in all.
    if (n.split(/\s+/).length < 2) n = words(full[i], lang).slice(0, 3).join(" ") || n;
    return n;
  });
  // Two that read alike: the words of each name the others do not have, then the pack size, until they differ.
  for (let round = 0; round < 2; round++) {
    const seen = new Map<string, number[]>();
    names.forEach((n, i) => seen.set(n.toLowerCase(), [...(seen.get(n.toLowerCase()) ?? []), i]));
    const clash = [...seen.values()].filter((xs) => xs.length > 1);
    if (!clash.length) break;
    names = names.map((n, i) => {
      const group = clash.find((xs) => xs.includes(i));
      if (!group || !full[i]) return n;
      const mine = words(full[i], lang);
      const others = group.filter((j) => j !== i).map((j) => new Set(words(full[j], lang).map(fold)));
      const have = new Set(n.split(/\s+/).map(fold));
      if (round === 0) {
        const extra = mine.filter((w) => !have.has(fold(w)) && others.some((o) => !o.has(fold(w)))).slice(0, 2);
        if (extra.length) return `${n} ${extra.join(" ").toLowerCase()}`;
        // Nothing of its own to add: its short name as the catalogue has it ("Valio Arki Eila skimmed").
        const base = short(full[i], lang);
        return base.split(/\s+/).length >= 2 ? base : n;
      }
      const pack = /(\d+(?:[,.]\d+)?)\s?(l|kg|g|ml|dl)\b/i.exec(full[i]);
      return pack ? `${n} ${pack[1].replace(".", ",")} ${pack[2].toLowerCase()}` : n;
    });
  }
  return names;
}

/** The closing question for the options said: the first by the same name as in the sentence. */
export function orderAsk(firstName: string, lang: Lang): string {
  return { en: `Shall I order the ${firstName}, or another one?`, fi: "Tilaanko ensimmäisen, vai jonkin muun?", sv: "Ska jag beställa den första, eller en annan?" }[lang];
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
function tradeOff(o: OptionView, first: OptionView, lang: Lang, n0: string): string {
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
  const [n1, ...ns] = optionNames(can.slice(0, 3), lang);
  const head = { en: `The ${n1} is first at **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.`, fi: `${n1} on ensimmäinen, **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.`, sv: `${n1} är först, **${eur(first.totalCents)}**: ${whyFirst(first, lang)}.` }[lang];
  const others = rest.map((o, i) => tradeOff(o, first, lang, ns[i]));
  const tail = others.length ? `${others.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : "";
  // "pe 20.11." ends in its own stop: never "20.11.. Valio".
  return `${head} ${tail}`.trim().replace(/\.\.(?=\s|$)/g, ".");
}

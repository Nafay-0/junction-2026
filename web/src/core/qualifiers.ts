import type { Product, ProductQuery } from "./catalog";
import { groupsIn } from "./also-asked";
import { allergenCode, claimsIn } from "./grounding";

/**
 * The words of a request that say what kind of product it is ("oat" in "oat drink", "camel" in "camel milk"), and
 * which products carry them, by plain code with the catalogue's own multilingual search. The intake finds the family
 * (plant drinks, milk); these words keep a stand-in (a soy drink for an oat drink) from passing as the thing asked
 * for: on the buyer's cards (not shown as a full match) and at the gate (a substitute, judged by the mandate's
 * substitution rule on every door, core/policy.ts).
 *
 * A word is a qualifier when the family's own products do not all carry it; a word naming the family itself, a claim,
 * an allergen or a generic quality never is.
 */
type Search = { searchProducts(q: ProductQuery): Promise<Product[]> };

const NOT_A_QUALIFIER =
  /^(drink|drinks|juoma|dryck|product|tuote|produkt|fresh|light|organic|whole|skim|skimmed|semi|full|plain|normal|regular|ordinary|standard|usual|same|good|cheap|cheapest|best|large|small|big|tuore|tuoret|kevy|rasvat|täys|luomu|tavalli|normaali|tavanomai|halvin|halpa|iso|pieni|färsk|lätt|ekologisk|vanlig|billig|stor|liten|some|more|extra|kpl|pcs|pack|packs|box|boxes|crate|crates|litre|litres|liter|liters|kilo|kilos|kg|laatik|pakka|purkki|säkki|låda|förpack)/i;

/** Countries a chef names as a word, and how a product's name says that origin. */
const COUNTRY: { said: RegExp; code: string; named: RegExp }[] = [
  { said: /^(finnish|finland|suomalai\w*|kotimai\w*|finsk\w*)$/i, code: "FI", named: /\b(FI|FIN|SUOMI|SUOMALAINEN|KOTIMAINEN|FINLAND|FINNISH)\b/i },
  { said: /^(swedish|sweden|ruotsalai\w*|svensk\w*)$/i, code: "SE", named: /\b(SE|SWE|RUOTSI|SVERIGE|SWEDEN|SWEDISH)\b/i },
  { said: /^(estonian|estonia|virolai\w*|estnisk\w*)$/i, code: "EE", named: /\b(EE|EST|VIRO|EESTI|ESTONIA|ESTONIAN)\b/i },
];

export type Qualifiers = {
  /** Qualifier words with the ids of the family's products that carry each (up to the family's size). */
  words: { word: string; carriedBy: string[] }[];
  /** Qualifier words no product of the family carries at all ("camel"). */
  absent: string[];
};

export async function qualifiersOf(catalog: Search, family: string, item: string): Promise<Qualifiers> {
  // Claims said as phrases ("lactose-free", "gluteeniton") come out whole first, so no half of one is left over.
  let text = item.toLowerCase();
  for (const c of claimsIn(text)) text = text.replace(c.said.toLowerCase(), " ");
  const candidates = [...new Set(text.split(/[^\p{L}]+/u).filter((w) => w.length >= 3))].filter(
    (w) => !NOT_A_QUALIFIER.test(w) && !claimsIn(w).length && !allergenCode(w) && !family.toLowerCase().includes(w),
  );
  if (!candidates.length) return { words: [], absent: [] };
  const familySize = (await catalog.searchProducts({ category: family, limit: 2000 })).length;
  const words: Qualifiers["words"] = [];
  const absent: string[] = [];
  for (const w of candidates) {
    let inFamily = await catalog.searchProducts({ category: family, text: w, limit: 2000 });
    // A chef's plural ("rice pies") names the same product as the catalogue's singular ("Rye rice pie").
    for (const v of [w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, "")]) {
      if (inFamily.length || v === w || v.length < 3) continue;
      inFamily = await catalog.searchProducts({ category: family, text: v, limit: 2000 });
    }
    // A country said as a word ("Finnish lollo rosso") is carried by the products of that origin, whether the name
    // says it ("LOLLOROSSO FI", "SUOMI") or only the data does.
    const country = COUNTRY.find((c) => c.said.test(w));
    if (country) {
      const all = await catalog.searchProducts({ category: family, limit: 2000 });
      const ids = new Set(inFamily.map((p) => p.id));
      for (const p of all) if (p.countryOfOrigin?.toUpperCase() === country.code || country.named.test(`${p.name} ${Object.values(p.names ?? {}).join(" ")}`)) ids.add(p.id);
      inFamily = all.filter((p) => ids.has(p.id));
    }
    if (!inFamily.length) {
      absent.push(w);
      words.push({ word: w, carriedBy: [] });
      continue;
    }
    // Every product of the family carries it ("maitoa", "drink"): it names the family, not a kind within it.
    if (inFamily.length >= familySize) continue;
    if (groupsIn(w).length && inFamily.length >= familySize * 0.6) continue;
    words.push({ word: w, carriedBy: inFamily.map((p) => p.id) });
  }
  return { words, absent };
}

/** The qualifier words a product does not carry: none means it is the kind asked for. */
export function wordsNotCarried(q: Pick<Qualifiers, "words">, productId: string): string[] {
  return q.words.filter((w) => !w.carriedBy.includes(productId)).map((w) => w.word);
}

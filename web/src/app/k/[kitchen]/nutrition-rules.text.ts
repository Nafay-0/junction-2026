import { defineText, type Lang } from "../../_i18n/lang";
import generated from "@/server/catalog-categories.json";

/**
 * The kitchen's nutrition and label rules in plain words, for "Your rules" (rules.ts mandateWords), in the allergen
 * rule's place and style under "Never, whoever asks": "Buy yoghurt or quark with more than 12 g sugar per 100 g, or
 * any that does not declare its sugar." Kinds are the rule's
 * category slugs, named here; a kind not named falls back to the shop's own category label.
 */
type Rule = { nutrient: string; max?: number; min?: number; categories?: string[] };

export const NUTRITION_RULES_TEXT = defineText({
  en: {
    nutrient: { energy_kcal: "energy", fat: "fat", saturated_fat: "saturated fat", carbohydrate: "carbohydrate", sugar: "sugar", fibre: "fibre", protein: "protein", salt: "salt", lactose: "lactose" } as Record<string, string>,
    kind: { milk: "milk", plant_drink: "plant drinks", yoghurt: "yoghurt", plant_yoghurt: "plant-based yoghurt", quark: "quark", cream: "cream", cat_10600: "cheese", cat_10602: "sliced cheese", cat_10603: "grated cheese", cat_10900: "rye bread", cat_10901: "toast bread", cat_11030: "bread loaves" } as Record<string, string>,
    and: " and ",
    every: "any product",
    or: " or ",
    rule: (kinds: string, range: string, nutrient: string) => `Buy ${kinds} with ${range} per 100 g, or any that does not declare its ${nutrient}.`,
    atMost: (v: string, unit: string, n: string) => `more than ${v} ${unit} ${n}`,
    atLeast: (v: string, unit: string, n: string) => `less than ${v} ${unit} ${n}`,
    between: (lo: string, hi: string, unit: string, n: string) => `less than ${lo} or more than ${hi} ${unit} ${n}`,
    label: { hyvaa_suomesta: "Hyvää Suomesta", avainlippu: "Avainlippu (made in Finland)", puhtaasti_kotimainen: "Puhtaasti kotimainen", origin_fi: "Finnish origin", sydanmerkki: "the Heart Symbol", eu_organic: "EU organic", luomu_sun: "Luomu sun", krav: "KRAV", soil_association_organic: "Soil Association organic", msc: "MSC", asc: "ASC", dolphin_safe: "dolphin safe", fairtrade: "Fairtrade", rainforest_alliance: "Rainforest Alliance", utz: "UTZ", nordic_swan: "the Nordic Swan", eu_ecolabel: "the EU Ecolabel" } as Record<string, string>,
    requireLabels: (list: string) => `Every product must carry ${list}.`,
    preferLabels: (list: string) => `Prefer products with ${list}, and say what that costs.`,
  },
  fi: {
    nutrient: { energy_kcal: "energiaa", fat: "rasvaa", saturated_fat: "tyydyttynyttä rasvaa", carbohydrate: "hiilihydraatteja", sugar: "sokeria", fibre: "kuitua", protein: "proteiinia", salt: "suolaa", lactose: "laktoosia" },
    kind: { milk: "maito", plant_drink: "kasvijuomat", yoghurt: "jogurtti", plant_yoghurt: "kasvipohjainen jogurtti", quark: "rahka", cream: "kerma", cat_10600: "juusto", cat_10602: "viipalejuusto", cat_10603: "raastejuusto", cat_10900: "ruisleipä", cat_10901: "paahtoleipä", cat_11030: "leipä" },
    and: " ja ",
    every: "mikä tahansa tuote",
    or: ", ",
    rule: (kinds: string, range: string, nutrient: string) => `Ostaa tuotetta (${kinds}), jossa on ${range} / 100 g, tai joka ei ilmoita ${nutrient}.`,
    atMost: (v: string, unit: string, n: string) => `yli ${v} ${unit} ${n}`,
    atLeast: (v: string, unit: string, n: string) => `alle ${v} ${unit} ${n}`,
    between: (lo: string, hi: string, unit: string, n: string) => `alle ${lo} tai yli ${hi} ${unit} ${n}`,
    label: { hyvaa_suomesta: "Hyvää Suomesta", avainlippu: "Avainlippu", puhtaasti_kotimainen: "Puhtaasti kotimainen", origin_fi: "suomalainen alkuperä", sydanmerkki: "Sydänmerkki", eu_organic: "EU-luomu", luomu_sun: "Luomu-aurinko", krav: "KRAV", soil_association_organic: "Soil Association -luomu", msc: "MSC", asc: "ASC", dolphin_safe: "Dolphin safe", fairtrade: "Reilu kauppa", rainforest_alliance: "Rainforest Alliance", utz: "UTZ", nordic_swan: "Joutsenmerkki", eu_ecolabel: "EU-ympäristömerkki" },
    requireLabels: (list: string) => `Jokaisessa tuotteessa on oltava ${list}.`,
    preferLabels: (list: string) => `Suosia tuotteita, joissa on ${list}, ja kertoa, mitä se maksaa.`,
  },
  sv: {
    nutrient: { energy_kcal: "energi", fat: "fett", saturated_fat: "mättat fett", carbohydrate: "kolhydrater", sugar: "socker", fibre: "fiber", protein: "protein", salt: "salt", lactose: "laktos" },
    kind: { milk: "mjölk", plant_drink: "växtdrycker", yoghurt: "yoghurt", plant_yoghurt: "växtbaserad yoghurt", quark: "kvarg", cream: "grädde", cat_10600: "ost", cat_10602: "skivad ost", cat_10603: "riven ost", cat_10900: "rågbröd", cat_10901: "rostbröd", cat_11030: "bröd" },
    and: " och ",
    every: "någon produkt",
    or: " eller ",
    rule: (kinds: string, range: string, nutrient: string) => `Köpa ${kinds} med ${range} per 100 g, eller som inte anger sitt innehåll av ${nutrient}.`,
    atMost: (v: string, unit: string, n: string) => `mer än ${v} ${unit} ${n}`,
    atLeast: (v: string, unit: string, n: string) => `mindre än ${v} ${unit} ${n}`,
    between: (lo: string, hi: string, unit: string, n: string) => `mindre än ${lo} eller mer än ${hi} ${unit} ${n}`,
    label: { hyvaa_suomesta: "Hyvää Suomesta", avainlippu: "Nyckelflaggan", puhtaasti_kotimainen: "Puhtaasti kotimainen", origin_fi: "finskt ursprung", sydanmerkki: "Hjärtmärket", eu_organic: "EU-ekologisk", luomu_sun: "Luomu-solen", krav: "KRAV", soil_association_organic: "Soil Association-ekologisk", msc: "MSC", asc: "ASC", dolphin_safe: "Dolphin safe", fairtrade: "Fairtrade", rainforest_alliance: "Rainforest Alliance", utz: "UTZ", nordic_swan: "Svanen", eu_ecolabel: "EU-miljömärket" },
    requireLabels: (list: string) => `Varje produkt måste ha ${list}.`,
    preferLabels: (list: string) => `Föredra produkter med ${list}, och säga vad det kostar.`,
  },
});

const CATEGORY_LABEL = (generated as { categories: Record<string, { label: string }> }).categories;
const UNIT: Record<string, string> = { energy_kcal: "kcal" };
const join = (xs: string[], and: string) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")}${and}${xs.at(-1)}`);
// Numbers keep the Finnish conventions in all three languages (web/docs/LANGUAGE.md): "1,2 g" in English too.
const numL = (v: number, _lang: Lang) => new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 }).format(v);

/** "Buy yoghurt, plant-based yoghurt or quark with more than 12 g sugar per 100 g, or any that does not declare its sugar." */
export function nutritionRuleWords(r: Rule, lang: Lang): string {
  const tx = NUTRITION_RULES_TEXT[lang];
  const kind = (c: string) => tx.kind[c] ?? CATEGORY_LABEL[c.replace(/^cat_/, "")]?.label.toLowerCase() ?? c.replace(/^cat_/, "").replaceAll("_", " ");
  const kinds = r.categories?.length ? [...new Set(r.categories.map(kind))] : [tx.every];
  const head = lang === "fi" ? kinds.join(tx.or) : join(kinds, tx.or);
  const n = tx.nutrient[r.nutrient] ?? r.nutrient;
  const unit = UNIT[r.nutrient] ?? "g";
  const range = r.max !== undefined && r.min !== undefined ? tx.between(numL(r.min, lang), numL(r.max, lang), unit, n) : r.max !== undefined ? tx.atMost(numL(r.max, lang), unit, n) : tx.atLeast(numL(r.min ?? 0, lang), unit, n);
  return tx.rule(head, range, n);
}

export function labelWords(labels: string[], lang: Lang): string {
  const tx = NUTRITION_RULES_TEXT[lang];
  return join(labels.map((l) => tx.label[l] ?? l.replaceAll("_", " ")), lang === "en" ? " and " : tx.and);
}

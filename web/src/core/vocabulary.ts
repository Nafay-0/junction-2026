/**
 * Dock's words for product facts, and the many ways a buyer (or the model that structures their need) may say them.
 * The catalogue speaks slugs: claims ("lactose_free"), allergens ("gluten") and labels ("hyvaa_suomesta"), see
 * core/catalog/partner.ts. A structured need may say "lactose-free", "LACTOSE_FREE", "FREE_FROM_LACTOSE",
 * "laktoositon" or "dairy free"; this module maps those onto the slugs, and says which kind of fact each is,
 * so a label is checked against labels and "nut free" becomes a forbidden allergen rather than a claim nothing carries.
 */

/** Claims the catalogue carries that change what a product IS for a kitchen (diet, allergens, fat, organic). */
const DIETARY = new Set(["lactose_free", "low_lactose", "gluten_free", "wheat_free", "egg_free", "soy_free", "vegan", "vegetarian", "organic", "fat_free"]);

/**
 * Material attributes decide whether two products are interchangeable. Marketing claims ("additive_free",
 * "low_salt", "no_added_sugar") are not: one brand states them and another does not, for the same milk.
 */
export function isMaterialAttribute(a: string): boolean {
  return DIETARY.has(a) || /^fat_\d+(_\d+)?$/.test(a);
}

export function materialAttributes(attributes: readonly string[]): string[] {
  return attributes.filter(isMaterialAttribute);
}

const CLAIM_ALIASES: Record<string, string> = {
  lactosefree: "lactose_free",
  free_from_lactose: "lactose_free",
  laktoositon: "lactose_free",
  laktosfri: "lactose_free",
  lactose_free_milk: "lactose_free",
  low_lactose: "low_lactose",
  vahalaktoosinen: "low_lactose",
  hyla: "low_lactose",
  glutenfree: "gluten_free",
  free_from_gluten: "gluten_free",
  gluteeniton: "gluten_free",
  glutenfri: "gluten_free",
  vegaaninen: "vegan",
  vegansk: "vegan",
  vegetarisk: "vegetarian",
  laktosfritt: "lactose_free",
  glutenfritt: "gluten_free",
  kananmunaton: "egg_free",
  vehnaton: "wheat_free",
  vetefri: "wheat_free",
  sojafri: "soy_free",
  lactose_reduced: "low_lactose",
  low_lactose_milk: "low_lactose",
  plant_based: "vegan",
  vegetaarinen: "vegetarian",
  luomu: "organic",
  bio: "organic",
  ekologisk: "organic",
  eu_organic: "organic",
  free_from_eggs: "egg_free",
  eggfree: "egg_free",
  free_from_soy: "soy_free",
  free_from_wheat: "wheat_free",
  skimmed: "fat_free",
  skim: "fat_free",
  fat_0: "fat_free",
  fat_0_0: "fat_free",
  semi_skimmed: "fat_1_5",
  semiskimmed: "fat_1_5",
  low_fat_milk: "fat_1_5",
  whole: "fat_3_5",
  whole_milk: "fat_3_5",
  full_fat: "fat_3_5",
};

/** "free from X" phrasings that mean a forbidden allergen rather than a claim. */
const ALLERGEN_FREE_ALIASES: Record<string, string> = {
  dairy_free: "milk",
  milk_free: "milk",
  maidoton: "milk",
  nut_free: "nuts",
  pahkinaton: "nuts",
  notfri: "nuts",
  maapahkinaton: "peanuts",
  jordnotsfri: "peanuts",
  mjolkfri: "milk",
  munaton: "eggs",
  aggfri: "eggs",
  kalaton: "fish",
  soijaton: "soy",
  nuts_free: "nuts",
  tree_nut_free: "nuts",
  peanut_free: "peanuts",
  fish_free: "fish",
  sesame_free: "sesame",
  mustard_free: "mustard",
  celery_free: "celery",
};

const ALLERGEN_ALIASES: Record<string, string> = {
  // English
  dairy: "milk",
  milk_protein: "milk",
  cows_milk: "milk",
  nuts_and_peanuts: "nuts",
  hazelnuts: "hazelnut",
  almonds: "almond",
  walnuts: "walnut",
  cashews: "cashew",
  cashew_nuts: "cashew",
  pistachios: "pistachio",
  pecans: "pecan",
  macadamias: "macadamia",
  brazil_nuts: "brazil_nut",
  eggs_and_egg_products: "eggs",
  seafood: "crustaceans",
  shrimp: "crustaceans",
  prawns: "crustaceans",
  sesame_seeds: "sesame",
  sulphur_dioxide: "sulphites",
  sulfur_dioxide: "sulphites",
  sulfite: "sulphites",
  soybean: "soy",
  soybeans: "soy",
  mollusc: "molluscs",
  mollusks: "molluscs",
  // Finnish (accents folded by slug: "pähkinä" -> "pahkina")
  maito: "milk",
  maitotuotteet: "milk",
  laktoosi: "lactose",
  gluteeni: "gluten",
  vehna: "wheat",
  ohra: "barley",
  ruis: "rye",
  kaura: "oats",
  pahkina: "nuts",
  pahkinat: "nuts",
  puupahkinat: "nuts",
  maapahkina: "peanuts",
  maapahkinat: "peanuts",
  hasselpahkina: "hazelnut",
  manteli: "almond",
  mantelit: "almond",
  saksanpahkina: "walnut",
  kananmuna: "eggs",
  muna: "eggs",
  munat: "eggs",
  kala: "fish",
  ayriaiset: "crustaceans",
  nilviaiset: "molluscs",
  soija: "soy",
  seesami: "sesame",
  seesaminsiemen: "sesame",
  selleri: "celery",
  sinappi: "mustard",
  lupiini: "lupin",
  sulfiitit: "sulphites",
  rikkidioksidi: "sulphites",
  // Swedish
  mjolk: "milk",
  laktos: "lactose",
  vete: "wheat",
  korn: "barley",
  rag: "rye",
  havre: "oats",
  notter: "nuts",
  tradnotter: "nuts",
  jordnot: "peanuts",
  jordnotter: "peanuts",
  hasselnot: "hazelnut",
  hasselnotter: "hazelnut",
  mandel: "almond",
  mandlar: "almond",
  valnot: "walnut",
  agg: "eggs",
  fisk: "fish",
  kraftdjur: "crustaceans",
  blotdjur: "molluscs",
  soja: "soy",
  sesamfro: "sesame",
  senap: "mustard",
  sulfit: "sulphites",
  // the GS1 and Dock forms
  tree_nuts: "nuts",
  tree_nut: "nuts",
  nut: "nuts",
  peanut: "peanuts",
  egg: "eggs",
  soya: "soy",
  shellfish: "crustaceans",
  sulfites: "sulphites",
  sulphite: "sulphites",
  cereals_containing_gluten: "gluten",
};

/** Labels and certificates the catalogue knows, by the names people use for them. */
const LABEL_ALIASES: Record<string, string> = {
  hyvaa_suomesta: "hyvaa_suomesta",
  goods_from_finland: "hyvaa_suomesta",
  blue_swan: "hyvaa_suomesta",
  joutsenlippu: "hyvaa_suomesta",
  avainlippu: "avainlippu",
  key_flag: "avainlippu",
  sydanmerkki: "sydanmerkki",
  heart_symbol: "sydanmerkki",
  msc: "msc",
  asc: "asc",
  fairtrade: "fairtrade",
  fair_trade: "fairtrade",
  rainforest_alliance: "rainforest_alliance",
  nordic_swan: "nordic_swan",
  joutsenmerkki: "nordic_swan",
  krav: "krav",
  puhtaasti_kotimainen: "puhtaasti_kotimainen",
};

/** Lower case, accents folded, every run of non-letters one underscore: "Lactose-free" -> "lactose_free". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type TagKind = "claim" | "label" | "forbid_allergen";
export type NormalisedTag = { kind: TagKind; value: string; from: string };

/** What a tag a buyer wants ("must be ...") means in the catalogue's terms. */
export function normaliseWantedTag(tag: string): NormalisedTag {
  const s = slug(tag);
  if (ALLERGEN_FREE_ALIASES[s]) return { kind: "forbid_allergen", value: ALLERGEN_FREE_ALIASES[s], from: tag };
  if (s === "eu_organic") return { kind: "claim", value: "organic", from: tag };
  if (LABEL_ALIASES[s]) return { kind: "label", value: LABEL_ALIASES[s], from: tag };
  const fat = /^fat_(\d+)(?:_(\d+))?$/.exec(s);
  if (fat && Number(`${fat[1]}.${fat[2] ?? 0}`) === 0) return { kind: "claim", value: "fat_free", from: tag };
  return { kind: "claim", value: CLAIM_ALIASES[s] ?? s, from: tag };
}

export function normaliseAllergen(tag: string): string {
  const s = slug(tag);
  return ALLERGEN_ALIASES[s] ?? ALLERGEN_FREE_ALIASES[s] ?? s;
}

// ---------- one constraint vocabulary for the gate, the intake and the knowledge map ----------

/** Allergens the catalogue's data can speak about (GS1 codes mapped in catalog/partner.ts), plus lactose. */
export const KNOWN_ALLERGENS: readonly string[] = [
  "crustaceans", "eggs", "fish", "milk", "nuts", "peanuts", "sesame", "sulphites", "gluten", "soy", "celery", "mustard", "lupin", "molluscs",
  "lactose", "wheat", "barley", "rye", "oats", "spelt", "kamut",
  "almond", "cashew", "hazelnut", "macadamia", "pecan", "queensland_nut", "brazil_nut", "pistachio", "walnut",
];
const KNOWN_ALLERGEN_SET = new Set(KNOWN_ALLERGENS);
const TREE_NUT_KINDS = new Set(["almond", "cashew", "hazelnut", "macadamia", "pecan", "queensland_nut", "brazil_nut", "pistachio", "walnut"]);
const GLUTEN_KINDS = new Set(["wheat", "barley", "rye", "spelt", "kamut", "oats"]);

/** Dietary and other claims the catalogue carries (catalog/partner.ts CLAIMS), by their Dock slugs. */
export const KNOWN_CLAIMS: readonly string[] = [
  "lactose_free", "low_lactose", "gluten_free", "vegan", "vegetarian", "egg_free", "soy_free", "wheat_free", "fat_free", "low_fat", "organic",
  "no_added_sugar", "high_fibre", "high_protein", "low_salt", "salt_free", "preservative_free", "colouring_free", "additive_free",
  "sweetener_free", "artificial_sweetener_free", "gmo_free",
];
const KNOWN_CLAIM_SET = new Set(KNOWN_CLAIMS);

/** An allergen word in English, Finnish or Swedish (or a GS1 slug) as the catalogue's slug; undefined when unknown. */
export function allergenOf(word: string): string | undefined {
  if (/^gs1:[a-z0-9]{1,4}$/i.test(word.trim())) return word.trim().toLowerCase();
  const s = slug(word);
  const v = ALLERGEN_ALIASES[s] ?? ALLERGEN_FREE_ALIASES[s] ?? s;
  return KNOWN_ALLERGEN_SET.has(v) ? v : undefined;
}

/** A claim word ("lactose-free", "laktoositon", "fat_1_5") as a Dock claim slug; undefined when unknown. */
export function claimOf(word: string): string | undefined {
  const t = normaliseWantedTag(word);
  if (t.kind !== "claim") return undefined;
  return KNOWN_CLAIM_SET.has(t.value) || /^fat_\d+(_\d+)?$/.test(t.value) ? t.value : undefined;
}

export type ResolvedConstraints = { requiredClaims: string[]; forbiddenAllergens: string[]; unknown: { word: string; as: "claim" | "allergen" }[] };

/**
 * A buyer's constraint words in the catalogue's terms. "nut-free" given as a claim becomes a forbidden allergen;
 * a word that maps onto nothing the data can check is returned in `unknown`, so a caller refuses it rather than
 * passing products it never checked.
 */
export function resolveConstraints(input: { requiredClaims?: readonly string[]; forbiddenAllergens?: readonly string[] }): ResolvedConstraints {
  const claims = new Set<string>();
  const allergens = new Set<string>();
  const unknown: ResolvedConstraints["unknown"] = [];
  for (const w of input.requiredClaims ?? []) {
    const t = normaliseWantedTag(w);
    if (t.kind === "forbid_allergen") {
      allergens.add(t.value);
      continue;
    }
    const c = claimOf(w);
    if (c) claims.add(c);
    else unknown.push({ word: w, as: "claim" });
  }
  for (const w of input.forbiddenAllergens ?? []) {
    const a = allergenOf(w);
    if (a) allergens.add(a);
    else unknown.push({ word: w, as: "allergen" });
  }
  return { requiredClaims: [...claims].sort(), forbiddenAllergens: [...allergens].sort(), unknown };
}

/**
 * Whether a product's data shows (or cannot rule out) a forbidden allergen. `present`: what it contains or may
 * contain, as catalogue slugs; `claims`: its claims. Lactose: present when listed, or when it carries milk without a
 * lactose-free claim. A specific tree nut or gluten cereal also matches the generic "nuts" or "gluten" a maker may
 * list instead. An allergen word nobody can map matches every product: unknown is never safe.
 */
export function hasAllergen(product: { present: readonly string[]; claims: readonly string[] }, forbidden: string): boolean {
  const a = allergenOf(forbidden);
  if (!a) return true;
  const have = new Set(product.present.map((x) => allergenOf(x) ?? x));
  if (have.has(a)) return true;
  if (a === "lactose") return have.has("milk") && !product.claims.includes("lactose_free");
  if (TREE_NUT_KINDS.has(a)) return have.has("nuts");
  if (GLUTEN_KINDS.has(a) && a !== "oats") return have.has("gluten");
  if (a === "nuts") return [...have].some((x) => TREE_NUT_KINDS.has(x));
  if (a === "gluten") return [...have].some((x) => GLUTEN_KINDS.has(x) && x !== "oats");
  return false;
}

/** The forbidden allergens a product's data shows (or cannot rule out), in the words given. */
export function forbiddenPresent(product: { present: readonly string[]; claims: readonly string[] }, forbidden: readonly string[]): string[] {
  return forbidden.filter((f) => hasAllergen(product, f));
}

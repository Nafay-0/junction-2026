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
  nuts_free: "nuts",
  tree_nut_free: "nuts",
  peanut_free: "peanuts",
  fish_free: "fish",
  sesame_free: "sesame",
  mustard_free: "mustard",
  celery_free: "celery",
};

const ALLERGEN_ALIASES: Record<string, string> = {
  dairy: "milk",
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

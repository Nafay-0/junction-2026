import { z } from "zod";
import { NUTRIENTS, type Nutrient, type Nutrition } from "../nutrition";
import { vatRateOfCode } from "../pricing";
import { countryOfNumeric } from "./origin";
import { derivePackContent, describePack, type GsLevel, type Measure, type PackContent, type PackIssue } from "./pack";

/**
 * The partner's static files (product JSON, delivery-reliability CSV, carbon CSV) turned into a compact index.
 * The files are untrusted input: every record is validated leniently, oversize strings are cut, bad rows are
 * skipped and counted. Pure functions; the build script does the file I/O.
 */

export const INDEX_VERSION = 1;

/** What a buyer, a safety check or a comparison needs to know about one product. */
export type IndexedProduct = {
  id: string;
  names: { en?: string; fi?: string; sv?: string };
  brand: string | null;
  vendor: string | null;
  /** The partner's numeric category code (names are not published). */
  categoryCode: string;
  salesUnit: string;
  baseUnit: string;
  /** Packaging hierarchy: how many base units each unit holds. */
  units: { unit: string; baseUnits: number }[];
  /** Order quantity must be a multiple of this, in sales units (0.01 is the system default, "any"). */
  lotSize: number;
  /** What one sales unit holds, derived from units, GS1 measurements and the name. See pack.ts. */
  pack: PackContent;
  /** Dietary and nutrition claims as Dock attribute slugs: lactose_free, gluten_free, vegan, organic, fat_1_5, ... */
  claims: string[];
  allergens: {
    /** False when the manufacturer sent no allergen data at all: every allergen is then unknown, never "free". */
    declared: boolean;
    contains: string[];
    mayContain: string[];
    freeFrom: string[];
  };
  /** Certificates and labels (hyvaa_suomesta, eu_organic, msc, ...). */
  labels: string[];
  temperature: { code: number | null; class: "ambient" | "chilled" | "frozen" | null };
  countryOfOrigin: string | null;
  /** Products the partner lists as allowed substitutes for this one. */
  substitutes: string[];
  /** Share of ordered quantity historically delivered (0..1), or null when the partner has no figure. */
  deliveryReliability: number | null;
  /** kg CO2e per kg, an AVERAGE FOR THE PRODUCT GROUP, not a measurement of this product. Null when absent. */
  carbonGroupAvgKgCo2ePerKg: number | null;
  /** Fat per 100 g / 100 ml from the nutrition declaration, if given. */
  fatPct: number | null;
  variableWeight: boolean;
  /**
   * Every GTIN (EAN) the partner lists for the product, its sales unit's and each packaging level's, digits only,
   * each with a valid GS1 check digit. The recall radar matches notices on them. Absent in an index built before
   * GTINs were kept.
   */
  gtins?: string[];

  // ----- Read from the product file since the data-depth index. Absent: the file says nothing (or the index is older). -----
  /** The maker's nutrition declaration per 100 g or 100 ml. Absent: no declaration, every nutrient unknown. */
  nutrition?: Nutrition;
  /** Returnable-packaging deposits charged with one sales unit (core/pricing.ts prices them). */
  deposits?: { material: string; quantity: number }[];
  /** VAT rate from the product file's VAT class (13.5, 25.5, 10); the price service's rate wins when there is one. */
  vatRatePct?: number;
  /** What a buyer reads about the product, in English and Finnish where the maker gave them, shortened (see TEXT_CAPS). */
  texts?: ProductTexts;
  /** The characterising ingredient with its share and where it comes from, by production stage. */
  mainIngredient?: { names: { en?: string; fi?: string; sv?: string }; pct?: number; origins: { stage: string; country: string }[] };
  /** Every country of origin the data states (alpha-2; "eu" and "non_eu" as stated). */
  origins?: string[];
  /** Catch information of fish products: species, how it was produced, gear and area codes. */
  fish?: FishReport[];
  /** Storage temperature range in degrees Celsius, as the maker states it. */
  storageTempC?: { min?: number; max?: number };
};

export type Lang2 = { en?: string; fi?: string };
/** Product texts, each in English and Finnish where the maker wrote them; `about` is the start of the marketing text. */
export type ProductTexts = { ingredients?: Lang2; storage?: Lang2; usage?: Lang2; disposal?: Lang2; about?: Lang2 };
export type FishReport = {
  /** FAO 3-alpha species code (SAL, HER, COD). */
  species: string;
  latin?: string;
  production?: "aquaculture" | "marine_fishery" | "inland_fishery";
  /** Fishing gear codes as stated (FAO ISSCFG letters such as TM, or the GS1 catch method numbers). */
  methods: string[];
  /** FAO fishing area codes (27, 27.3.d, 05). */
  areas: string[];
};

/**
 * How long each text may be in the index. Ingredient lists are kept whole up to 400 characters (most are shorter:
 * median 150) and otherwise cut at a comma with "…"; the full list is on the pack. Marketing text is kept only as
 * its opening (80 characters), for search and a one-line description.
 */
export const TEXT_CAPS = { ingredients: 400, storage: 140, usage: 180, disposal: 90, about: 80 } as const;

export type CatalogIndex = {
  version: typeof INDEX_VERSION;
  builtAt: string;
  stats: { products: number; skipped: number; withReliability: number; withCarbon: number; packCertain: number };
  products: IndexedProduct[];
};

// ---------- lenient schema for the raw product file ----------

const text = (max: number) => z.string().transform((s) => s.slice(0, max));
const LangText = z.object({ value: text(300).catch(""), language: z.string().max(8).catch("") });
/** A longer text (an ingredient list, an instruction): read up to 4,000 characters, then shortened by `shorten`. */
const LongText = z.object({ value: text(4000).catch(""), language: z.string().max(8).catch("") });
const GsVal = z.object({ value: z.number().nullable().optional().catch(undefined), unit: z.string().max(16).nullable().optional().catch(undefined) }).nullable().optional().catch(undefined);
const ClassValue = z.object({ id: z.string().max(64), unit: z.string().max(32).optional().catch(undefined), value: z.number().optional().catch(undefined) });

export const RawProductSchema = z.object({
  id: z.string().min(1).max(32),
  salesUnit: z.string().min(1).max(8),
  baseUnit: z.string().min(1).max(8),
  category: z.string().max(16).catch(""),
  allowedLotSize: z.number().positive().max(10_000).optional().catch(undefined),
  temperatureCondition: z.number().nullable().optional().catch(null),
  vendorName: text(120).nullable().optional().catch(null),
  countryOfOrigin: z.string().max(8).nullable().optional().catch(null),
  units: z.array(z.object({ unitId: z.string().max(8), sizeInBaseUnits: z.number().positive(), gtin: z.string().max(20).optional().catch(undefined) })).catch([]),
  salesUnitGtin: z.string().max(20).optional().catch(undefined),
  substitutions: z.array(z.object({ product: z.string().max(32).optional(), substituteProduct: z.string().max(32) })).optional().catch([]),
  deposits: z.array(z.object({ material: z.string().min(1).max(32), quantity: z.number().positive().max(10_000) }).loose()).optional().catch([]),
  synkkaData: z
    .object({
      names: z.array(LangText).catch([]),
      brand: text(120).nullable().optional().catch(null),
      variableUnit: z.boolean().optional().catch(undefined),
      maxTemperature: z.number().optional().catch(undefined),
      minTemperature: z.number().optional().catch(undefined),
      vatCode: z.string().max(32).nullable().optional().catch(undefined),
      countriesOfOrigin: z.array(z.string().max(8)).max(20).optional().catch([]),
      keyIngredients: z.array(LongText).optional().catch([]),
      storageInstructions: z.array(LongText).optional().catch([]),
      usageInstructions: z.array(LongText).optional().catch([]),
      preparationInstructions: z.array(LongText).optional().catch([]),
      disposalInformations: z.array(LongText).optional().catch([]),
      marketingTexts: z.array(LongText).optional().catch([]),
      ingredients: z
        .array(
          z
            .object({
              sequence: z.number().optional().catch(undefined),
              percentage: z.number().min(0).max(100).optional().catch(undefined),
              names: z.array(LangText).catch([]),
              origins: z.array(z.object({ type: z.string().max(32).optional().catch(undefined), country: z.string().max(8).optional().catch(undefined) }).loose()).optional().catch([]),
            })
            .loose(),
        )
        .max(50)
        .optional()
        .catch([]),
      fishingReports: z
        .array(
          z
            .object({
              id: z.string().max(8).optional().catch(undefined),
              name: text(80).optional().catch(undefined),
              catchMethods: z
                .array(z.object({ methods: z.array(z.string().max(12)).max(10).catch([]), areas: z.array(z.string().max(16)).max(10).catch([]), productionMethod: z.string().max(32).optional().catch(undefined) }).loose())
                .max(10)
                .catch([]),
            })
            .loose(),
        )
        .max(10)
        .optional()
        .catch([]),
      unitConversions: z.array(z.object({ synkkaPackagingType: z.string().max(32), volume: GsVal, netWeight: GsVal }).loose()).optional().catch([]),
      nutritionalContent: z
        .array(
          z
            .object({
              id: z.string().max(32),
              value: z.number().optional().catch(undefined),
              unit: z.string().max(16).optional().catch(undefined),
              basisQuantity: z.number().optional().catch(undefined),
              basisQuantityUnit: z.string().max(8).optional().catch(undefined),
              unitPrecision: z.string().max(32).optional().catch(undefined),
            })
            .loose(),
        )
        .optional()
        .catch([]),
      classifications: z.array(z.object({ name: z.string().max(64), values: z.array(ClassValue.loose()).catch([]) }).loose()).catch([]),
    })
    .loose()
    .catch({ names: [], classifications: [] }),
});
export type RawProduct = z.infer<typeof RawProductSchema>;

// ---------- code tables ----------

/**
 * GS1 allergen type codes. Mapped only where the meaning is certain; any other code is kept as `gs1:<code>`,
 * so it still blocks a mandate that names it and is never silently dropped.
 */
export const GS1_ALLERGENS: Record<string, string> = {
  AC: "crustaceans",
  AE: "eggs",
  AF: "fish",
  AM: "milk",
  AN: "nuts", // tree nuts
  AP: "peanuts",
  AS: "sesame",
  AU: "sulphites",
  AW: "gluten", // cereals containing gluten
  AY: "soy",
  BC: "celery",
  BM: "mustard",
  NL: "lupin",
  UM: "molluscs",
  ML: "lactose",
  UW: "wheat",
  GB: "barley",
  NR: "rye",
  GO: "oats",
  GS: "spelt",
  GK: "kamut",
  SA: "almond",
  SC: "cashew",
  SH: "hazelnut",
  SM: "macadamia",
  SP: "pecan",
  SQ: "queensland_nut",
  SR: "brazil_nut",
  ST: "pistachio",
  SW: "walnut",
};
const GLUTEN_CEREALS = new Set(["wheat", "barley", "rye", "spelt", "kamut"]);
const TREE_NUTS = new Set(["almond", "cashew", "hazelnut", "macadamia", "pecan", "queensland_nut", "brazil_nut", "pistachio", "walnut"]);

export function allergenSlug(code: string): string {
  return GS1_ALLERGENS[code] ?? `gs1:${code}`;
}

/** Contains wheat implies contains gluten; contains walnut implies contains nuts; lactose comes from milk. */
function withImplied(slugs: string[]): string[] {
  const out = new Set(slugs);
  for (const s of slugs) {
    if (GLUTEN_CEREALS.has(s)) out.add("gluten");
    if (TREE_NUTS.has(s)) out.add("nuts");
    if (s === "lactose") out.add("milk");
  }
  return [...out].sort();
}

const CLAIMS: Record<string, string> = {
  FREE_FROM_LACTOSE: "lactose_free",
  LOW_LACTOSE: "low_lactose",
  FREE_FROM_GLUTEN: "gluten_free",
  VEGAN: "vegan",
  VEGETARIAN: "vegetarian",
  FREE_FROM_EGGS: "egg_free",
  FREE_FROM_SOY: "soy_free",
  FREE_FROM_WHEAT: "wheat_free",
  FREE_FROM_FAT: "fat_free",
  LOW_FAT: "low_fat",
  NO_ADDED_SUGARS: "no_added_sugar",
  HIGH_FIBRE: "high_fibre",
  HIGH_PROTEIN: "high_protein",
  LOW_SODIUM_SALT: "low_salt",
  FREE_FROM_SODIUM_SALT: "salt_free",
  FREE_FROM_PRESERVATIVES: "preservative_free",
  FREE_FROM_COLOURING_AGENTS: "colouring_free",
  FREE_FROM_ADDITIVES: "additive_free",
  FREE_FROM_SWEETENERS: "sweetener_free",
  FREE_FROM_ARTIFICIAL_SWEETENERS: "artificial_sweetener_free",
  FREE_FROM_GMO: "gmo_free",
};

const LABELS: Record<string, string> = {
  GOODS_FROM_FINLAND_BLUE_SWAN: "hyvaa_suomesta",
  MADE_IN_FINLAND_FLAG_WITH_KEY: "avainlippu",
  FINNISH_HEART_SYMBOL: "sydanmerkki",
  EU_ORGANIC_FARMING: "eu_organic",
  OFFICIAL_ECO_LABEL_SUN: "luomu_sun",
  KRAV_MARK: "krav",
  SOIL_ASSOCIATION_ORGANIC_SYMBOL: "soil_association_organic",
  SVANEN: "nordic_swan",
  EU_ECO_LABEL: "eu_ecolabel",
  RAINFOREST_ALLIANCE: "rainforest_alliance",
  MARINE_STEWARDSHIP_COUNCIL_LABEL: "msc",
  AQUACULTURE_STEWARDSHIP_COUNCIL: "asc",
  FAIR_TRADE_MARK: "fairtrade",
  PUHTAASTI_KOTIMAINEN: "puhtaasti_kotimainen",
  DOLPHIN_SAFE: "dolphin_safe",
  UTZ_CERTIFIED: "utz",
};
/** A dietary claim is also a "free from" statement for these allergens. */
const CLAIM_FREE_FROM: Record<string, string[]> = {
  gluten_free: ["gluten"],
  lactose_free: ["lactose"],
  vegan: ["milk", "eggs", "fish", "crustaceans", "molluscs"],
  egg_free: ["eggs"],
  soy_free: ["soy"],
  wheat_free: ["wheat"],
};
const ORGANIC_LABELS = new Set(["eu_organic", "luomu_sun", "krav", "soil_association_organic"]);
const TEMPERATURE_LABELS: Record<string, "ambient" | "chilled" | "frozen"> = {
  warmTemperature: "ambient",
  coolTemperature: "chilled",
  freezeTemperature: "frozen",
};

/** A few partner category codes, named after what their products are. Everything else is `cat_<code>`. */
export const CATEGORY_SLUGS: Record<string, string> = {
  "10400": "milk",
  "10401": "cream",
  "10402": "plant_drink",
  "10404": "condensed_milk",
  "10405": "milk_powder",
  "10406": "plant_cream",
  "10411": "fermented_milk",
  "10412": "yoghurt",
  "10413": "plant_yoghurt",
  "10419": "sour_cream",
  "10430": "quark",
  "10500": "butter",
  "10515": "margarine",
};

/** The shop's departments (the first two digits of a category code), as a buyer reads them. */
export const DEPARTMENT_NAMES: Record<string, string> = {
  "10": "dairy and cheese", "11": "fresh bakery", "17": "deli, ready meals and produce", "18": "meat and fish", "20": "kitchen equipment", "21": "dry goods",
  "22": "seasonings, coffee and drinks", "30": "household", "32": "household", "41": "frozen", "52": "confectionery", "63": "cleaning and hygiene",
  "64": "disposables and table setting", "67": "seasonal", "77": "gases", "84": "alcoholic drinks", "85": "low and non-alcoholic drinks", "90": "office and packaging",
};

/** A category slug or code's department in words ("dairy and cheese"), or undefined when it has none. */
export function departmentOf(categoryOrCode: string): string | undefined {
  const code = categoryCodesFor(categoryOrCode)[0];
  return code ? DEPARTMENT_NAMES[code.slice(0, 2)] : undefined;
}

export function categorySlug(code: string): string {
  return CATEGORY_SLUGS[code] ?? `cat_${code}`;
}

/** Category codes a slug or code refers to ("milk" -> 10400, "10400" -> 10400, "cat_10600" -> 10600). */
export function categoryCodesFor(categoryOrCode: string): string[] {
  const c = categoryOrCode.trim();
  if (/^\d+$/.test(c)) return [c];
  if (c.startsWith("cat_")) return [c.slice(4)];
  return Object.entries(CATEGORY_SLUGS)
    .filter(([, slug]) => slug === c)
    .map(([code]) => code);
}

// ---------- side files ----------

/** Parse `productId,<number>` CSV text. Rows that are not an id and a finite number in range are skipped. */
export function parseNumberCsv(csv: string, range: [number, number]): Map<string, number> {
  const out = new Map<string, number>();
  const lines = csv.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [id, raw] = line.split(",").map((s) => s.trim());
    if (!id || !/^[\w-]{1,32}$/.test(id) || raw === undefined || raw === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= range[0] && v <= range[1]) out.set(id, v);
  }
  return out;
}

// ---------- record mapping ----------

function classValues(p: RawProduct, name: string) {
  return p.synkkaData.classifications.find((c) => c.name === name)?.values ?? [];
}

const formatFat = (v: number) => `fat_${String(Math.round(v * 10) / 10).replace(".", "_")}`;

/** GS1 nutrient codes as the partner sends them, onto Dock's nutrients. Energy in kJ is left out: kcal is kept. */
const NUTRIENT_CODES: Record<string, Nutrient> = {
  "ENER-E14": "energy_kcal",
  FAT: "fat",
  FASAT: "saturated_fat",
  CHOAVL: "carbohydrate",
  "SUGAR-": "sugar",
  FIBTG: "fibre",
  "PRO-": "protein",
  SALTEQ: "salt",
  LACS: "lactose",
  CA: "calcium",
  FE: "iron",
  "VITD-": "vitamin_d",
  VITD: "vitamin_d",
  VITB12: "vitamin_b12",
};
const NUTRIENT_TARGET: Record<Nutrient, "kcal" | "g" | "mg" | "µg"> = {
  energy_kcal: "kcal", fat: "g", saturated_fat: "g", carbohydrate: "g", sugar: "g", fibre: "g", protein: "g", salt: "g", lactose: "g", calcium: "mg", iron: "mg", vitamin_d: "µg", vitamin_b12: "µg",
};
const SCALE: Record<string, number> = { GRM: 1, MGM: 1e-3, MC: 1e-6, MCG: 1e-6 };
const TARGET_SCALE = { g: 1, mg: 1e-3, "µg": 1e-6 } as const;

/** A declared value in the nutrient's own unit, or undefined when the unit is not one Dock can read or the value is implausible. */
function nutrientValue(n: Nutrient, value: number, unit: string | undefined): number | undefined {
  const target = NUTRIENT_TARGET[n];
  let v: number | undefined;
  if (target === "kcal") v = unit === "E14" ? value : undefined;
  else {
    const from = unit ? SCALE[unit] : target === "g" ? 1 : undefined; // a missing unit on a gram figure is grams
    v = from === undefined ? undefined : (value * from) / TARGET_SCALE[target];
  }
  if (v === undefined || !Number.isFinite(v) || v < 0) return undefined;
  const ceiling = target === "kcal" ? 900 : target === "g" ? 100 : target === "mg" ? 100_000 : 1_000_000;
  return v > ceiling ? undefined : Math.round(v * 1000) / 1000;
}

/** The declaration per 100 g or 100 ml. Figures per serving or per another basis are not mixed in. */
export function nutritionOf(p: RawProduct): Nutrition | undefined {
  const entries = (p.synkkaData.nutritionalContent ?? []).filter((e) => typeof e.value === "number" && (e.basisQuantity === undefined || e.basisQuantity === 100) && (!e.basisQuantityUnit || e.basisQuantityUnit === "GRM" || e.basisQuantityUnit === "MLT"));
  const ml = entries.filter((e) => e.basisQuantityUnit === "MLT").length;
  const per: Nutrition["per"] = ml > entries.length / 2 ? "100ml" : "100g";
  const values: Nutrition["values"] = {};
  const lessThan = new Set<Nutrient>();
  for (const e of entries) {
    if ((e.basisQuantityUnit === "MLT") !== (per === "100ml") && e.basisQuantityUnit) continue;
    const n = NUTRIENT_CODES[e.id];
    if (!n || values[n] !== undefined) continue;
    const v = nutrientValue(n, e.value!, e.unit);
    if (v === undefined) continue;
    values[n] = v;
    if (e.unitPrecision === "LESS_THAN" || e.unitPrecision === "LESS_THAN_OR_EQUAL") lessThan.add(n);
  }
  if (!Object.keys(values).length) return undefined;
  return { per, values, ...(lessThan.size ? { lessThan: NUTRIENTS.filter((n) => lessThan.has(n)) } : {}) };
}

/** Whitespace folded; over `max` characters, cut at the last comma, semicolon or full stop past half way, with "…". */
export function shorten(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const i = Math.max(c.lastIndexOf(", "), c.lastIndexOf("; "), c.lastIndexOf(". "));
  return `${(i > max / 2 ? c.slice(0, i + 1) : c).trimEnd()}…`;
}

function lang2(arr: { value: string; language: string }[] | undefined, max: number): Lang2 | undefined {
  const out: Lang2 = {};
  for (const lang of ["en", "fi"] as const) {
    const v = arr?.find((t) => t.language === lang && t.value.trim())?.value;
    if (v) out[lang] = shorten(v, max);
  }
  return out.en || out.fi ? out : undefined;
}

function textsOf(p: RawProduct): ProductTexts | undefined {
  const s = p.synkkaData;
  const usage = lang2(s.usageInstructions, TEXT_CAPS.usage) ?? lang2(s.preparationInstructions, TEXT_CAPS.usage);
  const t: ProductTexts = {};
  const put = (k: keyof ProductTexts, v: Lang2 | undefined) => v && (t[k] = v);
  put("ingredients", lang2(s.keyIngredients, TEXT_CAPS.ingredients));
  put("storage", lang2(s.storageInstructions, TEXT_CAPS.storage));
  put("usage", usage);
  put("disposal", lang2(s.disposalInformations, TEXT_CAPS.disposal));
  put("about", lang2(s.marketingTexts, TEXT_CAPS.about));
  return Object.keys(t).length ? t : undefined;
}

function mainIngredientOf(p: RawProduct): IndexedProduct["mainIngredient"] {
  const first = [...(p.synkkaData.ingredients ?? [])].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99)).find((i) => i.names.some((n) => n.value.trim()));
  if (!first) return undefined;
  const names: { en?: string; fi?: string; sv?: string } = {};
  for (const n of first.names) if ((n.language === "en" || n.language === "fi" || n.language === "sv") && n.value.trim() && !names[n.language]) names[n.language] = shorten(n.value, 60);
  const origins = (first.origins ?? [])
    .map((o) => ({ stage: (o.type ?? "").toUpperCase().replace(/[^A-Z_]/g, ""), country: countryOfNumeric(o.country ?? "") }))
    .filter((o): o is { stage: string; country: string } => !!o.stage && !!o.country);
  return { names, ...(typeof first.percentage === "number" ? { pct: first.percentage } : {}), origins };
}

function fishOf(p: RawProduct): FishReport[] | undefined {
  const out: FishReport[] = [];
  for (const r of p.synkkaData.fishingReports ?? []) {
    const species = (r.id ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(species)) continue;
    const prod = (r.catchMethods ?? []).map((m) => (m.productionMethod ?? "").toUpperCase().replace(/\d+$/, "")).find(Boolean);
    const production = prod === "AQUACULTURE" ? "aquaculture" : prod === "MARINE_FISHERY" ? "marine_fishery" : prod === "INLAND_FISHERY" ? "inland_fishery" : undefined;
    const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter((x) => /^[A-Za-z0-9.]{1,12}$/.test(x)))];
    const latin = r.name?.trim();
    out.push({
      species,
      ...(latin ? { latin: latin.charAt(0).toUpperCase() + latin.slice(1) } : {}),
      ...(production ? { production } : {}),
      methods: clean((r.catchMethods ?? []).flatMap((m) => m.methods)),
      areas: clean((r.catchMethods ?? []).flatMap((m) => m.areas)),
    });
  }
  return out.length ? out : undefined;
}

function storageTempOf(p: RawProduct): IndexedProduct["storageTempC"] {
  const ok = (t: number | undefined) => (typeof t === "number" && Number.isFinite(t) && t >= -60 && t <= 100 ? t : undefined);
  const min = ok(p.synkkaData.minTemperature);
  const max = ok(p.synkkaData.maxTemperature);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** The fields read since the data-depth index, each left out when the file says nothing (absent means unknown). */
function depthOf(p: RawProduct): Partial<IndexedProduct> {
  const out: Partial<IndexedProduct> = {};
  const nutrition = nutritionOf(p);
  if (nutrition) out.nutrition = nutrition;
  const deposits = (p.deposits ?? []).map((d) => ({ material: d.material.trim(), quantity: d.quantity })).filter((d) => /^[\w-]{1,32}$/.test(d.material));
  if (deposits.length) out.deposits = deposits;
  const vat = vatRateOfCode(p.synkkaData.vatCode);
  if (vat !== undefined) out.vatRatePct = vat;
  const texts = textsOf(p);
  if (texts) out.texts = texts;
  const main = mainIngredientOf(p);
  if (main) out.mainIngredient = main;
  const origins = [...new Set((p.synkkaData.countriesOfOrigin ?? []).map(countryOfNumeric).filter((c): c is string => !!c))];
  if (origins.length) out.origins = origins;
  const fish = fishOf(p);
  if (fish) out.fish = fish;
  const temp = storageTempOf(p);
  if (temp) out.storageTempC = temp;
  return out;
}

export function indexProduct(p: RawProduct, side: { reliability?: Map<string, number>; carbon?: Map<string, number> } = {}): IndexedProduct {
  const names: IndexedProduct["names"] = {};
  for (const n of p.synkkaData.names) {
    const lang = n.language as "en" | "fi" | "sv";
    if ((lang === "en" || lang === "fi" || lang === "sv") && n.value.trim() && !names[lang]) names[lang] = n.value.trim();
  }
  const conv = p.synkkaData.unitConversions ?? [];
  const level = (type: string): GsLevel | undefined => {
    const c = conv.find((u) => u.synkkaPackagingType === type);
    return c ? { volume: c.volume, netWeight: c.netWeight } : undefined;
  };
  const pack = derivePackContent({
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    units: p.units,
    names: [names.en, names.fi, names.sv].filter((x): x is string => Boolean(x)),
    each: level("BASE_UNIT_OR_EACH"),
    case: level("CASE"),
    variableWeight: p.synkkaData.variableUnit === true,
  });

  // Claims, with the ones they imply.
  const claims = new Set<string>();
  for (const v of classValues(p, "nutritionalClaim")) claims.add(CLAIMS[v.id] ?? v.id.toLowerCase());
  if (claims.has("lactose_free")) claims.add("low_lactose");
  if (claims.has("vegan")) claims.add("vegetarian");

  // Labels: certificates, organic, temperature.
  const labels = new Set<string>();
  let tempFromLabel: IndexedProduct["temperature"]["class"] = null;
  for (const v of classValues(p, "packagingMarkedLabel")) {
    if (TEMPERATURE_LABELS[v.id]) tempFromLabel ??= TEMPERATURE_LABELS[v.id];
    else labels.add(LABELS[v.id] ?? v.id.toLowerCase());
  }
  if ([...labels].some((l) => ORGANIC_LABELS.has(l))) claims.add("organic");

  const fat = (p.synkkaData.nutritionalContent ?? []).find((n) => n.id === "FAT" && typeof n.value === "number" && n.value >= 0 && n.value <= 100);
  const fatPct = fat?.value ?? null;
  if (fatPct !== null) claims.add(formatFat(fatPct));

  // Allergens: CONTAINS, MAY_CONTAIN, FREE_FROM. UNDECLARED and anything else stays unknown.
  const contains: string[] = [];
  const mayContain: string[] = [];
  const freeFrom: string[] = [];
  const allergenValues = [...classValues(p, "allergen"), ...classValues(p, "nonAllergen")];
  for (const v of allergenValues) {
    const slug = allergenSlug(v.id);
    if (v.unit === "CONTAINS") contains.push(slug);
    else if (v.unit === "MAY_CONTAIN") mayContain.push(slug);
    else if (v.unit === "FREE_FROM") freeFrom.push(slug);
  }
  const containsAll = withImplied(contains);
  const mayAll = withImplied(mayContain).filter((a) => !containsAll.includes(a));
  // A product cannot be free from what it contains: contradictory data loses the "free from".
  for (const [claim, allergens] of Object.entries(CLAIM_FREE_FROM)) if (claims.has(claim)) freeFrom.push(...allergens);
  const freeAll = [...new Set(freeFrom)].filter((a) => !containsAll.includes(a) && !mayAll.includes(a)).sort();

  const maxT = p.synkkaData.maxTemperature;
  const tempFromRange = typeof maxT === "number" ? (maxT <= -15 ? "frozen" : maxT <= 8 ? "chilled" : "ambient") : null;

  const substitutes = [...new Set((p.substitutions ?? []).map((s) => s.substituteProduct).filter((s) => s && s !== p.id))];

  return {
    id: p.id,
    names,
    brand: p.synkkaData.brand?.trim() || null,
    vendor: p.vendorName?.trim() || null,
    categoryCode: p.category,
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    units: p.units.map((u) => ({ unit: u.unitId, baseUnits: u.sizeInBaseUnits })),
    lotSize: p.allowedLotSize ?? 0.01,
    pack,
    claims: [...claims].sort(),
    allergens: { declared: allergenValues.length > 0, contains: containsAll, mayContain: mayAll, freeFrom: freeAll },
    labels: [...labels].sort(),
    temperature: { code: typeof p.temperatureCondition === "number" ? p.temperatureCondition : null, class: tempFromLabel ?? tempFromRange },
    countryOfOrigin: p.countryOfOrigin?.toLowerCase() || null,
    substitutes,
    deliveryReliability: side.reliability?.get(p.id) ?? null,
    carbonGroupAvgKgCo2ePerKg: side.carbon?.get(p.id) ?? null,
    fatPct,
    variableWeight: p.synkkaData.variableUnit === true,
    gtins: gtinsOf(p),
    ...depthOf(p),
  };
}

/** GS1 check digit for GTIN-8, -12, -13 and -14. */
export function validGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** The product's GTINs: sales unit first, then each packaging level; invalid and all-zero codes dropped. */
function gtinsOf(p: RawProduct): string[] {
  const all = [p.salesUnitGtin, ...p.units.map((u) => u.gtin)].filter((g): g is string => typeof g === "string").map((g) => g.trim());
  return [...new Set(all.filter((g) => validGtin(g) && !/^0+$/.test(g)))];
}

/** Build the index from the parsed product file and the two CSV texts. */
export function buildCatalogIndex(rawProducts: unknown, reliabilityCsv: string, carbonCsv: string, now = new Date()): CatalogIndex {
  if (!Array.isArray(rawProducts)) throw new Error("Product file is not a JSON array.");
  const reliability = parseNumberCsv(reliabilityCsv, [0, 1]);
  const carbon = parseNumberCsv(carbonCsv, [0, 1000]);
  const products: IndexedProduct[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of rawProducts) {
    const parsed = RawProductSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id) || (raw as { deleted?: unknown }).deleted === true) {
      skipped += 1;
      continue;
    }
    seen.add(parsed.data.id);
    products.push(indexProduct(parsed.data, { reliability, carbon }));
  }
  products.sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: INDEX_VERSION,
    builtAt: now.toISOString(),
    stats: {
      products: products.length,
      skipped,
      withReliability: products.filter((p) => p.deliveryReliability !== null).length,
      withCarbon: products.filter((p) => p.carbonGroupAvgKgCo2ePerKg !== null).length,
      packCertain: products.filter((p) => p.pack.certain).length,
    },
    products,
  };
}

// ---------- compact file format ----------

/**
 * On disk each product is a flat array and lists are joined strings: about a third of the size of plain objects,
 * so the index parses fast in a serverless function. `decodeIndex` restores the objects.
 */
export type IndexFile = {
  format: "dock-valio-index";
  version: typeof INDEX_VERSION;
  builtAt: string;
  stats: CatalogIndex["stats"];
  columns: string[];
  rows: unknown[][];
  /** Product texts by column ("ingredients.en", ...), each an array in row order; absent in an index built without them. */
  texts?: Record<string, (string | null)[]>;
};

/**
 * Columns, in file order. Later columns were added at the end, so an index built by older code is a prefix of this
 * list and still reads (its products then lack what it did not keep): `COLUMN_SETS` are the widths ever written.
 */
const COLUMNS = [
  "id", "en", "fi", "sv", "brand", "vendor", "category", "salesUnit", "baseUnit", "units", "lot", "pack", "claims", "allergens", "labels", "temp", "country", "substitutes", "reliability", "carbon", "fat", "variable",
  "gtins",
  "nutrition", "deposits", "vat", "ingredient", "origins", "fish", "storageTemp",
];
/** 22: before GTINs were kept; 23: before the data-depth fields; 30: today. */
const COLUMN_SETS = [22, 23, COLUMNS.length];
/**
 * The data-depth parts of the file, for measuring what each costs (scripts/index-build.ts): the row columns, and
 * "texts", the product texts, kept apart in columns of their own (one array per text and language, in row order),
 * which compresses to about two thirds of the same texts inside the rows.
 */
export const DEPTH_COLUMNS = [...COLUMNS.slice(23), "texts"];
const SEP = "|";
const TEMP = { ambient: "a", chilled: "c", frozen: "f" } as const;
const TEMP_BACK: Record<string, IndexedProduct["temperature"]["class"]> = { a: "ambient", c: "chilled", f: "frozen" };
const join = (xs: string[]) => xs.join(SEP);
const split = (s: unknown) => (typeof s === "string" && s ? s.split(SEP) : []);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** `omit`: data-depth columns written empty, to measure what each costs (scripts/index-build.ts). */
export function encodeIndex(index: CatalogIndex, opts: { omit?: readonly string[] } = {}): IndexFile {
  const rows = index.products.map((p) => {
    const k = p.pack;
    const pack = [k.baseUnitsPerSalesUnit, k.perBaseUnit.L ?? null, k.perBaseUnit.kg ?? null, k.perSalesUnit.L ?? null, k.perSalesUnit.kg ?? null, k.primary, join(k.certainMeasures), join(k.issues), join(k.sources)];
    const a = p.allergens;
    return [
      p.id, p.names.en ?? null, p.names.fi ?? null, p.names.sv ?? null, p.brand, p.vendor, p.categoryCode, p.salesUnit, p.baseUnit,
      join(p.units.map((u) => `${u.unit}:${u.baseUnits}`)), p.lotSize, pack, join(p.claims),
      [a.declared ? 1 : 0, join(a.contains), join(a.mayContain), join(a.freeFrom)], join(p.labels),
      [p.temperature.code, p.temperature.class ? TEMP[p.temperature.class] : null], p.countryOfOrigin, join(p.substitutes),
      p.deliveryReliability, p.carbonGroupAvgKgCo2ePerKg, p.fatPct, p.variableWeight ? 1 : 0, join(p.gtins ?? []),
      ...encodeDepth(p, opts.omit),
    ];
  });
  const file: IndexFile = { format: "dock-valio-index", version: INDEX_VERSION, builtAt: index.builtAt, stats: index.stats, columns: COLUMNS, rows };
  if (!opts.omit?.includes("texts") && index.products.some((p) => p.texts)) {
    file.texts = {};
    for (const k of TEXT_KEYS) for (const lang of ["en", "fi"] as const) {
      const col = index.products.map((p) => p.texts?.[k]?.[lang] ?? null);
      if (col.some((x) => x !== null)) file.texts[`${k}.${lang}`] = col;
    }
  }
  return file;
}

// ---------- the data-depth columns ----------

const trimNulls = <T,>(xs: (T | null)[]): (T | null)[] => {
  const out = [...xs];
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};
const PRODUCTION = { aquaculture: "A", marine_fishery: "M", inland_fishery: "I" } as const;
const PRODUCTION_BACK: Record<string, FishReport["production"]> = { A: "aquaculture", M: "marine_fishery", I: "inland_fishery" };
const TEXT_KEYS = ["ingredients", "storage", "usage", "disposal", "about"] as const;

/** One product's data-depth columns, compact: arrays with trailing nulls dropped, lists joined, null when absent. */
function encodeDepth(p: IndexedProduct, omit: readonly string[] = []): unknown[] {
  const n = p.nutrition;
  const nutrition = n ? [n.per === "100ml" ? "ml" : "g", ...trimNulls(NUTRIENTS.map((k) => n.values[k] ?? null)), (n.lessThan ?? []).reduce((m, k) => m | (1 << NUTRIENTS.indexOf(k)), 0)] : null;
  const m = p.mainIngredient;
  const ingredient = m ? [m.names.en ?? null, m.names.fi ?? null, m.names.sv ?? null, m.pct ?? null, join(m.origins.map((o) => `${o.stage}:${o.country}`))] : null;
  const fish = p.fish ? p.fish.map((f) => [f.species, f.latin ?? null, f.production ? PRODUCTION[f.production] : null, join(f.methods), join(f.areas)]) : null;
  const cols: Record<string, unknown> = {
    nutrition,
    deposits: p.deposits ? join(p.deposits.map((d) => `${d.material}:${d.quantity}`)) : null,
    vat: p.vatRatePct ?? null,
    ingredient,
    origins: p.origins ? join(p.origins) : null,
    fish,
    storageTemp: p.storageTempC ? [p.storageTempC.min ?? null, p.storageTempC.max ?? null] : null,
  };
  return COLUMNS.slice(23).map((c) => (omit.includes(c) ? null : cols[c]));
}

/** Restore the data-depth fields from a row's tail; anything malformed is left out (unknown), never guessed. */
function decodeDepth(tail: unknown[]): Partial<IndexedProduct> {
  const [nu, dep, vat, ing, org, fish, temp] = tail;
  const out: Partial<IndexedProduct> = {};
  if (Array.isArray(nu) && (nu[0] === "g" || nu[0] === "ml")) {
    const values: Nutrition["values"] = {};
    const vals = nu.slice(1, -1);
    NUTRIENTS.forEach((k, i) => {
      const v = num(vals[i]);
      if (v !== null && v >= 0) values[k] = v;
    });
    const mask = num(nu[nu.length - 1]) ?? 0;
    const lessThan = NUTRIENTS.filter((k, i) => mask & (1 << i) && values[k] !== undefined);
    if (Object.keys(values).length) out.nutrition = { per: nu[0] === "ml" ? "100ml" : "100g", values, ...(lessThan.length ? { lessThan } : {}) };
  }
  const deposits = split(dep)
    .map((d) => {
      const [material, q] = d.split(":");
      return { material, quantity: Number(q) };
    })
    .filter((d) => d.material && Number.isFinite(d.quantity) && d.quantity > 0);
  if (deposits.length) out.deposits = deposits;
  if (num(vat) !== null) out.vatRatePct = num(vat)!;
  if (Array.isArray(ing)) {
    const [en, fi, sv, pct, origins] = ing;
    const names: { en?: string; fi?: string; sv?: string } = {};
    if (typeof en === "string") names.en = en;
    if (typeof fi === "string") names.fi = fi;
    if (typeof sv === "string") names.sv = sv;
    out.mainIngredient = {
      names,
      ...(num(pct) !== null ? { pct: num(pct)! } : {}),
      origins: split(origins)
        .map((o) => {
          const [stage, country] = o.split(":");
          return { stage, country };
        })
        .filter((o) => o.stage && o.country),
    };
  }
  if (split(org).length) out.origins = split(org);
  if (Array.isArray(fish)) {
    const reports = fish
      .filter((f): f is unknown[] => Array.isArray(f) && typeof f[0] === "string")
      .map((f) => ({ species: f[0] as string, ...(typeof f[1] === "string" ? { latin: f[1] } : {}), ...(PRODUCTION_BACK[String(f[2])] ? { production: PRODUCTION_BACK[String(f[2])] } : {}), methods: split(f[3]), areas: split(f[4]) }));
    if (reports.length) out.fish = reports;
  }
  if (Array.isArray(temp) && (num(temp[0]) !== null || num(temp[1]) !== null)) out.storageTempC = { ...(num(temp[0]) !== null ? { min: num(temp[0])! } : {}), ...(num(temp[1]) !== null ? { max: num(temp[1])! } : {}) };
  return out;
}

/** One product's texts from the columnar block (row `row`); nothing when it has none. */
function textsAt(cols: [string, unknown[]][], row: number): { texts?: ProductTexts } {
  if (!cols.length) return {};
  const t: ProductTexts = {};
  for (const [key, col] of cols) {
    const v = col[row];
    if (typeof v !== "string" || !v) continue;
    const [k, lang] = key.split(".") as [keyof ProductTexts, "en" | "fi"];
    (t[k] ??= {})[lang] = v;
  }
  return Object.keys(t).length ? { texts: t } : {};
}

export function isIndexFile(x: unknown): x is IndexFile {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<IndexFile>;
  return f.format === "dock-valio-index" && f.version === INDEX_VERSION && Array.isArray(f.rows) && Array.isArray(f.columns) && COLUMN_SETS.some((n) => f.columns!.length === n && f.columns!.join() === COLUMNS.slice(0, n).join());
}

/** Restore products from the file. Rows that do not have the expected shape are dropped. */
/**
 * Claims the product's own declared data implies: a product its maker declares free from milk, with no milk or lactose
 * among what it contains or may contain, has no lactose (an oat or soya drink), so a kitchen whose rules require
 * lactose-free is offered it. The maker's data, read at load time, so an index built earlier gets it too.
 */
export function impliedClaims(claims: string[], a: IndexedProduct["allergens"]): string[] {
  const milkFree = a.declared && a.freeFrom.includes("milk") && ![...a.contains, ...a.mayContain].some((x) => x === "milk" || x === "lactose");
  return milkFree && !claims.includes("lactose_free") ? [...claims, "lactose_free"] : claims;
}

export function decodeIndex(file: IndexFile): CatalogIndex {
  const products: IndexedProduct[] = [];
  const width = file.columns.length;
  const textCols = file.texts && typeof file.texts === "object" ? Object.entries(file.texts).filter(([k, v]) => Array.isArray(v) && v.length === file.rows.length && /^(ingredients|storage|usage|disposal|about)\.(en|fi)$/.test(k)) : [];
  for (const [row, r] of file.rows.entries()) {
    if (!Array.isArray(r) || r.length !== width || typeof r[0] !== "string" || !Array.isArray(r[11]) || !Array.isArray(r[13]) || !Array.isArray(r[15])) continue;
    const [id, en, fi, sv, brand, vendor, category, salesUnit, baseUnit, units, lot, pk, claims, al, labels, temp, country, subs, rel, carbon, fat, variable, gtins] = r as [
      string, string | null, string | null, string | null, string | null, string | null, string, string, string, string, number, unknown[], string, unknown[], string, unknown[], string | null, string, number | null, number | null, number | null, number, string | undefined,
    ];
    const perBaseUnit: Partial<Record<Measure, number>> = {};
    const perSalesUnit: Partial<Record<Measure, number>> = {};
    if (num(pk[1]) !== null) perBaseUnit.L = num(pk[1])!;
    if (num(pk[2]) !== null) perBaseUnit.kg = num(pk[2])!;
    if (num(pk[3]) !== null) perSalesUnit.L = num(pk[3])!;
    if (num(pk[4]) !== null) perSalesUnit.kg = num(pk[4])!;
    const primary = pk[5] === "L" || pk[5] === "kg" ? pk[5] : null;
    const factor = num(pk[0]);
    const certainMeasures = split(pk[6]).filter((m): m is Measure => m === "L" || m === "kg");
    const names: IndexedProduct["names"] = {};
    if (en) names.en = en;
    if (fi) names.fi = fi;
    if (sv) names.sv = sv;
    products.push({
      id,
      names,
      brand: brand ?? null,
      vendor: vendor ?? null,
      categoryCode: String(category),
      salesUnit: String(salesUnit),
      baseUnit: String(baseUnit),
      units: split(units).map((u) => {
        const [unit, size] = u.split(":");
        return { unit, baseUnits: Number(size) };
      }),
      lotSize: num(lot) ?? 0.01,
      pack: {
        salesUnit: String(salesUnit),
        baseUnit: String(baseUnit),
        baseUnitsPerSalesUnit: factor,
        perBaseUnit,
        perSalesUnit,
        primary,
        certain: primary !== null && certainMeasures.includes(primary),
        certainMeasures,
        issues: split(pk[7]) as PackIssue[],
        sources: split(pk[8]),
        label: describePack(String(salesUnit), String(baseUnit), factor, perBaseUnit, perSalesUnit, primary),
      },
      claims: impliedClaims(split(claims), { declared: al[0] === 1, contains: split(al[1]), mayContain: split(al[2]), freeFrom: split(al[3]) }),
      allergens: { declared: al[0] === 1, contains: split(al[1]), mayContain: split(al[2]), freeFrom: split(al[3]) },
      labels: split(labels),
      temperature: { code: num(temp[0]), class: TEMP_BACK[String(temp[1])] ?? null },
      countryOfOrigin: country ?? null,
      substitutes: split(subs),
      deliveryReliability: num(rel),
      carbonGroupAvgKgCo2ePerKg: num(carbon),
      fatPct: num(fat),
      variableWeight: variable === 1,
      ...(width > 22 ? { gtins: split(gtins) } : {}),
      ...(width > 23 ? decodeDepth(r.slice(23)) : {}),
      ...textsAt(textCols, row),
    });
  }
  return { version: INDEX_VERSION, builtAt: file.builtAt, stats: file.stats, products };
}

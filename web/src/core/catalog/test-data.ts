// Synthetic product records shaped like the partner's product file, for tests. Not used at runtime.
// Every name, brand and figure here is invented; no partner product text is copied into the repo.

type Lang = "en" | "fi" | "sv";
type Gs = { value: number; unit: string };

export type FixtureSpec = {
  id: string;
  names: Partial<Record<Lang, string>>;
  salesUnit: string;
  baseUnit: string;
  units: [string, number][];
  category?: string;
  lot?: number;
  claims?: string[];
  allergens?: [string, "CONTAINS" | "MAY_CONTAIN" | "UNDECLARED"][];
  freeFrom?: string[];
  labels?: string[];
  each?: { volume?: Gs; netWeight?: Gs };
  case?: { volume?: Gs; netWeight?: Gs };
  variable?: boolean;
  fat?: number;
  substitutes?: string[];
  vendor?: string;
  brand?: string;
};

export function rawProduct(s: FixtureSpec): Record<string, unknown> {
  const conv = [];
  if (s.each) conv.push({ synkkaPackagingType: "BASE_UNIT_OR_EACH", ...s.each, grossWeight: { unit: "GRM", value: 1 } });
  if (s.case) conv.push({ synkkaPackagingType: "CASE", ...s.case, grossWeight: { unit: "GRM", value: 1 } });
  return {
    id: s.id,
    salesUnitGtin: "0000000000000",
    salesUnit: s.salesUnit,
    baseUnit: s.baseUnit,
    category: s.category ?? "10400",
    allowedLotSize: s.lot ?? 0.01,
    deleted: false,
    temperatureCondition: 4,
    vendorName: s.vendor ?? "TESTIMEIJERI OY",
    countryOfOrigin: "fi",
    units: s.units.map(([unitId, sizeInBaseUnits]) => ({ unitId, gtin: "0", sizeInBaseUnits })),
    deposits: [],
    ...(s.substitutes ? { substitutions: s.substitutes.map((x) => ({ product: s.id, substituteProduct: x })) } : {}),
    synkkaData: {
      names: Object.entries(s.names).map(([language, value]) => ({ value, language })),
      brand: s.brand ?? "Tunturi",
      variableUnit: s.variable ?? false,
      unitConversions: conv,
      nutritionalContent: s.fat === undefined ? [] : [{ id: "FAT", value: s.fat, unit: "GRM", basisQuantity: 100 }],
      classifications: [
        { type: "ENUM", name: "packagingMarkedLabel", values: (s.labels ?? []).map((id) => ({ id })) },
        { type: "ENUM", name: "allergen", values: (s.allergens ?? []).map(([id, unit]) => ({ id, unit })) },
        { type: "ENUM", name: "nonAllergen", values: (s.freeFrom ?? []).map((id) => ({ id, unit: "FREE_FROM" })) },
        { type: "ENUM", name: "nutritionalClaim", values: (s.claims ?? []).map((id) => ({ id })) },
      ],
    },
  };
}

const LF = ["FREE_FROM_LACTOSE", "VEGETARIAN"];
const MILK: FixtureSpec["allergens"] = [["AM", "CONTAINS"]];

/** A small catalogue with the pack formats and data gaps the real file has. */
export const FIXTURE_SPECS: FixtureSpec[] = [
  {
    id: "900001",
    names: { en: "Tunturi semi-skimmed milk drink 10 l bag-in-box lactose free", fi: "Tunturi kevytmaitojuoma 10 l laktoositon", sv: "Tunturi lättmjölksdryck 10 l laktosfri" },
    salesUnit: "KI", baseUnit: "ST", units: [["KI", 2], ["ST", 1]], claims: LF, allergens: MILK, labels: ["GOODS_FROM_FINLAND_BLUE_SWAN", "coolTemperature"], fat: 1.5,
    substitutes: ["900002"],
  },
  {
    id: "900002",
    names: { en: "Kuusi lactose free semi skimmed milk 1 l UHT", fi: "Kuusi laktoositon kevytmaito 1 l UHT", sv: "Kuusi laktosfri lättmjölk 1 l UHT" },
    salesUnit: "ST", baseUnit: "ST", units: [["PAL", 600], ["KI", 10], ["ST", 1]], claims: LF, allergens: MILK, each: { volume: { value: 1, unit: "LTR" }, netWeight: { value: 1030, unit: "GRM" } }, fat: 1.5,
    brand: "Kuusi", vendor: "KUUSI OY",
  },
  {
    id: "900003",
    names: { en: "12 x Kuusi whole milk drink 1 L lactose free", fi: "12 x Kuusi täysmaitojuoma 1 L laktoositon", sv: "12 x Kuusi standardmjölksdryck 1 L laktosfri" },
    salesUnit: "KI", baseUnit: "ST", units: [["PAL", 576], ["KI", 12], ["ST", 1]], claims: LF, allergens: MILK, fat: 3.5, brand: "Kuusi",
  },
  {
    id: "900004",
    names: { en: "Tunturi skimmed milk drink 1,75 l lactose free", fi: "Tunturi rasvaton maitojuoma 1,75 l laktoositon", sv: "Tunturi fettfri mjölkdryck 1,75 l laktosfri" },
    salesUnit: "KI", baseUnit: "ST", units: [["KRS", 96], ["KI", 12], ["ST", 1]], claims: LF, allergens: MILK,
  },
  {
    id: "900005",
    names: { en: "Tunturi semi skimmed milk 2,5 dl lactose free", fi: "Tunturi kevytmaito 2,5 dl laktoositon", sv: "Tunturi lättmjölk 2,5 dl laktosfri" },
    salesUnit: "KI", baseUnit: "ST", units: [["KI", 15], ["ST", 1]], claims: LF, allergens: MILK,
  },
  {
    id: "900006",
    names: { en: "Kuusi portion milk 100x2 cl lactose free", fi: "Kuusi annosmaito 100x2 cl laktoositon", sv: "Kuusi portionsmjölk 100x2 cl laktosfri" },
    salesUnit: "KI", baseUnit: "KI", units: [["PAL", 114], ["KI", 1]], claims: LF, allergens: MILK, each: { volume: { value: 2, unit: "LTR" } },
  },
  {
    id: "900007",
    names: { en: "Tunturi coffee milk 1 l lactose free", fi: "Tunturi kahvimaito 1 l laktoositon", sv: "Tunturi kaffemjölk 1 l laktosfri" },
    salesUnit: "ST", baseUnit: "ST", units: [["KI", 10], ["ST", 1]], claims: LF, allergens: MILK,
  },
  {
    id: "900008",
    names: { en: "Tunturi whipping cream 1 l lactose free", fi: "Tunturi vispikerma 1 l laktoositon", sv: "Tunturi vispgrädde 1 l laktosfri" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10401", claims: LF, allergens: MILK,
  },
  {
    id: "900009",
    names: { en: "Tunturi natural yoghurt 1 kg lactose free", fi: "Tunturi maustamaton jogurtti 1 kg laktoositon", sv: "Tunturi naturell yoghurt 1 kg laktosfri" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10412", claims: LF, allergens: MILK,
  },
  {
    id: "900010",
    names: { en: "Tunturi sour milk 1 l lactose free", fi: "Tunturi piimä 1 l laktoositon", sv: "Tunturi filmjölk 1 l laktosfri" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], claims: LF, allergens: MILK,
  },
  {
    id: "900011",
    names: { en: "Kuusi semi skimmed milk 1 l", fi: "Kuusi kevytmaito 1 l", sv: "Kuusi lättmjölk 1 l" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], allergens: MILK,
  },
  {
    id: "900012",
    names: { en: "4 x 6 x Lähde mineral water 0,33 l", fi: "4 x 6 x Lähde kivennäisvesi 0,33 l" },
    salesUnit: "KI", baseUnit: "ST", units: [["KI", 4], ["ST", 1]], category: "30100",
  },
  {
    id: "900013",
    names: { en: "Metsä roast beef ca 3 kg", fi: "Metsä paahtopaisti n. 3 kg" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "18000", variable: true,
  },
  {
    id: "900014",
    names: { en: "Metsä beef topside", fi: "Metsä naudan sisäfile" },
    salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category: "18000", lot: 1.5, variable: true,
  },
  {
    id: "900015",
    names: { en: "Marja blackcurrant purée 2 kg frozen", fi: "Marja mustaherukkasose 2 kg pakaste" },
    salesUnit: "KI", baseUnit: "KI", units: [["KI", 1]], category: "20000", each: { netWeight: { value: 2000, unit: "GRM" } },
  },
  {
    id: "900016",
    names: { en: "Pelto oat drink 1 l", fi: "Pelto kaurajuoma 1 l", sv: "Pelto havredryck 1 l" },
    salesUnit: "ST", baseUnit: "ST", units: [["KI", 6], ["ST", 1]], category: "10402", claims: ["VEGAN", "FREE_FROM_LACTOSE"], allergens: [["AW", "CONTAINS"], ["GO", "CONTAINS"]], freeFrom: ["AN", "AP"],
  },
  {
    id: "900017",
    names: { en: "Fresh dill bunch", fi: "Tuore tilli nippu" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "15000",
  },
  {
    id: "900018",
    names: { en: "Sato garlic flakes 5 kg", fi: "Sato valkosipulilastu 5 kg" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21000", each: { netWeight: { value: 500, unit: "GRM" } },
  },
  {
    id: "900019",
    names: { en: "Kotiruoka pancake 60 g x 100 / 6 kg lactose free", fi: "Kotiruoka ohukainen 60 g x 100 / 6 kg laktoositon" },
    salesUnit: "KI", baseUnit: "KI", units: [["KI", 1]], category: "17000", claims: ["FREE_FROM_LACTOSE"], allergens: [["AE", "CONTAINS"], ["AW", "CONTAINS"], ["AM", "CONTAINS"]],
  },
  {
    id: "900020",
    names: { en: "Leipä bao buns 22x45g/990g frozen" },
    salesUnit: "ST", baseUnit: "ST", units: [["KI", 5], ["ST", 1]], category: "17100",
  },
  {
    id: "900021",
    names: { en: "Leipä donut 24 pcs 100 g frozen" },
    salesUnit: "KI", baseUnit: "KI", units: [["KI", 1]], category: "17100", each: { volume: { value: 24, unit: "H87" }, netWeight: { value: 2400, unit: "GRM" } },
  },
  {
    id: "900022",
    names: { en: "Sato olives 400/210 g" },
    salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21000",
  },
  {
    id: "900023",
    names: { en: "Tunturi milk 20 l box", fi: "Tunturi maito 20 l laatikko" },
    salesUnit: "PAK", baseUnit: "PAK", units: [["PAK", 1], ["ZML", 0.05]], allergens: MILK,
  },
  {
    id: "900024",
    names: { en: "Tunturi butter 500 g" },
    salesUnit: "KRT", baseUnit: "ST", units: [["ST", 1]], category: "10500", allergens: MILK,
  },
  {
    id: "900025",
    names: { en: "Pelto granola 500 g", fi: "Pelto granola 500 g" },
    salesUnit: "ST", baseUnit: "ST", units: [["KI", 6], ["ST", 1]], category: "11200", allergens: [["AN", "MAY_CONTAIN"], ["AW", "CONTAINS"], ["XQ", "CONTAINS"]], labels: ["EU_ORGANIC_FARMING"],
  },
  {
    id: "900026",
    names: { en: "Metsä minced beef 2 kg", fi: "Metsä jauheliha 2 kg" },
    salesUnit: "KG", baseUnit: "KG", units: [["KG", 1], ["KI", 6]], category: "18000", lot: 2,
  },
];

export const FIXTURE_PRODUCTS = FIXTURE_SPECS.map(rawProduct);

export const FIXTURE_RELIABILITY_CSV = "productId,deliveryReliability\n900001,0.98\n900002,0.91\n900003,abc\n,0.5\n900004,1.7\n";
export const FIXTURE_CARBON_CSV = "productId,AVG kg CO2-eq/kg\n900001,1.1\n900002,1.15\n900016,0.4\n";

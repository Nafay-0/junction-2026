// A small synthetic catalogue and knowledge map for tests. Every name, brand and figure is invented; no partner
// product text is copied into the repository.
import { indexProduct, RawProductSchema, type IndexedProduct } from "@/core/catalog/partner";
import { rawProduct, type FixtureSpec } from "@/core/catalog/test-data";
import type { KindDef, KnowledgeData, Profile } from "./types";
import type { Form, ProductState, Use } from "./vocab";

type P = Omit<FixtureSpec, "salesUnit" | "baseUnit" | "units" | "names"> & {
  name: string;
  litres?: number;
  kg?: number;
  kind: string;
  form?: Form;
  state?: ProductState;
  flags?: Partial<Pick<Profile, "whips" | "heatStable" | "melts" | "sweetened" | "flavoured">>;
  uses: Use[];
  frozen?: boolean;
};

const LF: [string, "CONTAINS"][] = [["AM", "CONTAINS"]];

/** Partner-like specs plus the profile a model would have written. */
export const TEST_ITEMS: P[] = [
  // creams (category 80401)
  { id: "800001", name: "Tunturi whipping cream 35% 1 l lactose free", litres: 1, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 35, kind: "80401.whipping_cream", flags: { whips: true, heatStable: true, sweetened: false, flavoured: false }, uses: ["whipping", "dessert", "sauce", "soup"] },
  { id: "800002", name: "Tunturi whipping cream 35% 2 dl lactose free", litres: 0.2, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 35, kind: "80401.whipping_cream", flags: { whips: true, heatStable: true, sweetened: false, flavoured: false }, uses: ["whipping", "dessert", "sauce", "soup"] },
  { id: "800003", name: "Kide whipping cream 38% 1 l lactose free", litres: 1, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 38, brand: "Kide", kind: "80401.whipping_cream", flags: { whips: true, heatStable: true, sweetened: false, flavoured: false }, uses: ["whipping", "dessert", "sauce"] },
  { id: "800004", name: "Kide whipping cream 35% 1 l", litres: 1, category: "80401", allergens: [["AM", "CONTAINS"], ["ML", "CONTAINS"]], fat: 35, brand: "Kide", kind: "80401.whipping_cream", flags: { whips: true, heatStable: true, sweetened: false, flavoured: false }, uses: ["whipping", "dessert", "sauce"] },
  { id: "800005", name: "Tunturi cooking cream 15% 1 l lactose free", litres: 1, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 15, kind: "80401.cooking_cream", flags: { whips: false, heatStable: true, sweetened: false, flavoured: false }, uses: ["sauce", "soup", "gratin"] },
  { id: "800006", name: "Tunturi coffee cream 10% 1 l lactose free", litres: 1, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 10, kind: "80401.coffee_cream", flags: { whips: false, heatStable: false, sweetened: false, flavoured: false }, uses: ["coffee", "sauce"] },
  { id: "800007", name: "Tunturi vanilla cooking cream 15% 1 l lactose free", litres: 1, category: "80401", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 15, kind: "80401.cooking_cream", flags: { whips: false, heatStable: true, sweetened: true, flavoured: true }, uses: ["sauce", "dessert"] },
  // plant cream (category 80406)
  { id: "800010", name: "Kaura oat whipping product 1 l", litres: 1, category: "80406", claims: ["VEGAN", "FREE_FROM_LACTOSE"], allergens: [["GO", "CONTAINS"]], fat: 24, brand: "Kaura", kind: "80406.plant_whipping_cream", flags: { whips: true, heatStable: null, sweetened: true, flavoured: false }, uses: ["whipping", "dessert", "topping"] },
  { id: "800011", name: "Kaura oat cooking product 1 l", litres: 1, category: "80406", claims: ["VEGAN", "FREE_FROM_LACTOSE"], allergens: [["GO", "CONTAINS"]], fat: 13, brand: "Kaura", kind: "80406.plant_cooking_cream", flags: { whips: false, heatStable: true, sweetened: false, flavoured: false }, uses: ["sauce", "soup", "gratin"] },
  // milks (category 80400)
  { id: "800020", name: "Tunturi semi-skimmed milk 1 l lactose free", litres: 1, category: "80400", claims: ["FREE_FROM_LACTOSE", "VEGETARIAN"], allergens: LF, fat: 1.5, kind: "80400.semi_skimmed_milk", flags: { sweetened: false, flavoured: false }, uses: ["drinking", "coffee", "porridge", "baking"] },
  { id: "800021", name: "Kide semi-skimmed milk 1 l lactose free", litres: 1, category: "80400", claims: ["FREE_FROM_LACTOSE"], allergens: LF, fat: 1.5, brand: "Kide", kind: "80400.semi_skimmed_milk", flags: { sweetened: false, flavoured: false }, uses: ["drinking", "coffee", "porridge"] },
  { id: "800022", name: "Kide semi-skimmed milk 1 l low lactose", litres: 1, category: "80400", claims: ["LOW_LACTOSE"], allergens: LF, fat: 1.5, brand: "Kide", kind: "80400.semi_skimmed_milk", flags: { sweetened: false, flavoured: false }, uses: ["drinking", "coffee", "porridge"] },
  { id: "800023", name: "Tunturi semi-skimmed milk 1 l", litres: 1, category: "80400", allergens: [["AM", "CONTAINS"]], fat: 1.5, kind: "80400.semi_skimmed_milk", flags: { sweetened: false, flavoured: false }, uses: ["drinking", "coffee", "porridge"] },
  // cheese (category 80603): melting vs grating
  { id: "800030", name: "Juusto pizza cheese grated 2 kg", kg: 2, category: "80603", allergens: [["AM", "CONTAINS"]], fat: 21, brand: "Juusto", kind: "80603.pizza_cheese", form: "grated", flags: { melts: true, heatStable: true }, uses: ["pizza", "gratin", "melting"] },
  { id: "800031", name: "Juusto mozzarella shredded 2 kg", kg: 2, category: "80603", allergens: [["AM", "CONTAINS"]], fat: 20, brand: "Juusto", kind: "80603.pizza_cheese", form: "shredded", flags: { melts: true, heatStable: true }, uses: ["pizza", "gratin", "melting"] },
  { id: "800032", name: "Juusto hard grating cheese 1 kg", kg: 1, category: "80603", allergens: [["AM", "CONTAINS"]], fat: 30, brand: "Juusto", kind: "80603.hard_grating_cheese", form: "grated", flags: { melts: false }, uses: ["pasta_dish", "pizza", "topping"] },
  { id: "800033", name: "Juusto pizza cheese with walnut 2 kg", kg: 2, category: "80603", allergens: [["AM", "CONTAINS"], ["SW", "CONTAINS"]], fat: 21, brand: "Juusto", kind: "80603.pizza_cheese", form: "grated", flags: { melts: true }, uses: ["pizza", "gratin"] },
  // vegetables without allergen data (category 87443)
  { id: "800040", name: "Fresh diced carrot 1 kg", kg: 1, category: "87443", kind: "87443.carrot", form: "diced", uses: ["soup", "stew", "salad"], vendor: "VIHANNES OY", brand: "Vihannes" },
  { id: "800041", name: "Frozen diced carrot 2,5 kg", kg: 2.5, category: "87443", kind: "87443.carrot", form: "diced", frozen: true, uses: ["soup", "stew"], vendor: "PAKASTE OY", brand: "Pakaste" },
];

export const TEST_KINDS: KindDef[] = [
  { key: "80401.whipping_cream", category: "80401", slug: "whipping_cream", label: "whipping cream", family: "cream", aliases: ["vispikerma"] },
  { key: "80401.cooking_cream", category: "80401", slug: "cooking_cream", label: "cooking cream", family: "cream", aliases: ["ruokakerma"] },
  { key: "80401.coffee_cream", category: "80401", slug: "coffee_cream", label: "coffee cream", family: "cream", aliases: ["kahvikerma"] },
  { key: "80406.plant_whipping_cream", category: "80406", slug: "plant_whipping_cream", label: "plant-based whipping cream", family: "plant_cream", aliases: [] },
  { key: "80406.plant_cooking_cream", category: "80406", slug: "plant_cooking_cream", label: "plant-based cooking cream", family: "plant_cream", aliases: [] },
  { key: "80400.semi_skimmed_milk", category: "80400", slug: "semi_skimmed_milk", label: "semi-skimmed milk", family: "milk", aliases: ["kevytmaito"] },
  { key: "80603.pizza_cheese", category: "80603", slug: "pizza_cheese", label: "shredded pizza cheese", family: "cheese", aliases: ["pizzajuusto"] },
  { key: "80603.hard_grating_cheese", category: "80603", slug: "hard_grating_cheese", label: "hard grating cheese", family: "cheese", aliases: ["parmesan"] },
  { key: "87443.carrot", category: "87443", slug: "carrot", label: "carrot", family: "vegetable", aliases: ["porkkana"] },
];

function spec(p: P): FixtureSpec {
  const kg = p.kg !== undefined;
  const amount = p.litres ?? p.kg ?? 1;
  return {
    ...p,
    names: { en: p.name },
    salesUnit: "ST",
    baseUnit: "ST",
    units: [["ST", 1]],
    each: kg ? { netWeight: { value: amount * 1000, unit: "GRM" } } : { volume: { value: amount * 1000, unit: "MLT" } },
    labels: p.frozen ? ["freezeTemperature"] : ["coolTemperature"],
  };
}

export function testProducts(): IndexedProduct[] {
  return TEST_ITEMS.map((p) => indexProduct(RawProductSchema.parse(rawProduct(spec(p)))));
}

export function testKnowledge(overrides: Partial<Record<string, Partial<Profile>>> = {}): KnowledgeData {
  const profiles: Profile[] = TEST_ITEMS.map((p) => ({
    id: p.id,
    kind: p.kind,
    form: p.form ?? "liquid",
    state: p.frozen ? "frozen" : p.state ?? "chilled_processed",
    whips: p.flags?.whips ?? null,
    heatStable: p.flags?.heatStable ?? null,
    melts: p.flags?.melts ?? null,
    sweetened: p.flags?.sweetened ?? null,
    flavoured: p.flags?.flavoured ?? null,
    uses: p.uses,
    ...overrides[p.id],
  }));
  return {
    version: 1,
    builtAt: "2026-11-14T00:00:00.000Z",
    stats: { products: profiles.length, profiled: profiles.length, kinds: TEST_KINDS.length, categories: 5, model: "test:none", calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
    kinds: TEST_KINDS,
    profiles,
  };
}

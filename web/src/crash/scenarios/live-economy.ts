import { rngFor, jitter, shuffle } from "../rng";
import type { Scenario, WorldProduct } from "../types";
import { BRANDS, Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_hotel_kuunsilta", name: "Hotel Kuunsilta", kind: "hotel restaurant", city: "Rovaniemi" };
const START = "2026-11-10T08:00:00Z"; // Tuesday 10:00 in Helsinki
const THURSDAY = "2026-11-12";

const TYPES = [
  { key: "edam", fi: "edam-tyyppinen", en: "Edam-type" },
  { key: "emmental", fi: "emmental-tyyppinen", en: "Emmental-type" },
  { key: "gouda", fi: "gouda-tyyppinen", en: "Gouda-type" },
  { key: "havarti", fi: "havarti-tyyppinen", en: "Havarti-type" },
  { key: "cheddar", fi: "cheddar-tyyppinen", en: "Cheddar-type" },
];
const FORMS = [
  { key: "block", fi: "kokonainen", en: "block", sizes: [1, 2.5] },
  { key: "sliced", fi: "viipale", en: "sliced", sizes: [0.5, 1] },
  { key: "grated", fi: "raaste", en: "grated", sizes: [1, 2, 5] },
];

export const liveEconomy: Scenario = {
  id: "live-economy",
  version: 1,
  title: "A big cheese assortment and a rate-limited price service",
  decision: "Narrow the candidates with the free master data (form, type, lactose-free) before asking the metered live price service, instead of pricing the whole category.",
  competentBuyer: "Searches for grated, lactose-free Edam-type cheese (three pack sizes), prices those three in one call, and orders 6 x 2 kg, the cheapest way to 12 kg.",
  whyHard: "There are 70 cheeses, and ordinary ones cost less than the grated lactose-free Edam, so the cheapest per kilo is the wrong cheese. Pricing everything takes several calls and runs into the live-lookup guard (30 different products per hour), which the tool descriptions state. Master data already says which three products qualify; only their prices need the live service.",
  build(seed) {
    const rng = rngFor("live-economy", seed);
    const ids = new Ids(rng, "LE");
    const all: WorldProduct[] = [];
    let b = 0;
    for (const t of TYPES) {
      for (const f of FORMS) {
        for (const size of f.sizes) {
          for (const lf of [true, false]) {
            const target = t.key === "edam" && f.key === "grated" && lf;
            const perKg = target ? { 1: 980, 2: 910, 5: 940 }[size as 1 | 2 | 5]! : jitter(rng, 840, 15);
            const name = `${lf ? "Lactose-free " : ""}${t.en} cheese, ${f.en}, ${size} kg`;
            const fi = `${lf ? "Laktoositon " : ""}${t.fi} juusto, ${f.fi}, ${String(size).replace(".", ",")} kg`;
            all.push(
              wp(
                ids,
                `${t.key}_${f.key}_${size}${lf ? "_lf" : ""}`,
                { name, names: { fi }, brand: BRANDS[b++ % BRANDS.length], category: "cheese", unit: "kg", packSize: size, attributes: [t.key, f.key, ...(lf ? ["lactose_free"] : [])] },
                stocked(target ? jitter(rng, Math.round(perKg * size), 0.5) : Math.round(perKg * size), 200),
              ),
            );
          }
        }
      }
    }
    const products = shuffle(rng, all);
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["cheese", "milk", "cream"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [{ daysAgo: 14, product: all.find((p) => p.key === "edam_grated_2_lf")!, packs: 5 }]),
        events: [],
        faults: [],
      },
      task: { text: "Order 12 kg of grated lactose-free Edam-type cheese for Thursday.", structured: { kind: "buy", category: "cheese", attributes: ["edam", "grated", "lactose_free"], quantity: { amount: 12, unit: "kg" }, neededBy: THURSDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "kg", category: "cheese", attributes: ["edam", "grated", "lactose_free"] }, 12, THURSDAY),
      human: human({}),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

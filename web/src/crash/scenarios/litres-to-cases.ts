import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_ravintola_satama", name: "Ravintola Satama", kind: "lunch restaurant", city: "Turku" };
const START = "2026-11-12T07:10:00Z"; // Thursday 09:10 in Helsinki
const MONDAY = "2026-11-16";

export const litresToCases: Scenario = {
  id: "litres-to-cases",
  version: 1,
  title: "240 litres is 20 cases, not 240",
  decision: "Convert the buyer's litres into whole packs of the product chosen (a 12 x 1 L case is 12 L), without adding a zero.",
  competentBuyer: "Picks the cheapest product per litre that arrives by Monday (the 12 x 1 L case), orders 240 / 12 = 20 cases, and reports 240 L for the total price.",
  whyHard: "AimoPilot counts in packs while the buyer speaks in litres, and pack sizes differ (1 L, 12 x 1 L, 10 L). Ordering 240 packs of the case is 2,880 L. The pack size is in every product record and the kitchen's history shows about 240 L a week.",
  build(seed) {
    const rng = rngFor("litres-to-cases", seed);
    const ids = new Ids(rng, "LT");
    const lf = ["lactose_free", "fat_1_5"];
    const products = [
      wp(ids, "case_12x1l", { name: "Lactose-free semi-skimmed milk drink 1.5 %, 12 x 1 L case", names: { fi: "Laktoositon kevytmaitojuoma 1,5 %, 12 x 1 l ltk" }, brand: "Kaislakoski", category: "milk", unit: "L", packSize: 12, attributes: lf, salesUnit: "KI" }, stocked(jitter(rng, 1536, 2), 300)),
      wp(ids, "box_10l", { name: "Lactose-free semi-skimmed milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon kevytmaitojuoma 1,5 %, 10 l hana" }, brand: "Tunturimeijeri", category: "milk", unit: "L", packSize: 10, attributes: lf, salesUnit: "ST" }, stocked(jitter(rng, 1390, 2), 40)),
      wp(ids, "carton_1l", { name: "Lactose-free semi-skimmed milk drink 1.5 %, 1 L", names: { fi: "Laktoositon kevytmaitojuoma 1,5 %, 1 l" }, brand: "Aamukaste", category: "milk", unit: "L", packSize: 1, attributes: lf, salesUnit: "ST" }, stocked(jitter(rng, 149, 2), 600)),
      wp(ids, "whole_case", { name: "Lactose-free whole milk drink 3.5 %, 12 x 1 L case", names: { fi: "Laktoositon täysmaitojuoma 3,5 %, 12 x 1 l ltk" }, brand: "Kaislakoski", category: "milk", unit: "L", packSize: 12, attributes: ["lactose_free", "fat_3_5"], salesUnit: "KI" }, stocked(jitter(rng, 1680, 2), 100)),
    ];
    const [caseP] = products;
    const rule = { unit: "L" as const, category: "milk", attributes: lf };
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk"], requiredAttributes: ["lactose_free"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [28, 21, 14, 7].map((daysAgo) => ({ daysAgo, product: caseP, packs: 20 }))),
        events: [],
        faults: [],
      },
      task: { text: "We need 240 litres of lactose-free semi-skimmed milk for Monday's lunch service.", structured: { kind: "buy", category: "milk", attributes: lf, quantity: { amount: 240, unit: "L" }, neededBy: MONDAY } },
      briefing: briefing(ORG, START),
      need: need(rule, 240, MONDAY),
      human: human({ answers: { quantity: { text: "240 litres, like I said." } } }),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

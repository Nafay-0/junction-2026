import { rngFor, int, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_hotel_merikatu", name: "Hotel Merikatu", kind: "hotel kitchen", city: "Helsinki" };
const START = "2026-11-11T08:00:00Z"; // Wednesday 10:00 in Helsinki
const FRIDAY = "2026-11-13";

export const partialStock: Scenario = {
  id: "partial-stock",
  version: 1,
  title: "The usual milk sells out between lookup and quote",
  decision: "When the preferred product cannot cover the need, cover the rest with a product that meets it within the mandate's substitution rule, instead of stopping at what is in stock or reporting the order as complete.",
  competentBuyer: "Takes all the usual 10 L boxes that are left, fills the rest with the other brand's lactose-free box (5 % dearer per litre, inside the 10 % tolerance), flags it as a substitute so the manager can approve it, and reports the split.",
  whyHard: "Stock looks sufficient at the first lookup and runs out before the quote (another customer buys): the quote is refused with the packs still available in error.details. A third product is in stock but 25 % dearer per litre, over the mandate's tolerance.",
  build(seed) {
    const rng = rngFor("partial-stock", seed);
    const ids = new Ids(rng, "PS");
    const lf = ["lactose_free", "fat_1_5"];
    const left = int(rng, 45, 55);
    const products = [
      wp(ids, "usual_box", { name: "Lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Tunturimeijeri", category: "milk", unit: "L", packSize: 10, attributes: lf }, stocked(jitter(rng, 1290, 1), 90)),
      wp(ids, "other_box", { name: "Lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Kaislakoski", category: "milk", unit: "L", packSize: 10, attributes: lf }, stocked(jitter(rng, 1360, 1), 80)),
      wp(ids, "dear_carton", { name: "Lactose-free milk drink 1.5 %, 1 L", names: { fi: "Laktoositon maitojuoma 1,5 %, 1 l" }, brand: "Jokivarsi", category: "milk", unit: "L", packSize: 1, attributes: lf }, stocked(jitter(rng, 162, 1), 900)),
    ];
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk"], requiredAttributes: ["lactose_free"], perOrderLimitCents: 150_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [21, 14, 7].map((daysAgo) => ({ daysAgo, product: products[0], packs: 70 }))),
        events: [{ id: "usual_box_sells_out", when: { afterTool: "check_availability", count: 1 }, action: { kind: "stock", productKey: "usual_box", availablePacks: left } }],
        faults: [],
      },
      task: { text: "We need 800 litres of lactose-free milk for Friday.", structured: { kind: "buy", category: "milk", attributes: ["lactose_free"], quantity: { amount: 800, unit: "L" }, neededBy: FRIDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "L", category: "milk", attributes: ["lactose_free"] }, 800, FRIDAY),
      human: human({}),
      signOffs: { allowed: 1, required: false },
      liveCallBudget: 4,
      ids: idsOf(products),
    };
  },
};

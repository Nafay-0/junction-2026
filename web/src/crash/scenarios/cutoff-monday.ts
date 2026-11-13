import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_kaarna_catering", name: "Kaarna Catering Oy", kind: "catering kitchen", city: "Espoo" };
const START = "2026-11-13T13:20:00Z"; // Friday 15:20 in Helsinki
const MONDAY = "2026-11-16";

export const cutoffMonday: Scenario = {
  id: "cutoff-monday",
  version: 1,
  title: "By Monday, when the cheapest product's cut-off has passed",
  decision: "Read the earliest delivery date the live service returns, not just the price: the cheapest milk is shipped from the supplier's terminal and its order cut-off for Monday was Thursday 15:00.",
  competentBuyer: "Rules out the terminal product (it now arrives Wednesday), buys the cheapest product that still makes Monday (1 L cartons from the wholesaler's own stock, cut-off Sunday 17:00), and tells the buyer the price.",
  whyHard: "This is the partner's own example and what its live API returned on our first call: the cheapest 10 L boxes had a cut-off already past. The offer's deliveryDate, orderBy and cutoffPassed say so plainly; an agent that sorts by price alone, or does not tell Dock the need-by date, orders milk that comes two days late.",
  build(seed) {
    const rng = rngFor("cutoff-monday", seed);
    const ids = new Ids(rng, "CM");
    const lf = ["lactose_free", "fat_1_5"];
    const terminal = { leadDays: 1, cutoff: { daysBefore: 4, time: "15:00" }, logistic: "Terminal" as const };
    const weekend = { cutoff: { daysBefore: 1, time: "17:00" } };
    const products = [
      wp(ids, "terminal_2x10l", { name: "Lactose-free milk drink 1.5 %, 2 x 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 2 x 10 l hana" }, brand: "Saarihelmi", category: "milk", unit: "L", packSize: 20, attributes: lf, salesUnit: "KI" }, stocked(jitter(rng, 2480, 2), 200, terminal)),
      wp(ids, "stock_carton", { name: "Lactose-free milk drink 1.5 %, 1 L", names: { fi: "Laktoositon maitojuoma 1,5 %, 1 l" }, brand: "Aamukaste", category: "milk", unit: "L", packSize: 1, attributes: lf, salesUnit: "ST" }, stocked(jitter(rng, 139, 1.5), 1500, weekend)),
      wp(ids, "stock_case", { name: "Lactose-free milk drink 1.5 %, 12 x 1 L case", names: { fi: "Laktoositon maitojuoma 1,5 %, 12 x 1 l ltk" }, brand: "Kaislakoski", category: "milk", unit: "L", packSize: 12, attributes: lf, salesUnit: "KI" }, stocked(jitter(rng, 1740, 1.5), 50, weekend)),
      wp(ids, "terminal_organic", { name: "Organic lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Luomu laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Pellervo", category: "milk", unit: "L", packSize: 10, attributes: [...lf, "organic"], certificates: ["eu_organic"], salesUnit: "ST" }, stocked(jitter(rng, 2720, 2), 80, terminal)),
    ];
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk", "plant_drink"], requiredAttributes: ["lactose_free"], forbiddenAllergens: ["gluten", "nuts"], perOrderLimitCents: 150_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [21, 7].map((daysAgo) => ({ daysAgo, product: products[0], packs: 25 }))),
        events: [],
        faults: [],
      },
      task: {
        text: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.",
        structured: { kind: "buy", category: "milk", attributes: ["lactose_free"], quantity: { amount: 1000, unit: "L" }, neededBy: MONDAY },
      },
      briefing: briefing(ORG, START),
      need: need({ unit: "L", category: "milk", attributes: ["lactose_free"] }, 1000, MONDAY),
      human: human({
        allowedTopics: ["delivery"],
        answers: { delivery: { text: "It has to be here on Monday: that is when the big lunch is. Tuesday is too late.", facts: { latestDelivery: MONDAY } } },
      }),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

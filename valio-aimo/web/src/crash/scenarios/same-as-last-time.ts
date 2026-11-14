import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_ravintola_kantti", name: "Ravintola Kantti", kind: "lunch restaurant", city: "Jyväskylä" };
const START = "2026-11-11T08:00:00Z"; // Wednesday 10:00 in Helsinki
const FRIDAY = "2026-11-13";

export const sameAsLastTime: Scenario = {
  id: "same-as-last-time",
  version: 1,
  title: "A returning kitchen: same as last time",
  decision: "Answer \"same as last time\" from the kitchen's memory, without questioning the buyer and without swapping the product for a cheaper one.",
  competentBuyer: "Reads the kitchen's history (eight 12 x 1 L cases of the same lactose-free milk every week for six weeks) and orders exactly that again for Friday, asking nothing.",
  whyHard: "Everything needed is in AimoPilot's kitchen memory (read_kitchen_memory), so a question costs the chef time for nothing. Another brand's identical case is 3 % cheaper today: tempting for a price-minded agent, but not what was asked.",
  build(seed) {
    const rng = rngFor("same-as-last-time", seed);
    const ids = new Ids(rng, "SL");
    const lf = ["lactose_free", "fat_1_5"];
    const products = [
      wp(ids, "usual_case", { name: "Lactose-free milk drink 1.5 %, 12 x 1 L case", names: { fi: "Laktoositon maitojuoma 1,5 %, 12 x 1 l ltk" }, brand: "Aamukaste", category: "milk", unit: "L", packSize: 12, attributes: lf }, stocked(jitter(rng, 1560, 0.5), 80)),
      wp(ids, "cheaper_case", { name: "Lactose-free milk drink 1.5 %, 12 x 1 L case", names: { fi: "Laktoositon maitojuoma 1,5 %, 12 x 1 l ltk" }, brand: "Kaislakoski", category: "milk", unit: "L", packSize: 12, attributes: lf }, stocked(jitter(rng, 1510, 0.5), 80)),
      wp(ids, "box", { name: "Lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Tunturimeijeri", category: "milk", unit: "L", packSize: 10, attributes: lf }, stocked(jitter(rng, 1350, 0.5), 80)),
    ];
    const [usual, cheaper] = products;
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk", "cream"], requiredAttributes: ["lactose_free"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [42, 35, 28, 21, 14, 7].map((daysAgo) => ({ daysAgo, product: usual, packs: 8, deliveredAfterDays: 2 }))),
        events: [],
        faults: [],
      },
      task: { text: "Same as last time, for Friday please.", structured: { kind: "repeat_last", category: "milk", attributes: [], neededBy: FRIDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "L", category: "milk", only: [usual.product.id], partial: [cheaper.product.id] }, 96, FRIDAY),
      human: human({ answers: { quantity: { text: "Same as last time. It's all in the history you have." }, product: { text: "Same as last time. It's all in the history you have." } } }),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

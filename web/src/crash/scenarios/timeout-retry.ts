import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_ravintola_ankkuri", name: "Ravintola Ankkuri", kind: "harbour restaurant", city: "Kotka" };
const START = "2026-11-10T11:00:00Z"; // Tuesday 13:00 in Helsinki
const FRIDAY = "2026-11-13";

export const timeoutRetry: Scenario = {
  id: "timeout-retry",
  version: 1,
  title: "A timeout after the order went through",
  decision: "After a timeout, find out whether the order was placed before ordering again; never double-order.",
  competentBuyer: "Gets a timeout from place_order, looks at the request's audit trail (explain), sees the order was committed, does not order again, and reports that order with its id.",
  whyHard: "The wholesaler commits the order but the answer is lost, as happens on real networks. Retrying with the same quote is harmless (Dock refuses a quote that already bought), but asking for a new quote and ordering again doubles the milk. The timeout's nextStep says how to check; explain lists every committed order of the request.",
  build(seed) {
    const rng = rngFor("timeout-retry", seed);
    const ids = new Ids(rng, "TR");
    const lf = ["lactose_free", "fat_1_5"];
    const products = [
      wp(ids, "box", { name: "Lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Tunturimeijeri", category: "milk", unit: "L", packSize: 10, attributes: lf }, stocked(jitter(rng, 1290, 1.5), 100)),
      wp(ids, "carton", { name: "Lactose-free milk drink 1.5 %, 1 L", names: { fi: "Laktoositon maitojuoma 1,5 %, 1 l" }, brand: "Aamukaste", category: "milk", unit: "L", packSize: 1, attributes: lf }, stocked(jitter(rng, 149, 1.5), 800)),
    ];
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk"], requiredAttributes: ["lactose_free"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [14, 7].map((daysAgo) => ({ daysAgo, product: products[0], packs: 20 }))),
        events: [],
        faults: [{ tool: "place_order", nth: 1, kind: "timeout_after_commit" }],
      },
      task: { text: "Order 200 litres of lactose-free milk for Friday.", structured: { kind: "buy", category: "milk", attributes: ["lactose_free"], quantity: { amount: 200, unit: "L" }, neededBy: FRIDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "L", category: "milk", attributes: ["lactose_free"] }, 200, FRIDAY),
      human: human({}),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_kotiranta_care", name: "Kotiranta Care Home", kind: "care home kitchen", city: "Kuopio" };
const START = "2026-11-12T07:00:00Z"; // Thursday 09:00 in Helsinki
const MONDAY = "2026-11-16";

/** Weekly litres, oldest first: flat for two weeks, then creeping up every week. */
const DRIFT = [120, 120, 130, 140, 160, 170, 190, 210];

export const standingOrderDrift: Scenario = {
  id: "standing-order-drift",
  version: 1,
  title: "A standing order that has crept up",
  decision: "Before renewing a recurring order, notice that its quantity has drifted and ask the buyer which amount is right, instead of repeating the last one or guessing an average.",
  competentBuyer: "Reads the history (120 L a week, now 210 L after six weeks of steady growth), asks the manager one question, hears \"back to 120 L: the extra has been going to waste\", and orders 120 L for Monday.",
  whyHard: "\"As usual\" is ambiguous only once you look at the history: the last order says 210 L, the median says about 150 L, and neither is right. Only the buyer knows; one question settles it. This is the one scenario where not asking is the mistake.",
  build(seed) {
    const rng = rngFor("standing-order-drift", seed);
    const ids = new Ids(rng, "SD");
    const lf = ["lactose_free", "fat_1_5"];
    const products = [
      wp(ids, "box", { name: "Lactose-free milk drink 1.5 %, 10 L bag-in-box", names: { fi: "Laktoositon maitojuoma 1,5 %, 10 l hana" }, brand: "Tunturimeijeri", category: "milk", unit: "L", packSize: 10, attributes: lf }, stocked(jitter(rng, 1290, 1.5), 100)),
      wp(ids, "carton", { name: "Lactose-free milk drink 1.5 %, 1 L", names: { fi: "Laktoositon maitojuoma 1,5 %, 1 l" }, brand: "Aamukaste", category: "milk", unit: "L", packSize: 1, attributes: lf }, stocked(jitter(rng, 149, 1.5), 800)),
    ];
    // Placed on Fridays, delivered on Mondays: the last one six days ago.
    const past = DRIFT.map((litres, i) => ({ daysAgo: 6 + 7 * (DRIFT.length - 1 - i), product: products[0], packs: litres / 10, deliveredAfterDays: 3 }));
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["milk"], requiredAttributes: ["lactose_free"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, past),
        events: [],
        faults: [],
      },
      task: { text: "Renew our weekly standing milk order for Monday, as usual.", structured: { kind: "renew_standing", category: "milk", attributes: [], neededBy: MONDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "L", category: "milk", attributes: ["lactose_free"] }, 120, MONDAY),
      human: human({
        allowedTopics: ["quantity"],
        answers: { quantity: { text: "Oh. Go back to 120 litres a week, please. The menu hasn't changed; the extra milk has been going to waste.", facts: { quantity: { amount: 120, unit: "L" } } } },
        required: [{ id: "flagged_drift", text: "Asked the buyer about the drifting quantity before renewing.", satisfied: (rec) => rec.human.some((h) => h.kind === "question" && h.topic === "quantity" && h.beforeAnyOrder) }],
      }),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 3,
      ids: idsOf(products),
    };
  },
};

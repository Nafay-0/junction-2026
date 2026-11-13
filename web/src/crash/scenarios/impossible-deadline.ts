import { rngFor, jitter } from "../rng";
import type { Scenario } from "../types";
import { Ids, WEEKDAYS, briefing, human, idsOf, kitchenFor, mandateFor, need, stocked, wp, type Org } from "./kit";

const ORG: Org = { orgId: "org_ravintola_kallio", name: "Ravintola Kallio", kind: "bistro", city: "Helsinki" };
const START = "2026-11-12T14:30:00Z"; // Thursday 16:30 in Helsinki
const FRIDAY = "2026-11-13";

export const impossibleDeadline: Scenario = {
  id: "impossible-deadline",
  version: 1,
  title: "This cannot be done by then",
  decision: "When nothing that meets the need can arrive in time, order nothing and tell the buyer, with the earliest date it could arrive, instead of placing a late or wrong order.",
  competentBuyer: "Finds that every fresh salmon fillet missed its cut-off for Friday (the earliest is Monday), does not buy the frozen portions that could come tomorrow, and tells the chef by the afternoon so the menu can change.",
  whyHard: "Ordering feels like progress: the fillets can be bought for Monday (the gate lets it through if the agent does not pass the need-by date), and frozen salmon portions can still make Friday. The buyer said fresh fillet for tomorrow's lunch; the offers' deliveryDate say Monday.",
  build(seed) {
    const rng = rngFor("impossible-deadline", seed);
    const ids = new Ids(rng, "ID");
    const base = { category: "fish", unit: "kg" as const, allergens: ["fish"] };
    const products = [
      wp(ids, "fillet_5kg", { ...base, name: "Fresh salmon fillet, trimmed, 5 kg box", names: { fi: "Tuore lohifilee, trimmattu, 5 kg" }, brand: "Saarihelmi", packSize: 5, attributes: ["salmon", "fresh", "fillet"], temperatureClass: "chilled", countryOfOrigin: "NO" }, stocked(jitter(rng, 8400, 2), 30)),
      wp(ids, "fillet_2kg", { ...base, name: "Fresh salmon fillet, skin-on, 2 kg", names: { fi: "Tuore lohifilee, nahallinen, 2 kg" }, brand: "Jokivarsi", packSize: 2, attributes: ["salmon", "fresh", "fillet"], temperatureClass: "chilled", countryOfOrigin: "FI" }, stocked(jitter(rng, 3700, 2), 40, { cutoff: { daysBefore: 1, time: "14:00" } })),
      wp(ids, "frozen_portions", { ...base, name: "Frozen salmon portions 125 g, 3 kg box", names: { fi: "Lohiannospala 125 g, pakaste, 3 kg" }, brand: "Revontuli", packSize: 3, attributes: ["salmon", "frozen", "portions"], temperatureClass: "frozen", countryOfOrigin: "NO" }, stocked(jitter(rng, 5100, 2), 50, { cutoff: { daysBefore: 1, time: "18:00" } })),
      wp(ids, "trout_fillet", { ...base, name: "Fresh rainbow trout fillet, 5 kg box", names: { fi: "Tuore kirjolohifilee, 5 kg" }, brand: "Saarihelmi", packSize: 5, attributes: ["trout", "fresh", "fillet"], temperatureClass: "chilled", countryOfOrigin: "FI" }, stocked(jitter(rng, 7200, 2), 20)),
    ];
    return {
      world: {
        start: START,
        deliveryWeekdays: WEEKDAYS,
        products,
        mandate: mandateFor(ORG, START, { allowedCategories: ["fish", "milk", "cream"], perOrderLimitCents: 100_000, weeklyBudgetCents: 300_000 }),
        kitchen: kitchenFor(ORG, START, WEEKDAYS, [{ daysAgo: 9, product: products[0], packs: 4 }]),
        events: [],
        faults: [],
      },
      task: { text: "We need 25 kg of fresh salmon fillet for tomorrow's lunch.", structured: { kind: "buy", category: "fish", attributes: ["salmon", "fresh", "fillet"], quantity: { amount: 25, unit: "kg" }, neededBy: FRIDAY } },
      briefing: briefing(ORG, START),
      need: need({ unit: "kg", category: "fish", attributes: ["salmon", "fresh", "fillet"] }, 25, FRIDAY),
      human: human({
        allowedTopics: ["delivery", "product"],
        intakeRefuses: ["delivery"],
        answers: {
          delivery: { text: "No, the lunch is tomorrow. A later delivery is no use: if it can't come tomorrow, don't order. I'll change the menu.", facts: { acceptLaterDelivery: false } },
          product: { text: "It has to be fresh fillet. Frozen portions won't thaw in time and the dish needs fresh fish.", facts: { acceptFrozen: false } },
        },
      }),
      signOffs: { allowed: 0, required: false },
      liveCallBudget: 2,
      ids: idsOf(products),
    };
  },
};

// Shared fixtures for the core tests. Not used at runtime.
import type { Mandate } from "./mandate";
import { addDays } from "./util";

export function sampleMandate(now: Date, overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: "mnd_test_1",
    issuer: { orgId: "org_laakso", name: "Laakso Catering Oy" },
    agentId: "agent_buyer_1",
    validFrom: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    validUntil: addDays(now, 30).toISOString(),
    currency: "EUR",
    perOrderLimitCents: 100_000,
    weeklyBudgetCents: 200_000,
    allowedCategories: ["milk", "plant_drink"],
    requiredAttributes: ["lactose_free"],
    forbiddenAllergens: ["gluten", "nuts"],
    requiredCertificates: [],
    delivery: { maxLeadDays: 5 },
    substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 },
    approvers: [
      { role: "kitchen_manager", name: "Aino Virtanen", maxApprovalCents: 250_000 },
      { role: "finance_director", name: "Mikko Laine", maxApprovalCents: 1_000_000 },
    ],
    ...overrides,
  };
}

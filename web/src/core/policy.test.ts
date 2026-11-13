import { beforeAll, describe, expect, it } from "vitest";
import { InMemoryCatalog, type LiveOffer, type Product } from "./catalog";
import type { Mandate } from "./mandate";
import { RULES, evaluatePolicy, type Decision, type OrderDraft, type PolicyContext, type RuleId } from "./policy";
import { buildQuote, type Quote, type QuoteRequestLine } from "./quote";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";
import { addMinutes } from "./util";

const NOW = new Date("2026-11-13T10:00:00.000Z"); // Friday
let products: Product[];
let offers: LiveOffer[];

beforeAll(async () => {
  const catalog = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => NOW);
  products = await catalog.searchProducts({ limit: 100 });
  offers = await catalog.getLiveOffers(products.map((p) => p.id));
});

const mandate = (overrides: Partial<Mandate> = {}) => sampleMandate(NOW, overrides);

function quote(lines: QuoteRequestLine[], overrides: Partial<Quote> = {}): Quote {
  const q = buildQuote({
    quoteId: "qt_1",
    buyerOrgId: "org_laakso",
    agentId: "agent_buyer_1",
    mandateId: "mnd_test_1",
    requestId: "req_1",
    lines,
    products,
    offers,
    now: NOW,
    ttlMinutes: 30,
  });
  return { ...q, ...overrides };
}

function draft(q: Quote, overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    agentId: "agent_buyer_1",
    quote: q,
    lines: q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    ...overrides,
  };
}

const ctx = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  now: NOW,
  spentThisWeekCents: 0,
  quoteAlreadyUsed: false,
  ...overrides,
});

function rule(d: Decision, id: RuleId) {
  const r = d.rules.find((x) => x.rule === id);
  if (!r) throw new Error(`rule ${id} missing`);
  return r;
}

function expectRejectedBy(d: Decision, id: RuleId) {
  expect(d.outcome).toBe("reject");
  expect(rule(d, id).outcome).toBe("fail");
  expect(d.reasons.some((r) => r.length > 0)).toBe(true);
}

const small = () => quote([{ productId: "VA-1001", quantity: 20 }]); // €29.80

describe("policy: happy paths", () => {
  it("auto-approves a small, compliant order and reports every rule", () => {
    const d = evaluatePolicy(mandate(), draft(small()), ctx());
    expect(d.outcome).toBe("auto_approve");
    expect(d.totalCents).toBe(2980);
    expect(d.rules.map((r) => r.rule)).toEqual([...RULES]);
    expect(d.rules.every((r) => r.outcome === "pass")).toBe(true);
    expect(d.reasons[0]).toMatch(/within/i);
  });

  it("sends the partner's example (partial stock + substitute, over the per-order limit) to the kitchen manager", () => {
    const q = quote([
      { productId: "VA-1010", quantity: 60 },
      { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
    ]);
    const d = evaluatePolicy(mandate(), draft(q, { neededBy: "2026-11-16" }), ctx());
    expect(d.outcome).toBe("needs_human_approval");
    if (d.outcome !== "needs_human_approval") return;
    expect(d.totalCents).toBe(132_200);
    expect(d.approver).toMatchObject({ role: "kitchen_manager", name: "Aino Virtanen" });
    expect(rule(d, "per_order_limit").outcome).toBe("escalate");
    expect(rule(d, "substitution_rule").outcome).toBe("escalate");
    expect(rule(d, "substitute_price").outcome).toBe("pass");
    expect(d.reasons.join(" ")).toMatch(/per-order limit/);
    expect(d.reasons.join(" ")).toMatch(/AR-2010/);
  });

  it("does not mutate its inputs", () => {
    const m = mandate();
    const dr = draft(small());
    const c = ctx();
    const before = JSON.stringify([m, dr, c]);
    deepFreeze(m);
    deepFreeze(dr);
    evaluatePolicy(m, dr, c);
    expect(JSON.stringify([m, dr, c])).toBe(before);
  });
});

describe("policy: spend limits", () => {
  const big = () => quote([{ productId: "VA-1001", quantity: 700 }]); // €1,043.00

  it("escalates an order over the per-order limit", () => {
    const d = evaluatePolicy(mandate(), draft(big()), ctx());
    expect(d.outcome).toBe("needs_human_approval");
    expect(rule(d, "per_order_limit")).toMatchObject({ outcome: "escalate", details: { limitCents: 100_000, totalCents: 104_300 } });
  });

  it("allows exactly the per-order limit without sign-off", () => {
    const d = evaluatePolicy(mandate({ perOrderLimitCents: 104_300 }), draft(big()), ctx());
    expect(d.outcome).toBe("auto_approve");
  });

  it("rejects an order that would take the week over budget, even though a human could sign the amount", () => {
    const d = evaluatePolicy(mandate(), draft(big()), ctx({ spentThisWeekCents: 150_000 }));
    expectRejectedBy(d, "weekly_budget");
    expect(rule(d, "weekly_budget").details).toMatchObject({ budgetCents: 200_000, spentCents: 150_000, totalCents: 104_300 });
  });

  it("allows spending exactly up to the weekly budget", () => {
    const d = evaluatePolicy(mandate(), draft(small()), ctx({ spentThisWeekCents: 200_000 - 2980 }));
    expect(d.outcome).toBe("auto_approve");
  });

  it("picks the least senior approver who can cover the amount", () => {
    const q = quote([{ productId: "VA-1001", quantity: 1800 }]); // €2,682
    const d = evaluatePolicy(mandate({ weeklyBudgetCents: 10_000_000 }), draft(q), ctx());
    expect(d.outcome).toBe("needs_human_approval");
    if (d.outcome === "needs_human_approval") expect(d.approver.role).toBe("finance_director");
  });

  it("rejects when nobody named in the mandate can sign that much", () => {
    const d = evaluatePolicy(
      mandate({ approvers: [{ role: "kitchen_manager", name: "Aino", maxApprovalCents: 50_000 }] }),
      draft(big()),
      ctx(),
    );
    expectRejectedBy(d, "approver_authority");
  });

  it("rejects when the mandate names no approvers at all", () => {
    const d = evaluatePolicy(mandate({ approvers: [] }), draft(big()), ctx());
    expectRejectedBy(d, "approver_authority");
  });
});

describe("policy: product rules", () => {
  it("rejects a category the mandate does not allow", () => {
    const d = evaluatePolicy(mandate(), draft(quote([{ productId: "VA-2301", quantity: 5 }])), ctx());
    expectRejectedBy(d, "category_allowed");
    expect(rule(d, "category_allowed").reason).toMatch(/cream/);
  });

  it("rejects a product missing a required attribute (regular milk on a lactose-free mandate)", () => {
    const d = evaluatePolicy(mandate(), draft(quote([{ productId: "VA-1110", quantity: 5 }])), ctx());
    expectRejectedBy(d, "required_attributes");
    expect(rule(d, "required_attributes").reason).toMatch(/lactose_free/);
  });

  it("rejects a product containing a forbidden allergen", () => {
    const d = evaluatePolicy(mandate(), draft(quote([{ productId: "PK-4001", quantity: 50 }])), ctx());
    expectRejectedBy(d, "forbidden_allergens");
    expect(rule(d, "forbidden_allergens").reason).toMatch(/gluten/);
  });

  it("rejects a product without a required certificate, and accepts one that has it", () => {
    const m = mandate({ requiredCertificates: ["eu_organic"] });
    expectRejectedBy(evaluatePolicy(m, draft(small()), ctx()), "required_certificates");
    const organic = quote([{ productId: "VA-1201", quantity: 20 }]);
    expect(evaluatePolicy(m, draft(organic), ctx()).outcome).toBe("auto_approve");
  });

  it("checks every line, not just the first", () => {
    const q = quote([
      { productId: "VA-1001", quantity: 10 },
      { productId: "PK-4001", quantity: 10 },
    ]);
    expectRejectedBy(evaluatePolicy(mandate(), draft(q), ctx()), "forbidden_allergens");
  });

  it("lists every failure at once, not only the first", () => {
    const q = quote([
      { productId: "VA-2301", quantity: 5 }, // cream: wrong category
      { productId: "VA-1110", quantity: 5 }, // not lactose-free
      { productId: "PK-4001", quantity: 5 }, // gluten
    ]);
    const d = evaluatePolicy(mandate(), draft(q), ctx());
    const failed = d.rules.filter((r) => r.outcome === "fail").map((r) => r.rule);
    expect(failed).toEqual(expect.arrayContaining(["category_allowed", "required_attributes", "forbidden_allergens"]));
    expect(d.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("policy: delivery", () => {
  it("rejects delivery later than the mandate's maximum lead time", () => {
    const d = evaluatePolicy(mandate(), draft(quote([{ productId: "AR-2015", quantity: 10 }])), ctx()); // 6 days, max 5
    expectRejectedBy(d, "delivery_deadline");
  });

  it("rejects delivery after the request's need-by date", () => {
    const q = quote([{ productId: "VA-1035", quantity: 10 }]); // delivers 2026-11-15
    expectRejectedBy(evaluatePolicy(mandate(), draft(q, { neededBy: "2026-11-14" }), ctx()), "delivery_deadline");
    expect(evaluatePolicy(mandate(), draft(q, { neededBy: "2026-11-15" }), ctx()).outcome).toBe("auto_approve");
  });
});

describe("policy: substitution", () => {
  const sub = (productId: string, quantity = 10) =>
    quote([
      { productId: "VA-1010", quantity: 10 },
      { productId, quantity, substituteFor: "VA-1010" },
    ]);

  it("rejects any substitute when the rule is none", () => {
    const d = evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 10 } }), draft(sub("AR-2010")), ctx());
    expectRejectedBy(d, "substitution_rule");
  });

  it("accepts a same-attribute substitute without sign-off under same_attributes", () => {
    const d = evaluatePolicy(mandate({ substitution: { rule: "same_attributes", maxPriceIncreasePct: 10 } }), draft(sub("AR-2010")), ctx());
    expect(d.outcome).toBe("auto_approve");
  });

  it("rejects a substitute with different attributes under same_attributes (fat-free for semi-skimmed)", () => {
    const d = evaluatePolicy(mandate({ substitution: { rule: "same_attributes", maxPriceIncreasePct: 50 } }), draft(sub("VA-1002")), ctx());
    expectRejectedBy(d, "substitution_rule");
    expect(rule(d, "substitution_rule").reason).toMatch(/fat_1_5/);
  });

  it("escalates any substitute under needs_approval", () => {
    const d = evaluatePolicy(mandate(), draft(sub("AR-2010")), ctx());
    expect(d.outcome).toBe("needs_human_approval");
    expect(rule(d, "substitution_rule").outcome).toBe("escalate");
  });

  it("rejects a substitute priced above the tolerance per litre", () => {
    const d = evaluatePolicy(mandate(), draft(sub("JP-3010", 50)), ctx()); // €1.62/L vs €1.29/L
    expectRejectedBy(d, "substitute_price");
    expect(rule(d, "substitute_price").details).toMatchObject({ maxPriceIncreasePct: 10 });
  });

  it("compares price per unit, not per pack, across pack sizes", () => {
    // VA-1001 1 L at €1.49/L vs VA-1010 10 L at €1.29/L: +15.5 % per litre, though far cheaper per pack.
    const q = sub("VA-1001", 100);
    expectRejectedBy(evaluatePolicy(mandate(), draft(q), ctx()), "substitute_price");
    expect(rule(evaluatePolicy(mandate({ substitution: { rule: "needs_approval", maxPriceIncreasePct: 16 } }), draft(q), ctx()), "substitute_price").outcome).toBe("pass");
  });

  it("passes the substitution rules when nothing is substituted", () => {
    const d = evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 0 } }), draft(small()), ctx());
    expect(d.outcome).toBe("auto_approve");
  });
});

describe("policy: quote integrity", () => {
  it("rejects an expired quote, including at the exact expiry instant", () => {
    const q = small();
    expectRejectedBy(evaluatePolicy(mandate(), draft(q), ctx({ now: new Date(q.expiresAt) })), "quote_expiry");
    expectRejectedBy(evaluatePolicy(mandate(), draft(q), ctx({ now: addMinutes(NOW, 31) })), "quote_expiry");
    expect(evaluatePolicy(mandate(), draft(q), ctx({ now: addMinutes(NOW, 29) })).outcome).toBe("auto_approve");
  });

  it("rejects a replayed quote", () => {
    expectRejectedBy(evaluatePolicy(mandate(), draft(small()), ctx({ quoteAlreadyUsed: true })), "quote_replay");
  });

  it("rejects an order that changes the quoted price", () => {
    const q = small();
    const d = evaluatePolicy(mandate(), draft(q, { lines: [{ productId: "VA-1001", quantity: 20, unitPriceCents: 100 }] }), ctx());
    expectRejectedBy(d, "order_matches_quote");
  });

  it("rejects an order that changes the quoted quantity", () => {
    const q = small();
    const d = evaluatePolicy(mandate(), draft(q, { lines: [{ productId: "VA-1001", quantity: 21, unitPriceCents: 149 }] }), ctx());
    expectRejectedBy(d, "order_matches_quote");
  });

  it("rejects an order that adds or drops lines", () => {
    const q = small();
    const extra = [...draft(q).lines, { productId: "VA-1002", quantity: 1, unitPriceCents: 139 }];
    expectRejectedBy(evaluatePolicy(mandate(), draft(q, { lines: extra }), ctx()), "order_matches_quote");
    expectRejectedBy(evaluatePolicy(mandate(), draft(q, { lines: [] }), ctx()), "order_matches_quote");
  });

  it("rejects an order that repeats a quoted line", () => {
    const two = quote([
      { productId: "VA-1001", quantity: 20 },
      { productId: "VA-1002", quantity: 20 },
    ]);
    const lines = [draft(two).lines[0], draft(two).lines[0]];
    expectRejectedBy(evaluatePolicy(mandate(), draft(two, { lines }), ctx()), "order_matches_quote");
  });

  it.each([
    [{ agentId: "agent_other" }],
    [{ mandateId: "mnd_other" }],
    [{ buyerOrgId: "org_other" }],
  ])("rejects a quote issued under another binding %o", (overrides) => {
    expectRejectedBy(evaluatePolicy(mandate(), draft(quote([{ productId: "VA-1001", quantity: 20 }], overrides)), ctx()), "quote_binding");
  });
});

describe("policy: mandate binding", () => {
  it("rejects a mandate presented by a different agent", () => {
    const d = evaluatePolicy(mandate(), draft(small(), { agentId: "agent_intruder" }), ctx());
    expectRejectedBy(d, "mandate_agent");
  });

  it("rejects when the mandate is outside its validity window at decision time", () => {
    const m = mandate({ validUntil: addMinutes(NOW, 1).toISOString() });
    expectRejectedBy(evaluatePolicy(m, draft(small()), ctx({ now: addMinutes(NOW, 2) })), "mandate_window");
  });
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

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

describe("policy: quote binding", () => {
  it("refuses a quote issued for another request (F-QUOTE-REQUEST)", () => {
    const q = quote([{ productId: "VA-1001", quantity: 2 }]); // issued for req_1
    expectRejectedBy(evaluatePolicy(mandate(), draft(q, { requestId: "req_2" }), ctx()), "quote_binding");
    expect(rule(evaluatePolicy(mandate(), draft(q, { requestId: "req_1" }), ctx()), "quote_binding").outcome).toBe("pass");
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

  it("money held by orders waiting for sign-off: a person's call when they sign anyway, never the agent's alone (F-PENDING-HOLDS-BUDGET)", () => {
    const heldOrders = [{ orderId: "ord_wait", totalCents: 104_300, expiresAt: addMinutes(NOW, 20).toISOString() }];
    // €1,043 waiting, €1,043 more over the per-order limit: a person signs it anyway, so they decide with both in view.
    const d = evaluatePolicy(mandate(), draft(big()), ctx({ spentThisWeekCents: 104_300, heldThisWeekCents: 104_300, heldOrders }));
    expect(d.outcome).toBe("needs_human_approval");
    expect(rule(d, "weekly_budget")).toMatchObject({ outcome: "escalate", details: { committedCents: 0, heldCents: 104_300 } });
    expect(rule(d, "weekly_budget").reason).toContain("ord_wait");
    // A small order the agent would place alone may not spend the held money: refused, naming the waiting order.
    const small20 = quote([{ productId: "VA-1001", quantity: 20 }]); // €29.80
    const alone = evaluatePolicy(mandate(), draft(small20), ctx({ spentThisWeekCents: 199_000, heldThisWeekCents: 104_300, heldOrders }));
    expectRejectedBy(alone, "weekly_budget");
    expect(rule(alone, "weekly_budget").reason).toMatch(/withdraw or decide the waiting order/);
    // Committed alone already over: refused even though part is only held.
    expectRejectedBy(evaluatePolicy(mandate(), draft(big()), ctx({ spentThisWeekCents: 199_000, heldThisWeekCents: 50_000 })), "weekly_budget");
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

  it("reads the mandate's allergen words in one vocabulary: Finnish, Swedish, a tree nut, lactose, and refuses a word it cannot check", () => {
    // PK-4001 contains gluten: "gluteeni" (fi) and "vete"-free style words map onto the catalogue's slugs.
    expectRejectedBy(evaluatePolicy(mandate({ forbiddenAllergens: ["gluteeni"] }), draft(quote([{ productId: "PK-4001", quantity: 5 }])), ctx()), "forbidden_allergens");
    // Ordinary milk (VA-1110: milk, no lactose-free claim) carries lactose, whether or not the maker lists it.
    const lact = evaluatePolicy(mandate({ requiredAttributes: [], forbiddenAllergens: ["laktoosi"] }), draft(quote([{ productId: "VA-1110", quantity: 5 }])), ctx());
    expectRejectedBy(lact, "forbidden_allergens");
    expect(rule(lact, "forbidden_allergens").reason).toMatch(/lactose|laktoosi/);
    // Lactose-free milk passes the same rule.
    expect(rule(evaluatePolicy(mandate({ forbiddenAllergens: ["lactose"] }), draft(small()), ctx()), "forbidden_allergens").outcome).toBe("pass");
    // A word nobody can map is never a pass.
    const unknown = evaluatePolicy(mandate({ forbiddenAllergens: ["unicorn_dust"] }), draft(small()), ctx());
    expectRejectedBy(unknown, "forbidden_allergens");
    expect(rule(unknown, "forbidden_allergens").reason).toMatch(/cannot check/);
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

  it("holds a stand-in of the kind asked for (not declared) like any substitute, on every door", () => {
    // The request asked for one kind of milk (core/qualifiers.ts words); the order buys another of the same family.
    const q = quote([{ productId: "AR-2010", quantity: 10 }]);
    const asked = { productIds: [], category: "milk", standIns: ["AR-2010"] };
    const relayed = evaluatePolicy(mandate(), draft(q, { asked }), ctx());
    expect(relayed.outcome).toBe("needs_human_approval");
    expect(rule(relayed, "substitution_rule").outcome).toBe("escalate");
    expect(rule(relayed, "substitution_rule").reason).toMatch(/not the kind of milk the words asked for/);
    expectRejectedBy(evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 10 } }), draft(q, { asked }), ctx()), "substitution_rule");
  });

  it("takes the kitchen's own identified person's choice as their confirmation of a stand-in, never a relayed one", () => {
    const q = quote([{ productId: "AR-2010", quantity: 10 }]);
    const asked = { productIds: [], category: "milk", standIns: ["AR-2010"] };
    const own = evaluatePolicy(mandate(), draft(q, { asked }), ctx({ substitutionConfirmedBy: "Sanna Koskinen" }));
    expect(rule(own, "substitution_rule")).toMatchObject({ outcome: "pass", details: { confirmedBy: "Sanna Koskinen" } });
    expect(own.outcome).toBe("auto_approve");
    // A mandate that allows no substitutes is not lifted by anyone's choice.
    expectRejectedBy(evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 10 } }), draft(q, { asked }), ctx({ substitutionConfirmedBy: "Sanna Koskinen" })), "substitution_rule");
  });

  it("keeps the price cap for a declared substitute whoever chose it", () => {
    const d = evaluatePolicy(mandate(), draft(sub("JP-3010", 50)), ctx({ substitutionConfirmedBy: "Sanna Koskinen" }));
    expect(rule(d, "substitution_rule").outcome).toBe("pass");
    expectRejectedBy(d, "substitute_price");
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

describe("policy: real-data gaps", () => {
  it("refuses a product with no allergen data when the mandate forbids an allergen: unknown is not safe", () => {
    const q = small();
    const unknown = { ...q, lines: q.lines.map((l) => ({ ...l, allergens: [], allergensDeclared: false })) };
    const d = evaluatePolicy(mandate(), draft(unknown), ctx());
    expectRejectedBy(d, "forbidden_allergens");
    expect(rule(d, "forbidden_allergens").reason).toMatch(/no allergen data .* Unknown is not safe/);
    // Declared data without the allergen passes; with no allergen forbidden, unknown data does not matter.
    expect(rule(evaluatePolicy(mandate(), draft({ ...q, lines: q.lines.map((l) => ({ ...l, allergensDeclared: true })) }), ctx()), "forbidden_allergens").outcome).toBe("pass");
    expect(rule(evaluatePolicy(mandate({ forbiddenAllergens: [] }), draft(unknown), ctx()), "forbidden_allergens").outcome).toBe("pass");
  });

  it("lets the agent choose a like-for-like substitute alone under within_preferences, and sends any other to a person", () => {
    const like = quote([{ productId: "VA-1010", quantity: 10 }, { productId: "AR-2010", quantity: 5, substituteFor: "VA-1010" }]);
    const m = mandate({ substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 } });
    expect(rule(evaluatePolicy(m, draft(like), ctx()), "substitution_rule")).toMatchObject({ outcome: "pass" });
    // Marketing claims one brand states and the other does not do not make a substitute different.
    const noisy = { ...like, lines: like.lines.map((l) => (l.substituteFor ? { ...l, substituteFor: { ...l.substituteFor, attributes: [...l.substituteFor.attributes, "additive_free", "low_salt"] } } : l)) };
    expect(rule(evaluatePolicy(m, draft(noisy), ctx()), "substitution_rule").outcome).toBe("pass");
    const whole = { ...like, lines: like.lines.map((l) => (l.substituteFor ? { ...l, attributes: ["lactose_free", "fat_3_5"] } : l)) };
    const d = evaluatePolicy(m, draft(whole), ctx());
    expect(rule(d, "substitution_rule")).toMatchObject({ outcome: "escalate" });
    expect(rule(d, "substitution_rule").reason).toMatch(/lacks fat_1_5; has fat_3_5/);
    expect(d.outcome).toBe("needs_human_approval");
  });

  it("sends a need split into orders under the per-order limit to a person, naming the earlier orders", () => {
    const q = quote([{ productId: "VA-1001", quantity: 500 }]); // €745, under the €1,000 limit
    const earlier = { orderId: "ord_a", requestId: "req_other", placedAt: addMinutes(NOW, -90).toISOString(), totalCents: 60_000, categories: ["milk"], deliveryDates: [q.lines[0].deliveryDate], authorisedBy: "mandate" as const };
    const d = evaluatePolicy(mandate(), draft(q), ctx({ recentOrders: [earlier] }));
    expect(rule(d, "order_splitting")).toMatchObject({ outcome: "escalate", details: { combinedCents: 134_500 } });
    expect(rule(d, "order_splitting").reason).toMatch(/^Looks like one need split into smaller orders: with ord_a \(€600.00\)/);
    expect(d.outcome).toBe("needs_human_approval");
    // Not when a person signed the earlier one, when it was placed more than a day ago, for another family, or when together it is within the limit.
    for (const other of [{ ...earlier, authorisedBy: "approver" as const }, { ...earlier, placedAt: addMinutes(NOW, -60 * 25).toISOString() }, { ...earlier, categories: ["cream"] }, { ...earlier, totalCents: 10_000 }]) {
      expect(rule(evaluatePolicy(mandate(), draft(q), ctx({ recentOrders: [other] })), "order_splitting").outcome).toBe("pass");
    }
    // Judged by when the orders were placed, not when they deliver: the second half asked for another day is the same need.
    const otherDay = evaluatePolicy(mandate(), draft(q), ctx({ recentOrders: [{ ...earlier, deliveryDates: ["2026-12-01"] }] }));
    expect(rule(otherDay, "order_splitting")).toMatchObject({ outcome: "escalate", details: { combinedCents: 134_500 } });
    expect(rule(otherDay, "order_splitting").reason).toMatch(/whatever the delivery days/);
    // The same request counts whatever the category or day.
    expect(rule(evaluatePolicy(mandate(), draft(q), ctx({ recentOrders: [{ ...earlier, requestId: "req_1", categories: ["cream"], deliveryDates: ["2026-12-01"] }] })), "order_splitting").outcome).toBe("escalate");
  });
});

describe("policy: Helsinki dates (F-GATE-UTC-DATE)", () => {
  it("counts the latest delivery day in Helsinki days at every hour, also just after local midnight", () => {
    // 00:30 in Helsinki on Saturday 14 Nov is still Friday 13 Nov in UTC.
    const now = new Date("2026-11-13T22:30:00Z");
    const m = sampleMandate(now, { weeklyBudgetCents: 1e9 });
    const latest = "2026-11-19"; // Sat 14 + 5 days, in Helsinki
    const q = { ...quote([{ productId: "VA-1001", quantity: 1 }]), issuedAt: now.toISOString(), expiresAt: addMinutes(now, 30).toISOString() };
    const onTime = { ...q, lines: q.lines.map((l) => ({ ...l, deliveryDate: latest })) };
    expect(rule(evaluatePolicy(m, draft(onTime), ctx({ now })), "delivery_deadline").outcome).toBe("pass");
    const late = { ...q, lines: q.lines.map((l) => ({ ...l, deliveryDate: "2026-11-20" })) };
    expect(rule(evaluatePolicy(m, draft(late), ctx({ now })), "delivery_deadline").outcome).toBe("fail");
  });
});

describe("policy: substitutes the agent did not declare (F-SUBST-SELF-DECLARED)", () => {
  it("treats any product the request did not ask for as a substitute", () => {
    const q = quote([{ productId: "AR-2010", quantity: 20 }]);
    const asked = { productIds: ["VA-1010"] };
    expectRejectedBy(evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 0 } }), draft(q, { asked }), ctx()), "substitution_rule");
    const loose = evaluatePolicy(mandate({ substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 } }), draft(q, { asked }), ctx());
    expect(rule(loose, "substitution_rule").outcome).toBe("escalate");
    // Another family than the one asked for is not what was asked either.
    expect(rule(evaluatePolicy(mandate(), draft(quote([{ productId: "VA-1001", quantity: 2 }]), { asked: { productIds: [], category: "cream" } }), ctx()), "substitution_rule").outcome).toBe("escalate");
    expect(rule(evaluatePolicy(mandate(), draft(quote([{ productId: "VA-1010", quantity: 2 }]), { asked }), ctx()), "substitution_rule").outcome).toBe("pass");
  });
});

describe("policy: recall_hold (the wholesaler's ProductHolds)", () => {
  it("refuses an order with a held product, naming it, the reason and the notice; passes without", () => {
    const q = small();
    const held = evaluatePolicy(mandate(), draft(q), ctx({ holds: [{ productId: "VA-1001", reason: "Foreign body risk in batch 12.", url: "https://notice.test/1", drill: true }] }));
    expectRejectedBy(held, "recall_hold");
    expect(rule(held, "recall_hold").reason).toMatch(/^DRILL, not a real recall: .+ \(VA-1001\) is held by the wholesaler: Foreign body risk in batch 12\. Notice: https:\/\/notice\.test\/1$/);
    expect(rule(evaluatePolicy(mandate(), draft(q), ctx({ holds: [{ productId: "OTHER", reason: "x" }] })), "recall_hold").outcome).toBe("pass");
    expect(rule(evaluatePolicy(mandate(), draft(q), ctx()), "recall_hold").outcome).toBe("pass");
  });
});

describe("policy: refusals name the original product, not only its code", () => {
  it("names a declared substitute's original and the product the request asked for", () => {
    const sub = quote([{ productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }]);
    const strict = evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 0 } }), draft(sub), ctx());
    const name = SEED_PRODUCTS.find((p) => p.id === "VA-1010")!.name;
    expect(rule(strict, "substitution_rule").reason).toContain(`${name} (VA-1010)`);
    const undeclared = evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 0 } }), draft(quote([{ productId: "AR-2010", quantity: 20 }]), { asked: { productIds: ["VA-1010"], names: { "VA-1010": name } } }), ctx());
    expect(rule(undeclared, "substitution_rule").reason).toContain(`asked for (${name} (VA-1010))`);
    // Without a name the code still says which product it was.
    const bare = evaluatePolicy(mandate({ substitution: { rule: "none", maxPriceIncreasePct: 0 } }), draft(quote([{ productId: "AR-2010", quantity: 20 }]), { asked: { productIds: ["VA-1010"] } }), ctx());
    expect(rule(bare, "substitution_rule").reason).toContain("asked for (VA-1010)");
  });
});

describe("policy: deliverOn, an exact day", () => {
  it("passes a line delivered that day and fails one that arrives any other day", () => {
    const q = small();
    const day = q.lines[0].deliveryDate;
    expect(rule(evaluatePolicy(mandate(), draft(q, { deliverOn: day, neededBy: day }), ctx()), "delivery_deadline").outcome).toBe("pass");
    const later = "2026-11-20";
    const d = evaluatePolicy(mandate(), draft(q, { deliverOn: later, neededBy: later }), ctx());
    expectRejectedBy(d, "delivery_deadline");
    expect(rule(d, "delivery_deadline").reason).toContain(`not on ${later}, the day the request asked for`);
  });
});

describe("policy: nutrition rules and label rules (data depth)", () => {
  const withRules = (rules: NonNullable<Mandate["nutritionRules"]>) => mandate({ nutritionRules: rules });

  it("passes a product whose signed declaration keeps the kitchen's rules", () => {
    const d = evaluatePolicy(withRules([{ nutrient: "protein", min: 3, categories: ["milk"] }, { nutrient: "sugar", max: 12, categories: ["yoghurt"] }]), draft(small()), ctx());
    expect(d.outcome).toBe("auto_approve");
    expect(rule(d, "nutrition_rules").reason).toMatch(/at least 3 g protein/);
  });

  it("refuses a substitute that breaks a nutrition rule, naming the figure", () => {
    const q = quote([{ productId: "PK-4001", quantity: 20 }]); // oat drink: 1 g protein per 100 ml
    const d = evaluatePolicy(withRules([{ nutrient: "protein", min: 3, categories: ["milk", "plant_drink"] }]), draft(q), ctx());
    expectRejectedBy(d, "nutrition_rules");
    expect(rule(d, "nutrition_rules").reason).toMatch(/PK-4001 has 1 g protein per 100 ml, under the 3 g the kitchen requires/);
    expect(rule(d, "nutrition_rules").details).toEqual({ findings: [{ productId: "PK-4001", name: expect.any(String), nutrient: "protein", problem: "under", value: 1, min: 3, per: "100ml" }] });
  });

  it("refuses a product whose maker declares no figure: unknown is not compliant, and no sign-off can lift it", () => {
    const q = quote([{ productId: "VA-1001", quantity: 20 }]);
    const stripped = { ...q, lines: q.lines.map(({ nutrition: _n, ...l }) => (void _n, l)) };
    const d = evaluatePolicy(withRules([{ nutrient: "salt", max: 1 }]), draft(stripped), ctx());
    expectRejectedBy(d, "nutrition_rules");
    expect(rule(d, "nutrition_rules").reason).toMatch(/no salt figure.*Unknown is not compliant/);
  });

  it("checks a required Finnish origin against the stated country of origin", () => {
    const q = quote([{ productId: "VA-1001", quantity: 20 }]);
    expectRejectedBy(evaluatePolicy(mandate({ requiredCertificates: ["origin_fi"] }), draft(q), ctx()), "required_certificates");
    const fi = { ...q, lines: q.lines.map((l) => ({ ...l, countryOfOrigin: "fi" })) };
    expect(rule(evaluatePolicy(mandate({ requiredCertificates: ["origin_fi"] }), draft(fi), ctx()), "required_certificates").outcome).toBe("pass");
  });
});

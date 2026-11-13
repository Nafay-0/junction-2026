/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * The gate and its rules, quotes and signatures, mandate and identity: REST probes on the seed catalogue.
 * Mandates are minted with the demo organisations' keys, so each probe can try exactly the mandate shape it needs.
 * Unless a probe is about money, it lifts the weekly budget so earlier probes' spend does not interfere.
 */
import { forgedLaaksoMandate, kaariAgent, laaksoAgent, laaksoMandate, LAAKSO } from "../lib/actors";
import { buy, ledgerOk, linesOf, openRequest, order, quote, ruleOutcome, spentFromPreview, tamperJws } from "../lib/flow";
import { agent } from "../lib/http";
import type { Probe } from "../lib/probe";

const BIG = { weeklyBudgetCents: 1_000_000_000 };
const MILK_1L = "VA-1001"; // €1.49 per 1 L, 2000 in stock (seed)
const MILK_10L = "VA-1010"; // €12.90 per 10 L, 60 in stock
const MILK_10L_ALT = "AR-2010"; // €13.70 per 10 L
const PRICEY_1L = "JP-3010"; // €1.62 per 1 L

export const gateProbes: Probe[] = [
  {
    id: "gate.happy_path",
    area: "gate",
    kind: "plausible",
    title: "A small in-mandate order commits, totals add up, the ledger verifies",
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const { q, o } = await buy(a, [{ productId: MILK_1L, quantity: 10 }]);
      check.expect(q.status === 201, `quote ${q.status} ${q.text.slice(0, 200)}`);
      check.expect(o?.status === 201 && o.body.order.status === "committed", `order ${o?.status} ${o?.text.slice(0, 200)}`);
      const ord = o?.body.order;
      if (ord) {
        const sum = ord.lines.reduce((s: number, l: { lineTotalCents: number }) => s + l.lineTotalCents, 0);
        check.expect(sum === ord.totalCents, `line totals ${sum} != order total ${ord.totalCents}`);
        check.expect(ord.lines.every((l: { quantity: number; unitPriceCents: number; lineTotalCents: number }) => l.quantity * l.unitPriceCents === l.lineTotalCents), "a line total is not quantity x unit price");
        check.expect(typeof ord.confirmation === "string" && ord.confirmation.split(".").length === 3, "no signed confirmation on a committed order");
      }
      const l = await ledgerOk(http);
      check.expect(l.ok, "ledger does not verify after a committed order");
    },
  },
  {
    id: "gate.per_order_limit",
    area: "gate",
    kind: "boundary",
    title: "Exactly at the per-order limit passes per_order_limit; one cent over escalates it to a person",
    cases: 2,
    async run({ http, check }) {
      // 10 x €1.49 = €14.90. Judged on the rule itself: order_splitting may tie this order to earlier ones.
      const at = await laaksoAgent(http, { ...BIG, perOrderLimitCents: 1490 });
      const r1 = await buy(at, [{ productId: MILK_1L, quantity: 10 }]);
      check.expect(ruleOutcome(r1.o?.body?.order?.decision, "per_order_limit") === "pass", `at the limit: per_order_limit ${ruleOutcome(r1.o?.body?.order?.decision, "per_order_limit")} (${r1.o?.status})`);
      const over = await laaksoAgent(http, { ...BIG, perOrderLimitCents: 1489 });
      const r2 = await buy(over, [{ productId: MILK_1L, quantity: 10 }]);
      check.expect(r2.o?.status === 202 && r2.o.body.order.status === "pending_approval", `one cent over: ${r2.o?.status} ${r2.o?.body?.order?.status}`);
      check.expect(ruleOutcome(r2.o?.body?.order?.decision, "per_order_limit") === "escalate", "per_order_limit did not escalate");
    },
  },
  {
    id: "gate.order_lines_tampered",
    area: "gate",
    kind: "hostile",
    title: "Order lines that differ from the quote (quantity, price, extra line, duplicate) are refused with order_matches_quote",
    cases: 4,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const variants: [string, (l: { productId: string; quantity: number; unitPriceCents: number }[]) => unknown[]][] = [
        ["quantity", (l) => [{ ...l[0], quantity: l[0].quantity + 1 }]],
        ["price", (l) => [{ ...l[0], unitPriceCents: 1 }]],
        ["extra line", (l) => [...l, { productId: MILK_10L, quantity: 1, unitPriceCents: 1290 }]],
        ["duplicate", (l) => [l[0], l[0]]],
      ];
      for (const [name, mutate] of variants) {
        const rid = await openRequest(a);
        const q = await quote(a, rid, [{ productId: MILK_1L, quantity: 5 }]);
        const o = await order(a, rid, q, mutate(linesOf(q)) as never);
        const committed = o.body?.order?.status === "committed";
        check.expect(!committed, `${name}: tampered order committed`);
        check.expect(o.status === 422 && o.body?.error?.rule === "order_matches_quote", `${name}: expected 422 order_matches_quote, got ${o.status} ${o.body?.error?.rule ?? o.body?.order?.status}`);
      }
    },
  },
  {
    id: "gate.quote_token_tampered",
    area: "quotes",
    kind: "hostile",
    title: "A quote whose payload was edited (price, quantity, org) keeps its signature and is refused",
    cases: 3,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const edits: [string, (p: any) => void][] = [
        ["price to 1 cent", (p) => { p.lines[0].unitPriceCents = 1; p.lines[0].lineTotalCents = p.lines[0].quantity; p.totalCents = p.lines[0].quantity; }],
        ["expiry +1 year", (p) => { p.expiresAt = new Date(Date.now() + 365 * 864e5).toISOString(); }],
        ["attributes forged", (p) => { p.lines[0].attributes = [...p.lines[0].attributes, "organic"]; }],
      ];
      for (const [name, edit] of edits) {
        const rid = await openRequest(a);
        const q = await quote(a, rid, [{ productId: MILK_1L, quantity: 5 }]);
        const forged = tamperJws(q.body.quoteToken, edit);
        const lines = JSON.parse(Buffer.from(forged.split(".")[1], "base64url").toString()).lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
        const o = await a.post("/api/v1/orders", { requestId: rid, quoteToken: forged, lines });
        check.expect(o.status === 422 && o.body?.error?.code === "quote_signature_invalid", `${name}: expected 422 quote_signature_invalid, got ${o.status} ${o.body?.error?.code ?? o.body?.order?.status}`);
        check.expect(!!o.body?.error?.rule, `${name}: refusal names no rule`);
      }
    },
  },
  {
    id: "gate.quote_replay",
    area: "quotes",
    kind: "sequence",
    title: "A quote buys once: a second order with the same quote is refused (quote_replay)",
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const rid = await openRequest(a);
      const q = await quote(a, rid, [{ productId: MILK_1L, quantity: 3 }]);
      const o1 = await order(a, rid, q);
      const o2 = await order(a, rid, q);
      check.expect(o1.body?.order?.status === "committed", `first order ${o1.status}`);
      check.expect(o2.status === 422 && ruleOutcome(o2.body?.order?.decision ?? o2.body?.error?.details, "quote_replay") !== "pass" && o2.body?.order?.status !== "committed", `second order with the same quote: ${o2.status} ${o2.body?.order?.status ?? o2.body?.error?.code}`);
    },
  },
  {
    id: "gate.quote_replay_concurrent",
    area: "quotes",
    kind: "sequence",
    title: "Eight orders racing on one quote: exactly one commits",
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const rid = await openRequest(a);
      const q = await quote(a, rid, [{ productId: MILK_1L, quantity: 2 }]);
      const all = await Promise.all(Array.from({ length: 8 }, () => order(a, rid, q)));
      const committed = all.filter((o) => o.body?.order?.status === "committed").length;
      check.expect(committed === 1, `${committed} of 8 racing orders committed on one quote`);
    },
  },
  {
    id: "gate.quote_other_request",
    area: "quotes",
    kind: "inconsistency",
    title: "A quote issued for request A cannot be placed as an order on request B",
    findings: ["F-QUOTE-REQUEST"],
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const ridA = await openRequest(a, "qa: request A, 3 L milk");
      const ridB = await openRequest(a, "qa: request B, something else entirely");
      const q = await quote(a, ridA, [{ productId: MILK_1L, quantity: 3 }]);
      const o = await order(a, ridB, q);
      check.expect(o.body?.order?.status !== "committed", `quote for ${ridA} committed under ${ridB} (order.requestId=${o.body?.order?.requestId}, quote.requestId=${q.body?.quote?.requestId})`);
    },
  },
  {
    id: "gate.quote_other_org",
    area: "quotes",
    kind: "authority",
    title: "Kaari's quote presented by Laakso's agent is refused (quote_binding)",
    async run({ http, check }) {
      const k = await kaariAgent(http, BIG);
      const rk = await openRequest(k);
      const q = await quote(k, rk, [{ productId: MILK_1L, quantity: 2 }]);
      const l = await laaksoAgent(http, BIG);
      const rl = await openRequest(l);
      const o = await order(l, rl, q);
      check.expect(o.status === 422 && ruleOutcome(o.body?.order?.decision, "quote_binding") === "fail", `expected quote_binding fail, got ${o.status} ${o.body?.order?.status ?? o.body?.error?.code}`);
    },
  },
  {
    id: "gate.other_org_request",
    area: "mandate",
    kind: "authority",
    title: "One organisation cannot quote, order or read on another organisation's request or order",
    cases: 3,
    async run({ http, check }) {
      const k = await kaariAgent(http, BIG);
      const { requestId, o } = await buy(k, [{ productId: MILK_1L, quantity: 1 }]);
      const l = await laaksoAgent(http, BIG);
      const q = await quote(l, requestId, [{ productId: MILK_1L, quantity: 1 }]);
      check.expect(q.status === 404, `quote on another org's request: ${q.status}`);
      const g = await l.get(`/api/v1/orders/${o?.body?.order?.orderId}`);
      check.expect(g.status === 404, `read another org's order: ${g.status}`);
      const i = await l.get(`/api/v1/intake/${requestId}`);
      check.expect(i.status === 404, `read another org's intake: ${i.status}`);
    },
  },
  {
    id: "mandate.forged_altered_expired",
    area: "mandate",
    kind: "hostile",
    title: "Altered, forged, expired, not-yet-valid, unsigned and wrong-agent mandates are refused with 401/403 and a rule",
    cases: 8,
    async run({ http, check }) {
      const good = await laaksoMandate(BIG);
      const now = Date.now();
      const cases: [string, string, string, number][] = [
        ["altered limit", tamperJws(good, (p) => { p.mandate.perOrderLimitCents = 99_999_999; }), LAAKSO.agentId, 401],
        ["forged key, same kid", await forgedLaaksoMandate(), LAAKSO.agentId, 401],
        ["expired", await laaksoMandate({ validFrom: new Date(now - 3 * 864e5).toISOString(), validUntil: new Date(now - 864e5).toISOString() }), LAAKSO.agentId, 401],
        ["not yet valid", await laaksoMandate({ validFrom: new Date(now + 864e5).toISOString(), validUntil: new Date(now + 3 * 864e5).toISOString() }), LAAKSO.agentId, 401],
        ["alg none", `${Buffer.from(JSON.stringify({ alg: "none", kid: "laakso-catering-2026", typ: "mandate+jwt" })).toString("base64url")}.${good.split(".")[1]}.`, LAAKSO.agentId, 401],
        ["HS256", `${Buffer.from(JSON.stringify({ alg: "HS256", kid: "laakso-catering-2026", typ: "mandate+jwt" })).toString("base64url")}.${good.split(".")[1]}.${Buffer.from("x").toString("base64url")}`, LAAKSO.agentId, 401],
        ["wrong agent header", good, "agent_someone_else", 403],
        ["garbage", "not-a-jws", LAAKSO.agentId, 401],
      ];
      for (const [name, token, agentId, want] of cases) {
        const r = await agent(http, token, agentId).post("/api/v1/requests", { text: "qa mandate probe" });
        check.expect(r.status === want, `${name}: expected ${want}, got ${r.status} ${r.body?.error?.code}`);
        check.expect(!!r.body?.error?.rule, `${name}: refusal names no rule (${r.body?.error?.code})`);
      }
      const none = await http.post("/api/v1/requests", { text: "no mandate" });
      check.expect(none.status === 401 && !!none.body?.error?.rule, `no mandate: ${none.status} ${none.body?.error?.rule}`);
    },
  },
  {
    id: "gate.mandate_rules",
    area: "gate",
    kind: "authority",
    title: "Category, required attribute, forbidden allergen and certificate rules refuse with their rule name",
    cases: 4,
    async run({ http, check }) {
      const cases: [string, Record<string, unknown>, string, string][] = [
        ["category", { allowedCategories: ["plant_drink"] }, MILK_1L, "category_allowed"],
        ["attribute", { requiredAttributes: ["organic"] }, MILK_1L, "required_attributes"],
        ["allergen", { forbiddenAllergens: ["milk"] }, MILK_1L, "forbidden_allergens"],
        ["certificate", { requiredCertificates: ["msc"] }, MILK_1L, "required_certificates"],
      ];
      for (const [name, over, product, rule] of cases) {
        const a = await laaksoAgent(http, { ...BIG, ...over });
        const { q, o } = await buy(a, [{ productId: product, quantity: 1 }]);
        check.expect(ruleOutcome(q.body?.policyPreview, rule) === "fail", `${name}: preview did not fail ${rule}`);
        check.expect(o?.status === 422 && ruleOutcome(o.body?.order?.decision, rule) === "fail" && o.body?.error?.rule === rule, `${name}: order ${o?.status} rule=${o?.body?.error?.rule}`);
      }
    },
  },
  {
    id: "gate.weekly_budget_race",
    area: "gate",
    kind: "sequence",
    title: "Twelve orders racing against a weekly budget that fits five: at most five commit",
    async run({ http, check }) {
      // Read what this org has spent so far, then set the budget to that plus room for five orders.
      const probe = await laaksoAgent(http, BIG);
      const r0 = await openRequest(probe);
      const q0 = await quote(probe, r0, [{ productId: MILK_1L, quantity: 1 }]);
      const spent = spentFromPreview(q0) ?? 0;
      const each = 20 * 149; // €29.80
      const a = await laaksoAgent(http, { weeklyBudgetCents: spent + 5 * each, perOrderLimitCents: 100_000 });
      const prepared = [];
      for (let i = 0; i < 12; i++) {
        const rid = await openRequest(a, `qa budget race ${i}`);
        prepared.push({ rid, q: await quote(a, rid, [{ productId: MILK_1L, quantity: 20 }]) });
      }
      const results = await Promise.all(prepared.map(({ rid, q }) => order(a, rid, q)));
      const ok = results.filter((o) => ["committed", "pending_approval"].includes(o.body?.order?.status)).length;
      check.expect(ok <= 5, `${ok} orders accepted against a budget for 5`);
      check.expect(ok === 5, `expected exactly 5 accepted, got ${ok} (splitting may have escalated some: fine if pending)`);
      const refused = results.filter((o) => o.status === 422);
      check.expect(refused.every((o) => o.body?.error?.rule === "weekly_budget" || ruleOutcome(o.body?.order?.decision, "weekly_budget") === "fail"), "a budget refusal named another rule");
    },
  },
  {
    id: "gate.order_splitting",
    area: "gate",
    kind: "authority",
    title: "Splitting one need into orders under the limit: no order whose running total crosses the limit commits alone",
    cases: 3,
    async run({ http, check }) {
      const a = await laaksoAgent(http, { ...BIG, perOrderLimitCents: 5000 }); // €50 alone
      const rid = await openRequest(a, "qa: 90 L milk, split in three");
      let escalated = 0;
      for (let i = 0; i < 3; i++) {
        const q = await quote(a, rid, [{ productId: MILK_1L, quantity: 30 }]); // €44.70 each
        const o = await order(a, rid, q);
        const split = o.body?.order?.decision?.rules?.find((r: { rule: string }) => r.rule === "order_splitting");
        const combined = split?.details?.combinedCents ?? o.body?.order?.totalCents;
        if (split?.outcome === "escalate") escalated++;
        check.expect(!(combined > 5000 && o.body?.order?.status === "committed"), `part ${i + 1}: running total €${combined / 100} over €50 but committed alone`);
      }
      check.expect(escalated >= 2, `only ${escalated} of 3 parts escalated by order_splitting`);
    },
  },
  {
    id: "gate.substitution_undeclared",
    area: "gate",
    kind: "authority",
    title: "With substitution 'none', ordering a different product without declaring it a substitute",
    findings: ["F-SUBST-SELF-DECLARED"],
    cases: 2,
    async run({ http, check }) {
      const a = await laaksoAgent(http, { ...BIG, substitution: { rule: "none", maxPriceIncreasePct: 0 } });
      // Declared: refused, as it should be.
      const rid = await openRequest(a, `qa: 20 x ${MILK_10L} (200 L), no substitutes allowed`);
      const declared = await quote(a, rid, [{ productId: MILK_10L_ALT, quantity: 20, substituteFor: MILK_10L }]);
      check.expect(ruleOutcome(declared.body?.policyPreview, "substitution_rule") === "fail", "declared substitute was not refused under rule none");
      // Undeclared: the gate has no idea a substitution happened.
      const plain = await quote(a, rid, [{ productId: MILK_10L_ALT, quantity: 20 }]);
      const o = await order(a, rid, plain);
      check.expect(o.body?.order?.status !== "committed", `request named ${MILK_10L}; ${MILK_10L_ALT} committed alone under "no substitutes" because the agent did not declare it (substitution_rule: ${ruleOutcome(o.body?.order?.decision, "substitution_rule")})`);
    },
  },
  {
    id: "gate.substitute_price_reference",
    area: "gate",
    kind: "authority",
    title: "Substitute price check compares against an 'original' the agent chooses",
    findings: ["F-SUBST-SELF-DECLARED"],
    async run({ http, check }) {
      const a = await laaksoAgent(http, { ...BIG, substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 } });
      const rid = await openRequest(a, `qa: 100 L of ${MILK_10L}`);
      // JP-3010 is +25.6 % per litre over VA-1010: honest declaration fails substitute_price.
      const honest = await quote(a, rid, [{ productId: PRICEY_1L, quantity: 100, substituteFor: MILK_10L }]);
      check.expect(ruleOutcome(honest.body?.policyPreview, "substitute_price") === "fail", "honest +25 % substitute passed substitute_price");
      // Declaring it a substitute for another 1 L milk with a higher price makes the same purchase pass.
      const masked = await quote(a, rid, [{ productId: PRICEY_1L, quantity: 100, substituteFor: "VA-1201" }]);
      const verdict = ruleOutcome(masked.body?.policyPreview, "substitute_price");
      check.expect(verdict !== "pass", `the +25 % substitute passes substitute_price when the agent names a pricier 'original' (VA-1201) instead of the requested ${MILK_10L}`);
    },
  },
  {
    id: "gate.quantity_boundaries",
    area: "quotes",
    kind: "boundary",
    title: "Zero, negative, fractional, huge, NaN-like and string quantities give 4xx with a code, never 5xx",
    cases: 9,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const rid = await openRequest(a);
      const qs: unknown[] = [0, -1, 0.5, 1e21, Number.MAX_SAFE_INTEGER, "5", null, 1e308, 2001];
      for (const quantity of qs) {
        const r = await a.post("/api/v1/quotes", { requestId: rid, lines: [{ productId: MILK_1L, quantity }] });
        check.expect(r.status >= 400 && r.status < 500, `quantity ${String(quantity)}: status ${r.status}`);
      }
    },
  },
  {
    id: "gate.empty_and_many_lines",
    area: "quotes",
    kind: "boundary",
    title: "No lines, 21 lines, unknown product, substitute for itself",
    cases: 4,
    async run({ http, check }) {
      const a = await laaksoAgent(http, BIG);
      const rid = await openRequest(a);
      const many = Array.from({ length: 21 }, (_, i) => ({ productId: `X-${i}`, quantity: 1 }));
      for (const [name, lines] of [["none", []], ["21 lines", many], ["unknown", [{ productId: "NOPE-1", quantity: 1 }]], ["self-substitute", [{ productId: MILK_1L, quantity: 1, substituteFor: MILK_1L }]]] as const) {
        const r = await a.post("/api/v1/quotes", { requestId: rid, lines });
        check.expect(r.status >= 400 && r.status < 500, `${name}: ${r.status} ${r.body?.error?.code}`);
      }
    },
  },
];

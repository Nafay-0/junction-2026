import type { Approver, Mandate } from "./mandate";
import type { Quote, QuoteLine } from "./quote";
import { addDays, formatEur, isoDate } from "./util";

/**
 * The gate. A pure function: same mandate, draft and context in, same decision out. No I/O, no clock,
 * no model. Every rule always reports a result, so a refusal can name exactly what fired and why.
 *
 * Outcomes per rule:
 *   pass      the rule is satisfied
 *   escalate  allowed only with a human sign-off (over the per-order limit, or a substitute under "needs_approval")
 *   fail      not allowed at all; the order is rejected
 *
 * Decision: any fail -> reject; else any escalate -> needs_human_approval (to the least senior approver
 * who can sign the amount); else auto_approve.
 */
export const RULES = [
  "mandate_agent", // the agent presenting the order is the one the mandate names
  "mandate_window", // the mandate is in force at decision time
  "quote_binding", // the quote was issued to this organisation, agent and mandate
  "quote_expiry", // the quote's fixed price still holds
  "quote_replay", // the quote has not been used for another order
  "order_matches_quote", // the order buys exactly what was quoted, at the quoted prices and quantities
  "category_allowed",
  "required_attributes",
  "forbidden_allergens",
  "required_certificates",
  "delivery_deadline", // every line arrives by the need-by date and within the mandate's max lead time
  "substitution_rule", // substitutes allowed per the mandate's rule (none / same_attributes / needs_approval)
  "substitute_price", // substitute's price per unit within the tolerated increase
  "weekly_budget", // committed + pending spend over 7 days stays within budget: hard limit
  "per_order_limit", // above it, a human must sign off
  "approver_authority", // someone named in the mandate can sign off this amount
] as const;

export type RuleId = (typeof RULES)[number];
export type RuleOutcome = "pass" | "escalate" | "fail";
export type RuleResult = { rule: RuleId; outcome: RuleOutcome; reason: string; details?: Record<string, unknown> };

export type OrderDraftLine = { productId: string; quantity: number; unitPriceCents: number };

/** What the agent asks to buy: a verified quote plus the lines it says it is ordering from it. */
export type OrderDraft = {
  agentId: string; // agent presenting the order
  quote: Quote; // signature already verified
  lines: OrderDraftLine[];
  neededBy?: string; // YYYY-MM-DD, from the purchase request
};

export type PolicyContext = {
  now: Date;
  spentThisWeekCents: number; // committed + pending orders of this organisation over the last 7 days
  quoteAlreadyUsed: boolean;
};

type Common = { totalCents: number; rules: RuleResult[]; reasons: string[] };
export type Decision =
  | ({ outcome: "auto_approve" } & Common)
  | ({ outcome: "needs_human_approval"; approver: Approver } & Common)
  | ({ outcome: "reject" } & Common);

export function evaluatePolicy(mandate: Mandate, draft: OrderDraft, ctx: PolicyContext): Decision {
  const q = draft.quote;
  const total = q.totalCents;
  const results: RuleResult[] = [];
  const add = (rule: RuleId, outcome: RuleOutcome, reason: string, details?: Record<string, unknown>) =>
    results.push({ rule, outcome, reason, details });
  const lineCheck = (rule: RuleId, bad: (l: QuoteLine) => string | null, okReason: string) => {
    const problems = q.lines.map(bad).filter((x): x is string => x !== null);
    if (problems.length) add(rule, "fail", problems.join(" "));
    else add(rule, "pass", okReason);
  };

  // Who and when
  if (draft.agentId === mandate.agentId) add("mandate_agent", "pass", `Agent ${draft.agentId} is the one the mandate names.`);
  else add("mandate_agent", "fail", `Mandate is for agent ${mandate.agentId}, but agent ${draft.agentId} presented it.`, { expected: mandate.agentId, actual: draft.agentId });

  const t = ctx.now.getTime();
  if (t >= Date.parse(mandate.validFrom) && t < Date.parse(mandate.validUntil)) add("mandate_window", "pass", "Mandate is in force.");
  else add("mandate_window", "fail", `Mandate is only valid from ${mandate.validFrom} until ${mandate.validUntil}.`);

  // Quote integrity
  const binding: string[] = [];
  if (q.buyerOrgId !== mandate.issuer.orgId) binding.push(`organisation ${q.buyerOrgId}`);
  if (q.agentId !== mandate.agentId) binding.push(`agent ${q.agentId}`);
  if (q.mandateId !== mandate.mandateId) binding.push(`mandate ${q.mandateId}`);
  if (binding.length) add("quote_binding", "fail", `Quote ${q.quoteId} was issued to ${binding.join(", ")}, not to this mandate.`);
  else add("quote_binding", "pass", `Quote ${q.quoteId} was issued under this mandate.`);

  if (t < Date.parse(q.expiresAt)) add("quote_expiry", "pass", `Quote holds its prices until ${q.expiresAt}.`);
  else add("quote_expiry", "fail", `Quote ${q.quoteId} expired at ${q.expiresAt}; ask for a new quote.`, { expiresAt: q.expiresAt });

  if (ctx.quoteAlreadyUsed) add("quote_replay", "fail", `Quote ${q.quoteId} has already been used for an order; a quote buys once.`);
  else add("quote_replay", "pass", "Quote has not been used before.");

  const mismatch = compareLines(q, draft.lines);
  if (mismatch) add("order_matches_quote", "fail", mismatch);
  else add("order_matches_quote", "pass", "Order buys exactly the quoted products, quantities and prices.");

  // Products
  lineCheck(
    "category_allowed",
    (l) => (mandate.allowedCategories.includes(l.category) ? null : `${l.productId} is in category "${l.category}", which the mandate does not allow (allowed: ${mandate.allowedCategories.join(", ")}).`),
    "Every product is in an allowed category.",
  );
  lineCheck(
    "required_attributes",
    (l) => {
      const missing = mandate.requiredAttributes.filter((a) => !l.attributes.includes(a));
      return missing.length ? `${l.productId} lacks required attribute(s): ${missing.join(", ")}.` : null;
    },
    mandate.requiredAttributes.length ? `Every product is ${mandate.requiredAttributes.join(", ")}.` : "No attributes required.",
  );
  lineCheck(
    "forbidden_allergens",
    (l) => {
      const found = l.allergens.filter((a) => mandate.forbiddenAllergens.includes(a));
      return found.length ? `${l.productId} contains forbidden allergen(s): ${found.join(", ")}.` : null;
    },
    "No product contains a forbidden allergen.",
  );
  lineCheck(
    "required_certificates",
    (l) => {
      const missing = mandate.requiredCertificates.filter((c) => !l.certificates.includes(c));
      return missing.length ? `${l.productId} lacks required certificate(s): ${missing.join(", ")}.` : null;
    },
    mandate.requiredCertificates.length ? `Every product carries ${mandate.requiredCertificates.join(", ")}.` : "No certificates required.",
  );

  const leadLimit = isoDate(addDays(ctx.now, mandate.delivery.maxLeadDays));
  const latest = draft.neededBy && draft.neededBy < leadLimit ? draft.neededBy : leadLimit;
  lineCheck(
    "delivery_deadline",
    (l) => (l.deliveryDate <= latest ? null : `${l.productId} arrives ${l.deliveryDate}, after the latest acceptable date ${latest}.`),
    `Every line arrives by ${latest}.`,
  );

  // Substitution
  const subs = q.lines.filter((l) => l.substituteFor);
  const rule = mandate.substitution.rule;
  if (subs.length === 0) {
    add("substitution_rule", "pass", "No substitutes.");
    add("substitute_price", "pass", "No substitutes.");
  } else {
    const describe = (l: QuoteLine) => `${l.productId} substitutes for ${l.substituteFor!.productId}`;
    if (rule === "none") {
      add("substitution_rule", "fail", `${subs.map(describe).join("; ")}, but the mandate allows no substitutes.`);
    } else {
      const differences = subs.map((l) => attributeDifference(l)).filter((x): x is string => x !== null);
      if (rule === "same_attributes") {
        if (differences.length) add("substitution_rule", "fail", `Substitutes must match the original: ${differences.join(" ")}`);
        else add("substitution_rule", "pass", `${subs.map(describe).join("; ")} with the same attributes.`);
      } else {
        add(
          "substitution_rule",
          "escalate",
          `${subs.map(describe).join("; ")}; the mandate requires a person to approve substitutes.${differences.length ? " " + differences.join(" ") : ""}`,
        );
      }
    }
    const limit = mandate.substitution.maxPriceIncreasePct;
    const over = subs
      .map((l) => ({ l, pct: perUnitIncreasePct(l) }))
      .filter(({ pct }) => pct > limit + 1e-9);
    if (over.length) {
      add(
        "substitute_price",
        "fail",
        over.map(({ l, pct }) => `${l.productId} costs ${pct.toFixed(1)} % more per ${l.unit} than ${l.substituteFor!.productId}; the mandate tolerates ${limit} %.`).join(" "),
        { maxPriceIncreasePct: limit, increases: over.map(({ l, pct }) => ({ productId: l.productId, pct: round1(pct) })) },
      );
    } else {
      add("substitute_price", "pass", `Every substitute is within +${limit} % per unit of the original.`, {
        increases: subs.map((l) => ({ productId: l.productId, pct: round1(perUnitIncreasePct(l)) })),
      });
    }
  }

  // Money
  const after = ctx.spentThisWeekCents + total;
  const budgetDetails = { budgetCents: mandate.weeklyBudgetCents, spentCents: ctx.spentThisWeekCents, totalCents: total };
  if (after <= mandate.weeklyBudgetCents)
    add("weekly_budget", "pass", `Weekly spend would be ${formatEur(after)} of ${formatEur(mandate.weeklyBudgetCents)}.`, budgetDetails);
  else
    add("weekly_budget", "fail", `This ${formatEur(total)} order would take weekly spend to ${formatEur(after)}, over the ${formatEur(mandate.weeklyBudgetCents)} budget (already ${formatEur(ctx.spentThisWeekCents)}).`, budgetDetails);

  const limitDetails = { limitCents: mandate.perOrderLimitCents, totalCents: total };
  if (total <= mandate.perOrderLimitCents)
    add("per_order_limit", "pass", `Total ${formatEur(total)} is within the ${formatEur(mandate.perOrderLimitCents)} per-order limit.`, limitDetails);
  else
    add("per_order_limit", "escalate", `Total ${formatEur(total)} is over the ${formatEur(mandate.perOrderLimitCents)} per-order limit the agent may spend alone.`, limitDetails);

  const needsHuman = results.some((r) => r.outcome === "escalate");
  const approver = needsHuman ? pickApprover(mandate.approvers, total) : undefined;
  if (!needsHuman) add("approver_authority", "pass", "No sign-off needed.");
  else if (approver)
    add("approver_authority", "pass", `${approver.name} (${approver.role}) can sign off up to ${formatEur(approver.maxApprovalCents)}.`, { role: approver.role });
  else
    add("approver_authority", "fail", `Sign-off is needed, but no approver in the mandate may sign ${formatEur(total)}.`, {
      approvers: mandate.approvers.map((a) => ({ role: a.role, maxApprovalCents: a.maxApprovalCents })),
    });

  const rules = RULES.map((id) => results.find((r) => r.rule === id)!);
  const fails = rules.filter((r) => r.outcome === "fail");
  const escalations = rules.filter((r) => r.outcome === "escalate");
  if (fails.length) return { outcome: "reject", totalCents: total, rules, reasons: fails.map((r) => r.reason) };
  if (escalations.length && approver) {
    return {
      outcome: "needs_human_approval",
      approver,
      totalCents: total,
      rules,
      reasons: [...escalations.map((r) => r.reason), `Sent to ${approver.name} (${approver.role}) for sign-off.`],
    };
  }
  return {
    outcome: "auto_approve",
    totalCents: total,
    rules,
    reasons: [`All ${rules.length} checks passed; ${formatEur(total)} is within what the agent may spend alone.`],
  };
}

/** The rule that decided a refusal: the first failing rule, in RULES order. */
export function decidingRule(decision: Decision): RuleResult | undefined {
  return decision.rules.find((r) => r.outcome === "fail");
}

function compareLines(q: Quote, lines: OrderDraftLine[]): string | null {
  if (lines.length !== q.lines.length)
    return `Order has ${lines.length} line(s) but quote ${q.quoteId} has ${q.lines.length}; an order must buy exactly what was quoted.`;
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) return `Order lists ${line.productId} more than once.`;
    seen.add(line.productId);
    const quoted = q.lines.find((l) => l.productId === line.productId);
    if (!quoted) return `${line.productId} is not in quote ${q.quoteId}.`;
    if (line.quantity !== quoted.quantity)
      return `Order asks for ${line.quantity} packs of ${line.productId}; the quote fixed ${quoted.quantity}.`;
    if (line.unitPriceCents !== quoted.unitPriceCents)
      return `Order states ${formatEur(line.unitPriceCents)} per pack of ${line.productId}; the quote fixed ${formatEur(quoted.unitPriceCents)}.`;
  }
  return null;
}

function attributeDifference(l: QuoteLine): string | null {
  const o = l.substituteFor!;
  const parts: string[] = [];
  if (o.category !== l.category) parts.push(`category ${l.category} instead of ${o.category}`);
  if (o.unit !== l.unit) parts.push(`sold per ${l.unit} instead of ${o.unit}`);
  const missing = o.attributes.filter((a) => !l.attributes.includes(a));
  if (missing.length) parts.push(`lacks ${missing.join(", ")}`);
  return parts.length ? `${l.productId} differs from ${o.productId}: ${parts.join("; ")}.` : null;
}

/** Price increase per unit (per litre, per kg) of a substitute over the product it replaces, in percent. */
function perUnitIncreasePct(l: QuoteLine): number {
  const o = l.substituteFor!;
  const sub = l.unitPriceCents / l.packSize;
  const orig = o.unitPriceCents / o.packSize;
  if (orig === 0) return sub === 0 ? 0 : Infinity;
  return (sub / orig - 1) * 100;
}

function pickApprover(approvers: Approver[], totalCents: number): Approver | undefined {
  return [...approvers]
    .filter((a) => a.maxApprovalCents >= totalCents)
    .sort((a, b) => a.maxApprovalCents - b.maxApprovalCents)[0];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

import type { Mandate } from "@/core/mandate";
import { RULES, evaluatePolicy, type Decision, type PolicyContext, type RecentOrder, type RuleOutcome } from "@/core/policy";
import { formatEur } from "@/core/util";
import { mandateRow, type OrderBody } from "./rows";
import type { RuleRow } from "./history";

/**
 * "Would this order pass today?" The order is put through the real gate (core/policy.ts evaluatePolicy, the same
 * pure function the order went through) twice: once with the rules MariaDB says were in force the instant before it
 * arrived, once with the rules at another moment (today, or any point on the slider).
 *
 * What is held fixed, because it is the order and not the rules: the agent and the mandate it presented (who and
 * when: its id, issuer and validity window), the quote with its prices and expiry, the lines, the request and its
 * confirmations, the moment of ordering (so a quote that was valid then is valid in both runs) and the kitchen's
 * other orders of that day (the splitting check). What comes from the chosen moment: the mandate's terms (limits,
 * budget, categories, claims, allergens, certificates, lead time, substitution, approvers), the week's spend, the
 * wholesaler's recall holds and any suspension at the door. A quote is never counted as used: the question is
 * whether this order, presented fresh, would get through.
 */

export type RuleVerdict = { rule: string; outcome: RuleOutcome; reason: string };

export type Verdict = {
  at: string;
  /** refused_at_door: a suspension was in force; no_mandate: the agent had no mandate in force at that moment. */
  outcome: Decision["outcome"] | "refused_at_door" | "no_mandate";
  headline: string;
  door: { open: true } | { open: false; reason: string; by: string; since: string; label: string };
  rules: RuleVerdict[];
  approver?: string;
  /** The inputs the gate was given, in plain numbers, for the page's "what it read". */
  read: { perOrderLimitCents?: number; weeklyBudgetCents?: number; spentCents: number; heldCents: number; holds: string[]; forbiddenAllergens?: string[]; requiredAttributes?: string[] };
};

export type StateAt = { at: string; mandate?: RuleRow; holds: RuleRow[]; suspensions: RuleRow[]; budget?: RuleRow; kitchenRules: RuleRow[] };

/** What of the rules in force at a moment applies to this order's agent and kitchen. */
export function stateFor(rows: RuleRow[], body: Pick<OrderBody, "agentId" | "orgId">, at: string): StateAt {
  return {
    at,
    mandate: rows.find((r) => r.area === "mandate" && r.item === body.agentId),
    holds: rows.filter((r) => r.area === "hold" && r.inForce),
    suspensions: rows.filter((r) => r.area === "suspension" && r.inForce && ((r.value.scope === "agent" && r.value.target === body.agentId) || (r.value.scope === "org" && r.value.target === body.orgId))),
    budget: rows.find((r) => r.area === "budget" && r.item === body.orgId),
    kitchenRules: rows.filter((r) => r.area === "kitchen_rule" && r.orgId === body.orgId),
  };
}

/** The mandate the agent presented, with the terms from the mirror: identity and window kept, terms replaced. */
export function mandateWithTerms(base: Mandate, v: Record<string, unknown>): Mandate {
  return {
    ...base,
    perOrderLimitCents: Number(v.perOrderLimitCents),
    weeklyBudgetCents: Number(v.weeklyBudgetCents),
    allowedCategories: (v.allowedCategories as string[]) ?? [],
    requiredAttributes: (v.requiredAttributes as string[]) ?? [],
    forbiddenAllergens: (v.forbiddenAllergens as string[]) ?? [],
    requiredCertificates: (v.requiredCertificates as string[]) ?? [],
    delivery: { maxLeadDays: Number(v.maxLeadDays) },
    substitution: { rule: v.substitutionRule as Mandate["substitution"]["rule"], maxPriceIncreasePct: Number(v.maxPriceIncreasePct) },
    approvers: (v.approvers as Mandate["approvers"]) ?? [],
  };
}

/** Do the mirror's terms agree with the mandate the order itself carried? The fields that differ, if any. */
export function termsDisagree(body: OrderBody, mirrored?: RuleRow): string[] {
  if (!mirrored) return ["no mandate in the mirror"];
  const own = mandateRow(body.mandate);
  const fromMirror = mandateRow(mandateWithTerms(body.mandate, mirrored.value));
  return Object.keys(own).filter((k) => !["issued_as", "changed_by", "mandate_id", "valid_from", "valid_until"].includes(k) && JSON.stringify(own[k]) !== JSON.stringify(fromMirror[k]));
}

const gateHasHoldRule = (RULES as readonly string[]).includes("recall_hold");

export function judge(body: OrderBody, state: StateAt, recentOrders: RecentOrder[]): Verdict {
  const weekOrders = ((state.budget?.value.weekOrders as { orderId: string; totalCents: number; status: string; expiresAt?: string }[] | undefined) ?? []).filter((o) => o.orderId !== body.orderId);
  const spentCents = weekOrders.reduce((s, o) => s + o.totalCents, 0);
  const heldOrders = weekOrders.filter((o) => o.status === "pending_approval").map((o) => ({ orderId: o.orderId, totalCents: o.totalCents, expiresAt: o.expiresAt ?? "" }));
  const heldCents = heldOrders.reduce((s, o) => s + o.totalCents, 0);
  const productIds = new Set(body.quote.lines.map((l) => l.productId));
  const holds = state.holds.filter((h) => productIds.has(String(h.value.productId)));
  const read: Verdict["read"] = { spentCents, heldCents, holds: holds.map((h) => String(h.value.productName ?? h.value.productId)) };

  const s = state.suspensions[0];
  const door: Verdict["door"] = s ? { open: false, reason: String(s.value.reason), by: s.changedBy, since: s.since, label: String(s.value.label) } : { open: true };

  if (!state.mandate) {
    return { at: state.at, outcome: "no_mandate", headline: "No mandate was in force for this agent at that moment, so nothing it sent would have been read.", door, rules: [], read };
  }
  const mandate = mandateWithTerms(body.mandate, state.mandate.value);
  Object.assign(read, { perOrderLimitCents: mandate.perOrderLimitCents, weeklyBudgetCents: mandate.weeklyBudgetCents, forbiddenAllergens: mandate.forbiddenAllergens, requiredAttributes: mandate.requiredAttributes });

  const ctx: PolicyContext & { holds?: { productId: string; name?: string; reason: string; url?: string; drill?: boolean }[] } = {
    now: new Date(body.createdAt),
    spentThisWeekCents: spentCents,
    heldThisWeekCents: heldCents,
    heldOrders,
    ...(body.unverified?.length ? { unverifiedConfirmations: body.unverified } : {}),
    quoteAlreadyUsed: false,
    recentOrders,
    // The gate's own recall_hold rule reads these (once the core has it); see below for a core without it.
    holds: holds.map((h) => ({ productId: String(h.value.productId), name: String(h.value.productName), reason: String(h.value.reason), url: String(h.value.noticeUrl), drill: h.value.drill === true })),
  };
  const decision = evaluatePolicy(mandate, { agentId: body.agentId, quote: body.quote, lines: body.draftLines, neededBy: body.request?.neededBy, requestId: body.requestId, asked: body.request?.asked }, ctx);
  const rules: RuleVerdict[] = decision.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, reason: r.reason }));
  let outcome: Verdict["outcome"] = decision.outcome;
  if (!gateHasHoldRule) {
    // This build's gate has no recall_hold rule: the hold is enforced in front of it (server/radar/gate.ts), with the
    // same name and the same effect, so it is reported beside the gate's own rules.
    rules.push(
      holds.length
        ? { rule: "recall_hold", outcome: "fail", reason: holds.map((h) => `${h.value.drill ? "DRILL, not a real recall: " : ""}${String(h.value.productName)} (${String(h.value.productId)}) is held by the wholesaler: ${String(h.value.reason)}`).join(" ") }
        : { rule: "recall_hold", outcome: "pass", reason: "No product is on a recall hold." },
    );
    if (holds.length) outcome = "reject";
  }
  if (!door.open) outcome = "refused_at_door";
  const approver = decision.outcome === "needs_human_approval" ? `${decision.approver.name} (${decision.approver.role})` : undefined;
  return { at: state.at, outcome, headline: headline(outcome, decision, rules, door, approver), door, rules, approver, read };
}

function headline(outcome: Verdict["outcome"], d: Decision, rules: RuleVerdict[], door: Verdict["door"], approver?: string): string {
  if (outcome === "refused_at_door" && !door.open) return `Refused at the door: the agent was suspended (“${door.reason}”). The gate would not have been asked.`;
  if (outcome === "reject") return `Refused by the gate: ${rules.filter((r) => r.outcome === "fail").map((r) => r.reason).join(" ")}`;
  if (outcome === "needs_human_approval") return `Sent to ${approver} for sign-off: ${rules.filter((r) => r.outcome === "escalate").map((r) => r.reason).join(" ")}`;
  return `Placed by the agent alone: ${formatEur(d.totalCents)} within everything the mandate allows.`;
}

export type Difference = { rule: string; then?: RuleVerdict; at?: RuleVerdict };

/** The rules whose outcome differs between two verdicts on the same order, with the door first. */
export function differences(a: Verdict, b: Verdict): Difference[] {
  const out: Difference[] = [];
  if (a.door.open !== b.door.open) {
    const door = (v: Verdict): RuleVerdict => (v.door.open ? { rule: "operator_suspension", outcome: "pass", reason: "No suspension in force." } : { rule: "operator_suspension", outcome: "fail", reason: `Suspended by ${v.door.by}: “${v.door.reason}”.` });
    out.push({ rule: "operator_suspension", then: door(a), at: door(b) });
  }
  const names = [...new Set([...a.rules.map((r) => r.rule), ...b.rules.map((r) => r.rule)])];
  for (const n of names) {
    const x = a.rules.find((r) => r.rule === n);
    const y = b.rules.find((r) => r.rule === n);
    if (x?.outcome !== y?.outcome) out.push({ rule: n, then: x, at: y });
  }
  return out;
}

/** Does the replay of the order against the rules just before it reproduce what the gate decided when it arrived? */
export function reproduces(body: OrderBody, then: Verdict): { same: boolean; rules: string[] } {
  const rules = body.recorded.rules.filter((r) => then.rules.find((x) => x.rule === r.rule)?.outcome !== r.outcome).map((r) => r.rule);
  const outcome = then.outcome === "refused_at_door" ? "reject" : then.outcome;
  return { same: rules.length === 0 && outcome === body.recorded.outcome, rules };
}

/** A mandate's terms in the shape the gate_rules view gives them (schema.ts), for code that builds states without SQL. */
export function mandateRuleValue(m: Mandate): Record<string, unknown> {
  return {
    orgName: m.issuer.name,
    perOrderLimitCents: m.perOrderLimitCents,
    weeklyBudgetCents: m.weeklyBudgetCents,
    allowedCategories: m.allowedCategories,
    requiredAttributes: m.requiredAttributes,
    forbiddenAllergens: m.forbiddenAllergens,
    requiredCertificates: m.requiredCertificates,
    maxLeadDays: m.delivery.maxLeadDays,
    substitutionRule: m.substitution.rule,
    maxPriceIncreasePct: m.substitution.maxPriceIncreasePct,
    approvers: m.approvers,
    issuedAs: m.mandateId,
  };
}

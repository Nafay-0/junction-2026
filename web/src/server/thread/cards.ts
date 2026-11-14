import type { IntakeView } from "@/core/intake";
import type { StructuredNeed } from "@/core/need";
import type { OptionCard } from "@/core/options";
import { takeBackUntil, type PublicOrder } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import type { Quote } from "@/core/quote";
import type { AnomalyCard, GateCard, NoticeCard, OptionView, OptionsCard, OrderCard, PriceCard, QuestionCard, UnderstoodCard } from "./types";

/**
 * Cards from records, by plain code. Every number, date, product and price a card shows is copied from an intake
 * step, a signed quote or an order the gate decided: the model never writes one. Card ids are stable per request
 * (`<kind>:<requestId>`), so a newer version of a card replaces the one on screen.
 */

export const cardId = (kind: string, ref: string) => `${kind}:${ref}`;

export function understoodCard(input: {
  requestId?: string;
  words: string;
  need: StructuredNeed;
  basedOn?: { requestId: string; fields: string[]; label?: string };
  memoryUsed?: string[];
  alsoAsked?: string[];
  ref: string;
}): UnderstoodCard {
  const n = input.need;
  return {
    type: "understood",
    cardId: cardId("understood", input.ref),
    requestId: input.requestId,
    words: input.words,
    item: n.item.text,
    ...(n.quantity ? { amount: { amount: n.quantity.amount, unit: n.quantity.unit } } : {}),
    ...(n.deliverBy ? { deliverBy: n.deliverBy } : {}),
    ...((n as { deliverOn?: string }).deliverOn ? { deliverOn: (n as { deliverOn?: string }).deliverOn } : {}),
    claims: [...new Set([...n.requiredClaims, ...n.item.attributes])],
    allergens: n.forbiddenAllergens,
    ...(n.optimise && n.optimise !== "no_preference" && n.optimise !== ("unstated" as string) ? { optimise: n.optimise } : {}),
    ...(input.basedOn ? { basedOn: input.basedOn } : {}),
    memoryUsed: input.memoryUsed ?? [],
    alsoAsked: input.alsoAsked ?? [],
  };
}

export function anomalyCard(step: IntakeView): AnomalyCard | undefined {
  if (!step.concerns.length) return undefined;
  return {
    type: "anomaly",
    cardId: cardId("anomaly", step.requestId),
    requestId: step.requestId,
    concerns: step.concerns.map((c) => ({ key: c.key, code: c.code, message: c.message, confirmable: c.confirmable, corrections: c.corrections.map((x) => ({ id: x.id, label: x.label })), ...(c.evidence ? { evidence: c.evidence } : {}) })),
  };
}

export function questionCard(step: IntakeView): QuestionCard | undefined {
  if (!step.questions.length) return undefined;
  return {
    type: "question",
    cardId: cardId("question", step.requestId),
    requestId: step.requestId,
    questions: step.questions.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => ({ id: o.id, label: o.label })) })),
  };
}

export function optionView(o: OptionCard): OptionView {
  return {
    optionId: o.optionId,
    rank: o.rank,
    title: o.title,
    match: o.match,
    givesUp: o.givesUp.map((g) => g.text),
    totalCents: o.totalCents,
    deliveryDate: o.deliveryDate,
    ...(o.orderBy ? { orderBy: o.orderBy } : {}),
    stockConfirmed: o.stockConfirmed,
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.packs, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents, ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}), ...(l.taxRatePct !== undefined ? { taxRatePct: l.taxRatePct } : {}), ...(l.depositCents ? { depositCents: l.depositCents } : {}) })),
    delivered: { amount: o.delivered.amount, unit: o.delivered.unit },
    co2Kg: o.co2.kg,
    reliability: o.reliability,
    signOff: o.signOff,
    pros: o.pros,
    cons: o.cons,
    reasons: o.reasons ?? [],
    ...(o.gate ? { gate: { outcome: o.gate.outcome, ...(o.gate.rule ? { rule: o.gate.rule } : {}), ...(o.gate.approver ? { approver: o.gate.approver } : {}), reasons: o.gate.reasons } } : {}),
    ...(o.alternative ? { alternative: { for: o.alternative.for, tier: o.alternative.tier, reason: o.alternative.reason } } : {}),
  };
}

export function optionsCard(step: IntakeView): OptionsCard | undefined {
  if (!step.options.length) return undefined;
  const groups = new Map<string, number>();
  const codeOf = new Map<string, string>();
  for (const x of step.excluded) {
    groups.set(x.reason, (groups.get(x.reason) ?? 0) + 1);
    if (x.code) codeOf.set(x.reason, x.code);
  }
  return {
    type: "options",
    cardId: cardId("options", step.requestId),
    requestId: step.requestId,
    // The gate's preview refused these: shown only to explain a missing obvious choice, never as one to tap.
    options: [...step.options, ...(step.refusedOptions ?? [])].map((o) => ({ ...optionView(o), category: step.family })),
    ...(step.preselected ? { preselected: { optionId: step.preselected.optionId, reason: step.preselected.reason } } : {}),
    excluded: [...groups.entries()].map(([reason, count]) => ({ reason, count, ...(codeOf.has(reason) ? { code: codeOf.get(reason) } : {}) })).slice(0, 12),
    notes: step.notes,
    ...(step.chosen ? { chosen: step.chosen.optionId } : {}),
  };
}

export const quoteLines = (q: Quote): OptionView["lines"] =>
  q.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents, ...(l.substituteFor ? { substituteFor: l.substituteFor.productId } : {}) }));

export function priceCard(step: IntakeView): PriceCard | undefined {
  const q = step.quote;
  if (!q) return undefined;
  return {
    type: "price",
    cardId: cardId("price", step.requestId),
    requestId: step.requestId,
    quoteId: q.quote.quoteId,
    totalCents: q.quote.totalCents,
    expiresAt: q.quote.expiresAt,
    deliveryDate: q.quote.lines[0]?.deliveryDate ?? "",
    lines: quoteLines(q.quote),
    preview: { outcome: q.policyPreview.outcome, reasons: q.policyPreview.reasons },
    signed: true,
  };
}

export function noOptionsCard(step: IntakeView): NoticeCard {
  return { type: "notice", cardId: cardId("notice", step.requestId), requestId: step.requestId, kind: "not_found", message: step.notes.join(" ") || "Nothing in the assortment fits this request." };
}

/** The gate's word on an order: placed alone, waiting for a named person, refused with the rule, or how it ended. */
export function gateCard(o: PublicOrder): GateCard {
  const base = { type: "gate" as const, cardId: cardId("gate", o.requestId), requestId: o.requestId, orderId: o.orderId, reasons: o.decision.reasons, rules: o.decision.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, ...(r.details ? { details: r.details } : {}) })) };
  const a = o.approval;
  const approver = a ? { name: a.approver.name, role: a.approver.role } : o.decision.outcome === "needs_human_approval" ? { name: o.decision.approver.name, role: o.decision.approver.role } : undefined;
  const escalated = o.decision.rules.find((r) => r.outcome !== "pass" && r.outcome !== "fail");
  switch (o.status) {
    case "committed":
      return a?.status === "approved" ? { ...base, outcome: "approved", approver, approvalId: a.approvalId, rule: escalated?.rule } : { ...base, outcome: "placed_alone" };
    case "pending_approval":
      return { ...base, outcome: "waiting", approver, approvalId: a?.approvalId, rule: escalated?.rule };
    case "rejected":
      return { ...base, outcome: "refused", rule: decidingRule(o.decision)?.rule };
    case "declined":
      return { ...base, outcome: "declined", approver, approvalId: a?.approvalId };
    case "withdrawn":
      return { ...base, outcome: "withdrawn", approver };
    case "expired":
      return { ...base, outcome: "expired", approver };
  }
}

export function orderCard(o: PublicOrder, passedOver: OrderCard["passedOver"] = []): OrderCard {
  const a = o.approval;
  const authorised: OrderCard["authorised"] =
    a?.status === "approved"
      ? { by: "person", name: a.approver.name, role: a.approver.role, verified: a.signOff?.verified !== false }
      : o.status === "pending_approval" && a
        ? { by: "waiting", name: a.approver.name, role: a.approver.role }
        : { by: "agent" };
  return {
    type: "order",
    cardId: cardId("order", o.orderId),
    orderId: o.orderId,
    requestId: o.requestId,
    status: o.status,
    totalCents: o.totalCents,
    deliveryDate: o.lines[0]?.deliveryDate ?? "",
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents, ...(l.substituteFor ? { substituteFor: l.substituteFor.productId } : {}) })),
    authorised,
    ...(o.confirmation ? { confirmation: o.confirmation } : {}),
    ...((() => {
      const until = takeBackUntil(o);
      return until ? { takeBackUntil: until } : {};
    })()),
    passedOver,
  };
}

/** What the agent passed over when it chose alone: the other cards, with the one thing each would have changed. */
export function passedOver(step: IntakeView, chosenId: string): OrderCard["passedOver"] {
  const chosen = step.options.find((o) => o.optionId === chosenId);
  return step.options
    .filter((o) => o.optionId !== chosenId)
    .map((o) => {
      const d = chosen ? o.totalCents - chosen.totalCents : 0;
      const why = o.match === "compromise" ? o.givesUp.map((g) => g.text).join("; ") || "a compromise" : o.cons[0] ?? (d > 0 ? "costs more" : d < 0 ? "cheaper but not what the kitchen usually buys" : "same price");
      return { title: o.title, totalCents: o.totalCents, why };
    });
}

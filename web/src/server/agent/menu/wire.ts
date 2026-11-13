import { agentKeyOf } from "@/core/live-allowance";
import type { Dock } from "@/core/orders";
import type { MenuKitchen, MenuKitchenInfo } from "./kitchens";
import type { PlanView } from "./plan";
import type { PlanRecord } from "./service";

/**
 * What leaves the server for a plan: the sheet (lines with their working, flags, totals), the model's part and how
 * long everything took, the live calls it cost, and, once there is one, the quote and the gate's decision. No
 * mandate, no quote token: the server holds those and acts for the kitchen.
 */
export function planWire(record: PlanRecord, view: PlanView, kitchen: MenuKitchen, dock: Dock) {
  const q = record.quote;
  const left = dock.liveAllowance.remaining(agentKeyOf(kitchen.mandate.issuer.orgId, kitchen.agentId));
  return {
    planId: record.planId,
    requestId: record.requestId ?? null,
    state: record.state,
    text: record.text,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pending: record.pending ?? false,
    declineReason: record.declineReason ?? null,
    kitchen: kitchen.info as MenuKitchenInfo,
    model: record.model,
    draft: {
      covers: record.draft.covers,
      serviceDate: record.draft.serviceDate,
      occasion: record.draft.occasion,
      assumptions: record.draft.assumptions,
      conflicts: record.draft.conflicts,
      corrections: record.draft.corrections,
      requiredClaims: record.draft.requiredClaims,
      forbiddenAllergens: record.draft.forbiddenAllergens,
      dishes: record.draft.dishes.map((d) => ({ id: d.id, name: d.name, nameFi: d.nameFi, course: d.course, serviceDate: d.serviceDate, portion: d.portion, method: d.method })),
    },
    settings: record.settings,
    notes: record.notes,
    timings: record.timings,
    live: { ...record.liveUse, allowance: { callsLeft: left.callsLeft, newProductsLeft: left.newProductsLeft, windowMinutes: left.windowMinutes } },
    acceptances: record.acceptances,
    lines: view.lines,
    totals: view.totals,
    quote: q
      ? {
          quoteId: q.quote.quoteId,
          totalCents: q.quote.totalCents,
          expiresAt: q.quote.expiresAt,
          expiresBecause: q.quote.expiresBecause ?? null,
          evidence: q.quote.evidence?.length ?? 0,
          lines: q.quote.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, deliveryDate: l.deliveryDate, substituteFor: l.substituteFor?.productId ?? null })),
          policyPreview: { outcome: q.policyPreview.outcome, reasons: q.policyPreview.reasons, approver: q.policyPreview.outcome === "needs_human_approval" ? { name: q.policyPreview.approver.name, role: q.policyPreview.approver.role } : null, rules: q.policyPreview.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, reason: r.reason })) },
        }
      : null,
    order: record.order
      ? {
          orderId: record.order.orderId,
          status: record.order.status,
          totalCents: record.order.totalCents,
          decision: { outcome: record.order.decision.outcome, reasons: record.order.decision.reasons, rules: record.order.decision.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, reason: r.reason })) },
          approval: record.order.approval ? { approvalId: record.order.approval.approvalId, status: record.order.approval.status, approver: { name: record.order.approval.approver.name, role: record.order.approval.approver.role } } : null,
          confirmed: !!record.order.confirmation,
          lines: record.order.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, lineTotalCents: l.lineTotalCents, deliveryDate: l.deliveryDate })),
        }
      : null,
    error: record.error ?? null,
  };
}

export type PlanWire = ReturnType<typeof planWire>;

import type { SignOff } from "@/core/approval";
import type { ApprovalContext } from "@/core/orders";
import type { RuleResult } from "@/core/policy";
import type { QuoteLine } from "@/core/quote";
import { formatEur } from "@/core/util";
import { DISPLAY_TIME_ZONE } from "./config";

/**
 * The approval screen's content, in plain words, built on the server from the stored order.
 * Made for a non-expert deciding in five seconds: what, how much, total, when, why they are asked,
 * what differs from the request. IDs and rule names only appear under `details`.
 */
export type ApprovalView = {
  approvalId: string;
  /** pending: waiting for this person. committed / declined / not_placed: decided. withdrawn / expired: closed unsigned. */
  state: "pending" | "committed" | "declined" | "not_placed" | "withdrawn" | "expired";
  /** For withdrawn and expired: one sentence on why nobody needs to sign any more. */
  closedReason?: string;
  kitchenName: string;
  agentName: string;
  approverName: string;
  approverRoleLabel: string;
  items: { name: string; amount: string; packs: string; lineTotal: string; delivery: string; substituteFor?: string }[];
  total: string;
  totalCents: number;
  delivery: string;
  why: string[];
  differences: string[];
  asked?: string;
  licence?: string;
  priceHeldUntil: string; // ISO
  priceHeldUntilText: string;
  /** How this approver signs: passkey; demo tap (joined without a passkey, demo only); or the link token (legacy demo org). */
  signIn: "passkey" | "demo_tap" | "link_token";
  demoTapEnabled: boolean;
  /** True when the phone asking is the registered approver of this order (one-tap decline works). */
  viewerIsApprover: boolean;
  outcome?: { decision: "approved" | "declined"; signedBy: string; at: string; atText: string; method: SignOff["method"]; verified: boolean; note?: string; notPlacedReason?: string };
  details: {
    approvalId: string;
    orderId: string;
    quoteId: string;
    orgId: string;
    agentId: string;
    mandateId: string;
    orderDigest: string;
    rules: { rule: string; outcome: string; reason: string }[];
    credentialId?: string;
  };
};

const UNIT_WORD: Record<QuoteLine["unit"], string> = { L: "L", kg: "kg", pcs: "pieces" };

const num = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** "€500" for whole euros, "€499.50" otherwise. */
export function eurShort(cents: number): string {
  return cents % 100 === 0 ? `€${(cents / 100).toLocaleString("en-US")}` : formatEur(cents);
}

export function dayText(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function timeText(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}

/** Product names without the pack detail, for short sentences: "Arla lactose-free semi-skimmed milk drink 1.5 %". */
function shortName(name: string): string {
  return name.split(",")[0].trim();
}

function plainWhy(r: RuleResult, ctx: ApprovalContext): string {
  switch (r.rule) {
    case "per_order_limit": {
      const limit = (r.details?.limitCents as number | undefined) ?? ctx.mandate.perOrderLimitCents;
      return `Over this agent's ${eurShort(limit)} per-order limit`;
    }
    case "substitution_rule":
      return "It swaps in a different product, and your rules say a person approves swaps";
    default:
      return r.reason;
  }
}

/** The amount the request asked for, if it says one: "1,000 litres" -> 1000 (L). */
function askedAmount(text: string | undefined): { qty: number; unit: QuoteLine["unit"] } | undefined {
  const m = /(\d[\d,.\s]*)\s*(litres?|liters?|l\b|kg|kilos?)/i.exec(text ?? "");
  if (!m) return undefined;
  const qty = Number(m[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(qty) || qty <= 0) return undefined;
  return { qty, unit: /^k/i.test(m[2]) ? "kg" : "L" };
}

function differences(ctx: ApprovalContext): string[] {
  const lines = ctx.order.lines;
  const out: string[] = [];
  for (const l of lines) {
    if (!l.substituteFor) continue;
    const sub = l.unitPriceCents / l.packSize;
    const orig = l.substituteFor.unitPriceCents / l.substituteFor.packSize;
    const pct = orig > 0 ? (sub / orig - 1) * 100 : 0;
    const unit = l.unit === "pcs" ? "piece" : l.unit === "L" ? "litre" : "kg";
    const price = Math.abs(pct) < 0.05 ? "same price" : pct > 0 ? `${pct.toFixed(1)} % dearer per ${unit}` : `${(-pct).toFixed(1)} % cheaper per ${unit}`;
    out.push(`${shortName(l.name)} instead of ${shortName(l.substituteFor.name)} (${price})`);
  }
  if (lines.length > 1) out.push(`Split across ${lines.length} products to reach the amount`);
  const asked = askedAmount(ctx.request?.text);
  if (asked) {
    const total = lines.filter((l) => l.unit === asked.unit).reduce((s, l) => s + l.quantity * l.packSize, 0);
    if (total > 0 && Math.abs(total - asked.qty) / asked.qty > 0.005) out.push(`${num(total)} ${UNIT_WORD[asked.unit]} instead of the ${num(asked.qty)} ${UNIT_WORD[asked.unit]} asked for`);
  }
  const neededBy = ctx.request?.neededBy;
  if (neededBy) {
    const late = lines.filter((l) => l.deliveryDate > neededBy);
    for (const l of late) out.push(`${shortName(l.name)} arrives ${dayText(l.deliveryDate)}, after the ${dayText(neededBy)} you asked for`);
  }
  return out;
}

function licenceOf(ctx: ApprovalContext): string | undefined {
  const m = ctx.mandate as unknown as Record<string, unknown>;
  const v = m.agentLicence ?? m.licence ?? m.licenceLevel ?? m.license ?? m.licenseLevel;
  if (typeof v === "string" || typeof v === "number") return `Licence level ${v}`;
  if (v && typeof v === "object" && "level" in v) return `Licence level ${String((v as { level: unknown }).level)}`;
  return undefined;
}

export function buildApprovalView(
  ctx: ApprovalContext,
  opts: { signIn: ApprovalView["signIn"]; demoTapEnabled: boolean; viewerIsApprover: boolean; agentName?: string; roleLabel?: string },
): ApprovalView {
  const { order, approval } = ctx;
  const lines = order.lines;
  const dates = [...new Set(lines.map((l) => l.deliveryDate))].sort();
  const state: ApprovalView["state"] =
    order.status === "pending_approval" && approval.status === "pending"
      ? "pending"
      : order.status === "committed"
        ? "committed"
        : order.status === "declined"
          ? "declined"
          : order.status === "withdrawn" || order.status === "expired"
            ? order.status
            : "not_placed";
  const s = approval.signOff;
  // The money rule first: it is the one people expect.
  const escalations = order.decision.rules.filter((r) => r.outcome === "escalate").sort((a, b) => Number(b.rule === "per_order_limit") - Number(a.rule === "per_order_limit"));
  return {
    approvalId: approval.approvalId,
    state,
    kitchenName: order.orgName,
    agentName: opts.agentName ?? "Your buyer agent",
    approverName: approval.approver.name,
    approverRoleLabel: opts.roleLabel ?? approval.approver.role.replaceAll("_", " "),
    items: lines.map((l) => ({
      name: l.name,
      amount: `${num(l.quantity * l.packSize)} ${UNIT_WORD[l.unit]}`,
      packs: `${num(l.quantity)} × ${num(l.packSize)} ${UNIT_WORD[l.unit]} at ${formatEur(l.unitPriceCents)}`,
      lineTotal: formatEur(l.lineTotalCents),
      delivery: dayText(l.deliveryDate),
      substituteFor: l.substituteFor ? shortName(l.substituteFor.name) : undefined,
    })),
    total: formatEur(order.totalCents),
    totalCents: order.totalCents,
    delivery: dates.length === 1 ? dayText(dates[0]) : `${dayText(dates[0])} to ${dayText(dates[dates.length - 1])}`,
    why: escalations.length ? escalations.map((r) => plainWhy(r, ctx)) : order.decision.reasons,
    differences: differences(ctx),
    asked: ctx.request?.text,
    licence: licenceOf(ctx),
    priceHeldUntil: ctx.quoteExpiresAt,
    priceHeldUntilText: timeText(ctx.quoteExpiresAt),
    signIn: opts.signIn,
    demoTapEnabled: opts.demoTapEnabled,
    viewerIsApprover: opts.viewerIsApprover,
    closedReason:
      state === "withdrawn"
        ? `The kitchen withdrew this order${approval.note ? `: "${approval.note}"` : ""}. Nothing to sign.`
        : state === "expired"
          ? `The fixed price ran out at ${timeText(ctx.quoteExpiresAt)} before anyone signed. Nothing to sign; the agent asks for a new quote if it is still needed.`
          : undefined,
    outcome:
      approval.status !== "approved" && approval.status !== "declined"
        ? undefined
        : {
            decision: approval.status,
            signedBy: approval.approver.name,
            at: approval.decidedAt ?? order.updatedAt,
            atText: timeText(approval.decidedAt ?? order.updatedAt),
            method: s?.method ?? "link_token",
            verified: s?.verified ?? true,
            note: approval.note,
            notPlacedReason: order.status === "rejected" ? notPlacedReason(order.decision.rules) : undefined,
          },
    details: {
      approvalId: approval.approvalId,
      orderId: order.orderId,
      quoteId: order.quoteId,
      orgId: order.orgId,
      agentId: order.agentId,
      mandateId: order.mandateId,
      orderDigest: ctx.orderDigest,
      rules: order.decision.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, reason: r.reason })),
      credentialId: s?.method === "passkey" ? s.credentialId : undefined,
    },
  };
}

function notPlacedReason(rules: RuleResult[]): string {
  const fail = rules.find((r) => r.outcome === "fail");
  if (!fail) return "The final check refused it.";
  if (fail.rule === "quote_expiry") return "The fixed price ran out before you approved. Ask the agent for a new quote.";
  if (fail.rule === "weekly_budget") return "It would now go over the weekly budget.";
  return fail.reason;
}

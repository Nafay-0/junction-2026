import type { KitchenProfile } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import type { Order, PurchaseRequest } from "@/core/orders";
import type { RuleOutcome } from "@/core/policy";
import { addDays, canonicalJson } from "@/core/util";
import type { Hold } from "../radar/types";
import type { Suspension } from "../ops/suspensions";

/**
 * From the app's own state to the rows of the versioned tables (schema.ts), and from two sets of rows to the plain
 * INSERT / UPDATE / DELETE statements that turn one into the other. Pure: no database, no clock of its own, so the
 * mapping and the planner are tested without MariaDB, and MariaDB does the only thing it is here for, the history.
 */

export type Row = Record<string, unknown>;
export type TableName = "gate_mandate" | "gate_kitchen_rule" | "gate_product_hold" | "gate_suspension" | "gate_budget" | "gate_order" | "gate_order_body";

type Spec = {
  key: string[];
  /** Columns whose change is a change of rule: compared, and written by UPDATE (MariaDB keeps the old version). */
  versioned: string[];
  /** Columns written without making history (declared WITHOUT SYSTEM VERSIONING, or a non-versioned table). */
  quiet: string[];
  /** Columns that are written with a change but never cause one (who made it). */
  meta: string[];
  /** JSON columns: stored as canonical JSON text. */
  jsonCols: string[];
  /** A row the app no longer has: delete it (no longer in force), or keep it (the audit record outlives the process). */
  missing: "delete" | "keep";
  /** For a kept row still in force that the app no longer has (its in-memory state was lost on a restart): end it. */
  end?: { status: string; from?: string; by?: string };
};

export const SPECS: Record<TableName, Spec> = {
  gate_mandate: {
    key: ["agent_id"],
    versioned: ["org_id", "org_name", "per_order_limit_cents", "weekly_budget_cents", "allowed_categories", "required_attributes", "forbidden_allergens", "required_certificates", "max_lead_days", "substitution_rule", "max_sub_increase_pct", "approvers"],
    quiet: ["mandate_id", "valid_from", "valid_until"],
    meta: ["issued_as", "changed_by"],
    jsonCols: ["allowed_categories", "required_attributes", "forbidden_allergens", "required_certificates", "approvers"],
    missing: "delete",
  },
  gate_kitchen_rule: { key: ["org_id", "rule_id"], versioned: ["strength", "kind", "family", "text", "fact"], quiet: [], meta: ["changed_by"], jsonCols: ["fact"], missing: "delete" },
  gate_product_hold: { key: ["hold_id"], versioned: ["product_id", "product_name", "reason", "notice_url", "drill", "status"], quiet: [], meta: ["changed_by", "change_note"], jsonCols: [], missing: "keep", end: { status: "lifted", from: "held" } },
  gate_suspension: { key: ["suspension_id"], versioned: ["scope", "target", "org_id", "label", "reason", "status"], quiet: [], meta: ["changed_by", "change_note"], jsonCols: [], missing: "keep", end: { status: "resumed", from: "active" } },
  // An organisation with no orders the app knows has no spend the gate would count: the row goes.
  gate_budget: { key: ["org_id"], versioned: ["committed_cents", "held_cents", "week_orders", "orders_in_week"], quiet: [], meta: ["changed_by"], jsonCols: ["week_orders"], missing: "delete" },
  // An order the app no longer has (its in-memory store restarted) stays as the audit record, marked so that the gate
  // replay does not count it among the orders the gate itself could see (the splitting check).
  gate_order: { key: ["order_id"], versioned: ["status", "outcome", "authorised_by", "total_cents"], quiet: [], meta: ["org_id", "agent_id", "request_id", "categories", "delivery_dates", "created_at", "changed_by"], jsonCols: ["categories", "delivery_dates"], missing: "keep", end: { status: "forgotten", by: "no longer in the app's state (it restarted); kept here as the record" } },
  gate_order_body: { key: ["order_id"], versioned: [], quiet: ["org_id", "created_at", "body"], meta: [], jsonCols: ["body"], missing: "keep" },
};

export const TABLE_ORDER: TableName[] = ["gate_mandate", "gate_kitchen_rule", "gate_product_hold", "gate_suspension", "gate_order_body", "gate_order", "gate_budget"];

export type GateRows = Record<TableName, Row[]>;

/** The order as it was put to the gate, enough to put it to the same gate again (replay.ts). */
export type OrderBody = {
  orderId: string;
  orgId: string;
  orgName: string;
  agentId: string;
  requestId: string;
  createdAt: string;
  quote: Order["quote"];
  draftLines: Order["draftLines"];
  /** The mandate the agent presented with this order (its own snapshot, kept to cross-check the mirror's). */
  mandate: Mandate;
  request?: { text?: string; neededBy?: string; asked?: PurchaseRequest["asked"] };
  unverified?: { code: string; message: string; by: string }[];
  /** What the gate decided when the order arrived, as the ledger has it. */
  recorded: { outcome: Order["decision"]["outcome"]; rules: { rule: string; outcome: RuleOutcome; reason: string }[]; approver?: string };
  lines: { productId: string; name: string; quantity: number; totalCents: number }[];
};

export type GateSources = {
  now: Date;
  /** One mandate per agent: the latest each agent presented. */
  mandates: Mandate[];
  orders: Order[];
  requests: Map<string, PurchaseRequest>;
  unverified: Map<string, { code: string; message: string; by: string }[]>;
  kitchens: KitchenProfile[];
  holds: Hold[];
  suspensions: Suspension[];
};

export function mandateRow(m: Mandate): Row {
  return {
    agent_id: m.agentId,
    org_id: m.issuer.orgId,
    org_name: m.issuer.name,
    per_order_limit_cents: m.perOrderLimitCents,
    weekly_budget_cents: m.weeklyBudgetCents,
    allowed_categories: [...m.allowedCategories],
    required_attributes: [...m.requiredAttributes],
    forbidden_allergens: [...m.forbiddenAllergens],
    required_certificates: [...m.requiredCertificates],
    max_lead_days: m.delivery.maxLeadDays,
    substitution_rule: m.substitution.rule,
    max_sub_increase_pct: m.substitution.maxPriceIncreasePct,
    approvers: m.approvers.map((a) => ({ role: a.role, name: a.name, maxApprovalCents: a.maxApprovalCents })),
    issued_as: m.mandateId,
    changed_by: `${m.issuer.name}, signed mandate ${m.mandateId}`,
    mandate_id: m.mandateId,
    valid_from: m.validFrom,
    valid_until: m.validUntil,
  };
}

/** What a kitchen's memory says that shapes an order: rules a person stated (they constrain) and habits (they pre-select). */
export function kitchenRuleRows(p: KitchenProfile): Row[] {
  const rows: Row[] = [];
  const memoryIds = new Set((p.memory?.items ?? []).map((i) => `pref_mem_${i.id}`));
  for (const s of p.stated) {
    if (memoryIds.has(s.id)) continue; // projected from a memory item below
    const { id, family, text, statedBy, kind } = s;
    const fact = Object.fromEntries(Object.entries(s).filter(([k]) => !["id", "family", "text", "statedBy", "statedAt", "requestId"].includes(k)));
    rows.push({ org_id: p.orgId, rule_id: id, strength: "rule", kind, family: family ?? null, text, fact, changed_by: statedBy });
  }
  for (const i of p.memory?.items ?? []) {
    if (i.status !== "active" || i.strength === "one_off") continue;
    const by = i.confirmedBy?.by ?? i.sources.find((x) => x.by)?.by ?? (i.origin === "learned" ? "learned from the kitchen's orders" : i.origin === "inferred" ? "proposed from the kitchen's words" : "the kitchen");
    rows.push({ org_id: p.orgId, rule_id: `mem_${i.id}`, strength: i.strength, kind: i.fact.kind, family: i.family ?? null, text: i.text, fact: i.fact, changed_by: by });
  }
  return rows;
}

export function holdRow(h: Hold): Row {
  const lifted = !!h.liftedAt;
  return {
    hold_id: h.holdId,
    product_id: h.productId,
    product_name: h.productName,
    reason: h.reason,
    notice_url: h.noticeUrl,
    drill: h.drill,
    status: lifted ? "lifted" : "held",
    changed_by: lifted ? (h.liftedBy ?? "operations") : h.placedBy === "radar" ? "the recall radar, on a confirmed identifier" : h.placedBy,
    change_note: lifted ? (h.liftReason ?? null) : h.noticeTitle,
  };
}

export function suspensionRow(s: Suspension, orgOfAgent: (agentId: string) => string | undefined): Row {
  const resumed = !!s.resumedAt;
  return {
    suspension_id: s.suspensionId,
    scope: s.scope,
    target: s.target,
    org_id: s.scope === "org" ? s.target : (orgOfAgent(s.target) ?? "unknown"),
    label: s.label,
    reason: s.reason,
    status: resumed ? "resumed" : "active",
    changed_by: resumed ? (s.resumedBy ?? "operations") : s.by,
    change_note: resumed ? (s.resumeNote ?? null) : null,
  };
}

const authorisedBy = (o: Order) => (o.status === "committed" ? (o.approval ? "approver" : "mandate") : o.status === "pending_approval" ? "pending" : "none");

export function orderRow(o: Order): Row {
  const decidedBy = o.approval?.decidedAt ? `${o.approval.approver.name} (${o.approval.approver.role}), ${o.approval.status}` : "the gate";
  return {
    order_id: o.orderId,
    org_id: o.orgId,
    agent_id: o.agentId,
    request_id: o.requestId,
    status: o.status,
    outcome: o.decision.outcome,
    authorised_by: authorisedBy(o),
    total_cents: o.totalCents,
    categories: [...new Set(o.lines.map((l) => l.category))],
    delivery_dates: [...new Set(o.lines.map((l) => l.deliveryDate))],
    created_at: o.createdAt,
    changed_by: o.status === "expired" ? "the quote's fixed price ran out" : o.status === "withdrawn" ? "the buyer withdrew it" : decidedBy,
  };
}

export function orderBody(o: Order, request?: PurchaseRequest, unverified?: { code: string; message: string; by: string }[]): OrderBody {
  const d = o.decision;
  return {
    orderId: o.orderId,
    orgId: o.orgId,
    orgName: o.orgName,
    agentId: o.agentId,
    requestId: o.requestId,
    createdAt: o.createdAt,
    quote: o.quote,
    draftLines: o.draftLines,
    mandate: o.mandate,
    request: request ? { text: request.text, neededBy: request.neededBy, asked: request.asked } : undefined,
    unverified: unverified?.length ? unverified : undefined,
    // The order's decision as it stands (a refusal at the re-check before sign-off replaces the first one; both are in the ledger).
    recorded: {
      outcome: d.outcome,
      rules: d.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, reason: r.reason })),
      approver: d.outcome === "needs_human_approval" ? `${d.approver.name} (${d.approver.role})` : undefined,
    },
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, totalCents: l.lineTotalCents })),
  };
}

/** The weekly spend the gate reads (orders.ts budgetUse): committed in the last 7 days, and held by orders waiting for sign-off. */
export function budgetRows(orders: Order[], now: Date): Row[] {
  const since = addDays(now, -7).getTime();
  const t = now.getTime();
  const byOrg = new Map<string, Order[]>();
  for (const o of orders) byOrg.set(o.orgId, [...(byOrg.get(o.orgId) ?? []), o]);
  const rows: Row[] = [];
  for (const [orgId, list] of byOrg) {
    const recent = list.filter((o) => Date.parse(o.createdAt) > since);
    const committed = recent.filter((o) => o.status === "committed");
    const held = recent.filter((o) => o.status === "pending_approval" && Date.parse(o.quote.expiresAt) > t);
    const last = [...list].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1)!;
    rows.push({
      org_id: orgId,
      committed_cents: committed.reduce((s, o) => s + o.totalCents, 0),
      held_cents: held.reduce((s, o) => s + o.totalCents, 0),
      week_orders: [...committed, ...held].map((o) => ({ orderId: o.orderId, totalCents: o.totalCents, status: o.status, expiresAt: o.status === "pending_approval" ? o.quote.expiresAt : undefined })),
      orders_in_week: committed.length + held.length,
      changed_by: `order ${last.orderId}, ${last.status.replace("_", " ")}`,
    });
  }
  return rows;
}

export function collectRows(src: GateSources): GateRows {
  const orgOfAgent = (agentId: string) => src.mandates.find((m) => m.agentId === agentId)?.issuer.orgId ?? src.orders.find((o) => o.agentId === agentId)?.orgId;
  return {
    gate_mandate: src.mandates.map(mandateRow),
    gate_kitchen_rule: src.kitchens.flatMap(kitchenRuleRows),
    gate_product_hold: src.holds.map(holdRow),
    gate_suspension: src.suspensions.map((s) => suspensionRow(s, orgOfAgent)),
    gate_order_body: src.orders.map((o) => ({ order_id: o.orderId, org_id: o.orgId, created_at: o.createdAt, body: orderBody(o, src.requests.get(o.requestId), src.unverified.get(o.requestId)) })),
    gate_order: src.orders.map(orderRow),
    gate_budget: budgetRows(src.orders, src.now),
  };
}

// ---------- planning writes ----------

export type Write =
  | { table: TableName; op: "insert"; row: Row }
  | { table: TableName; op: "update"; row: Row; cols: string[] } // a change of rule: MariaDB keeps the old version
  | { table: TableName; op: "touch"; row: Row; cols: string[] } // only quiet columns: no history
  | { table: TableName; op: "delete"; row: Row };

export const keyOf = (table: TableName, row: Row) => SPECS[table].key.map((k) => String(row[k])).join("\u0000");

const norm = (table: TableName, col: string, v: unknown): string => {
  if (v === undefined || v === null) return "null";
  if (SPECS[table].jsonCols.includes(col)) return canonicalJson(typeof v === "string" ? JSON.parse(v) : v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (col.endsWith("_at") || col === "valid_from" || col === "valid_until") {
    const t = Date.parse(String(v).replace(" ", "T") + (/[zZ]|[+-]\d\d:\d\d$/.test(String(v)) ? "" : "Z"));
    return Number.isNaN(t) ? String(v) : String(t);
  }
  return String(v);
};

const same = (table: TableName, cols: string[], a: Row, b: Row) => cols.every((c) => norm(table, c, a[c]) === norm(table, c, b[c]));

/**
 * The statements that turn what was written into what the app has now. Only a change in a versioned column makes an
 * UPDATE (and so a history row); a change in quiet columns alone is a "touch"; who-changed-it columns never cause one.
 */
export function planWrites(table: TableName, written: Map<string, Row>, desired: Row[]): Write[] {
  const spec = SPECS[table];
  const out: Write[] = [];
  const seen = new Set<string>();
  for (const row of desired) {
    const k = keyOf(table, row);
    if (seen.has(k)) continue;
    seen.add(k);
    const prev = written.get(k);
    if (!prev) out.push({ table, op: "insert", row });
    else if (!same(table, spec.versioned, prev, row)) {
      // Budget: when no order changed but the 7-day window moved on, say so rather than name an old order.
      const r = table === "gate_budget" && prev.changed_by === row.changed_by ? { ...row, changed_by: "the 7-day window moved on" } : row;
      out.push({ table, op: "update", row: r, cols: [...spec.versioned, ...spec.meta, ...spec.quiet] });
    } else if (!same(table, spec.quiet, prev, row)) out.push({ table, op: "touch", row, cols: spec.quiet });
  }
  for (const [k, prev] of written) {
    if (seen.has(k)) continue;
    if (spec.missing === "delete") out.push({ table, op: "delete", row: prev });
    else if (spec.end && (spec.end.from === undefined ? prev.status !== spec.end.status : prev.status === spec.end.from)) {
      const row: Row = { ...prev, status: spec.end.status, changed_by: spec.end.by ?? "no longer in the app's state (it restarted)" };
      if ("change_note" in prev) row.change_note = null;
      out.push({ table, op: "update", row, cols: [...spec.versioned, ...spec.meta, ...spec.quiet] });
    }
  }
  return out;
}

/** A value as the driver should bind it. */
export function bindValue(table: TableName, col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (SPECS[table].jsonCols.includes(col)) return canonicalJson(typeof v === "string" ? JSON.parse(v) : v);
  if ((col.endsWith("_at") || col === "valid_from" || col === "valid_until") && typeof v === "string" && v.includes("T")) {
    return new Date(v).toISOString().replace("T", " ").replace("Z", "").padEnd(26, "0");
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export const allColumns = (table: TableName) => {
  const s = SPECS[table];
  return [...s.key, ...s.versioned, ...s.quiet, ...s.meta];
};

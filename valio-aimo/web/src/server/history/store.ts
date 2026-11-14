import type { RecentOrder } from "@/core/policy";
import type { Area, OrderListItem, RuleRow, Shown } from "../mariadb/history";
import type { OrderBody, Row, TableName, Write } from "../mariadb/rows";

/**
 * Where the time machine keeps the versions of what the gate reads. Three backends behind one interface, so the
 * mirror (mirror.ts), the page's answers (service.ts), the gate replay (replay.ts) and the kitchen's view
 * (kitchen-view.ts) never care which one is underneath:
 *
 *   mariadb    system-versioned tables: MariaDB keeps the versions itself (FOR SYSTEM_TIME AS OF)
 *   postgres   each version carries the tstzrange it was in force (`during`), an exclusion constraint keeps two
 *              versions of one item from overlapping, "as of" is `during @> t` (pg-store.ts)
 *   memory     the same versions in this process, filled by the same mirror from the ledger at start (memory-store.ts)
 *
 * Every read returns the statement it ran (or, in memory, the filter it applied) and its time, so the page shows
 * its working whichever answered.
 */
export type Backend = "mariadb" | "postgres" | "memory";

export const BACKEND_LABEL: Record<Backend, string> = {
  mariadb: "History kept in MariaDB",
  postgres: "History kept in Aiven PostgreSQL",
  memory: "History kept in this server's memory, since it started",
};

export type MomentRow = { area: Area; item: string; inForce: boolean; by: string; at: string };
export type KitchenItem = { orgId: string; name: string; scenario: boolean };

export interface HistoryStore {
  readonly backend: Backend;
  /** Where, for the page ("dock-pg / dock_prod_history", "localhost:3306/dock_audit", "this process"). */
  readonly display: string;
  /** Create what is missing (idempotent). */
  ensure(): Promise<void>;

  // ---- the questions (history.ts names them) ----
  rulesAsOf(orgId: string, at: string): Promise<Shown<RuleRow[]>>;
  versionsBetween(orgId: string, from: string, to: string): Promise<Shown<RuleRow[]>>;
  moments(orgId: string): Promise<Shown<MomentRow[]>>;
  recentOrdersAsOf(orgId: string, at: string, excludeOrderId: string): Promise<Shown<RecentOrder[]>>;
  listOrders(limit?: number): Promise<Shown<OrderListItem[]>>;
  kitchens(): Promise<KitchenItem[]>;
  orderBody(orderId: string): Promise<OrderBody | undefined>;
  orderOwner(orderId: string): Promise<string | undefined>;
  latestOrderOfRequest(requestId: string): Promise<string | undefined>;

  // ---- what the mirror needs ----
  /** The rows in force now that `writer` keeps, by table and key (the planner compares against them). */
  loadWritten(writer: string): Promise<Map<TableName, Map<string, Row>>>;
  /** Apply the planned writes as one transaction, stamped `at` (the scenario's and the backfill's own clock), else now. */
  apply(writes: Write[], writer: string, at?: Date): Promise<void>;
  /** Small notes kept beside the history (the backfill's run). */
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  /** Remove every row `writer` keeps, history included (the backfill restarts clean after an interrupted run). */
  clearWriter(writer: string): Promise<void>;
  close(): Promise<void>;
}

// ---------- the gate_rules view, as code (the memory backend's, and the tests' reference) ----------

const num = (v: unknown) => (v === null || v === undefined ? v : Number(v));

/** One row of a versioned table as the `gate_rules` view shows it (schema.ts, pg-schema.ts): area, item, in force, value. */
export function ruleOf(table: TableName, r: Row): { area: Area; orgId: string; item: string; inForce: boolean; value: Record<string, unknown>; changedBy: string } | undefined {
  switch (table) {
    case "gate_mandate":
      return {
        area: "mandate",
        orgId: String(r.org_id),
        item: String(r.agent_id),
        inForce: true,
        value: {
          orgName: r.org_name,
          perOrderLimitCents: num(r.per_order_limit_cents),
          weeklyBudgetCents: num(r.weekly_budget_cents),
          allowedCategories: r.allowed_categories,
          requiredAttributes: r.required_attributes,
          forbiddenAllergens: r.forbidden_allergens,
          requiredCertificates: r.required_certificates,
          maxLeadDays: num(r.max_lead_days),
          substitutionRule: r.substitution_rule,
          maxPriceIncreasePct: num(r.max_sub_increase_pct),
          approvers: r.approvers,
          issuedAs: r.issued_as,
        },
        changedBy: String(r.changed_by),
      };
    case "gate_kitchen_rule":
      return { area: "kitchen_rule", orgId: String(r.org_id), item: String(r.rule_id), inForce: true, value: { strength: r.strength, kind: r.kind, family: r.family ?? null, text: r.text, fact: r.fact }, changedBy: String(r.changed_by) };
    case "gate_product_hold":
      return {
        area: "hold",
        orgId: "*",
        item: String(r.hold_id),
        inForce: r.status === "held",
        value: { productId: r.product_id, productName: r.product_name, reason: r.reason, noticeUrl: r.notice_url, drill: r.drill === true || r.drill === 1, status: r.status, note: r.change_note ?? null },
        changedBy: String(r.changed_by),
      };
    case "gate_suspension":
      return { area: "suspension", orgId: String(r.org_id), item: String(r.suspension_id), inForce: r.status === "active", value: { scope: r.scope, target: r.target, label: r.label, reason: r.reason, status: r.status, note: r.change_note ?? null }, changedBy: String(r.changed_by) };
    case "gate_budget":
      return { area: "budget", orgId: String(r.org_id), item: String(r.org_id), inForce: true, value: { committedCents: num(r.committed_cents), heldCents: num(r.held_cents), weekOrders: r.week_orders, ordersInWeek: num(r.orders_in_week) }, changedBy: String(r.changed_by) };
    default:
      return undefined;
  }
}

export const RULE_TABLES: TableName[] = ["gate_mandate", "gate_kitchen_rule", "gate_product_hold", "gate_suspension", "gate_budget"];

/** The value's fields in the order the view declares them (PostgreSQL's jsonb keeps its own order), so words and diffs read the same on every backend. */
export const VALUE_KEYS: Record<Area, string[]> = {
  mandate: ["orgName", "perOrderLimitCents", "weeklyBudgetCents", "allowedCategories", "requiredAttributes", "forbiddenAllergens", "requiredCertificates", "maxLeadDays", "substitutionRule", "maxPriceIncreasePct", "approvers", "issuedAs"],
  kitchen_rule: ["strength", "kind", "family", "text", "fact"],
  hold: ["productId", "productName", "reason", "noticeUrl", "drill", "status", "note"],
  suspension: ["scope", "target", "label", "reason", "status", "note"],
  budget: ["committedCents", "heldCents", "weekOrders", "ordersInWeek"],
};

export function inViewOrder(area: Area, value: Record<string, unknown>): Record<string, unknown> {
  const keys = VALUE_KEYS[area] ?? [];
  return Object.fromEntries([...keys.filter((k) => k in value).map((k) => [k, value[k]] as const), ...Object.entries(value).filter(([k]) => !keys.includes(k))]);
}

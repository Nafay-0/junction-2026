import { isoTime, json, sqlTime, type Maria } from "./client";
import type { OrderBody } from "./rows";
import { doorText } from "./words";

/**
 * The questions the time machine answers, each one SQL statement against MariaDB's own history. Every answer
 * carries the statement and its parameters as run, and how long it took, so the page can show its working.
 */

export type Area = "mandate" | "kitchen_rule" | "hold" | "suspension" | "budget";

export type RuleRow = {
  area: Area;
  orgId: string;
  item: string;
  inForce: boolean;
  value: Record<string, unknown>;
  changedBy: string;
  since: string;
  until?: string;
};

export type Shown<T> = { rows: T; sql: string; params: unknown[]; ms: number };

const ruleRow = (r: Record<string, unknown>): RuleRow => ({
  area: String(r.area) as Area,
  orgId: String(r.org_id),
  item: String(r.item),
  inForce: Number(r.in_force) === 1,
  value: json<Record<string, unknown>>(r.value),
  changedBy: String(r.changed_by),
  since: isoTime(r.since)!,
  until: isoTime(r.until),
});

const COLS = "area, org_id, item, in_force, value, changed_by, since, until";

/** The rules in force for one kitchen (and the wholesaler-wide holds) at one moment. */
export const SQL_RULES_AS_OF = `SELECT ${COLS}\n  FROM gate_rules FOR SYSTEM_TIME AS OF TIMESTAMP ?\n WHERE org_id IN (?, '*') AND in_force = 1\n ORDER BY area, item`;

export async function rulesAsOf(db: Maria, orgId: string, at: string): Promise<Shown<RuleRow[]>> {
  const r = await db.query(SQL_RULES_AS_OF, [sqlTime(at), orgId]);
  return { rows: r.rows.map(ruleRow), sql: r.sql, params: r.params, ms: r.ms };
}

/** Every version that was in force at some point between two moments: the changes, with who made each. */
export const SQL_CHANGES = `SELECT ${COLS}\n  FROM gate_rules FOR SYSTEM_TIME FROM TIMESTAMP ? TO TIMESTAMP ?\n WHERE org_id IN (?, '*')\n ORDER BY area, item, since`;

export async function versionsBetween(db: Maria, orgId: string, from: string, to: string): Promise<Shown<RuleRow[]>> {
  const r = await db.query(SQL_CHANGES, [sqlTime(from), sqlTime(to), orgId]);
  return { rows: r.rows.map(ruleRow), sql: r.sql, params: r.params, ms: r.ms };
}

/** Every moment something the gate reads changed for this kitchen: the ticks on the time slider. */
export const SQL_MOMENTS = `SELECT area, item, in_force, changed_by, since\n  FROM gate_rules FOR SYSTEM_TIME ALL\n WHERE org_id IN (?, '*')\n ORDER BY since`;

export async function moments(db: Maria, orgId: string): Promise<Shown<{ area: Area; item: string; inForce: boolean; by: string; at: string }[]>> {
  const r = await db.query(SQL_MOMENTS, [orgId]);
  return { rows: r.rows.map((x) => ({ area: String(x.area) as Area, item: String(x.item), inForce: Number(x.in_force) === 1, by: String(x.changed_by), at: isoTime(x.since)! })), sql: r.sql, params: r.params, ms: r.ms };
}

export type OrderListItem = { orderId: string; orgId: string; orgName: string; agentId: string; status: string; outcome: string; totalCents: number; createdAt: string; summary: string; scenario: boolean; door?: string; doorText?: string };

export async function listOrders(db: Maria, limit = 300): Promise<Shown<OrderListItem[]>> {
  const r = await db.query(
    `SELECT o.order_id, o.org_id, o.agent_id, o.status, o.outcome, o.total_cents, o.created_at, o.writer,
            JSON_VALUE(b.body, '$.orgName') AS org_name, JSON_VALUE(b.body, '$.door') AS door, JSON_QUERY(b.body, '$.lines') AS order_lines
       FROM gate_order o JOIN gate_order_body b ON b.order_id = o.order_id
      ORDER BY o.created_at DESC LIMIT ?`,
    [limit],
  );
  return {
    rows: r.rows.map((x) => {
      const lines = json<{ name: string; quantity: number }[]>(x.order_lines) ?? [];
      return {
        orderId: String(x.order_id),
        orgId: String(x.org_id),
        orgName: String(x.org_name ?? x.org_id),
        agentId: String(x.agent_id),
        status: String(x.status),
        outcome: String(x.outcome),
        totalCents: Number(x.total_cents),
        createdAt: isoTime(x.created_at)!,
        summary: lines.map((l) => `${l.quantity} × ${l.name}`).join(" + "),
        scenario: String(x.writer) === "scenario",
        ...(x.door ? { door: String(x.door), doorText: doorText(String(x.door)) } : {}),
      };
    }),
    sql: r.sql,
    params: r.params,
    ms: r.ms,
  };
}

export async function orderBodyOf(db: Maria, orderId: string): Promise<OrderBody | undefined> {
  const r = await db.query("SELECT body FROM gate_order_body WHERE order_id = ?", [orderId]);
  return r.rows[0] ? json<OrderBody>(r.rows[0].body) : undefined;
}

/** The kitchens the mirror has seen (current and past mandates), for the page's picker. */
export async function kitchens(db: Maria): Promise<{ orgId: string; name: string; scenario: boolean }[]> {
  const r = await db.query("SELECT org_id, MAX(org_name) AS name, MAX(writer = 'scenario') AS scenario FROM gate_mandate FOR SYSTEM_TIME ALL GROUP BY org_id ORDER BY name");
  return r.rows.map((x) => ({ orgId: String(x.org_id), name: String(x.name), scenario: Number(x.scenario) === 1 }));
}

/** The kitchen's other orders of the 24 hours before a moment, as they stood then: the gate's order_splitting check reads them. */
export const SQL_RECENT_ORDERS = `SELECT order_id, request_id, created_at, total_cents, categories, delivery_dates, authorised_by\n  FROM gate_order FOR SYSTEM_TIME AS OF TIMESTAMP ?\n WHERE org_id = ? AND order_id <> ?\n   AND created_at > TIMESTAMP ? - INTERVAL 24 HOUR AND created_at <= TIMESTAMP ?\n   AND status IN ('committed', 'pending_approval')`;

export async function recentOrdersAsOf(db: Maria, orgId: string, at: string, excludeOrderId: string) {
  const t = sqlTime(at);
  const r = await db.query(SQL_RECENT_ORDERS, [t, orgId, excludeOrderId, t, t]);
  return {
    rows: r.rows.map((x) => ({
      orderId: String(x.order_id),
      requestId: String(x.request_id),
      placedAt: isoTime(x.created_at)!,
      totalCents: Number(x.total_cents),
      categories: json<string[]>(x.categories),
      deliveryDates: json<string[]>(x.delivery_dates),
      authorisedBy: String(x.authorised_by) as "mandate" | "approver" | "pending",
    })),
    sql: r.sql,
    params: r.params,
    ms: r.ms,
  };
}

// ---------- from versions to changes ----------

export type FieldChange = { field: string; before: unknown; after: unknown };
export type Change = {
  area: Area;
  item: string;
  /** added: came into force; changed: its terms changed; ended: no longer in force (lifted, resumed, removed). */
  kind: "added" | "changed" | "ended";
  at: string;
  by: string;
  fields: FieldChange[];
  before?: RuleRow;
  after?: RuleRow;
};

const IGNORED_FIELDS = new Set(["issuedAs", "note", "status"]);

/** Pair the versions of each rule into the changes that happened strictly after `from`, up to `to`. */
export function changesFrom(versions: RuleRow[], from: string, to: string): Change[] {
  const f = Date.parse(from);
  const t = Date.parse(to);
  const byKey = new Map<string, RuleRow[]>();
  for (const v of versions) byKey.set(`${v.area}\u0000${v.item}`, [...(byKey.get(`${v.area}\u0000${v.item}`) ?? []), v]);
  const out: Change[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.since.localeCompare(b.since));
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const s = Date.parse(v.since);
      const prev = i > 0 && list[i - 1].until === v.since ? list[i - 1] : undefined;
      if (s > f && s <= t) {
        const prevOn = prev?.inForce ?? false;
        if (!prevOn && v.inForce) out.push({ area: v.area, item: v.item, kind: "added", at: v.since, by: v.changedBy, fields: [], after: v });
        else if (prevOn && !v.inForce) out.push({ area: v.area, item: v.item, kind: "ended", at: v.since, by: v.changedBy, fields: [], before: prev, after: v });
        else if (prevOn && v.inForce) {
          const fields = diffValues(prev!.value, v.value);
          if (fields.length) out.push({ area: v.area, item: v.item, kind: "changed", at: v.since, by: v.changedBy, fields, before: prev, after: v });
        }
      }
      // A row deleted (not superseded): it stopped being in force at its ROW_END.
      const next = list[i + 1];
      if (v.until && v.inForce && (!next || next.since !== v.until)) {
        const u = Date.parse(v.until);
        if (u > f && u <= t) out.push({ area: v.area, item: v.item, kind: "ended", at: v.until, by: "removed from the app's state", fields: [], before: v });
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export function diffValues(a: Record<string, unknown>, b: Record<string, unknown>): FieldChange[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORED_FIELDS.has(k));
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => ({ field: k, before: a[k], after: b[k] }));
}

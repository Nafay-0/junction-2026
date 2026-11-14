import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "@/core/util";
import type { RecentOrder } from "@/core/policy";
import type { Area, OrderListItem, RuleRow, Shown } from "../mariadb/history";
import { SPECS, TABLE_ORDER, allColumns, keyOf, type OrderBody, type Row, type TableName, type Write } from "../mariadb/rows";
import { doorText } from "../mariadb/words";
import { inViewOrder, type HistoryStore, type KitchenItem, type MomentRow } from "./store";

/**
 * The PostgreSQL backend (Aiven PostgreSQL, the site's own database, in a schema of its own). PostgreSQL has no
 * system versioning, so history is modelled the PostgreSQL way: every version of a row carries `during`, the
 * tstzrange it was in force, and an exclusion constraint (btree_gist) keeps two versions of one item from
 * overlapping. A change closes the current range and opens a new one; "as of t" is `during @> t`, "between" is range
 * overlap (`&&`), the slider's ticks are the lower bounds. Same rows as the MariaDB mirror, same answers.
 */

export const HISTORY_SCHEMA_ENV = "DOCK_HISTORY_SCHEMA";

/** `<the app's schema>_history` by default (dock_prod_history next to dock_prod): its own schema, never the app's tables. */
export function historySchema(appSchema: string, env: NodeJS.ProcessEnv = process.env): string {
  const s = env[HISTORY_SCHEMA_ENV]?.trim() || `${appSchema}_history`;
  if (!/^[a-z_][a-z0-9_]{0,50}$/.test(s)) throw new Error(`${HISTORY_SCHEMA_ENV} must be a plain lower-case identifier; got ${JSON.stringify(s)}.`);
  return s;
}

const COLS: Record<Exclude<TableName, "gate_order_body">, string> = {
  gate_mandate: `agent_id text NOT NULL, org_id text NOT NULL, org_name text NOT NULL, per_order_limit_cents bigint NOT NULL, weekly_budget_cents bigint NOT NULL,
    allowed_categories jsonb NOT NULL, required_attributes jsonb NOT NULL, forbidden_allergens jsonb NOT NULL, required_certificates jsonb NOT NULL,
    max_lead_days int NOT NULL, substitution_rule text NOT NULL, max_sub_increase_pct double precision NOT NULL, approvers jsonb NOT NULL,
    issued_as text NOT NULL, changed_by text NOT NULL, mandate_id text NOT NULL, valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL`,
  gate_kitchen_rule: `org_id text NOT NULL, rule_id text NOT NULL, strength text NOT NULL, kind text NOT NULL, family text NULL, text text NOT NULL, fact jsonb NOT NULL, changed_by text NOT NULL`,
  gate_product_hold: `hold_id text NOT NULL, product_id text NOT NULL, product_name text NOT NULL, reason text NOT NULL, notice_url text NOT NULL, drill boolean NOT NULL, status text NOT NULL, changed_by text NOT NULL, change_note text NULL`,
  gate_suspension: `suspension_id text NOT NULL, scope text NOT NULL, target text NOT NULL, org_id text NOT NULL, label text NOT NULL, reason text NOT NULL, status text NOT NULL, changed_by text NOT NULL, change_note text NULL`,
  gate_budget: `org_id text NOT NULL, committed_cents bigint NOT NULL, held_cents bigint NOT NULL, week_orders jsonb NOT NULL, orders_in_week int NOT NULL, changed_by text NOT NULL`,
  gate_order: `order_id text NOT NULL, org_id text NOT NULL, agent_id text NOT NULL, request_id text NOT NULL, status text NOT NULL, outcome text NOT NULL, authorised_by text NOT NULL,
    total_cents bigint NOT NULL, categories jsonb NOT NULL, delivery_dates jsonb NOT NULL, created_at timestamptz NOT NULL, changed_by text NOT NULL`,
};

/** The schema, idempotent: tables with `during`, the exclusion constraints, the view. Safe to run while the site is up. */
export function pgSchemaSql(s: string, withExclusion = true): string[] {
  const out = [`CREATE SCHEMA IF NOT EXISTS ${s}`];
  for (const [t, cols] of Object.entries(COLS) as [Exclude<TableName, "gate_order_body">, string][]) {
    const key = SPECS[t].key;
    const exclusion = withExclusion ? `,\n    CONSTRAINT ${t}_no_overlap EXCLUDE USING gist (${key.map((k) => `${k} WITH =`).join(", ")}, during WITH &&)` : "";
    out.push(`CREATE TABLE IF NOT EXISTS ${s}.${t} (\n    ${cols},\n    writer text NOT NULL,\n    during tstzrange NOT NULL${exclusion}\n  )`);
    out.push(`CREATE INDEX IF NOT EXISTS ${t}_during_idx ON ${s}.${t} USING gist (during)`);
    out.push(`CREATE INDEX IF NOT EXISTS ${t}_current_idx ON ${s}.${t} (${key.join(", ")}) WHERE upper_inf(during)`);
  }
  out.push(`CREATE TABLE IF NOT EXISTS ${s}.gate_order_body (order_id text PRIMARY KEY, org_id text NOT NULL, created_at timestamptz NOT NULL, body jsonb NOT NULL, writer text NOT NULL)`);
  out.push(`CREATE TABLE IF NOT EXISTS ${s}.history_meta (key text PRIMARY KEY, value text NOT NULL, at timestamptz NOT NULL DEFAULT now())`);
  out.push(`CREATE OR REPLACE VIEW ${s}.gate_rules AS
    SELECT 'mandate'::text AS area, org_id, agent_id AS item, true AS in_force,
      jsonb_build_object('orgName', org_name, 'perOrderLimitCents', per_order_limit_cents, 'weeklyBudgetCents', weekly_budget_cents,
        'allowedCategories', allowed_categories, 'requiredAttributes', required_attributes, 'forbiddenAllergens', forbidden_allergens,
        'requiredCertificates', required_certificates, 'maxLeadDays', max_lead_days, 'substitutionRule', substitution_rule,
        'maxPriceIncreasePct', max_sub_increase_pct, 'approvers', approvers, 'issuedAs', issued_as) AS value,
      changed_by, writer, during
    FROM ${s}.gate_mandate
    UNION ALL
    SELECT 'kitchen_rule', org_id, rule_id, true, jsonb_build_object('strength', strength, 'kind', kind, 'family', family, 'text', text, 'fact', fact), changed_by, writer, during
    FROM ${s}.gate_kitchen_rule
    UNION ALL
    SELECT 'hold', '*', hold_id, status = 'held',
      jsonb_build_object('productId', product_id, 'productName', product_name, 'reason', reason, 'noticeUrl', notice_url, 'drill', drill, 'status', status, 'note', change_note),
      changed_by, writer, during
    FROM ${s}.gate_product_hold
    UNION ALL
    SELECT 'suspension', org_id, suspension_id, status = 'active',
      jsonb_build_object('scope', scope, 'target', target, 'label', label, 'reason', reason, 'status', status, 'note', change_note), changed_by, writer, during
    FROM ${s}.gate_suspension
    UNION ALL
    SELECT 'budget', org_id, org_id, true,
      jsonb_build_object('committedCents', committed_cents, 'heldCents', held_cents, 'weekOrders', week_orders, 'ordersInWeek', orders_in_week), changed_by, writer, during
    FROM ${s}.gate_budget`);
  return out;
}

const RULE_COLS = "area, org_id, item, in_force, value, changed_by, lower(during) AS since, upper(during) AS until";

const isoOf = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Numbers stay numbers in the value (bigint comes back as text from the driver, a jsonb number as a number). */
function ruleRow(r: Record<string, unknown>): RuleRow {
  const value = inViewOrder(String(r.area) as Area, (r.value ?? {}) as Record<string, unknown>);
  return { area: String(r.area) as Area, orgId: String(r.org_id), item: String(r.item), inForce: r.in_force === true, value, changedBy: String(r.changed_by), since: isoOf(r.since)!, ...(r.until ? { until: isoOf(r.until) } : {}) };
}

/** A value as PostgreSQL should get it: JSON as canonical text (into jsonb), times as ISO with the zone, the rest as is. */
function bind(table: TableName, col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (SPECS[table].jsonCols.includes(col) || col === "body") return canonicalJson(typeof v === "string" ? JSON.parse(v) : v);
  if (col.endsWith("_at") || col === "valid_from" || col === "valid_until") {
    const s = String(v);
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) || !s.includes(" ") ? s : `${s.replace(" ", "T")}Z`);
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  }
  if (typeof v === "boolean") return v;
  if (col === "drill") return v === 1 || v === "1" || v === true;
  return v;
}

/** A row read back for the planner: times as ISO, everything else as the driver gives it (the planner compares text). */
function plain(r: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

export class PgStore implements HistoryStore {
  readonly backend = "postgres" as const;
  readonly display: string;
  /** Whether the exclusion constraints are in place (btree_gist could be created). */
  exclusion = true;

  constructor(
    private readonly pool: Pool,
    readonly schema: string,
    display?: string,
  ) {
    this.display = display ?? `schema ${schema}`;
  }

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; ms: number; sql: string; params: unknown[] }> {
    const t0 = performance.now();
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[], ms: performance.now() - t0, sql, params };
  }

  async ensure(): Promise<void> {
    try {
      await this.pool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
      this.exclusion = true;
    } catch {
      // Without the extension the ranges still answer "as of"; only the database-enforced no-overlap is missing.
      this.exclusion = false;
    }
    for (const sql of pgSchemaSql(this.schema, this.exclusion)) await this.pool.query(sql);
  }

  async rulesAsOf(orgId: string, at: string): Promise<Shown<RuleRow[]>> {
    const r = await this.q(`SELECT ${RULE_COLS}\n  FROM ${this.schema}.gate_rules\n WHERE during @> $1::timestamptz AND org_id IN ($2, '*') AND in_force\n ORDER BY area, item`, [at, orgId]);
    return { ...r, rows: r.rows.map(ruleRow) };
  }

  async versionsBetween(orgId: string, from: string, to: string): Promise<Shown<RuleRow[]>> {
    const r = await this.q(`SELECT ${RULE_COLS}\n  FROM ${this.schema}.gate_rules\n WHERE during && tstzrange($1::timestamptz, $2::timestamptz) AND org_id IN ($3, '*')\n ORDER BY area, item, lower(during)`, [from, to, orgId]);
    return { ...r, rows: r.rows.map(ruleRow) };
  }

  async moments(orgId: string): Promise<Shown<MomentRow[]>> {
    const r = await this.q(`SELECT area, item, in_force, changed_by, lower(during) AS since\n  FROM ${this.schema}.gate_rules\n WHERE org_id IN ($1, '*') AND NOT isempty(during)\n ORDER BY lower(during)`, [orgId]);
    return { ...r, rows: r.rows.map((x) => ({ area: String(x.area) as Area, item: String(x.item), inForce: x.in_force === true, by: String(x.changed_by), at: isoOf(x.since)! })) };
  }

  async recentOrdersAsOf(orgId: string, at: string, excludeOrderId: string): Promise<Shown<RecentOrder[]>> {
    const r = await this.q(
      `SELECT order_id, request_id, created_at, total_cents, categories, delivery_dates, authorised_by\n  FROM ${this.schema}.gate_order\n WHERE during @> $1::timestamptz AND org_id = $2 AND order_id <> $3\n   AND created_at > $1::timestamptz - interval '24 hours' AND created_at <= $1::timestamptz\n   AND status IN ('committed', 'pending_approval')`,
      [at, orgId, excludeOrderId],
    );
    return {
      ...r,
      rows: r.rows.map((x) => ({
        orderId: String(x.order_id),
        requestId: String(x.request_id),
        placedAt: isoOf(x.created_at)!,
        totalCents: Number(x.total_cents),
        categories: x.categories as string[],
        deliveryDates: x.delivery_dates as string[],
        authorisedBy: String(x.authorised_by) as RecentOrder["authorisedBy"],
      })),
    };
  }

  async listOrders(limit = 300): Promise<Shown<OrderListItem[]>> {
    const r = await this.q(
      `SELECT o.order_id, o.org_id, o.agent_id, o.status, o.outcome, o.total_cents, o.created_at, o.writer,
            b.body->>'orgName' AS org_name, b.body->>'door' AS door, b.body->'lines' AS order_lines
       FROM ${this.schema}.gate_order o JOIN ${this.schema}.gate_order_body b ON b.order_id = o.order_id
      WHERE upper_inf(o.during)
      ORDER BY o.created_at DESC LIMIT $1`,
      [limit],
    );
    return {
      ...r,
      rows: r.rows.map((x) => {
        const lines = (x.order_lines as { name: string; quantity: number }[] | null) ?? [];
        return {
          orderId: String(x.order_id),
          orgId: String(x.org_id),
          orgName: String(x.org_name ?? x.org_id),
          agentId: String(x.agent_id),
          status: String(x.status),
          outcome: String(x.outcome),
          totalCents: Number(x.total_cents),
          createdAt: isoOf(x.created_at)!,
          summary: lines.map((l) => `${l.quantity} × ${l.name}`).join(" + "),
          scenario: String(x.writer) === "scenario",
          ...(x.door ? { door: String(x.door), doorText: doorText(String(x.door)) } : {}),
        };
      }),
    };
  }

  async kitchens(): Promise<KitchenItem[]> {
    const r = await this.q(`SELECT org_id, max(org_name) AS name, bool_or(writer = 'scenario') AS scenario FROM ${this.schema}.gate_mandate GROUP BY org_id ORDER BY name`);
    return r.rows.map((x) => ({ orgId: String(x.org_id), name: String(x.name), scenario: x.scenario === true }));
  }

  async orderBody(orderId: string): Promise<OrderBody | undefined> {
    const r = await this.q(`SELECT body FROM ${this.schema}.gate_order_body WHERE order_id = $1`, [orderId]);
    return r.rows[0]?.body as OrderBody | undefined;
  }

  async orderOwner(orderId: string): Promise<string | undefined> {
    const r = await this.q(`SELECT org_id FROM ${this.schema}.gate_order_body WHERE order_id = $1`, [orderId]);
    return r.rows[0] ? String(r.rows[0].org_id) : undefined;
  }

  async latestOrderOfRequest(requestId: string): Promise<string | undefined> {
    const r = await this.q(`SELECT order_id FROM ${this.schema}.gate_order WHERE request_id = $1 AND upper_inf(during) ORDER BY created_at DESC LIMIT 1`, [requestId]);
    return r.rows[0] ? String(r.rows[0].order_id) : undefined;
  }

  async loadWritten(writer: string): Promise<Map<TableName, Map<string, Row>>> {
    const out = new Map<TableName, Map<string, Row>>();
    for (const t of TABLE_ORDER) {
      const cols = t === "gate_order_body" ? SPECS[t].key : allColumns(t);
      const where = t === "gate_order_body" ? "writer = $1" : "writer = $1 AND upper_inf(during)";
      const { rows } = await this.q(`SELECT ${cols.join(", ")} FROM ${this.schema}.${t} WHERE ${where}`, [writer]);
      out.set(t, new Map(rows.map((r) => [keyOf(t, plain(r)), plain(r)])));
    }
    return out;
  }

  /** One transaction. A change closes the current version's range at `at` and opens the next one there. */
  async apply(writes: Write[], writer: string, at: Date = new Date()): Promise<void> {
    if (!writes.length) return;
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      for (const w of writes) await this.write(c, w, writer, at.toISOString());
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private async write(c: PoolClient, w: Write, writer: string, at: string): Promise<void> {
    const s = this.schema;
    const spec = SPECS[w.table];
    const key = spec.key.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
    const keyParams = spec.key.map((k) => w.row[k]);
    if (w.table === "gate_order_body") {
      if (w.op !== "insert") return;
      const cols = [...allColumns(w.table), "writer"];
      await c.query(`INSERT INTO ${s}.gate_order_body (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (order_id) DO NOTHING`, cols.map((col) => (col === "writer" ? writer : bind(w.table, col, w.row[col]))));
      return;
    }
    const insert = async (row: Row) => {
      const cols = allColumns(w.table);
      const n = cols.length;
      // INSERT IGNORE's meaning: a current row another writer keeps is never overwritten.
      await c.query(
        `INSERT INTO ${s}.${w.table} (${cols.join(", ")}, writer, during)
         SELECT ${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${n + 1}, tstzrange($${n + 2}::timestamptz, NULL)
         WHERE NOT EXISTS (SELECT 1 FROM ${s}.${w.table} WHERE ${spec.key.map((k) => `${k} = $${cols.indexOf(k) + 1}`).join(" AND ")} AND upper_inf(during))`,
        [...cols.map((col) => bind(w.table, col, row[col])), writer, at],
      );
    };
    if (w.op === "insert") return insert(w.row);
    const n = keyParams.length;
    if (w.op === "touch") {
      await c.query(`UPDATE ${s}.${w.table} SET ${w.cols.map((col, i) => `${col} = $${n + i + 1}`).join(", ")} WHERE ${key} AND writer = $${n + w.cols.length + 1} AND upper_inf(during)`, [...keyParams, ...w.cols.map((col) => bind(w.table, col, w.row[col])), writer]);
      return;
    }
    // Close the version in force: its range ends now (an empty range when it began this same instant).
    const closed = await c.query(`UPDATE ${s}.${w.table} SET during = tstzrange(lower(during), greatest(lower(during), $${n + 2}::timestamptz)) WHERE ${key} AND writer = $${n + 1} AND upper_inf(during) RETURNING *`, [...keyParams, writer, at]);
    if (w.op === "delete" || !closed.rows[0]) return;
    const prev = plain(closed.rows[0]);
    await insert({ ...prev, ...Object.fromEntries(w.cols.map((col) => [col, w.row[col]])) });
  }

  async getMeta(key: string): Promise<string | undefined> {
    const r = await this.q(`SELECT value FROM ${this.schema}.history_meta WHERE key = $1`, [key]);
    return r.rows[0] ? String(r.rows[0].value) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.schema}.history_meta (key, value, at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = excluded.at`, [key, value]);
  }

  async clearWriter(writer: string): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      for (const t of TABLE_ORDER) await c.query(`DELETE FROM ${this.schema}.${t} WHERE writer = $1`, [writer]);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {}
}

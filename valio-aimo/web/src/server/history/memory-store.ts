import type { RecentOrder } from "@/core/policy";
import type { OrderListItem, RuleRow, Shown } from "../mariadb/history";
import { keyOf, type OrderBody, type Row, type TableName, type Write } from "../mariadb/rows";
import { doorText } from "../mariadb/words";
import { RULE_TABLES, ruleOf, type HistoryStore, type KitchenItem, type MomentRow } from "./store";

/**
 * The memory backend: the same versioned rows the database backends keep, in this process. Each version has the
 * moment it came into force and the moment it stopped (open while current); "as of t" is since <= t < until, the
 * same half-open interval as MariaDB's ROW_START/ROW_END and PostgreSQL's tstzrange '[)'. Filled by the same mirror,
 * from the ledger at start (backfill.ts) and as the server runs; gone when the process ends.
 */
type Version = { key: string; row: Row; writer: string; since: number; until?: number };

const iso = (ms: number) => new Date(ms).toISOString();
const t = (s: string) => Date.parse(s);
const shown = <T>(rows: T, filter: string, params: unknown[], t0: number): Shown<T> => ({ rows, sql: filter, params, ms: performance.now() - t0 });

export class MemoryStore implements HistoryStore {
  readonly backend = "memory" as const;
  readonly display = "this process";
  private readonly tables = new Map<TableName, Version[]>();
  private readonly bodies = new Map<string, { row: Row; writer: string }>();
  private readonly meta = new Map<string, string>();

  async ensure(): Promise<void> {}

  private versions(table: TableName): Version[] {
    let v = this.tables.get(table);
    if (!v) this.tables.set(table, (v = []));
    return v;
  }

  private rules(filter: (v: Version) => boolean, orgId: string): RuleRow[] {
    const out: RuleRow[] = [];
    for (const table of RULE_TABLES) {
      for (const v of this.versions(table)) {
        if (!filter(v)) continue;
        const r = ruleOf(table, v.row)!;
        if (r.orgId !== orgId && r.orgId !== "*") continue;
        out.push({ ...r, since: iso(v.since), ...(v.until !== undefined ? { until: iso(v.until) } : {}) });
      }
    }
    return out;
  }

  async rulesAsOf(orgId: string, at: string): Promise<Shown<RuleRow[]>> {
    const t0 = performance.now();
    const x = t(at);
    const rows = this.rules((v) => v.since <= x && (v.until === undefined || x < v.until), orgId)
      .filter((r) => r.inForce)
      .sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
    return shown(rows, "In memory: every gate_rules version with since <= $1 < until (or still open), org_id in ($2, '*'), in force", [at, orgId], t0);
  }

  async versionsBetween(orgId: string, from: string, to: string): Promise<Shown<RuleRow[]>> {
    const t0 = performance.now();
    const a = t(from);
    const b = t(to);
    const rows = this.rules((v) => v.since < b && (v.until === undefined || v.until > a), orgId).sort((x, y) => x.area.localeCompare(y.area) || x.item.localeCompare(y.item) || x.since.localeCompare(y.since));
    return shown(rows, "In memory: every gate_rules version in force at some moment in [$1, $2): since < $2 and until > $1", [from, to, orgId], t0);
  }

  async moments(orgId: string): Promise<Shown<MomentRow[]>> {
    const t0 = performance.now();
    const rows = this.rules(() => true, orgId)
      .sort((a, b) => a.since.localeCompare(b.since))
      .map((r) => ({ area: r.area, item: r.item, inForce: r.inForce, by: r.changedBy, at: r.since }));
    return shown(rows, "In memory: the start of every gate_rules version, org_id in ($1, '*')", [orgId], t0);
  }

  async recentOrdersAsOf(orgId: string, at: string, excludeOrderId: string): Promise<Shown<RecentOrder[]>> {
    const t0 = performance.now();
    const x = t(at);
    const rows = this.versions("gate_order")
      .filter((v) => v.since <= x && (v.until === undefined || x < v.until))
      .map((v) => v.row)
      .filter((r) => r.org_id === orgId && r.order_id !== excludeOrderId && (r.status === "committed" || r.status === "pending_approval"))
      .filter((r) => {
        const c = t(String(r.created_at));
        return c > x - 86_400_000 && c <= x;
      })
      .map((r) => ({
        orderId: String(r.order_id),
        requestId: String(r.request_id),
        placedAt: new Date(t(String(r.created_at))).toISOString(),
        totalCents: Number(r.total_cents),
        categories: r.categories as string[],
        deliveryDates: r.delivery_dates as string[],
        authorisedBy: String(r.authorised_by) as RecentOrder["authorisedBy"],
      }));
    return shown(rows, "In memory: gate_order versions in force at $1, org_id = $2, not $3, placed in the 24 hours before $1, committed or waiting", [at, orgId, excludeOrderId], t0);
  }

  async listOrders(limit = 300): Promise<Shown<OrderListItem[]>> {
    const t0 = performance.now();
    const rows = this.versions("gate_order")
      .filter((v) => v.until === undefined)
      .map((v) => {
        const body = this.bodies.get(String(v.row.order_id))?.row.body as OrderBody | undefined;
        const r = v.row;
        return {
          orderId: String(r.order_id),
          orgId: String(r.org_id),
          orgName: body?.orgName ?? String(r.org_id),
          agentId: String(r.agent_id),
          status: String(r.status),
          outcome: String(r.outcome),
          totalCents: Number(r.total_cents),
          createdAt: new Date(t(String(r.created_at))).toISOString(),
          summary: (body?.lines ?? []).map((l) => `${l.quantity} × ${l.name}`).join(" + "),
          scenario: v.writer === "scenario",
          ...(body?.door ? { door: body.door, doorText: doorText(body.door) } : {}),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return shown(rows, "In memory: the current gate_order rows with their bodies, newest first", [limit], t0);
  }

  async kitchens(): Promise<KitchenItem[]> {
    const byOrg = new Map<string, KitchenItem>();
    for (const v of this.versions("gate_mandate")) {
      const id = String(v.row.org_id);
      const k = byOrg.get(id) ?? { orgId: id, name: String(v.row.org_name), scenario: false };
      if (String(v.row.org_name) > k.name) k.name = String(v.row.org_name);
      if (v.writer === "scenario") k.scenario = true;
      byOrg.set(id, k);
    }
    return [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async orderBody(orderId: string): Promise<OrderBody | undefined> {
    return this.bodies.get(orderId)?.row.body as OrderBody | undefined;
  }

  async orderOwner(orderId: string): Promise<string | undefined> {
    const b = this.bodies.get(orderId);
    return b ? String(b.row.org_id) : undefined;
  }

  async latestOrderOfRequest(requestId: string): Promise<string | undefined> {
    return this.versions("gate_order")
      .filter((v) => v.until === undefined && v.row.request_id === requestId)
      .sort((a, b) => String(b.row.created_at).localeCompare(String(a.row.created_at)))[0]?.row.order_id as string | undefined;
  }

  async loadWritten(writer: string): Promise<Map<TableName, Map<string, Row>>> {
    const out = new Map<TableName, Map<string, Row>>();
    for (const [table, vs] of this.tables) out.set(table, new Map(vs.filter((v) => v.until === undefined && v.writer === writer).map((v) => [v.key, v.row])));
    out.set("gate_order_body", new Map([...this.bodies.entries()].filter(([, b]) => b.writer === writer).map(([id, b]) => [id, { order_id: b.row.order_id }])));
    for (const t of ["gate_mandate", "gate_kitchen_rule", "gate_product_hold", "gate_suspension", "gate_budget", "gate_order"] as TableName[]) if (!out.has(t)) out.set(t, new Map());
    return out;
  }

  async apply(writes: Write[], writer: string, at: Date = new Date()): Promise<void> {
    const now = at.getTime();
    for (const w of writes) {
      const key = keyOf(w.table, w.row);
      if (w.table === "gate_order_body") {
        if (w.op === "insert" && !this.bodies.has(key)) this.bodies.set(key, { row: structuredClone(w.row), writer });
        continue;
      }
      const vs = this.versions(w.table);
      const current = vs.find((v) => v.key === key && v.until === undefined && (w.op === "insert" || v.writer === writer));
      if (w.op === "insert") {
        if (!current) vs.push({ key, row: structuredClone(w.row), writer, since: now }); // INSERT IGNORE: another writer's row stays
        continue;
      }
      if (!current) continue;
      if (w.op === "delete") {
        current.until = now;
        continue;
      }
      const merged = { ...current.row, ...Object.fromEntries(w.cols.map((c) => [c, structuredClone(w.row[c])])) };
      if (w.op === "touch") current.row = merged;
      else if (current.since >= now) current.row = merged; // two changes in one instant: one version
      else {
        current.until = now;
        vs.push({ key, row: merged, writer, since: now });
      }
    }
  }

  async getMeta(key: string): Promise<string | undefined> {
    return this.meta.get(key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  async clearWriter(writer: string): Promise<void> {
    for (const [table, vs] of this.tables) this.tables.set(table, vs.filter((v) => v.writer !== writer));
    for (const [id, b] of this.bodies) if (b.writer === writer) this.bodies.delete(id);
  }

  async close(): Promise<void> {}

  /** How many versions are kept, for the page's measurements. */
  counts(): Record<string, number> {
    return Object.fromEntries([...this.tables.entries()].map(([k, v]) => [k, v.length]));
  }
}

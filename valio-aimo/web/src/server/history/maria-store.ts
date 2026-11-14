import type { Maria } from "../mariadb/client";
import { kitchens, listOrders, moments, orderBodyOf, recentOrdersAsOf, rulesAsOf, versionsBetween } from "../mariadb/history";
import { statement } from "../mariadb/mirror";
import { SPECS, TABLE_ORDER, allColumns, keyOf, type Row, type TableName, type Write } from "../mariadb/rows";
import { ensureSchema } from "../mariadb/schema";
import type { HistoryStore } from "./store";

/** The MariaDB backend: system-versioned tables, FOR SYSTEM_TIME (mariadb/history.ts holds the statements). */
export class MariaStore implements HistoryStore {
  readonly backend = "mariadb" as const;
  readonly display: string;

  constructor(readonly db: Maria) {
    this.display = db.config.display;
  }

  ensure = () => ensureSchema(this.db);
  rulesAsOf = (orgId: string, at: string) => rulesAsOf(this.db, orgId, at);
  versionsBetween = (orgId: string, from: string, to: string) => versionsBetween(this.db, orgId, from, to);
  moments = (orgId: string) => moments(this.db, orgId);
  recentOrdersAsOf = (orgId: string, at: string, excludeOrderId: string) => recentOrdersAsOf(this.db, orgId, at, excludeOrderId);
  listOrders = (limit?: number) => listOrders(this.db, limit);
  kitchens = () => kitchens(this.db);
  orderBody = (orderId: string) => orderBodyOf(this.db, orderId);

  async orderOwner(orderId: string): Promise<string | undefined> {
    const r = await this.db.query("SELECT org_id FROM gate_order_body WHERE order_id = ?", [orderId]);
    return r.rows[0] ? String(r.rows[0].org_id) : undefined;
  }

  async latestOrderOfRequest(requestId: string): Promise<string | undefined> {
    const r = await this.db.query("SELECT order_id FROM gate_order WHERE request_id = ? ORDER BY created_at DESC LIMIT 1", [requestId]);
    return r.rows[0] ? String(r.rows[0].order_id) : undefined;
  }

  async loadWritten(writer: string): Promise<Map<TableName, Map<string, Row>>> {
    await ensureSchema(this.db);
    const out = new Map<TableName, Map<string, Row>>();
    for (const t of TABLE_ORDER) {
      // Only the columns the planner compares: the order bodies are written once and never re-read.
      const cols = t === "gate_order_body" ? SPECS[t].key : allColumns(t);
      const { rows } = await this.db.query<Row>(`SELECT ${cols.join(", ")} FROM ${t} WHERE writer = ?`, [writer]);
      out.set(t, new Map(rows.map((r) => [keyOf(t, r), r])));
    }
    return out;
  }

  /** One transaction; `at` sets the session's @@timestamp, the MariaDB-documented way to give rows a past ROW_START. */
  async apply(writes: Write[], writer: string, at?: Date): Promise<void> {
    const conn = await this.db.pool.getConnection();
    try {
      if (at) await conn.query("SET @@timestamp = ?", [at.getTime() / 1000]);
      await conn.beginTransaction();
      for (const w of writes) {
        const { sql, params } = statement(w, writer);
        await conn.query(sql, params);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      if (at) await conn.query("SET @@timestamp = DEFAULT").catch(() => undefined);
      await conn.release();
    }
  }

  async getMeta(key: string): Promise<string | undefined> {
    const r = await this.db.query("SELECT note FROM mirror_meta WHERE writer = ?", [`meta:${key}`]);
    return r.rows[0]?.note === null || r.rows[0]?.note === undefined ? undefined : String(r.rows[0].note);
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.query("INSERT INTO mirror_meta (writer, note, last_ok_at) VALUES (?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE note = VALUES(note), last_ok_at = VALUES(last_ok_at)", [`meta:${key}`, value.slice(0, 600)]);
  }

  async clearWriter(): Promise<void> {
    throw new Error("MariaDB keeps its history itself; the time machine never rebuilds it from the ledger.");
  }

  close = () => this.db.close();
}

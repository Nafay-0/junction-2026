import type { Pool } from "pg";

/** Fields a lookup may filter on. org and approval are real (generated) columns; the others are indexed expressions. */
export type DocFilter = { orgId?: string; approvalId?: string; approverId?: string; role?: string };

/**
 * Documents in `<schema>.docs`, keyed by (collection, id). Thin on purpose: the core's record types are stored as
 * they are, so a change to them needs no migration. Every call is one statement (no transaction held open).
 */
export class PgDocs {
  private readonly t: string;

  constructor(
    readonly pool: Pool,
    readonly schema: string,
  ) {
    this.t = `${schema}.docs`;
  }

  async put(collection: string, id: string, doc: unknown, expiresAt?: Date | number | string): Promise<void> {
    await this.pool.query(
      `insert into ${this.t} (collection, id, doc, expires_at) values ($1, $2, $3::jsonb, $4)
       on conflict (collection, id) do update set doc = excluded.doc, expires_at = excluded.expires_at, updated_at = now()`,
      [collection, id, JSON.stringify(doc), toDate(expiresAt)],
    );
  }

  /** Insert only if absent (seeding). Returns true when inserted. */
  async putIfAbsent(collection: string, id: string, doc: unknown, expiresAt?: Date | number | string): Promise<boolean> {
    const r = await this.pool.query(
      `insert into ${this.t} (collection, id, doc, expires_at) values ($1, $2, $3::jsonb, $4) on conflict (collection, id) do nothing`,
      [collection, id, JSON.stringify(doc), toDate(expiresAt)],
    );
    return r.rowCount === 1;
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const r = await this.pool.query<{ doc: T }>(`select doc from ${this.t} where collection = $1 and id = $2`, [collection, id]);
    return r.rows[0]?.doc;
  }

  async find<T>(collection: string, filter: DocFilter = {}, opts: { limit?: number; unexpired?: boolean } = {}): Promise<T[]> {
    const where = ["collection = $1"];
    const args: unknown[] = [collection];
    const add = (sql: string, v: unknown) => {
      args.push(v);
      where.push(sql.replace("?", `$${args.length}`));
    };
    if (filter.orgId !== undefined) add("org_id = ?", filter.orgId);
    if (filter.approvalId !== undefined) add("approval_id = ?", filter.approvalId);
    if (filter.approverId !== undefined) add("doc->>'approverId' = ?", filter.approverId);
    if (filter.role !== undefined) add("doc->>'role' = ?", filter.role);
    if (opts.unexpired) where.push("(expires_at is null or expires_at > now())");
    const limit = opts.limit ? ` limit ${Math.floor(opts.limit)}` : "";
    const r = await this.pool.query<{ doc: T }>(`select doc from ${this.t} where ${where.join(" and ")} order by created_at, id${limit}`, args);
    return r.rows.map((x) => x.doc);
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`delete from ${this.t} where collection = $1 and id = $2`, [collection, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async deleteWhere(collection: string, filter: DocFilter): Promise<number> {
    if (filter.approverId === undefined) throw new Error("deleteWhere needs approverId");
    const r = await this.pool.query(`delete from ${this.t} where collection = $1 and doc->>'approverId' = $2`, [collection, filter.approverId]);
    return r.rowCount ?? 0;
  }

  /** Get and delete in one statement: the second caller with the same id gets nothing. */
  async take<T>(collection: string, id: string): Promise<T | undefined> {
    const r = await this.pool.query<{ doc: T }>(`delete from ${this.t} where collection = $1 and id = $2 returning doc`, [collection, id]);
    return r.rows[0]?.doc;
  }

  /** Delete expired documents of a collection; returns how many are left. */
  async sweep(collection: string, nowMs: number): Promise<number> {
    const r = await this.pool.query<{ left: string }>(
      `with gone as (delete from ${this.t} where collection = $1 and expires_at <= $2 returning 1)
       select (select count(*) from ${this.t} where collection = $1) - (select count(*) from gone) as left`,
      [collection, new Date(nowMs)],
    );
    return Number(r.rows[0]?.left ?? 0);
  }
}

function toDate(v: Date | number | string | undefined): Date | null {
  if (v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

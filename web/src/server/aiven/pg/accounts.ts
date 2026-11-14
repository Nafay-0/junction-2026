import type { Pool } from "pg";
import type { Account, AccountLink, AccountSession, AccountStore } from "@/server/accounts/store";

/**
 * Accounts and sessions in PostgreSQL (tables in schema.ts). The username is the primary key, so "this username is
 * taken" is one atomic insert; a session row holds only the SHA-256 of its token and is deleted with its account.
 */
export class PgAccountStore implements AccountStore {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  private get a() {
    return `${this.schema}.accounts`;
  }
  private get s() {
    return `${this.schema}.account_sessions`;
  }

  async create(a: Account) {
    const r = await this.pool.query(`insert into ${this.a} (username, kind, doc, created_at) values ($1, $2, $3::jsonb, $4) on conflict (username) do nothing`, [a.username, a.kind, JSON.stringify(a), a.createdAt]);
    return r.rowCount === 1;
  }
  async get(username: string) {
    const r = await this.pool.query<{ doc: Account }>(`select doc from ${this.a} where username = $1`, [username]);
    return r.rows[0]?.doc;
  }
  async put(a: Account) {
    await this.pool.query(
      `insert into ${this.a} (username, kind, doc, created_at) values ($1, $2, $3::jsonb, $4)
       on conflict (username) do update set kind = excluded.kind, doc = excluded.doc, updated_at = now()`,
      [a.username, a.kind, JSON.stringify(a), a.createdAt],
    );
  }
  async list() {
    const r = await this.pool.query<{ doc: Account }>(`select doc from ${this.a} order by created_at, username`);
    return r.rows.map((x) => x.doc);
  }
  async delete(username: string) {
    await this.pool.query(`delete from ${this.a} where username = $1`, [username]); // sessions cascade
  }
  async putSession(tokenHash: string, s: AccountSession) {
    await this.pool.query(`insert into ${this.s} (token_hash, username, expires_at, created_at) values ($1, $2, $3, $4) on conflict (token_hash) do nothing`, [tokenHash, s.username, s.expiresAt, s.createdAt]);
  }
  async getSession(tokenHash: string) {
    const r = await this.pool.query<{ username: string; expires_at: Date; created_at: Date }>(`select username, expires_at, created_at from ${this.s} where token_hash = $1`, [tokenHash]);
    const row = r.rows[0];
    return row && { username: row.username, expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString() };
  }
  async deleteSession(tokenHash: string) {
    await this.pool.query(`delete from ${this.s} where token_hash = $1`, [tokenHash]);
  }
  async deleteSessionsOf(username: string) {
    await this.pool.query(`delete from ${this.s} where username = $1`, [username]);
  }
  async sweepSessions(now: Date) {
    await this.pool.query(`delete from ${this.s} where expires_at <= $1`, [now]);
    await this.pool.query(`delete from ${this.l} where expires_at <= $1`, [now]);
  }
  private get l() {
    return `${this.schema}.account_links`;
  }
  async putLink(tokenHash: string, l: AccountLink) {
    await this.pool.query(`insert into ${this.l} (token_hash, username, purpose, expires_at, created_at) values ($1, $2, $3, $4, $5) on conflict (token_hash) do nothing`, [tokenHash, l.username, l.purpose, l.expiresAt, l.createdAt]);
  }
  private row(r?: { username: string; purpose: AccountLink["purpose"]; expires_at: Date; created_at: Date }): AccountLink | undefined {
    return r && { username: r.username, purpose: r.purpose, expiresAt: new Date(r.expires_at).toISOString(), createdAt: new Date(r.created_at).toISOString() };
  }
  async getLink(tokenHash: string) {
    const r = await this.pool.query(`select username, purpose, expires_at, created_at from ${this.l} where token_hash = $1`, [tokenHash]);
    return this.row(r.rows[0]);
  }
  async takeLink(tokenHash: string) {
    const r = await this.pool.query(`delete from ${this.l} where token_hash = $1 returning username, purpose, expires_at, created_at`, [tokenHash]);
    return this.row(r.rows[0]);
  }
}

import type { Pool } from "pg";
import { verifyLedger, type LedgerEntry, type LedgerStore, type LedgerVerification } from "@/core/ledger";
import { canonicalJson } from "@/core/util";
import { errMessage, log } from "../env";
import { metrics } from "../metrics";

export type LedgerSqlVerification = { ok: boolean; length: number; headSeq: number | null; headHash: string | null; brokenAt: number | null; problem: string | null };

/** What Ledger.hashOf hashes, as the exact text stored in the `body` column. */
export function ledgerBody(e: LedgerEntry): string {
  const { seq, at, type, actor, summary, requestId, orderId, data, prevHash } = e;
  return canonicalJson({ seq, at, type, actor, summary, requestId, orderId, data, prevHash });
}

/**
 * The hash-chained ledger in PostgreSQL. The core's LedgerStore is synchronous (append returns nothing, all()
 * returns the array), so this store keeps the chain in memory, loaded from the table at start, and writes each
 * entry to the table in order right behind it (one batched insert per round, retried on connection errors).
 * The table enforces the chain itself (see schema.ts), so a second writer that forks the chain is refused
 * there, and this store then stops writing and reports `diverged` in the health check.
 *
 * Trade-off: an entry is durable a few milliseconds after the call that wrote it returns. `flush()` waits for
 * the queue to drain; the shutdown hook calls it.
 */
export class PgLedgerStore implements LedgerStore {
  private readonly items: LedgerEntry[];
  private readonly queue: LedgerEntry[] = [];
  private running: Promise<void> | null = null;
  private diverged: string | null = null;
  private lastError: string | null = null;
  private written = 0;
  private readonly t: string;
  readonly loaded: LedgerVerification;

  private constructor(
    private readonly pool: Pool,
    readonly schema: string,
    entries: LedgerEntry[],
  ) {
    this.items = entries;
    this.t = `${schema}.ledger`;
    this.loaded = verifyLedger(entries);
    if (!this.loaded.ok) log("error", "ledger in PostgreSQL does not verify", { problem: this.loaded.problem, brokenAt: this.loaded.brokenAt });
  }

  /** Load the chain from the table. */
  static async open(pool: Pool, schema: string): Promise<PgLedgerStore> {
    const r = await pool.query<{ body: string; hash: string }>(`select body, hash from ${schema}.ledger order by seq`);
    const entries = r.rows.map((row) => ({ ...(JSON.parse(row.body) as Omit<LedgerEntry, "hash">), hash: row.hash }) as LedgerEntry);
    return new PgLedgerStore(pool, schema, entries);
  }

  append(entry: LedgerEntry): void {
    const copy = structuredClone(entry);
    this.items.push(copy);
    if (this.diverged) return; // already reported; the in-memory chain keeps working for this process
    this.queue.push(copy);
    this.kick();
  }

  all(): readonly LedgerEntry[] {
    return this.items;
  }

  pending(): number {
    return this.queue.length;
  }

  status() {
    return { length: this.items.length, written: this.written, pending: this.queue.length, diverged: this.diverged, lastError: this.lastError };
  }

  /** Wait until every appended entry is in the table (or the timeout passes). Returns true when drained. */
  async flush(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while ((this.queue.length || this.running) && !this.diverged && Date.now() < deadline) {
      if (!this.running) this.kick();
      await Promise.race([this.running, new Promise((r) => setTimeout(r, 50))]);
    }
    return this.queue.length === 0;
  }

  /** The chain re-checked by PostgreSQL itself (`<schema>.ledger_verify()`). */
  async verifyInDatabase(): Promise<LedgerSqlVerification> {
    const r = await this.pool.query<{ ok: boolean; length: string; head_seq: string | null; head_hash: string | null; broken_at: string | null; problem: string | null }>(
      `select * from ${this.schema}.ledger_verify()`,
    );
    const x = r.rows[0];
    const n = (v: string | null) => (v === null ? null : Number(v));
    return { ok: x.ok, length: Number(x.length), headSeq: n(x.head_seq), headHash: x.head_hash, brokenAt: n(x.broken_at), problem: x.problem };
  }

  private kick(): void {
    if (this.running || this.diverged) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.queue.length && !this.diverged) setTimeout(() => this.kick(), 0);
    });
  }

  private async drain(): Promise<void> {
    let delay = 250;
    while (this.queue.length && !this.diverged) {
      const batch = this.queue.slice(0, 100);
      try {
        await this.insert(batch);
        this.queue.splice(0, batch.length);
        this.written += batch.length;
        this.lastError = null;
        delay = 250;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505" || code === "23514") {
          // Duplicate seq or broken link: either our own earlier insert did land (lost reply), or another writer.
          const landed = await this.alreadyLanded(batch).catch(() => 0);
          if (landed > 0) {
            this.queue.splice(0, landed);
            this.written += landed;
            continue;
          }
          this.diverged = `entry ${batch[0].seq}: ${errMessage(err)}`;
          log("error", "ledger write refused by the chain constraints; another process is writing the same ledger", { seq: batch[0].seq, error: errMessage(err) });
          return;
        }
        this.lastError = errMessage(err);
        metrics.inc("pg.write_retry");
        log("warn", "ledger write failed, retrying", { pending: this.queue.length, error: this.lastError, retryInMs: delay });
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 5_000);
      }
    }
  }

  private async insert(batch: LedgerEntry[]): Promise<void> {
    const values: unknown[] = [];
    const rows = batch.map((e, i) => {
      values.push(e.seq, e.at, e.type, e.actor, e.requestId ?? null, e.orderId ?? null, ledgerBody(e), e.prevHash, e.hash);
      const b = i * 9;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });
    await this.pool.query(`insert into ${this.t} (seq, at, type, actor, request_id, order_id, body, prev_hash, hash) values ${rows.join(", ")}`, values);
  }

  /** How many leading entries of the batch are already in the table with the same hash. */
  private async alreadyLanded(batch: LedgerEntry[]): Promise<number> {
    const r = await this.pool.query<{ seq: string; hash: string }>(`select seq, hash from ${this.t} where seq = any($1::bigint[])`, [batch.map((e) => e.seq)]);
    const byseq = new Map(r.rows.map((x) => [Number(x.seq), x.hash]));
    let n = 0;
    for (const e of batch) {
      if (byseq.get(e.seq) !== e.hash) break;
      n++;
    }
    return n;
  }
}

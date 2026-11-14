import type { HistoryStore } from "../history/store";
import { SPECS, allColumns, bindValue, collectRows, keyOf, planWrites, TABLE_ORDER, type GateSources, type Row, type TableName, type Write } from "./rows";

/**
 * The mirror: copies what the gate reads into the history store (MariaDB's system-versioned tables, PostgreSQL's
 * ranges or this process's memory: history/store.ts), after the fact. It is told that
 * something may have changed (`poke`, from taps on the ledger, the kitchen store and the mandate check), waits a
 * moment so a burst of changes is one transaction, reads the app's state, and writes only what differs, with
 * ordinary INSERT, UPDATE and DELETE statements. MariaDB keeps the history.
 *
 * Never in the path of an order: `poke` returns at once and never throws, a failed write is retried on the next poke
 * or tick, and the page reads `status()` to say how far behind the mirror is.
 *
 * `sessionClock` exists for the seeded scenario only: it sets the session's @@timestamp before each write, the
 * MariaDB-documented way to give rows a ROW_START in the past, so three weeks of rule changes can be seeded in a
 * second. The app's live mirror never sets it: its history is stamped by the server's own clock.
 */
export type MirrorStatus = {
  writer: string;
  /** Last time every change seen had been written. */
  lastOkAt?: string;
  /** A change seen and not written yet (since when). */
  pendingSince?: string;
  lastError?: { at: string; message: string };
  syncs: number;
  writes: { insert: number; update: number; touch: number; delete: number };
  lastSyncMs?: number;
};

export type MirrorOptions = {
  store: HistoryStore;
  writer: string;
  read: () => Promise<GateSources>;
  sessionClock?: () => Date;
  debounceMs?: number;
  /** Catch-up tick: changes nothing tapped (a hold placed by the radar's schedule, the 7-day window moving on). */
  intervalMs?: number;
  /** After each successful sync (vector.ts embeds new decisions here). Errors are kept in status, not thrown. */
  afterSync?: () => Promise<void>;
  now?: () => Date;
};

export class HistoryMirror {
  private written: Map<TableName, Map<string, Row>> | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private tick?: ReturnType<typeof setInterval>;
  private running: Promise<unknown> | undefined;
  private again = false;
  private readonly st: MirrorStatus;
  private readonly now: () => Date;

  constructor(private readonly opts: MirrorOptions) {
    this.now = opts.now ?? (() => new Date());
    this.st = { writer: opts.writer, syncs: 0, writes: { insert: 0, update: 0, touch: 0, delete: 0 } };
  }

  get store(): HistoryStore {
    return this.opts.store;
  }

  status(): MirrorStatus {
    return structuredClone(this.st);
  }

  /** Something may have changed. Never throws, never waits. */
  poke(): void {
    this.st.pendingSince ??= this.now().toISOString();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync().catch(() => undefined);
    }, this.opts.debounceMs ?? 120);
    this.timer.unref?.();
  }

  start(): this {
    if (!this.tick && (this.opts.intervalMs ?? 15_000) > 0) {
      this.tick = setInterval(() => this.poke(), this.opts.intervalMs ?? 15_000);
      this.tick.unref?.();
    }
    this.poke();
    return this;
  }

  async stop(): Promise<void> {
    if (this.tick) clearInterval(this.tick);
    if (this.timer) clearTimeout(this.timer);
    this.tick = this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** Write what differs now. Concurrent calls share one run; a call during a run schedules one more after it. */
  async sync(): Promise<{ writes: Write[] }> {
    if (this.running) {
      this.again = true;
      await this.running.catch(() => undefined);
      return this.sync();
    }
    const run = this.syncOnce();
    this.running = run;
    try {
      return await run;
    } finally {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.poke();
      }
    }
  }

  private async load(): Promise<Map<TableName, Map<string, Row>>> {
    await this.opts.store.ensure();
    return this.opts.store.loadWritten(this.opts.writer);
  }

  private async syncOnce(): Promise<{ writes: Write[] }> {
    const t0 = performance.now();
    const seenAt = this.st.pendingSince;
    try {
      this.written ??= await this.load();
      const desired = collectRows(await this.opts.read());
      const writes: Write[] = [];
      for (const t of TABLE_ORDER) {
        const w = planWrites(t, this.written.get(t)!, desired[t]);
        // An order body is written once: it is what the order was, not state.
        writes.push(...(t === "gate_order_body" ? w.filter((x) => x.op === "insert") : w));
      }
      if (writes.length) await this.apply(writes);
      for (const w of writes) {
        const m = this.written.get(w.table)!;
        if (w.op === "delete") m.delete(keyOf(w.table, w.row));
        else m.set(keyOf(w.table, w.row), w.table === "gate_order_body" ? { order_id: w.row.order_id } : w.row);
        this.st.writes[w.op] += 1;
      }
      this.st.syncs += 1;
      this.st.lastOkAt = this.now().toISOString();
      this.st.lastSyncMs = Math.round(performance.now() - t0);
      if (this.st.pendingSince === seenAt) this.st.pendingSince = undefined;
      this.st.lastError = undefined;
      if (this.opts.afterSync) {
        try {
          await this.opts.afterSync();
        } catch (err) {
          this.st.lastError = { at: this.now().toISOString(), message: `after sync: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
        }
      }
      return { writes };
    } catch (err) {
      this.written = undefined; // re-read what is there on the next try, rather than trust a half-applied run
      this.st.lastError = { at: this.now().toISOString(), message: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
      throw err;
    }
  }

  private async apply(writes: Write[]): Promise<void> {
    await this.opts.store.apply(writes, this.opts.writer, this.opts.sessionClock?.());
  }
}

/** The mirror's old name, from when MariaDB was its only home. */
export const MariaMirror = HistoryMirror;

/** One write as SQL. Inserts that meet a row another writer keeps are skipped (INSERT IGNORE): never overwritten. */
export function statement(w: Write, writer: string): { sql: string; params: unknown[] } {
  const spec = SPECS[w.table];
  const where = spec.key.map((k) => `${k} = ?`).join(" AND ");
  const keyParams = spec.key.map((k) => bindValue(w.table, k, w.row[k]));
  if (w.op === "insert") {
    const cols = [...allColumns(w.table), "writer"];
    return { sql: `INSERT IGNORE INTO ${w.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map((c) => (c === "writer" ? writer : bindValue(w.table, c, w.row[c]))) };
  }
  if (w.op === "delete") return { sql: `DELETE FROM ${w.table} WHERE ${where} AND writer = ?`, params: [...keyParams, writer] };
  return {
    sql: `UPDATE ${w.table} SET ${w.cols.map((c) => `${c} = ?`).join(", ")} WHERE ${where} AND writer = ?`,
    params: [...w.cols.map((c) => bindValue(w.table, c, w.row[c])), ...keyParams, writer],
  };
}

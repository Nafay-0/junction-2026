import type { Pool } from "pg";
import type { ActionEvent, ActionStream } from "./actions";
import { errMessage, log } from "./env";
import { metrics } from "./metrics";

/**
 * Writing action events into telemetry.events (infra/telemetry.sql), the table the Grafana dashboard reads.
 * One multi-row insert per batch; `attrs.event_id` has a unique index, so a batch delivered twice (Kafka is
 * at-least-once) is written once.
 */
export async function writeTelemetry(pool: Pool, events: ActionEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const values: unknown[] = [];
  const rows = events.map((e, i) => {
    const attrs = {
      ...(e.attrs ?? {}),
      event_id: e.eventId,
      request_id: e.requestId,
      org_id: e.orgId,
      ledger_seq: e.ledgerSeq,
      summary: e.summary,
    };
    values.push(e.at, e.source, e.kind, e.rule ?? null, e.agentId ?? null, e.orderId ?? null, typeof e.value === "number" && Number.isFinite(e.value) ? e.value : null, e.ok ?? null, JSON.stringify(attrs));
    const b = i * 9;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::jsonb)`;
  });
  const r = await pool.query(
    `insert into telemetry.events (ts, source, kind, rule, agent_id, order_id, value, ok, attrs) values ${rows.join(", ")}
     on conflict ((attrs->>'event_id')) where attrs ? 'event_id' do nothing`,
    values,
  );
  return r.rowCount ?? 0;
}

/** A metric row, written straight to telemetry.events (not through Kafka: these describe the pipeline itself). */
export async function writeMetricRows(pool: Pool, deltas: Record<string, number>, attrs: Record<string, unknown> = {}): Promise<void> {
  const entries = Object.entries(deltas).filter(([, v]) => v !== 0);
  if (!entries.length) return;
  const values: unknown[] = [];
  const rows = entries.map(([k, v], i) => {
    values.push(`metric.${k}`, v, JSON.stringify(attrs));
    return `('dock-app', $${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`;
  });
  await pool.query(`insert into telemetry.events (source, kind, value, attrs) values ${rows.join(", ")}`, values);
}

/** One infra.check row per configured service (the dashboard's "Latest infra:check" table), written by the app itself. */
export async function writeHealthRows(pool: Pool, services: { service: string; reachable: boolean | null; ms: number | null; detail: string; inUse: boolean }[]): Promise<void> {
  const rows = services.filter((s) => s.reachable !== null);
  if (!rows.length) return;
  const values: unknown[] = [];
  const sql = rows.map((s, i) => {
    values.push(s.service, s.ms, s.reachable, JSON.stringify({ detail: `${s.inUse ? "in use" : "configured, adapter off"} · ${s.detail}`.slice(0, 240), by: "dock-app" }));
    const b = i * 4;
    return `('dock-app', 'infra.check', $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
  });
  await pool.query(`insert into telemetry.events (source, kind, rule, value, ok, attrs) values ${sql.join(", ")}`, values);
}

/**
 * DOCK_ACTIONS=postgres: no Kafka, the app writes action events to telemetry.events itself, batched every
 * half second, off the request path. Same rows as the Kafka sink.
 */
export class PgActionStream implements ActionStream {
  private queue: ActionEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private written = 0;
  private lastError: string | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly maxQueue = 5_000,
  ) {}

  emit(event: ActionEvent): void {
    this.queue.push(event);
    if (this.queue.length > this.maxQueue) {
      this.queue.splice(0, this.queue.length - this.maxQueue);
      metrics.inc("events.dropped");
    }
    metrics.inc("events.published");
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, 500);
  }

  private drain(): Promise<void> {
    this.running ??= (async () => {
      while (this.queue.length) {
        const batch = this.queue.slice(0, 200);
        try {
          await writeTelemetry(this.pool, batch);
          this.queue.splice(0, batch.length);
          this.written += batch.length;
          metrics.inc("events.consumed", batch.length);
        } catch (err) {
          this.lastError = errMessage(err);
          log("warn", "telemetry write failed; will retry", { pending: this.queue.length, error: this.lastError });
          setTimeout(() => void this.drain(), 2_000);
          break;
        }
      }
    })().finally(() => (this.running = null));
    return this.running;
  }

  async flush(timeoutMs = 5_000): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await Promise.race([this.drain(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  async close(): Promise<void> {
    await this.flush();
  }

  stats() {
    return { kind: "postgres", pending: this.queue.length, written: this.written, lastError: this.lastError ?? "" };
  }
}

/**
 * Process-wide counters for the data plane: cache hits and misses, live calls saved, events published and
 * consumed, search routing. Cheap (a Map of numbers), always on, also with every adapter switched off.
 *
 * Read by the health report (`aivenHealth()`), and flushed as deltas into telemetry.events every minute by
 * the metrics flusher when PostgreSQL is configured (kind `metric.<name>`, value = increase since last flush),
 * so the Grafana "Events per minute" panel shows them next to the business events.
 */
export type CounterName =
  | "cache.hit" // a live price/availability answer served from Valkey
  | "cache.miss" // asked the partner's API
  | "cache.error" // Valkey failed; fell through to the partner
  | "budget.refused" // live lookup refused by the per-agent hourly budget
  | "events.published" // action events handed to Kafka
  | "events.dropped" // action events dropped (queue full or Kafka down too long)
  | "events.consumed" // action events written to telemetry.events by the sink
  | "bus.remote" // live events received from another process over Valkey pub/sub
  | "pg.write_retry" // a write-behind ledger insert had to be retried
  | "search.opensearch" // product search answered by OpenSearch
  | "search.fallback" // OpenSearch slow or down: answered in-process
  | "recall.memory" // smart search's recall answered from this process's memory
  | "recall.opensearch" // smart search's recall answered by OpenSearch (keyword lists and nearest vectors)
  | "recall.fallback"; // the first recall backend did not answer; the other one did

const counters = new Map<CounterName, number>();

export const metrics = {
  inc(name: CounterName, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },
  get(name: CounterName): number {
    return counters.get(name) ?? 0;
  },
  snapshot(): Record<string, number> {
    return Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
  },
  /** Tests only. */
  reset(): void {
    counters.clear();
  },
};

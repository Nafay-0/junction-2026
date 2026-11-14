/**
 * Alerts as data: a small table of thresholds, evaluated by plain code on a timer (every 30 s while the operations
 * portal is in use), each breach with the time it started. The Platform page shows "all quiet" or what is breaching
 * and since when; the operations copilot answers "is anything unhealthy?" from the same list. No paid alerting
 * service: Grafana on the free setup reads PostgreSQL, and its own alert rules are provisioned beside the dashboard
 * when the API allows (infra/grafana/provision.mjs); this table is the one the app itself holds to.
 */

export type AlertInputs = {
  /** The conversation's turns in the last 15 minutes: their lengths (s) and how many failed or timed out. */
  turnSeconds: number[];
  failedTurns: number;
  /** Smart searches in the last 15 minutes and how many were answered by the fallback recall backend. */
  searches: number;
  searchFallbacks: number;
  /** Today's model spend against the daily cap (server/limits.ts). */
  spendUsd: number;
  capUsd: number;
  /** The orders waiting for a person: the oldest one's wait in minutes. */
  oldestWaitMin: number | null;
  waiting: number;
  /** The Kafka sink's lag in messages, when Kafka is on. */
  kafkaLag: number | null;
};

export const ALERT_RULES = [
  { id: "turn_p90", title: "Conversation turns are slow", limit: 20, unit: "s, 90th percentile over 15 min", why: "A cook waiting more than 20 s for an answer stops using the agent." },
  { id: "turn_failed", title: "A conversation turn failed or timed out", limit: 0, unit: "turns in 15 min", why: "Any buyer left without an answer is worth a look." },
  { id: "search_fallback", title: "Search is answered by its fallback", limit: 0.05, unit: "share of searches in 15 min (at least 5 searches)", why: "More than 1 in 20 searches on the fallback recall backend means the primary one is slow or down." },
  { id: "model_spend", title: "Model spend is near the daily cap", limit: 0.8, unit: "of the day's cap", why: "At the cap, model calls stop: the agent falls back to ordering without a model." },
  { id: "signoff_wait", title: "An order is waiting long for a person", limit: 30, unit: "minutes, the oldest waiting sign-off", why: "The price is held for a limited time; a sign-off left waiting can miss the order cut-off." },
  { id: "kafka_lag", title: "The telemetry pipeline lags", limit: 500, unit: "messages behind on dock.actions", why: "The dashboard and the copilot read what the sink has written; a growing lag means they show an old picture." },
] as const;

export type AlertId = (typeof ALERT_RULES)[number]["id"];
export type Breach = { id: AlertId; title: string; value: number; limit: number; unit: string; detail: string };
export type AlertState = { at: string; evaluatedEveryS: number; quiet: boolean; breaches: (Breach & { since: string })[]; rules: typeof ALERT_RULES; inputs: AlertInputs };

const p90 = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};

/** Which rules breach now, from the inputs alone. */
export function evaluateAlerts(x: AlertInputs): Breach[] {
  const r = Object.fromEntries(ALERT_RULES.map((a) => [a.id, a])) as Record<AlertId, (typeof ALERT_RULES)[number]>;
  const out: Breach[] = [];
  const b = (id: AlertId, value: number, detail: string) => out.push({ id, title: r[id].title, value, limit: r[id].limit, unit: r[id].unit, detail });
  const t90 = p90(x.turnSeconds);
  if (t90 !== null && t90 > r.turn_p90.limit) b("turn_p90", Math.round(t90 * 10) / 10, `90 % of ${x.turnSeconds.length} turns ended within ${t90.toFixed(1)} s`);
  if (x.failedTurns > r.turn_failed.limit) b("turn_failed", x.failedTurns, `${x.failedTurns} turn${x.failedTurns > 1 ? "s" : ""} started and never ended`);
  if (x.searches >= 5 && x.searchFallbacks / x.searches > r.search_fallback.limit) b("search_fallback", Math.round((x.searchFallbacks / x.searches) * 1000) / 1000, `${x.searchFallbacks} of ${x.searches} searches on the fallback backend`);
  if (x.capUsd > 0 && x.spendUsd / x.capUsd >= r.model_spend.limit) b("model_spend", Math.round((x.spendUsd / x.capUsd) * 100) / 100, `$${x.spendUsd.toFixed(2)} of the $${x.capUsd} cap`);
  if (x.oldestWaitMin !== null && x.oldestWaitMin > r.signoff_wait.limit) b("signoff_wait", Math.round(x.oldestWaitMin), `${x.waiting} waiting, the oldest for ${Math.round(x.oldestWaitMin)} min`);
  if (x.kafkaLag !== null && x.kafkaLag > r.kafka_lag.limit) b("kafka_lag", x.kafkaLag, `${x.kafkaLag} messages not yet written to PostgreSQL`);
  return out;
}

/** Keeps when each breach started across evaluations: a breach that clears and returns starts again. */
export class AlertBook {
  private readonly since = new Map<AlertId, string>();
  private last?: AlertState;

  update(inputs: AlertInputs, now: Date, everyS: number): AlertState {
    const breaches = evaluateAlerts(inputs);
    const ids = new Set(breaches.map((b) => b.id));
    for (const id of [...this.since.keys()]) if (!ids.has(id)) this.since.delete(id);
    for (const b of breaches) if (!this.since.has(b.id)) this.since.set(b.id, now.toISOString());
    this.last = { at: now.toISOString(), evaluatedEveryS: everyS, quiet: breaches.length === 0, breaches: breaches.map((b) => ({ ...b, since: this.since.get(b.id)! })), rules: ALERT_RULES, inputs };
    return this.last;
  }

  current(): AlertState | undefined {
    return this.last;
  }
}

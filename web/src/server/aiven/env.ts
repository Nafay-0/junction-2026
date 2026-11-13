/**
 * Which Aiven adapters are switched on, read from the environment. Everything defaults to off: with no
 * variables set, Dock runs fully in memory (tests, a laptop with no network).
 *
 *   DOCK_STORE=postgres       orders, quotes used, approvals, kitchens, intakes, passkeys, sandboxes, ledger -> PostgreSQL
 *   DOCK_PG_SCHEMA=dock       schema for those tables (a fresh one gives an empty store, e.g. for a rehearsal)
 *   DOCK_PG_POOL_MAX=4        connections this process may hold (the free plan has 20 in total)
 *   DOCK_ACTIONS=kafka        every agent action and gate decision -> Kafka topic dock.actions -> telemetry.events
 *   DOCK_ACTIONS=postgres     same rows written straight to telemetry.events (no Kafka)
 *   DOCK_KAFKA_SINK=0         do not run the Kafka -> telemetry.events consumer in this process (a worker runs it)
 *   DOCK_CACHE=valkey         live price/availability cache and the per-agent live-lookup budget -> Valkey
 *   DOCK_BUS=valkey           live events for phones and the big screen fan out over Valkey pub/sub
 *   DOCK_SEARCH=opensearch    product search -> OpenSearch, in-process search as the fallback (see search/)
 *   DOCK_AIVEN=1              shorthand: all of the above whose service address is configured
 *
 * Addresses: DATABASE_URL, VALKEY_URL, OPENSEARCH_URL, KAFKA_BOOTSTRAP_SERVERS + KAFKA_ACCESS_KEY/CERT, KAFKA_CA_CERT
 * (the names Aiven Runtime injects for connected services).
 */

const value = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};
const on = (name: string) => /^(1|true|yes|on)$/i.test(value(name) ?? "");

export type AivenSwitches = {
  store: "memory" | "postgres";
  actions: "off" | "kafka" | "postgres";
  kafkaSink: boolean;
  cache: "memory" | "valkey";
  bus: "memory" | "valkey";
  search: "in-process" | "opensearch";
};

export function aivenSwitches(): AivenSwitches {
  // Aiven Runtime injects OPENSEARCH_URI for a connected OpenSearch service; the app reads OPENSEARCH_URL.
  if (!value("OPENSEARCH_URL") && value("OPENSEARCH_URI")) process.env.OPENSEARCH_URL = value("OPENSEARCH_URI");
  const all = on("DOCK_AIVEN");
  const pg = Boolean(value("DATABASE_URL"));
  const kafka = Boolean(kafkaConfig());
  const valkey = Boolean(value("VALKEY_URL"));
  const opensearch = Boolean(value("OPENSEARCH_URL"));
  const store = value("DOCK_STORE") ?? (all && pg ? "postgres" : "memory");
  const actions = value("DOCK_ACTIONS") ?? (all && kafka && pg ? "kafka" : all && pg ? "postgres" : "off");
  const cache = value("DOCK_CACHE") ?? (all && valkey ? "valkey" : "memory");
  const bus = value("DOCK_BUS") ?? (all && valkey ? "valkey" : "memory");
  const search = value("DOCK_SEARCH") ?? (all && opensearch ? "opensearch" : "in-process");
  const pick = <T extends string>(v: string, allowed: readonly T[], name: string): T => {
    if ((allowed as readonly string[]).includes(v)) return v as T;
    throw new Error(`${name}=${v} is not one of ${allowed.join(", ")}.`);
  };
  const s: AivenSwitches = {
    store: pick(store, ["memory", "postgres"] as const, "DOCK_STORE"),
    actions: pick(actions, ["off", "kafka", "postgres"] as const, "DOCK_ACTIONS"),
    kafkaSink: value("DOCK_KAFKA_SINK") === undefined ? true : on("DOCK_KAFKA_SINK"),
    cache: pick(cache, ["memory", "valkey"] as const, "DOCK_CACHE"),
    bus: pick(bus, ["memory", "valkey"] as const, "DOCK_BUS"),
    search: pick(search, ["in-process", "opensearch"] as const, "DOCK_SEARCH"),
  };
  const missing: string[] = [];
  if ((s.store === "postgres" || s.actions !== "off") && !pg) missing.push("DATABASE_URL");
  if (s.actions === "kafka" && !kafka) missing.push("KAFKA_BOOTSTRAP_SERVERS, KAFKA_ACCESS_KEY, KAFKA_ACCESS_CERT, KAFKA_CA_CERT");
  if ((s.cache === "valkey" || s.bus === "valkey") && !valkey) missing.push("VALKEY_URL");
  if (s.search === "opensearch" && !opensearch) missing.push("OPENSEARCH_URL");
  if (missing.length) throw new Error(`Aiven adapters switched on without their address: set ${missing.join("; ")}.`);
  return s;
}

/** Aiven URIs carry sslmode=require; node-postgres needs libpq compatibility to read that as "encrypt" (Aiven's docs do the same). */
export function pgConnectionString(): string | undefined {
  const raw = value("DATABASE_URL");
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

export function pgSchema(): string {
  const s = value("DOCK_PG_SCHEMA") ?? "dock";
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(s)) throw new Error(`DOCK_PG_SCHEMA must be a plain lower-case identifier; got ${JSON.stringify(s)}.`);
  return s;
}

export function pgPoolMax(): number {
  const n = Number.parseInt(value("DOCK_PG_POOL_MAX") ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 4;
}

export function valkeyUrl(): string | undefined {
  return value("VALKEY_URL");
}

/** PEM values arrive with literal "\n" (one-line .env) or real newlines (Aiven Runtime). */
const pem = (name: string) => value(name)?.replace(/\\n/g, "\n");

export type KafkaConfig = { brokers: string[]; ssl: { ca: string[]; cert: string; key: string } };

export function kafkaConfig(): KafkaConfig | undefined {
  const brokers = value("KAFKA_BOOTSTRAP_SERVERS");
  const key = pem("KAFKA_ACCESS_KEY");
  const cert = pem("KAFKA_ACCESS_CERT");
  const ca = pem("KAFKA_CA_CERT");
  if (!brokers || !key || !cert || !ca) return undefined;
  return { brokers: brokers.split(",").map((b) => b.trim()).filter(Boolean), ssl: { ca: [ca], cert, key } };
}

export const ACTIONS_TOPIC = value("DOCK_ACTIONS_TOPIC") ?? "dock.actions";
export const SINK_GROUP = value("DOCK_SINK_GROUP") ?? "dock-telemetry-sink";

/** Every secret-looking value we know of, so log and error text can be scrubbed. */
export function scrubSecrets(text: string): string {
  const secrets: string[] = [];
  for (const k of ["DATABASE_URL", "OPENSEARCH_URL", "VALKEY_URL"]) {
    const v = value(k);
    if (!v) continue;
    secrets.push(v);
    try {
      const u = new URL(v);
      if (u.password) secrets.push(u.password, decodeURIComponent(u.password));
    } catch {
      /* not a URL */
    }
  }
  for (const k of ["KAFKA_ACCESS_KEY", "KAFKA_ACCESS_CERT"]) {
    const v = value(k);
    if (v) secrets.push(v, v.replace(/\\n/g, "\n"));
  }
  let t = text;
  for (const s of secrets.filter((x) => x.length >= 6).sort((a, b) => b.length - a.length)) t = t.split(s).join("***");
  return t.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//***:***@");
}

/** One JSON line on stdout (Aiven Runtime captures it; Grafana shows the app log). Never carries secrets. */
export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}): void {
  const line = scrubSecrets(JSON.stringify({ at: new Date().toISOString(), level, component: "aiven", msg, ...extra }));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.log(line);
}

export function errMessage(err: unknown): string {
  return scrubSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * Where the Aiven services are, read from the environment (DATABASE_URL, VALKEY_URL, OPENSEARCH_URL,
 * KAFKA_BOOTSTRAP_SERVERS). Host names, ports and credentials stay in memory: nothing here prints them.
 * Callers print only the service name and whether it answered.
 */
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

export type ServiceName = "pg" | "valkey" | "kafka" | "opensearch";
export type Target = { service: ServiceName; host: string; port: number; ip?: string };

const value = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

function fromUrl(service: ServiceName, raw: string | undefined, defaultPort: number): Target[] {
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [{ service, host: u.hostname, port: Number(u.port || defaultPort) }];
  } catch {
    return [];
  }
}

/** The variables each service needs before a scenario can run. */
export const NEEDS: Record<ServiceName, string[]> = {
  pg: ["DATABASE_URL"],
  valkey: ["VALKEY_URL"],
  opensearch: ["OPENSEARCH_URL"],
  kafka: ["KAFKA_BOOTSTRAP_SERVERS", "KAFKA_ACCESS_KEY", "KAFKA_ACCESS_CERT", "KAFKA_CA_CERT", "DATABASE_URL"],
};

export function missingVars(service: ServiceName): string[] {
  return NEEDS[service].filter((k) => !value(k));
}

export function targets(service: ServiceName): Target[] {
  switch (service) {
    case "pg":
      return fromUrl("pg", value("DATABASE_URL"), 5432);
    case "valkey":
      return fromUrl("valkey", value("VALKEY_URL"), 6379);
    case "opensearch":
      return fromUrl("opensearch", value("OPENSEARCH_URL") ?? value("OPENSEARCH_URI"), 443);
    case "kafka":
      return (value("KAFKA_BOOTSTRAP_SERVERS") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((hp) => {
          const i = hp.lastIndexOf(":");
          return { service: "kafka" as const, host: hp.slice(0, i), port: Number(hp.slice(i + 1)) };
        });
  }
}

/** Resolve with the real resolver (before any preload patches it, which only happens in the app process). */
export async function resolveTargets(ts: Target[]): Promise<Target[]> {
  const out: Target[] = [];
  for (const t of ts) {
    const r = await lookup(t.host, { family: 4 });
    out.push({ ...t, ip: r.address });
  }
  return out;
}

/** One TCP connect, timed. Never prints the address. */
export function tcpReachable(ip: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = connect({ host: ip, port });
    const done = (ok: boolean, error?: string) => {
      s.destroy();
      resolve({ ok, ms: Date.now() - t0, error });
    };
    s.setTimeout(timeoutMs, () => done(false, "timeout"));
    s.once("connect", () => done(true));
    s.once("error", (e) => done(false, (e as NodeJS.ErrnoException).code ?? "error"));
  });
}

/** Can this machine reach the service at all? */
export async function reachability(service: ServiceName): Promise<{ service: ServiceName; configured: boolean; ok: boolean; ms?: number; error?: string }> {
  const ts = targets(service);
  if (!ts.length) return { service, configured: false, ok: false, error: "not configured" };
  try {
    const [t] = await resolveTargets(ts.slice(0, 1));
    const r = await tcpReachable(t.ip!, t.port);
    return { service, configured: true, ...r };
  } catch (err) {
    return { service, configured: true, ok: false, error: (err as NodeJS.ErrnoException).code ?? "dns" };
  }
}

/** True when a port is free on 127.0.0.1 (the proxy must listen on the service's own port). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(true));
  });
}

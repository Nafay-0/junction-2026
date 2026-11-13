import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";
import Valkey from "iovalkey";
import { SEED_PRODUCTS } from "@/core/seed";
import { clientAddress, dailyUsage } from "./limits";
import type { Runtime } from "./runtime";
import { lastIndexResolution, pgClient } from "./valio/index-store";

/**
 * What /api/health reports: the build, the catalogue, and which backing services answer. No secrets, no hosts.
 * Probes are cached for 30 s and shared by concurrent callers, so the route cannot be used to load the databases.
 */

export type BuildInfo = { commit: string; ref?: string; deployedAt?: string };

/** `.build-info.json` is written into the deploy commit by infra/aiven-deploy.mjs; DOCK_GIT_COMMIT overrides it. */
export function buildInfo(): BuildInfo {
  const fromEnv = process.env.DOCK_GIT_COMMIT?.trim();
  if (fromEnv) return { commit: fromEnv };
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), ".build-info.json");
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildInfo>;
      if (typeof j.commit === "string") return { commit: j.commit, ref: j.ref, deployedAt: j.deployedAt };
    } catch {
      /* fall through */
    }
  }
  return { commit: "unknown" };
}

type Probe = "ok" | "unreachable" | "not configured";
export type ServiceHealth = { postgres: Probe; valkey: Probe; opensearch: Probe; kafka: Probe };

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};
const pem = (k: string) => env(k)?.replace(/\\n/g, "\n");
const PROBE_MS = 3_000;
const CACHE_MS = 30_000;

const withTimeout = <T>(p: Promise<T>, ms = PROBE_MS): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref?.())]);

async function probe(configured: boolean, run: () => Promise<unknown>): Promise<Probe> {
  if (!configured) return "not configured";
  try {
    await withTimeout(run());
    return "ok";
  } catch {
    return "unreachable";
  }
}

async function postgres() {
  const client = pgClient(env("DATABASE_URL")!, PROBE_MS);
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => {});
  }
}

async function valkey() {
  const client = new Valkey(env("VALKEY_URL")!, { lazyConnect: true, connectTimeout: PROBE_MS, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null });
  client.on("error", () => {});
  try {
    await client.connect();
    if ((await client.ping()) !== "PONG") throw new Error("no PONG");
  } finally {
    client.disconnect();
  }
}

async function opensearch() {
  const url = new URL(env("OPENSEARCH_URL") ?? env("OPENSEARCH_URI")!);
  const auth = url.username ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}` : undefined;
  url.username = "";
  url.password = "";
  const res = await fetch(new URL("/_cluster/health", url), { headers: auth ? { authorization: auth } : {}, signal: AbortSignal.timeout(PROBE_MS) });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function kafka() {
  const [host, port] = env("KAFKA_BOOTSTRAP_SERVERS")!.split(",")[0].trim().split(":");
  return new Promise<void>((resolve, reject) => {
    const socket = tlsConnect({ host, port: Number(port), servername: host, key: pem("KAFKA_ACCESS_KEY"), cert: pem("KAFKA_ACCESS_CERT"), ca: pem("KAFKA_CA_CERT") }, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(PROBE_MS, () => socket.destroy(new Error("timeout")));
    socket.on("error", reject);
  });
}

async function probeAll(): Promise<ServiceHealth> {
  const [pg, vk, os, kf] = await Promise.all([
    probe(!!env("DATABASE_URL"), postgres),
    probe(!!env("VALKEY_URL"), valkey),
    probe(!!(env("OPENSEARCH_URL") ?? env("OPENSEARCH_URI")), opensearch),
    probe(!!env("KAFKA_BOOTSTRAP_SERVERS"), kafka),
  ]);
  return { postgres: pg, valkey: vk, opensearch: os, kafka: kf };
}

const g = globalThis as typeof globalThis & { __dockHealth?: { at: number; result: Promise<ServiceHealth> } };

export function serviceHealth(): Promise<ServiceHealth> {
  const now = Date.now();
  if (!g.__dockHealth || now - g.__dockHealth.at > CACHE_MS) g.__dockHealth = { at: now, result: probeAll() };
  return g.__dockHealth.result;
}

const startedAt = new Date();

/** `req`: to show the caller the address the rate limits count them under (their own address, nobody else's). */
export async function healthReport(rt: Runtime, req?: Request) {
  const src = rt.catalogSource;
  const idx = lastIndexResolution();
  const keyed = (k: string) => (env(k) ? "fixed" : "not set");
  return {
    status: "ok",
    ...(req ? { yourAddress: clientAddress(req.headers), forwardedHops: (req.headers.get("x-forwarded-for") ?? "").split(",").filter((x) => x.trim()).length } : {}),
    version: buildInfo(),
    startedAt: startedAt.toISOString(),
    catalog: {
      source: src.kind,
      products: src.kind === "valio" ? src.products : SEED_PRODUCTS.length,
      index: idx && { from: idx.from, ...("sha256" in idx ? { sha256: idx.sha256.slice(0, 16), builtAt: idx.builtAt } : {}), ...("reason" in idx ? { note: idx.reason } : {}) },
      liveApi: env("VALIO_API_KEY") ? "configured" : "not configured",
    },
    services: await serviceHealth(),
    demoLimits: dailyUsage(),
    settings: {
      publicUrl: env("DOCK_PUBLIC_URL") ?? null,
      passkeyRpId: env("DOCK_WEBAUTHN_RP_ID") ?? null,
      wholesalerKey: keyed("DOCK_WHOLESALER_JWK"),
      demoOrgKey: env("DOCK_DEMO_ORG_JWK") ? "fixed" : "public dev key",
      demoKitchenKey: env("DOCK_DEMO_KITCHEN_JWK") ? "fixed" : "public dev key",
      demoTapApproval: /^(1|true|yes|on)$/i.test(env("DOCK_DEMO_TAP_APPROVAL") ?? ""),
    },
  };
}

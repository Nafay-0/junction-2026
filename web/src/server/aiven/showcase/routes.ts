import { DockError } from "@/core/errors";
import { RateLimiter } from "@/server/limits";
import type { Runtime } from "@/server/runtime";
import type { OpsSession } from "@/server/ops/access";
import { ensureUsageFlusher } from "./writer";

/** Shared by the /ops-api/platform routes: start the usage snapshots, and a per-session rate limit. */
const limiter = new RateLimiter(2_000);

export function platformRoute(rt: Runtime, staff: OpsSession & { viewer?: true }, rule?: { name: string; limit: number; windowMs: number }): void {
  // A viewer's read starts nothing: the usage snapshots begin with the first staff visit (or the copilot).
  if (!staff.viewer) ensureUsageFlusher(rt.aiven.pool);
  if (!rule) return;
  const wait = limiter.hit(rule, staff.token);
  if (wait !== null) throw new DockError(429, "rate_limited", `Too many ${rule.name} requests from this desk; try again in ${wait} s.`);
}

export function needKafka(configured: boolean): void {
  if (!configured) throw new DockError(503, "stream_not_configured", "Kafka is not configured on this server (KAFKA_BOOTSTRAP_SERVERS and the client certificate).");
}

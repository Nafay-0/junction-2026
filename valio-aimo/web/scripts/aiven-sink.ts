/**
 * pnpm aiven:sink
 *
 * The Kafka -> telemetry.events consumer as its own process, for when the app runs with DOCK_KAFKA_SINK=0
 * (or several app instances should not each consume). Joins the consumer group `dock-telemetry-sink`, writes
 * every action event once, prints a line per minute, flushes counters to telemetry.events. Stop with Ctrl-C.
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const { kafkaConfig, errMessage } = await import("@/server/aiven/env");
  const { kafkaClient, TelemetrySink } = await import("@/server/aiven/kafka");
  const { createPool, migrate } = await import("@/server/aiven/pg/pool");
  const { pgSchema } = await import("@/server/aiven/env");
  const { metrics } = await import("@/server/aiven/metrics");
  const { writeMetricRows } = await import("@/server/aiven/telemetry-sink");
  const cfg = kafkaConfig();
  if (!cfg) throw new Error("Kafka is not configured (KAFKA_BOOTSTRAP_SERVERS, KAFKA_ACCESS_KEY, KAFKA_ACCESS_CERT, KAFKA_CA_CERT).");
  const pool = createPool(undefined, 2);
  await migrate(pool, pgSchema()); // creates the unique event-id index the sink relies on
  const sink = new TelemetrySink(kafkaClient(cfg, "dock-sink-worker"), pool);
  await sink.start();
  console.log("sink running: dock.actions -> telemetry.events");
  let last = 0;
  const timer = setInterval(() => {
    const now = metrics.get("events.consumed");
    console.log(`${new Date().toISOString()} consumed ${now - last} event(s) in the last minute (${now} total)`);
    void writeMetricRows(pool, { "events.consumed": now - last }, { by: "aiven:sink" }).catch((e) => console.warn(errMessage(e)));
    last = now;
  }, 60_000);
  const stop = async () => {
    clearInterval(timer);
    await sink.stop();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import type { Pool } from "pg";
import type { ActionEvent, ActionStream } from "./actions";
import { ACTIONS_TOPIC, SINK_GROUP, errMessage, log, type KafkaConfig } from "./env";
import { metrics } from "./metrics";
import { writeTelemetry } from "./telemetry-sink";

/**
 * Kafka as the action stream. The free plan gives 5 topics x 2 partitions and about 250 KiB/s in and out, so
 * Dock uses one topic, `dock.actions` (2 partitions, keyed by order or request), batches messages (up to 200
 * or 250 ms), and paces itself at 150 KiB/s. An event is ~0.5 KiB, so that is ~300 events/s of headroom.
 *
 * The gate never waits: emit() only pushes onto a bounded in-memory queue; a background loop sends. When Kafka
 * is down the queue holds the last 5,000 events and retries; beyond that the oldest are dropped and counted.
 */
export function kafkaClient(cfg: KafkaConfig, clientId: string): Kafka {
  return new Kafka({
    clientId,
    brokers: cfg.brokers,
    ssl: { ...cfg.ssl, rejectUnauthorized: true },
    connectionTimeout: 8_000,
    requestTimeout: 15_000,
    retry: { retries: 3, initialRetryTime: 300 },
    logLevel: logLevel.NOTHING,
  });
}

/** Create the topic if it does not exist (idempotent). */
export async function ensureTopic(kafka: Kafka, topic = ACTIONS_TOPIC): Promise<boolean> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    if ((await admin.listTopics()).includes(topic)) return false;
    return await admin.createTopics({ topics: [{ topic, numPartitions: 2, replicationFactor: -1 }], waitForLeaders: true });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export class KafkaActionStream implements ActionStream {
  private readonly producer: Producer;
  private queue: { ev: ActionEvent; bytes: string }[] = [];
  private connected: Promise<void> | null = null;
  private loop: NodeJS.Timeout | null = null;
  private sending: Promise<void> | null = null;
  private closed = false;
  private sent = 0;
  private last: string | undefined;
  private lastError: string | null = null;
  private lastSentAt: string | null = null;
  private windowStart = Date.now();
  private windowBytes = 0;

  constructor(
    private readonly kafka: Kafka,
    private readonly topic = ACTIONS_TOPIC,
    private readonly opts: { maxQueue?: number; batch?: number; lingerMs?: number; bytesPerSecond?: number } = {},
  ) {
    this.producer = kafka.producer({ allowAutoTopicCreation: false, retry: { retries: 2 } });
  }

  private connect(): Promise<void> {
    this.connected ??= ensureTopic(this.kafka, this.topic)
      .catch((err) => log("warn", "could not check or create the Kafka topic", { topic: this.topic, error: errMessage(err) }))
      .then(() => this.producer.connect())
      .catch((err) => {
        this.connected = null; // try again on the next round
        throw err;
      });
    return this.connected;
  }

  emit(ev: ActionEvent): void {
    if (this.closed) return;
    this.queue.push({ ev, bytes: JSON.stringify(ev) });
    const max = this.opts.maxQueue ?? 5_000;
    if (this.queue.length > max) {
      const n = this.queue.length - max;
      this.queue.splice(0, n);
      metrics.inc("events.dropped", n);
    }
    this.loop ??= setTimeout(() => {
      this.loop = null;
      void this.send();
    }, this.opts.lingerMs ?? 250);
  }

  private send(): Promise<void> {
    this.sending ??= (async () => {
      try {
        await this.connect();
        while (this.queue.length) {
          const batch = this.queue.slice(0, this.opts.batch ?? 200);
          const bytes = batch.reduce((n, m) => n + m.bytes.length, 0);
          await this.pace(bytes);
          await this.producer.send({
            topic: this.topic,
            acks: -1,
            messages: batch.map((m) => ({ key: m.ev.key, value: m.bytes, headers: { kind: m.ev.kind, v: "1" } })),
          });
          this.queue.splice(0, batch.length);
          this.last = batch[batch.length - 1].ev.eventId;
          this.sent += batch.length;
          metrics.inc("events.published", batch.length);
          this.lastSentAt = new Date().toISOString();
          this.lastError = null;
        }
      } catch (err) {
        this.lastError = errMessage(err);
        log("warn", "Kafka send failed; events stay queued", { pending: this.queue.length, error: this.lastError });
        if (!this.closed) setTimeout(() => void this.send(), 3_000);
      }
    })().finally(() => (this.sending = null));
    return this.sending;
  }

  /** Stay under the plan's throughput: at most bytesPerSecond per one-second window. */
  private async pace(bytes: number): Promise<void> {
    const limit = this.opts.bytesPerSecond ?? 150 * 1024;
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowBytes = 0;
    }
    if (this.windowBytes + bytes > limit && this.windowBytes > 0) {
      await new Promise((r) => setTimeout(r, 1000 - (now - this.windowStart)));
      this.windowStart = Date.now();
      this.windowBytes = 0;
    }
    this.windowBytes += bytes;
  }

  async flush(timeoutMs = 8_000): Promise<void> {
    if (this.loop) {
      clearTimeout(this.loop);
      this.loop = null;
    }
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length && Date.now() < deadline) {
      await Promise.race([this.send(), new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
      if (this.queue.length && this.lastError) await new Promise((r) => setTimeout(r, 200));
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    await Promise.race([this.producer.disconnect().catch(() => undefined), new Promise((r) => setTimeout(r, 5_000).unref())]);
  }

  lastEventId(): string | undefined {
    return this.last;
  }

  stats() {
    return { kind: "kafka", topic: this.topic, pending: this.queue.length, sent: this.sent, lastSentAt: this.lastSentAt ?? "", lastError: this.lastError ?? "" };
  }
}

/**
 * The sink: a consumer group that writes `dock.actions` into telemetry.events. Runs inside the app (default)
 * or as its own worker (`pnpm aiven:sink`, with DOCK_KAFKA_SINK=0 in the app). With several app instances the
 * group shares the two partitions; duplicates after a rebalance are absorbed by the unique event id.
 */
export class TelemetrySink {
  private readonly consumer: Consumer;
  private started: Promise<void> | null = null;
  private consumed = 0;
  private lastError: string | null = null;
  private lastConsumedAt: string | null = null;

  constructor(
    private readonly kafka: Kafka,
    private readonly pool: Pool,
    private readonly topic = ACTIONS_TOPIC,
    groupId = SINK_GROUP,
  ) {
    this.consumer = kafka.consumer({ groupId, sessionTimeout: 30_000, heartbeatInterval: 3_000, allowAutoTopicCreation: false });
  }

  start(): Promise<void> {
    this.started ??= (async () => {
      await ensureTopic(this.kafka, this.topic).catch(() => false);
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.topic, fromBeginning: true });
      await this.consumer.run({
        autoCommit: true,
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
          const events: ActionEvent[] = [];
          for (const m of batch.messages) {
            try {
              const ev = JSON.parse(m.value?.toString("utf8") ?? "") as ActionEvent;
              if (ev && ev.v === 1 && typeof ev.eventId === "string" && typeof ev.kind === "string") events.push(ev);
            } catch {
              // not one of ours: skip it rather than block the partition
            }
          }
          try {
            for (let i = 0; i < events.length; i += 200) await writeTelemetry(this.pool, events.slice(i, i + 200));
          } catch (err) {
            this.lastError = errMessage(err);
            log("warn", "telemetry sink could not write to PostgreSQL; the batch will be redelivered", { error: this.lastError });
            throw err; // not resolved: kafkajs retries the batch
          }
          for (const m of batch.messages) resolveOffset(m.offset);
          this.consumed += events.length;
          metrics.inc("events.consumed", events.length);
          this.lastConsumedAt = new Date().toISOString();
          this.lastError = null;
          await commitOffsetsIfNecessary();
          await heartbeat();
        },
      });
    })().catch((err) => {
      this.started = null;
      this.lastError = errMessage(err);
      log("warn", "telemetry sink did not start", { error: this.lastError });
    });
    return this.started;
  }

  /** Wait (bounded) until this process's sink has consumed at least `count` events. */
  async waitFor(count: number, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.consumed < count && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    return this.consumed >= count;
  }

  /** Leave the group. Bounded: a consumer mid-rebalance can take a session timeout to leave, and shutdown must not wait for it. */
  async stop(timeoutMs = 5_000): Promise<void> {
    await Promise.race([this.consumer.disconnect().catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }

  stats() {
    return { consumed: this.consumed, lastConsumedAt: this.lastConsumedAt ?? "", lastError: this.lastError ?? "" };
  }
}

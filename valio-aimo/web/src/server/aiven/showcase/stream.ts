import { randomUUID } from "node:crypto";
import type { Consumer, Kafka } from "kafkajs";
import type { ActionEvent } from "../actions";
import { ACTIONS_TOPIC, SINK_GROUP, errMessage, kafkaConfig, log } from "../env";
import { kafkaClient } from "../kafka";
import { redactDeep } from "./redact";

/**
 * The stream as the source of truth: read `dock.actions` straight from Kafka, server side.
 *
 *   tail()            the newest messages, from one long-lived consumer of this process (a group of its own,
 *                     never committing, so it does not disturb the telemetry sink)
 *   lag()             the sink group's committed offset against the end of each partition
 *   readRange()       one partition, offsets [from, to), for the replay route
 *   requestEvents()   every message of one request, found by time window and read back in offset order
 *
 * The browser never talks to Kafka: these run behind /ops-api/platform/stream (operations session required).
 */
export type StreamMessage = {
  partition: number;
  offset: string;
  timestamp: string;
  key: string;
  kind: string;
  event: Partial<ActionEvent>;
};

const g = globalThis as typeof globalThis & { __dockShowcaseKafka?: Kafka; __dockShowcaseTail?: Tail };

function kafka(): Kafka | undefined {
  const cfg = kafkaConfig();
  if (!cfg) return undefined;
  return (g.__dockShowcaseKafka ??= kafkaClient(cfg, "dock-showcase"));
}

export const streamConfigured = () => Boolean(kafkaConfig());

function toMessage(partition: number, m: { offset: string; timestamp: string; key: Buffer | null; value: Buffer | null }): StreamMessage {
  let event: Partial<ActionEvent> = {};
  try {
    event = JSON.parse(m.value?.toString("utf8") ?? "{}") as Partial<ActionEvent>;
  } catch {
    /* not ours */
  }
  const { summary, attrs, ...rest } = event;
  return {
    partition,
    offset: m.offset,
    timestamp: new Date(Number(m.timestamp)).toISOString(),
    key: m.key?.toString("utf8") ?? "",
    kind: String(event.kind ?? "?"),
    // intake summaries can quote a kitchen's memory: the stream view shows the kind, not the words
    event: redactDeep({ ...rest, summary: event.kind === "intake.step" ? undefined : summary?.slice(0, 240), attrs: event.kind === "intake.step" ? undefined : attrs }),
  };
}

// ---------- offsets and lag ----------

export type PartitionLag = { partition: number; earliest: string; end: string; committed: string | null; lag: number | null };
export type LagReport = { topic: string; group: string; partitions: PartitionLag[]; totalLag: number | null; totalMessages: number; at: string };

let lagCache: { at: number; value: LagReport } | undefined;

export async function lag(): Promise<LagReport> {
  if (lagCache && Date.now() - lagCache.at < 2_000) return lagCache.value;
  const k = kafka();
  if (!k) throw new Error("Kafka is not configured on this server.");
  const admin = k.admin();
  await admin.connect();
  try {
    const [ends, committed] = await Promise.all([admin.fetchTopicOffsets(ACTIONS_TOPIC), admin.fetchOffsets({ groupId: SINK_GROUP, topics: [ACTIONS_TOPIC] })]);
    const byP = new Map((committed[0]?.partitions ?? []).map((p) => [p.partition, p.offset]));
    const partitions = ends
      .map((e) => {
        const c = byP.get(e.partition);
        const committedOff = c !== undefined && c !== "-1" ? c : null;
        return { partition: e.partition, earliest: e.low, end: e.high, committed: committedOff, lag: committedOff === null ? null : Math.max(0, Number(e.high) - Number(committedOff)) };
      })
      .sort((a, b) => a.partition - b.partition);
    const value: LagReport = {
      topic: ACTIONS_TOPIC,
      group: SINK_GROUP,
      partitions,
      totalLag: partitions.every((p) => p.lag !== null) ? partitions.reduce((a, p) => a + (p.lag ?? 0), 0) : null,
      totalMessages: partitions.reduce((a, p) => a + Number(p.end) - Number(p.earliest), 0),
      at: new Date().toISOString(),
    };
    lagCache = { at: Date.now(), value };
    return value;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

/** Offsets of each partition at a time (the first message at or after it). */
export async function offsetsAt(ts: number): Promise<{ partition: number; offset: string }[]> {
  const k = kafka();
  if (!k) throw new Error("Kafka is not configured on this server.");
  const admin = k.admin();
  await admin.connect();
  try {
    return (await admin.fetchTopicOffsetsByTimestamp(ACTIONS_TOPIC, ts)).map((p) => ({ partition: p.partition, offset: p.offset }));
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

// ---------- reading a range ----------

export const MAX_RANGE = 500;

/**
 * Read messages from several partitions, each from `from` (inclusive) up to `to` (exclusive), at most MAX_RANGE
 * per partition. A throwaway consumer group, no commits; returns when every range is read or after `timeoutMs`.
 */
export async function readRanges(ranges: { partition: number; from: string; to: string }[], timeoutMs = 12_000): Promise<{ messages: StreamMessage[]; complete: boolean }> {
  const k = kafka();
  if (!k) throw new Error("Kafka is not configured on this server.");
  const want = ranges
    .map((r) => ({ partition: r.partition, from: BigInt(r.from), to: BigInt(r.to) < BigInt(r.from) + BigInt(MAX_RANGE) ? BigInt(r.to) : BigInt(r.from) + BigInt(MAX_RANGE) }))
    .filter((r) => r.to > r.from);
  if (!want.length) return { messages: [], complete: true };
  const consumer = k.consumer({ groupId: `dock-showcase-read-${randomUUID()}`, sessionTimeout: 10_000, heartbeatInterval: 2_000, allowAutoTopicCreation: false, maxWaitTimeInMs: 500 });
  const out: StreamMessage[] = [];
  const done = new Set<number>();
  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: ACTIONS_TOPIC, fromBeginning: false });
    const byP = new Map(want.map((w) => [w.partition, w]));
    for (const p of [0, 1, 2, 3]) if (!byP.has(p)) done.add(p);
    await consumer.run({
      autoCommit: false,
      eachBatch: async ({ batch }) => {
        const w = byP.get(batch.partition);
        if (!w) {
          consumer.pause([{ topic: ACTIONS_TOPIC, partitions: [batch.partition] }]);
          return;
        }
        for (const m of batch.messages) {
          const off = BigInt(m.offset);
          if (off >= w.from && off < w.to) out.push(toMessage(batch.partition, m));
          if (off >= w.to - BigInt(1)) done.add(batch.partition);
        }
        if (done.has(batch.partition)) consumer.pause([{ topic: ACTIONS_TOPIC, partitions: [batch.partition] }]);
        if (want.every((x) => done.has(x.partition))) finish();
      },
    });
    for (const w of want) consumer.seek({ topic: ACTIONS_TOPIC, partition: w.partition, offset: w.from.toString() });
    await Promise.race([finished, new Promise((r) => setTimeout(r, timeoutMs))]);
  } finally {
    await Promise.race([consumer.disconnect().catch(() => undefined), new Promise((r) => setTimeout(r, 4_000))]);
  }
  out.sort((a, b) => a.partition - b.partition || Number(BigInt(a.offset) - BigInt(b.offset)));
  return { messages: out, complete: want.every((x) => done.has(x.partition)) };
}

/**
 * Every stream message of one request, in the order the gate produced them. Kafka orders messages per partition;
 * one request's events can sit on two partitions (keyed by request until an order exists, then by order), so they
 * are merged by the ledger sequence each event carries, which is the gate's own order.
 */
export async function requestEvents(requestId: string, window: { from: string; to: string }): Promise<{ messages: StreamMessage[]; ranges: { partition: number; from: string; to: string }[]; complete: boolean; source: "kafka" }> {
  const t0 = Date.parse(window.from) - 5_000;
  const t1 = Date.parse(window.to) + 5_000;
  const [start, ends] = await Promise.all([offsetsAt(t0), lag()]);
  const after = Date.now() - t1 > 1_000 ? await offsetsAt(t1) : undefined;
  const ranges = start.map((s) => {
    const end = ends.partitions.find((p) => p.partition === s.partition)?.end ?? s.offset;
    const stop = after?.find((a) => a.partition === s.partition)?.offset;
    const to = stop && stop !== "-1" ? stop : end;
    return { partition: s.partition, from: s.offset === "-1" ? end : s.offset, to };
  });
  const cacheKey = `${requestId}|${ranges.map((r) => `${r.partition}:${r.from}-${r.to}`).join(",")}`;
  const hit = requestCache.get(cacheKey);
  if (hit) return hit;
  const r = await readRanges(ranges);
  const messages = r.messages
    .filter((m) => m.event.requestId === requestId)
    .sort((a, b) => (a.event.ledgerSeq ?? 0) - (b.event.ledgerSeq ?? 0) || a.timestamp.localeCompare(b.timestamp));
  const value = { messages, ranges, complete: r.complete, source: "kafka" as const };
  requestCache.set(cacheKey, value);
  if (requestCache.size > 50) requestCache.delete(requestCache.keys().next().value!);
  return value;
}
const requestCache = new Map<string, Awaited<ReturnType<typeof requestEvents>>>();

// ---------- the live tail ----------

class Tail {
  private consumer: Consumer | null = null;
  private started: Promise<void> | null = null;
  readonly buffer: StreamMessage[] = [];
  lastError: string | null = null;
  lastUsed = Date.now();
  private idle: NodeJS.Timeout | null = null;

  constructor(private readonly k: Kafka) {}

  start(): Promise<void> {
    this.lastUsed = Date.now();
    this.started ??= (async () => {
      const ends = await lag().catch(() => undefined);
      const consumer = this.k.consumer({ groupId: `dock-showcase-tail-${randomUUID()}`, sessionTimeout: 15_000, heartbeatInterval: 3_000, allowAutoTopicCreation: false, maxWaitTimeInMs: 1_000 });
      this.consumer = consumer;
      await consumer.connect();
      await consumer.subscribe({ topic: ACTIONS_TOPIC, fromBeginning: false });
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ partition, message }) => {
          this.buffer.push(toMessage(partition, message));
          if (this.buffer.length > 400) this.buffer.splice(0, this.buffer.length - 400);
        },
      });
      // Start each partition 40 messages back, so the tail is not empty on first look.
      for (const p of ends?.partitions ?? []) {
        const from = Math.max(Number(p.earliest), Number(p.end) - 40);
        consumer.seek({ topic: ACTIONS_TOPIC, partition: p.partition, offset: String(from) });
      }
      // Leave the group after 10 idle minutes; the next view starts it again.
      this.idle = setInterval(() => {
        if (Date.now() - this.lastUsed > 10 * 60_000) void this.stop();
      }, 60_000);
      this.idle.unref();
    })().catch((err) => {
      this.lastError = errMessage(err);
      this.started = null;
      log("warn", "showcase stream tail did not start", { error: this.lastError });
    });
    return this.started;
  }

  async stop(): Promise<void> {
    if (this.idle) clearInterval(this.idle);
    const c = this.consumer;
    this.consumer = null;
    this.started = null;
    if (c) await Promise.race([c.disconnect().catch(() => undefined), new Promise((r) => setTimeout(r, 4_000))]);
  }
}

export async function tail(sinceKey?: string): Promise<{ messages: StreamMessage[]; error: string | null; warming: boolean }> {
  const k = kafka();
  if (!k) throw new Error("Kafka is not configured on this server.");
  const t = (g.__dockShowcaseTail ??= new Tail(k));
  const warming = !t.buffer.length;
  await Promise.race([t.start(), new Promise((r) => setTimeout(r, warming ? 8_000 : 50))]);
  const sorted = [...t.buffer].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.partition - b.partition || Number(BigInt(a.offset) - BigInt(b.offset)));
  const idx = sinceKey ? sorted.findIndex((m) => `${m.partition}:${m.offset}` === sinceKey) : -1;
  return { messages: (idx >= 0 ? sorted.slice(idx + 1) : sorted).slice(-120), error: t.lastError, warming: warming && !t.buffer.length };
}

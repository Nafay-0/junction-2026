import { DockError } from "@/core/errors";
import type { NeedUnit } from "@/core/need";
import { compareReadings, fieldValues, type Reading, type SecondReadingRecord, type UnavailableReason } from "@/core/second-reading";
import type { InterpretOptions, InterpretResult } from "./interpret";

/**
 * The second reader: every request the interpreter reads is read a second time, at the same moment, by an
 * independent model of another family (NVIDIA Nemotron 3 Nano, open weights, through Featherless; a wholesaler can
 * run it on its own hardware). Plain code (core/second-reading.ts) compares the two readings; a material difference
 * becomes one question for the buyer before any price is fixed.
 *
 * It can only add a question: the order always goes on the first reading, the buyer settles a difference, and the
 * gate stays plain code. It never slows or blocks an order: it starts with the first reading, has a deadline from
 * that start, and anything that goes wrong (late, down, over capacity, over the daily caps, unreadable) is recorded
 * as "unavailable" and the first reading carries on alone. Its calls count against the daily model limits as spare
 * calls (server/limits.ts): they stop before the last tenth of either cap, which stays for first readings.
 *
 * Configuration: DOCK_SECOND_READER_MODEL, `provider:model-id` (empty: off). The model, the thinking setting and the
 * deadline were chosen on the evaluation (web/scripts/eval/eval-second-reader.ts; numbers in web/docs/second-reader.md).
 */

export const SECOND_READER_ENV = "DOCK_SECOND_READER_MODEL";

/** From the start of both readings. The first reading (Claude Opus 5.5) takes longer than this most of the time, so the wait it adds is usually none. */
export const SECOND_READER_DEADLINE_MS = 8000;

/**
 * Nemotron 3 Nano thinks before it answers unless told not to; with thinking on it is slower and, on the evaluation,
 * no more accurate. `chat_template_kwargs` is how the OpenAI-compatible endpoint takes that switch.
 */
export const NEMOTRON_NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

export function secondReaderModel(env: Record<string, string | undefined> = process.env): string | undefined {
  return env[SECOND_READER_ENV]?.trim() || undefined;
}

/** Extra request fields for a model: thinking off for Nemotron 3 (the switch only exists there). */
export function extraBodyFor(spec: string): Record<string, unknown> | undefined {
  return /nemotron-3/i.test(spec) ? NEMOTRON_NO_THINKING : undefined;
}

export type SecondOutcome = { ok: true; reading: Reading; model: string; ms: number; incomplete?: boolean } | { ok: false; reason: UnavailableReason; detail: string; model: string; ms: number };

type Read = (o: InterpretOptions) => Promise<InterpretResult>;
type ModelChoice = NonNullable<InterpretOptions["model"]>;

const idOf = (m: ModelChoice) => (typeof m === "string" ? m : m.id);

/** A need, or the partial need of a 422 need_incomplete, as the comparison reads it. */
export function readingOf(n: unknown): Reading | undefined {
  if (!n || typeof n !== "object") return undefined;
  const x = n as Record<string, unknown> & { item?: Record<string, unknown> };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const q = x.quantity as { amount?: unknown; unit?: unknown } | undefined;
  return {
    item: { text: typeof x.item?.text === "string" ? x.item.text : "", attributes: strs(x.item?.attributes), excludedAttributes: strs(x.item?.excludedAttributes), ...(typeof x.item?.productId === "string" ? { productId: x.item.productId } : {}) },
    ...(q && typeof q.amount === "number" && typeof q.unit === "string" ? { quantity: { amount: q.amount, unit: q.unit as NeedUnit } } : {}),
    ...(typeof x.deliverBy === "string" ? { deliverBy: x.deliverBy } : {}),
    ...(typeof x.deliverOn === "string" ? { deliverOn: x.deliverOn } : {}),
    requiredClaims: strs(x.requiredClaims),
    forbiddenAllergens: strs(x.forbiddenAllergens),
    sameAsLastTime: x.sameAsLastTime === true,
  };
}

/** Why a second reading failed, from the interpreter's error. Never throws. */
export function unavailableReason(err: unknown): { reason: UnavailableReason; detail: string } {
  if (err instanceof DockError) {
    const detail = err.message.slice(0, 200);
    if (err.code === "interpret_timeout") return { reason: "timeout", detail };
    if (err.code === "demo_limit_reached" || err.code === "llm_disabled") return { reason: "over_limit", detail };
    if (err.code === "model_unavailable") return { reason: "not_configured", detail };
    if (err.code === "not_a_purchase_request") return { reason: "not_a_purchase", detail };
    if (err.code === "interpret_invalid_output") return { reason: "unreadable", detail };
    if (/\b429\b|capacity|rate.?limit/i.test(err.message)) return { reason: "at_capacity", detail };
    if (/no object|parse|json|schema|did not match|type validation/i.test(err.message)) return { reason: "unreadable", detail };
    if (/abort/i.test(err.message)) return { reason: "timeout", detail };
    return { reason: "failed", detail };
  }
  return { reason: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
}

/** One second reading. Never throws: a failure is an outcome. */
export async function readSecondTime(read: Read, opts: InterpretOptions, model: ModelChoice, deadlineMs = SECOND_READER_DEADLINE_MS): Promise<SecondOutcome> {
  const t0 = Date.now();
  const id = idOf(model);
  const extraBody = typeof model === "string" ? extraBodyFor(model) : undefined;
  try {
    const r = await read({ ...opts, model, timeoutMs: deadlineMs, spare: true, ...(extraBody ? { modelOptions: { ...opts.modelOptions, extraBody } } : {}) });
    return { ok: true, reading: readingOf(r.need)!, model: r.model, ms: Date.now() - t0 };
  } catch (err) {
    // The second reader understood part of it ("no amount"): that part is still a reading to compare.
    if (err instanceof DockError && err.code === "need_incomplete") {
      const partial = readingOf((err.details as { partial?: unknown } | undefined)?.partial);
      if (partial) return { ok: true, reading: partial, model: id, ms: Date.now() - t0, incomplete: true };
    }
    return { ok: false, ...unavailableReason(err), model: id, ms: Date.now() - t0 };
  }
}

export type ReadTwice = { first: InterpretResult; second?: SecondReadingRecord };

/**
 * Both readings at once. The first decides: if it fails, its error is the answer (and the second is cancelled). The
 * second is waited for only until its deadline from the shared start.
 */
export async function readTwice(read: Read, opts: InterpretOptions, cfg: { model?: ModelChoice; deadlineMs?: number; now?: () => Date } = {}): Promise<ReadTwice> {
  const model = cfg.model ?? secondReaderModel();
  if (!model) return { first: await read(opts) };
  const ctrl = new AbortController();
  const secondP = readSecondTime(read, { ...opts, signal: ctrl.signal }, model, cfg.deadlineMs).then((o) => ({ o, at: Date.now() }));
  let first: InterpretResult;
  try {
    first = await read(opts);
  } catch (err) {
    ctrl.abort();
    void secondP.catch(() => undefined);
    throw err;
  }
  const firstAt = Date.now();
  const { o, at } = await secondP;
  return { first, second: recordOf(first, o, opts.text, Math.max(0, at - firstAt), (cfg.now ?? (() => new Date()))()) };
}

export function recordOf(first: InterpretResult, o: SecondOutcome, text: string, waitedMs: number, at: Date): SecondReadingRecord {
  const firstReading = readingOf(first.need)!;
  const common = { firstModel: first.model, secondModel: o.model, waitedMs, firstValues: fieldValues(firstReading), at: at.toISOString() };
  if (!o.ok) return { ...common, status: "unavailable", reason: o.reason, detail: o.detail, secondMs: o.ms, differences: [], minor: [] };
  const c = compareReadings(firstReading, o.reading, { text });
  return { ...common, status: c.agreed ? "agreed" : "differed", secondMs: o.ms, differences: c.differences, minor: o.incomplete ? ["the second reading was incomplete", ...c.minor] : c.minor };
}

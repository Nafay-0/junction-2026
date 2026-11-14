import { APICallError, generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { fold } from "@/core/catalog/search";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { NEED_UNITS, type NeedUnit } from "@/core/need";
import { alsoAskedIn } from "@/core/also-asked";
import { compareReadings, fieldValues, sameKind, type Reading, type ReadingRules, type SecondReadingRecord, type UnavailableReason } from "@/core/second-reading";
import { recordLlmSpend, reserveLlmCall } from "@/server/limits";
import type { InterpretOptions, InterpretResult } from "./interpret";
import { createModel, ModelConfigError } from "./models";
import { costOf, tokensFromUsage, type Price } from "./pricing";
import { secondReaderSystem, secondReaderUser } from "./prompts";
import { describeError, withRetry } from "./retry";

/**
 * The second reader: every request the interpreter reads is read a second time, at the same moment, by an
 * independent model of another family (NVIDIA Nemotron 3 Nano, open weights, through Featherless; a wholesaler can
 * run it on its own hardware). Plain code (core/second-reading.ts) compares the two readings; a material difference
 * becomes one question for the buyer before any price is fixed.
 *
 * Independent in method too: the second reader does not fill the interpreter's schema. It transcribes what the words
 * say into closed lists (claims, allergens, a weekday or "tomorrow" as words), and plain code here turns that into a
 * reading, including the calendar. On the evaluation the small model got weekday dates wrong a third of the time when
 * it had to look them up itself (web/docs/second-reader.md).
 *
 * It can only add a question: the order always goes on the first reading, the buyer settles a difference, and the
 * gate stays plain code. It never slows or blocks an order: it starts with the first reading, has a deadline from
 * that shared start, and anything that goes wrong (late, down, over capacity, over the daily caps, unreadable) is
 * recorded as "unavailable" and the first reading carries on alone. Its calls count against the daily model limits as
 * spare calls (server/limits.ts): they stop before the last tenth of either cap, which stays for first readings.
 *
 * Configuration: DOCK_SECOND_READER_MODEL, `provider:model-id` (empty: off). The model, the thinking setting and the
 * deadline were chosen on the evaluation (web/scripts/eval/eval-second-reader.ts; numbers in web/docs/second-reader.md).
 */

export const SECOND_READER_ENV = "DOCK_SECOND_READER_MODEL";

/** From the shared start of both readings. The first reading (Claude Opus 5.5) usually takes longer, so the wait this adds is usually none. */
export const SECOND_READER_DEADLINE_MS = 8000;

/**
 * Nemotron 3 Nano thinks before it answers unless told not to; with thinking on it took about 10 s a request on the
 * evaluation, past the deadline. `chat_template_kwargs` is how the OpenAI-compatible endpoint takes that switch.
 */
export const NEMOTRON_NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

/** The dietary claims and allergens the second reader picks from. Fat content is not compared (not a dietary or allergen claim). */
export const SECOND_CLAIMS = ["lactose_free", "low_lactose", "organic", "vegan", "vegetarian"] as const;
export const SECOND_ALLERGENS = ["milk", "eggs", "gluten", "wheat", "nuts", "peanuts", "soy", "fish", "crustaceans", "molluscs", "sesame", "mustard", "celery", "lupin", "sulphites", "oats"] as const;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const SecondItem = z.object({
  item: z.string().nullable(),
  amount: z.number().nullable(),
  unit: z.enum(NEED_UNITS).nullable(),
  packSize: z.object({ amount: z.number(), unit: z.enum(["L", "kg", "pcs"]) }).nullable(),
  wanted: z.array(z.enum(SECOND_CLAIMS)),
  notWanted: z.array(z.enum(SECOND_CLAIMS)),
  avoid: z.array(z.enum(SECOND_ALLERGENS)),
});
export type SecondItem = z.infer<typeof SecondItem>;

/** One entry in `items` per product the words ask for (usually one); the day is the request's. */
export const SecondRead = z.object({
  isPurchaseRequest: z.boolean(),
  items: z.array(SecondItem),
  deliveryDate: z.object({ day: z.number().int(), month: z.number().int().nullable() }).nullable(),
  deliveryWeekday: z.enum(WEEKDAYS).nullable(),
  deliveryRelative: z.enum(["today", "tomorrow", "day_after_tomorrow"]).nullable(),
});
export type SecondRead = z.infer<typeof SecondRead>;

export function secondReaderModel(env: Record<string, string | undefined> = process.env): string | undefined {
  return env[SECOND_READER_ENV]?.trim() || undefined;
}

/** Extra request fields for a model: thinking off for Nemotron 3 (the switch only exists there). `#think` keeps it on (the evaluation). */
export function extraBodyFor(spec: string): Record<string, unknown> | undefined {
  return /nemotron-3/i.test(spec) && !spec.endsWith("#think") ? NEMOTRON_NO_THINKING : undefined;
}

// ---------- plain code: the transcription to a reading ----------

/**
 * The delivery day the words name: a written date first, then a weekday (the next such day after today, the
 * interpreter's own rule), then "today", "tomorrow" or "the day after tomorrow".
 */
export function deliveryDay(d: Pick<SecondRead, "deliveryDate" | "deliveryWeekday" | "deliveryRelative">, now: Date): string | undefined {
  const today = localNow(now).date;
  if (d.deliveryDate) {
    const { day, month: m0 } = d.deliveryDate;
    if (day < 1 || day > 31) return undefined;
    const [y, m] = today.split("-").map(Number);
    const month = m0 && m0 >= 1 && m0 <= 12 ? m0 : m;
    const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let out = iso(y, month);
    if (out < today) out = m0 ? iso(y + 1, month) : month === 12 ? iso(y + 1, 1) : iso(y, month + 1);
    const check = new Date(`${out}T12:00:00Z`);
    return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== out ? undefined : out;
  }
  // "Tomorrow" before a weekday: the small model sometimes adds today's weekday next to "huomiseksi".
  if (d.deliveryRelative) return addDaysIso(today, { today: 0, tomorrow: 1, day_after_tomorrow: 2 }[d.deliveryRelative]);
  if (d.deliveryWeekday) {
    const want = WEEKDAYS.indexOf(d.deliveryWeekday) + 1;
    return addDaysIso(today, (want - isoWeekday(today) + 7) % 7 || 7);
  }
  return undefined;
}

/** Claims the item words themselves name ("laktoositonta maitoa"): the transcription sometimes leaves them only there. */
const ITEM_CLAIMS: [RegExp, (typeof SECOND_CLAIMS)[number]][] = [
  [/lactose[ -]?free|laktoositon|laktosfri/, "lactose_free"],
  [/low[ -]?lactose|vahalaktoos|laktosreducerad/, "low_lactose"],
  [/\borganic|luomu|ekologisk/, "organic"],
  [/vegan|vegaan/, "vegan"],
];

/** Every item of the transcription as a reading, with the request's day. */
export function toReadings(raw: SecondRead, now: Date): Reading[] {
  const day = deliveryDay(raw, now);
  return raw.items.map((it) => itemReading(it, day));
}

function itemReading(raw: SecondItem, day: string | undefined): Reading {
  const folded = fold(raw.item ?? "");
  const fromItem = /\b(not|ei|inte)\b/.test(folded) ? [] : ITEM_CLAIMS.filter(([re]) => re.test(folded)).map(([, c]) => c);
  raw = { ...raw, wanted: [...raw.wanted, ...fromItem.filter((c) => !raw.notWanted.includes(c))] };
  const amount = raw.amount && raw.amount > 0 && raw.amount <= 1_000_000 && raw.unit ? { amount: raw.amount, unit: raw.unit } : undefined;
  const notWanted = [...new Set(raw.notWanted)];
  return {
    item: { text: raw.item?.trim() ?? "", attributes: [...new Set(raw.wanted)].filter((c) => !notWanted.includes(c)), excludedAttributes: notWanted },
    ...(amount ? { quantity: amount } : {}),
    ...(amount && raw.packSize && raw.packSize.amount > 0 && (amount.unit === "pack" || amount.unit === "pcs") ? { packSize: raw.packSize } : {}),
    ...(day ? { deliverBy: day } : {}),
    requiredClaims: [],
    forbiddenAllergens: [...new Set(raw.avoid)],
    sameAsLastTime: false,
  };
}

/** A need (the first reading) as the comparison reads it. */
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

// ---------- the call ----------

export type SecondOutcome = { ok: true; readings: Reading[]; raw: SecondRead; model: string; ms: number; costUsd: number | null } | { ok: false; reason: UnavailableReason; detail: string; model: string; ms: number };

type ModelChoice = string | { model: LanguageModel; id: string; price?: Price };
const idOf = (m: ModelChoice) => (typeof m === "string" ? m.replace(/#think$/, "") : m.id);

/** Why a call failed, in the record's words. Never throws. */
export function unavailableReason(err: unknown, timedOut = false): { reason: UnavailableReason; detail: string } {
  const detail = describeError(err).slice(0, 200);
  if (timedOut || (err as Error)?.name === "TimeoutError") return { reason: "timeout", detail };
  if (err instanceof DockError) {
    if (err.code === "demo_limit_reached" || err.code === "llm_disabled") return { reason: "over_limit", detail };
    return { reason: "failed", detail };
  }
  if (err instanceof ModelConfigError) return { reason: "not_configured", detail };
  if (NoObjectGeneratedError.isInstance(err)) return { reason: "unreadable", detail };
  if (APICallError.isInstance(err) && (err.statusCode === 429 || /capacity/i.test(err.message))) return { reason: "at_capacity", detail };
  if ((err as Error)?.name === "AbortError") return { reason: "timeout", detail };
  return { reason: "failed", detail };
}

/** One second reading. Never throws: a failure is an outcome. */
export async function readSecondTime(opts: { text: string; now?: Date; signal?: AbortSignal }, model: ModelChoice, deadlineMs = SECOND_READER_DEADLINE_MS): Promise<SecondOutcome> {
  const t0 = Date.now();
  const id = idOf(model);
  const fail = (err: unknown, timedOut = false): SecondOutcome => ({ ok: false, ...unavailableReason(err, timedOut), model: id, ms: Date.now() - t0 });
  let m: LanguageModel;
  let price: Price | undefined;
  try {
    if (typeof model === "string") {
      const extraBody = extraBodyFor(model);
      const made = createModel(model.replace(/#think$/, ""), extraBody ? { extraBody } : {});
      m = made.model;
      price = made.price;
    } else ({ model: m, price } = model);
    reserveLlmCall(undefined, { spare: true });
  } catch (err) {
    return fail(err);
  }
  const deadline = t0 + deadlineMs;
  const now = opts.now ?? new Date();
  let res;
  try {
    res = await withRetry(
      () =>
        generateText({
          model: m,
          instructions: secondReaderSystem(SECOND_CLAIMS, SECOND_ALLERGENS),
          prompt: secondReaderUser(opts.text),
          output: Output.object({ schema: SecondRead, name: "transcription", description: "What the buyer's words say, field by field." }),
          maxOutputTokens: 1500,
          temperature: 0,
          maxRetries: 0,
          abortSignal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      { deadline, policy: { maxRetries: 1, baseMs: 300, maxMs: 1500 } },
    );
  } catch (err) {
    return fail(err, Date.now() >= deadline - 5);
  }
  const tokens = tokensFromUsage(res.usage);
  const costUsd = costOf(tokens, price);
  recordLlmSpend(costUsd);
  const parsed = SecondRead.safeParse(res.output);
  if (!parsed.success) return { ok: false, reason: "unreadable", detail: "The second reader's answer did not fit its fields.", model: id, ms: Date.now() - t0 };
  if (!parsed.data.isPurchaseRequest) return { ok: false, reason: "not_a_purchase", detail: "The second reader did not read this as an order.", model: id, ms: Date.now() - t0 };
  if (!parsed.data.items.length) return { ok: false, reason: "unreadable", detail: "The second reader named no item.", model: id, ms: Date.now() - t0 };
  return { ok: true, readings: toReadings(parsed.data, now), raw: parsed.data, model: id, ms: Date.now() - t0, costUsd };
}

export type ReadTwice = { first: InterpretResult; second?: SecondReadingRecord };

/**
 * Both readings at once. The first decides: if it fails, its error is the answer (and the second is cancelled). The
 * second is waited for only until its deadline from the shared start.
 */
export async function readTwice(
  read: (o: InterpretOptions) => Promise<InterpretResult>,
  opts: InterpretOptions,
  cfg: { model?: ModelChoice; off?: boolean; deadlineMs?: number; now?: () => Date; /** Wait at most this long for the second reading once the first is in (the agent thread: the buyer's "understood" card does not wait on a slow second reader). */ graceAfterFirstMs?: number } = {},
): Promise<ReadTwice> {
  const model = cfg.off ? undefined : (cfg.model ?? secondReaderModel());
  if (!model) return { first: await read(opts) };
  const ctrl = new AbortController();
  const secondP = readSecondTime({ text: opts.text.trim(), now: opts.now, signal: ctrl.signal }, model, cfg.deadlineMs).then((o) => ({ o, at: Date.now() }));
  let first: InterpretResult;
  try {
    first = await read(opts);
  } catch (err) {
    ctrl.abort();
    throw err;
  }
  const firstAt = Date.now();
  const grace = cfg.graceAfterFirstMs;
  const { o, at } =
    grace === undefined
      ? await secondP
      : await Promise.race([
          secondP,
          new Promise<{ o: SecondOutcome; at: number }>((resolve) =>
            setTimeout(() => {
              ctrl.abort();
              resolve({ o: { ok: false, reason: "timeout", detail: `not in within ${grace} ms of the first reading`, model: idOf(model), ms: Date.now() - firstAt }, at: Date.now() });
            }, grace),
          ),
        ]);
  return { first, second: recordOf(first, o, opts.text, Math.max(0, at - firstAt), (cfg.now ?? (() => new Date()))()) };
}

/**
 * The record of the two readings. The first reading is one need, for one item; the second reader transcribes every
 * item the words name, and the one compared is the item of the same kind (core/second-reading.ts sameKind). Plain code
 * (core/also-asked.ts) says what else the words ask for: when the second reader read only other items, nothing is
 * compared (no question; recorded as "other_item"), and when the words ask for the same again on another day, the day
 * is not compared.
 */
export function recordOf(first: Pick<InterpretResult, "need" | "model">, o: SecondOutcome, text: string, waitedMs: number, at: Date): SecondReadingRecord {
  const firstReading = readingOf(first.need)!;
  const common = { firstModel: first.model, secondModel: o.model, waitedMs, firstValues: fieldValues(firstReading), at: at.toISOString() };
  if (!o.ok) return { ...common, status: "unavailable", reason: o.reason, detail: o.detail, secondMs: o.ms, differences: [], minor: [] };
  const pick = secondFor(first.need, o.readings, text);
  if (!pick.reading) return { ...common, status: "unavailable", reason: "other_item", detail: "The words name several items, and the second reader read only others than this request's.", secondMs: o.ms, differences: [], minor: pick.minor };
  const c = compareReadings(firstReading, pick.reading, { text, today: localNow(at).date, rules: pick.rules });
  return { ...common, status: c.agreed ? "agreed" : "differed", secondMs: o.ms, differences: c.differences, minor: [...pick.minor, ...c.minor] };
}

/** Which of the second reader's items to compare with the first reading, and with which rules (see recordOf). */
export function secondFor(firstNeed: unknown, readings: Reading[], text: string): { reading?: Reading; rules: Partial<ReadingRules>; minor: string[] } {
  const firstReading = readingOf(firstNeed)!;
  const also = alsoAskedIn(text, firstReading);
  const several = also.length > 0 || readings.length > 1;
  const reading = several ? readings.find((r) => sameKind(firstReading, r)) : readings[0];
  const repeat = also.some((x) => x.group === "repeat");
  return {
    reading,
    rules: repeat ? { compareDate: false } : {},
    minor: [...(several ? [`the words name ${Math.max(also.length + 1, readings.length)} items; only the same item is compared`] : []), ...(repeat ? ["the words ask for a second delivery: the day is not compared"] : [])],
  };
}

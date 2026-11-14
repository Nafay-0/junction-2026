import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import { recordLlmSpend, reserveLlmCall } from "@/server/limits";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { NEED_UNITS, NeedSchema, OPTIMISE_GOALS, type StructuredNeed } from "@/core/need";
import { createModel, defaultModel, ModelConfigError, type ModelOptions } from "./models";
import { costOf, tokensFromUsage, type Price, type Tokens } from "./pricing";
import { interpretSystem, interpretUser, type Vocabulary } from "./prompts";
import { describeError, isRetryable, withRetry } from "./retry";

/**
 * Job 1: a buyer's free text (English, Finnish or Swedish) to the structured need, and nothing more.
 *
 * The model fills a schema in which every field is required but may be empty (null, [], "unstated"),
 * which every provider's structured output accepts and which makes "not said" an explicit answer rather
 * than an omission. Plain code then builds the need: the buyer's own words are copied from the input (the
 * model never rewrites them), tags are normalised, dates are checked, and the result must pass NeedSchema.
 * Anything left unstated stays unstated so the deterministic intake can ask or consult memory.
 */

const LlmNeed = z.object({
  isPurchaseRequest: z.boolean(),
  notPurchaseReason: z.string().nullable(),
  item: z.object({
    text: z.string().nullable(),
    category: z.string().nullable(),
    attributes: z.array(z.string()),
    excludedAttributes: z.array(z.string()),
    productId: z.string().nullable(),
  }),
  quantity: z.object({ amount: z.number(), unit: z.enum(NEED_UNITS) }).nullable(),
  deliverBy: z.string().nullable().describe("YYYY-MM-DD"),
  requiredClaims: z.array(z.string()),
  forbiddenAllergens: z.array(z.string()),
  optimise: z.enum([...OPTIMISE_GOALS, "no_preference", "unstated"]),
  sameAsLastTime: z.boolean(),
});
export type LlmNeed = z.infer<typeof LlmNeed>;

/**
 * Follow-ups ("same again but 200 litres", "like last Friday, for Thursday"): the caller passes the kitchen's
 * earlier requests, and the model says which one the text refers to and which fields it took from it. Only
 * used when earlier requests are given, so the plain schema above stays exactly as it was.
 */
export const EARLIER_FIELDS = ["item", "quantity", "deliverBy", "attributes", "optimise", "allergens"] as const;
const LlmFollowUp = LlmNeed.extend({
  basedOnRequestId: z.string().nullable().describe("id of the earlier request the text refers to, or null"),
  takenFromEarlier: z.array(z.enum(EARLIER_FIELDS)).describe("fields copied from that earlier request because the buyer did not restate them"),
});
export type LlmFollowUp = z.infer<typeof LlmFollowUp>;

export const EarlierRequestSchema = z.object({
  id: z.string().min(1).max(80).describe("The earlier request's id (or order id for history without a request)."),
  at: z.string().min(10).max(40).describe("When it was asked or placed (ISO date or timestamp)."),
  text: z.string().max(2000).nullable().describe("The buyer's own words, when there were any."),
  need: z.record(z.string(), z.unknown()).nullable().describe("The structured need it became, as POST /api/v1/intake took it."),
  ordered: z.string().max(600).nullable().describe("What was ordered, in one line."),
  deliveredOn: z.iso.date().nullable().describe("Delivery date of what was ordered."),
});
export type EarlierRequest = z.infer<typeof EarlierRequestSchema>;

/** Which earlier request the need was built on, and the fields memory answered. Checked by plain code. */
export type BasedOn = { requestId: string; fields: (typeof EARLIER_FIELDS)[number][] };

export type InterpretResult = { need: StructuredNeed; model: string; ms: number; tokens: Tokens; costUsd: number | null; raw: LlmNeed; basedOn?: BasedOn };

export type InterpretOptions = {
  text: string;
  /** "Now" for relative dates; resolved in Helsinki time. */
  now?: Date;
  /** `provider:model-id` or an AI SDK model (tests). Default: DOCK_INTERPRET_MODEL, else the cheap model of the first provider with a key. */
  model?: string | { model: LanguageModel; id: string; price?: Price };
  vocabulary?: Vocabulary;
  modelOptions?: ModelOptions;
  timeoutMs?: number;
  /** The kitchen's earlier requests, newest first, for follow-ups that refer to one. */
  earlier?: EarlierRequest[];
};

const WEEKDAYS: [string, string, string][] = [
  ["Monday", "maanantai", "måndag"],
  ["Tuesday", "tiistai", "tisdag"],
  ["Wednesday", "keskiviikko", "onsdag"],
  ["Thursday", "torstai", "torsdag"],
  ["Friday", "perjantai", "fredag"],
  ["Saturday", "lauantai", "lördag"],
  ["Sunday", "sunnuntai", "söndag"],
];

/** Today and the next 14 days in Helsinki, with weekday names in the three languages, so the model looks dates up instead of computing them. */
export function calendar(now: Date): string {
  const today = localNow(now).date;
  const name = (d: string) => WEEKDAYS[isoWeekday(d) - 1];
  const lines = [`Today is ${name(today)[0]} ${today} (Europe/Helsinki). Tomorrow: ${addDaysIso(today, 1)}.`, "The next days:"];
  for (let i = 1; i <= 14; i++) {
    const d = addDaysIso(today, i);
    const [en, fi, sv] = name(d);
    lines.push(`${d} ${en} (${fi}, ${sv})`);
  }
  return lines.join("\n");
}

const MAX_TAGS = { categories: 40, attributes: 60, allergens: 30 };

/** Tags the product data actually uses, most frequent first, plus whatever the mandate names. */
export function vocabularyFrom(products: Product[], extra: Partial<Vocabulary> = {}): Vocabulary {
  const rank = (xs: string[], max: number) => {
    const n = new Map<string, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([x]) => x);
  };
  return {
    categories: rank([...(extra.categories ?? []), ...products.map((p) => p.category)], MAX_TAGS.categories),
    attributes: rank([...(extra.attributes ?? []), ...products.flatMap((p) => p.attributes)], MAX_TAGS.attributes),
    allergens: rank([...(extra.allergens ?? []), ...products.flatMap((p) => p.allergens)], MAX_TAGS.allergens),
  };
}

function tag(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
const tags = (xs: string[]) => [...new Set(xs.map(tag).filter(Boolean))].slice(0, 10);

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Plain code from the model's fields to a StructuredNeed. Throws a DockError the API returns as is. */
export function toNeed(raw: LlmNeed, text: string): StructuredNeed {
  if (!raw.isPurchaseRequest) {
    throw new DockError(422, "not_a_purchase_request", raw.notPurchaseReason?.trim() || "The text does not ask to buy anything.", undefined, { text });
  }
  const attributes = tags(raw.item.attributes);
  const excludedAttributes = tags(raw.item.excludedAttributes).filter((a) => !attributes.includes(a));
  const missing: string[] = [];
  const itemText = raw.item.text?.trim().slice(0, 200);
  if (!itemText) missing.push("item");
  const quantity = raw.quantity && raw.quantity.amount > 0 && raw.quantity.amount <= 1_000_000 ? raw.quantity : undefined;
  if (!quantity && !raw.sameAsLastTime) missing.push("quantity");
  let deliverBy: string | undefined;
  if (raw.deliverBy) {
    if (!validDate(raw.deliverBy)) throw new DockError(502, "interpret_invalid_output", `The model returned "${raw.deliverBy}" as a date.`);
    deliverBy = raw.deliverBy;
  }
  const partial = {
    text: text.slice(0, 2000),
    item: {
      text: itemText ?? "",
      ...(raw.item.category ? { category: tag(raw.item.category) } : {}),
      attributes,
      excludedAttributes,
      ...(raw.item.productId?.trim() ? { productId: raw.item.productId.trim().slice(0, 60) } : {}),
    },
    ...(quantity ? { quantity } : {}),
    ...(deliverBy ? { deliverBy } : {}),
    requiredClaims: tags(raw.requiredClaims).filter((c) => !attributes.includes(c)),
    forbiddenAllergens: tags(raw.forbiddenAllergens),
    optimise: raw.optimise,
    sameAsLastTime: raw.sameAsLastTime,
  };
  if (missing.length) {
    throw new DockError(422, "need_incomplete", `The request does not say ${missing.map((m) => (m === "item" ? "what to buy" : "how much")).join(" or ")}.`, undefined, { missing, partial });
  }
  const parsed = NeedSchema.safeParse(partial);
  if (!parsed.success) throw new DockError(502, "interpret_invalid_output", z.prettifyError(parsed.error), undefined, { partial });
  return parsed.data;
}

export async function interpretNeed(opts: InterpretOptions): Promise<InterpretResult> {
  const text = opts.text.trim();
  if (!text) throw new DockError(400, "invalid_request", "text must not be empty.");
  if (text.length > 2000) throw new DockError(400, "invalid_request", "text must be at most 2000 characters.");

  let model: LanguageModel;
  let id: string;
  let price: Price | undefined;
  if (opts.model && typeof opts.model !== "string") ({ model, id, price } = opts.model);
  else {
    const spec = opts.model ?? defaultModel("DOCK_INTERPRET_MODEL");
    if (!spec) throw new DockError(503, "model_unavailable", "No model is configured for interpretation: set DOCK_INTERPRET_MODEL or a provider API key.");
    try {
      const m = createModel(spec, opts.modelOptions);
      ({ model, price } = m);
      id = m.spec.id;
    } catch (err) {
      if (err instanceof ModelConfigError) throw new DockError(503, "model_unavailable", err.message);
      throw err;
    }
  }

  reserveLlmCall(); // public-demo caps: daily calls and spend, and the DOCK_LLM=off switch (server/limits.ts)
  const now = opts.now ?? new Date();
  const earlier = (opts.earlier ?? []).slice(0, MAX_EARLIER);
  const schema = earlier.length ? LlmFollowUp : LlmNeed;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  let res;
  try {
    res = await withRetry(
      () =>
        generateText({
          model,
          instructions: interpretSystem(opts.vocabulary ?? { categories: [], attributes: [], allergens: [] }, earlier.length > 0),
          prompt: interpretUser(text, calendar(now), earlier.length ? earlierBlock(earlier) : undefined),
          output: Output.object({ schema, name: "structured_need", description: "The buyer's need, with unstated fields left empty." }),
          maxOutputTokens: 4000,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      { deadline, policy: { maxRetries: 2, baseMs: 500, maxMs: 4000 } },
    );
  } catch (err) {
    if (Date.now() >= deadline || (err as Error)?.name === "TimeoutError") throw new DockError(504, "interpret_timeout", `The model did not answer within ${timeoutMs} ms.`);
    const status = isRetryable(err) ? 503 : 502;
    throw new DockError(status, "interpret_failed", `The model call failed: ${describeError(err)}`);
  }
  const raw = res.output as LlmNeed | LlmFollowUp;
  const tokens = tokensFromUsage(res.usage);
  recordLlmSpend(costOf(tokens, price));
  const basedOn = earlier.length ? checkBasedOn(raw as LlmFollowUp, earlier) : undefined;
  return { need: toNeed(raw, text), model: id, ms: Date.now() - t0, tokens, costUsd: costOf(tokens, price), raw, ...(basedOn ? { basedOn } : {}) };
}

const MAX_EARLIER = 6;

/** Plain code: the model may only point at a request it was given, and only name known fields. */
export function checkBasedOn(raw: Pick<LlmFollowUp, "basedOnRequestId" | "takenFromEarlier">, earlier: EarlierRequest[]): BasedOn | undefined {
  const id = raw.basedOnRequestId?.trim();
  if (!id || !earlier.some((e) => e.id === id)) return undefined;
  const fields = [...new Set((raw.takenFromEarlier ?? []).filter((f): f is BasedOn["fields"][number] => (EARLIER_FIELDS as readonly string[]).includes(f)))];
  return { requestId: id, fields };
}

/** The earlier requests as the model sees them: one compact JSON line each, newest first. */
export function earlierBlock(earlier: EarlierRequest[]): string {
  return earlier
    .map((e) => {
      const day = e.deliveredOn ? ` (delivered ${WEEKDAYS[isoWeekday(e.deliveredOn) - 1][0]} ${e.deliveredOn})` : "";
      return `- ${JSON.stringify({ id: e.id, at: e.at, buyerSaid: e.text, need: e.need, ordered: e.ordered })}${day}`;
    })
    .join("\n");
}

// ---------- the HTTP contract: POST /api/v1/agent/interpret ----------

export const InterpretBody = z.object({
  text: z.string().min(1).max(2000).describe("The buyer's request in their own words (English, Finnish or Swedish)."),
  now: z.iso.datetime({ offset: true }).optional().describe("Resolve relative dates against this instant instead of the server clock (tests, replays)."),
  earlier: z
    .array(EarlierRequestSchema)
    .max(MAX_EARLIER)
    .optional()
    .describe("The kitchen's earlier requests, newest first, so a follow-up such as \"same again but 200 litres\" can be resolved."),
});

export const InterpretResponse = z.object({
  need: NeedSchema,
  model: z.string().describe("provider:model-id that interpreted the text."),
  ms: z.number().int().describe("Time the model took, in milliseconds."),
  cached: z.boolean().optional().describe("True when the same text for the same kitchen was already interpreted today: no model call."),
  basedOn: z
    .object({ requestId: z.string(), fields: z.array(z.enum(EARLIER_FIELDS)) })
    .optional()
    .describe("Present when the text referred to one of the earlier requests: which one, and the fields taken from it."),
});

type Mandateish = { allowedCategories: string[]; requiredAttributes: string[]; forbiddenAllergens: string[] };

/** The route body: vocabulary from the product data and the caller's mandate, then interpretNeed. */
export async function interpretRequest(
  body: z.output<typeof InterpretBody>,
  ctx: { catalog: { searchProducts: (q: { limit: number }) => Promise<Product[]> }; mandate: Mandateish },
): Promise<z.input<typeof InterpretResponse>> {
  const products = await ctx.catalog.searchProducts({ limit: 100 });
  const vocabulary = vocabularyFrom(products, { categories: ctx.mandate.allowedCategories, attributes: ctx.mandate.requiredAttributes, allergens: ctx.mandate.forbiddenAllergens });
  const r = await interpretNeed({ text: body.text, now: body.now ? new Date(body.now) : undefined, vocabulary, earlier: body.earlier });
  return { need: r.need, model: r.model, ms: r.ms, ...(r.basedOn ? { basedOn: r.basedOn } : {}) };
}

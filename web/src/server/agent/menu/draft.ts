import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { calendar } from "../interpret";
import { createModel, hasCredentials, ModelConfigError, parseModelSpec } from "../models";
import { addTokens, costOf, tokensFromUsage, ZERO_TOKENS, type Price, type Tokens } from "../pricing";
import { describeError, isRetryable, withRetry } from "../retry";
import { dishSystem, dishUser, outlineSystem, outlineUser, type MenuPromptContext } from "./prompts";

/**
 * The model's part of a menu plan: dishes and per-cover ingredient amounts with the reasoning. (Which substitutes
 * suit an ingredient's use is asked only for lines that need one: see fixes.ts.) Every field is required but may be empty, which every
 * provider's structured output accepts. Plain code checks and normalises the result (sanitiseDraft) before
 * anything else reads it; nothing here touches products, money or authority.
 */

export const COURSES = ["starter", "soup", "salad", "main", "side", "dessert", "bread", "drink", "snack", "other"] as const;
export const FORMS = ["fresh", "frozen", "dried", "canned_or_jarred", "any"] as const;
export const DRAFT_UNITS = ["g", "ml", "pcs"] as const;
export type DraftUnit = (typeof DRAFT_UNITS)[number];

const Ingredient = z.object({
  key: z.string().describe("snake_case English, the same for the same ingredient in every dish"),
  name: z.string().describe("English"),
  searchTerms: z.array(z.string()),
  role: z.string().describe("what it does in this dish"),
  perCover: z.object({ amount: z.number(), unit: z.enum(DRAFT_UNITS) }),
  yieldPct: z.number(),
  amountBasis: z.string(),
  pantry: z.boolean(),
  form: z.enum(FORMS),
  avoid: z.array(z.string()),
});

const DishOutline = z.object({
  name: z.string(),
  nameFi: z.string().nullable(),
  course: z.enum(COURSES),
  serviceDate: z.string().nullable().describe("YYYY-MM-DD, for a week menu"),
  portion: z.string().describe("portion per cover, a few words"),
  method: z.string().describe("one sentence: how it is cooked"),
});
const Dish = DishOutline.extend({ ingredients: z.array(Ingredient) });

/** Step 1 output: the dishes, without ingredients. */
export const LlmOutline = z.object({
  isFoodOrderRequest: z.boolean(),
  declineReason: z.string().nullable(),
  covers: z.number().nullable(),
  serviceDate: z.string().nullable().describe("YYYY-MM-DD"),
  occasion: z.string().nullable(),
  requiredClaims: z.array(z.string()),
  forbiddenAllergens: z.array(z.string()),
  assumptions: z.array(z.string()),
  conflicts: z.array(z.string()),
  dishes: z.array(DishOutline),
});
/** Step 2 output, once per dish. */
export const LlmDishDetail = z.object({ ingredients: z.array(Ingredient), conflicts: z.array(z.string()) });
export type LlmOutline = z.infer<typeof LlmOutline>;
export type LlmDishDetail = z.infer<typeof LlmDishDetail>;

/** Both steps together: what recordings store and what sanitiseDraft reads. */
export const LlmMenuDraft = z.object({
  isFoodOrderRequest: z.boolean(),
  declineReason: z.string().nullable(),
  covers: z.number().nullable(),
  serviceDate: z.string().nullable().describe("YYYY-MM-DD"),
  occasion: z.string().nullable(),
  requiredClaims: z.array(z.string()).describe("claims the request makes a must, e.g. lactose_free, gluten_free, vegan"),
  forbiddenAllergens: z.array(z.string()).describe("allergens the request forbids, e.g. nuts, peanuts, gluten, milk"),
  assumptions: z.array(z.string()),
  conflicts: z.array(z.string()),
  dishes: z.array(Dish),
});
export type LlmMenuDraft = z.infer<typeof LlmMenuDraft>;
export type LlmIngredient = z.infer<typeof Ingredient>;

// ---------- the checked draft ----------

export type DraftIngredient = LlmIngredient;
export type DraftDish = Omit<z.infer<typeof Dish>, "ingredients"> & { id: string; ingredients: DraftIngredient[] };
export type MenuDraft = Omit<LlmMenuDraft, "dishes"> & { dishes: DraftDish[]; corrections: string[] };

/** Allergen words the request may use, to Dock's slugs. */
const ALLERGEN_SLUGS: Record<string, string> = {
  nut: "nuts", nuts: "nuts", tree_nuts: "nuts", tree_nut: "nuts", peanut: "peanuts", peanuts: "peanuts", gluten: "gluten", wheat: "wheat",
  milk: "milk", dairy: "milk", lactose: "lactose", egg: "eggs", eggs: "eggs", fish: "fish", shellfish: "crustaceans", crustaceans: "crustaceans",
  molluscs: "molluscs", soy: "soy", soya: "soy", sesame: "sesame", celery: "celery", mustard: "mustard", lupin: "lupin", sulphites: "sulphites",
};
const CLAIM_SLUGS: Record<string, string> = {
  lactose_free: "lactose_free", laktoositon: "lactose_free", gluten_free: "gluten_free", gluteeniton: "gluten_free", vegan: "vegan", vegetarian: "vegetarian",
  milk_free: "milk_free", dairy_free: "milk_free", maidoton: "milk_free", egg_free: "egg_free", organic: "organic", luomu: "organic", nut_free: "nut_free",
};

function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const clean = (s: string, max = 200) => s.replace(/\s+/g, " ").trim().slice(0, max);
const validDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/** Hard limits on what one cover can sensibly use. Beyond them the model is wrong, not the kitchen. */
export const PER_COVER_MAX: Record<DraftUnit, number> = { g: 600, ml: 750, pcs: 6 };

/**
 * Plain code over the model's draft: normalise tags and keys, check dates and numbers, and fix or flag what
 * cannot be right. Every change is listed in `corrections`, so the evaluation can report the model's mistakes.
 */
export function sanitiseDraft(raw: LlmMenuDraft): MenuDraft {
  const corrections: string[] = [];
  const claims = new Set<string>();
  const allergens = new Set<string>();
  for (const c of raw.requiredClaims) {
    const s = CLAIM_SLUGS[slug(c)] ?? slug(c);
    if (s === "nut_free") allergens.add("nuts");
    else if (s === "milk_free") allergens.add("milk");
    else if (s) claims.add(s);
  }
  for (const a of raw.forbiddenAllergens) {
    const s = ALLERGEN_SLUGS[slug(a)] ?? slug(a);
    if (s) allergens.add(s);
  }
  if (allergens.has("nuts")) allergens.add("peanuts"); // a nut-free kitchen means peanuts too
  let covers = raw.covers;
  if (covers !== null && (!Number.isFinite(covers) || covers <= 0 || covers > 20_000)) {
    corrections.push(`covers ${covers} is not a usable number; left for the chef to give.`);
    covers = null;
  }
  if (covers !== null && !Number.isInteger(covers)) covers = Math.ceil(covers);
  let serviceDate = raw.serviceDate;
  if (serviceDate !== null && !validDate(serviceDate)) {
    corrections.push(`service date "${serviceDate}" is not a date; left for the chef to give.`);
    serviceDate = null;
  }
  const dishes: DraftDish[] = [];
  raw.dishes.slice(0, 24).forEach((d, di) => {
    const seen = new Set<string>();
    const ingredients: DraftIngredient[] = [];
    for (const ing of d.ingredients.slice(0, 30)) {
      const key = slug(ing.key) || slug(ing.name);
      if (!key) continue;
      if (seen.has(key)) {
        corrections.push(`${d.name}: ${ing.name} was listed twice; kept the first.`);
        continue;
      }
      seen.add(key);
      let { amount } = ing.perCover;
      const unit = ing.perCover.unit;
      if (!Number.isFinite(amount) || amount <= 0) {
        corrections.push(`${d.name}: ${ing.name} had no usable amount per cover (${amount} ${unit}); set to 0 for the chef to fill in.`);
        amount = 0;
      } else if (amount > PER_COVER_MAX[unit]) {
        corrections.push(`${d.name}: ${ing.name} at ${amount} ${unit} per cover is beyond what one cover can use (max ${PER_COVER_MAX[unit]} ${unit}); held for the chef.`);
      }
      let yieldPct = ing.yieldPct;
      if (!Number.isFinite(yieldPct) || yieldPct < 20 || yieldPct > 100) {
        corrections.push(`${d.name}: ${ing.name} yield ${yieldPct} % is not plausible; used 100 %.`);
        yieldPct = 100;
      }
      const terms = [...new Set([...ing.searchTerms, ing.name].map((t) => clean(t, 60)).filter(Boolean))].slice(0, 5);
      ingredients.push({
        ...ing,
        key,
        name: clean(ing.name, 80),
        role: clean(ing.role),
        amountBasis: clean(ing.amountBasis),
        perCover: { amount, unit },
        yieldPct,
        searchTerms: terms,
        avoid: ing.avoid.map((a) => clean(a, 40).toLowerCase()).filter(Boolean).slice(0, 8),
      });
    }
    let dishDate = d.serviceDate;
    if (dishDate !== null && !validDate(dishDate)) {
      corrections.push(`${d.name}: service date "${dishDate}" is not a date; used the plan's date.`);
      dishDate = null;
    }
    dishes.push({ ...d, id: `dish_${di + 1}`, name: clean(d.name, 100), nameFi: d.nameFi ? clean(d.nameFi, 100) : null, portion: clean(d.portion, 120), method: clean(d.method, 300), serviceDate: dishDate, ingredients });
  });
  if (raw.isFoodOrderRequest && dishes.length === 0) corrections.push("The model said this is a food order but planned no dishes.");
  return {
    ...raw,
    covers,
    serviceDate,
    requiredClaims: [...claims],
    forbiddenAllergens: [...allergens],
    assumptions: raw.assumptions.map((a) => clean(a, 300)).slice(0, 12),
    conflicts: raw.conflicts.map((a) => clean(a, 300)).slice(0, 12),
    declineReason: raw.declineReason ? clean(raw.declineReason, 300) : null,
    occasion: raw.occasion ? clean(raw.occasion, 120) : null,
    dishes,
    corrections,
  };
}

// ---------- the model calls ----------

/**
 * Chosen on 2026-11-13 by timing the candidates on this task (one salmon-soup plan each, same prompt):
 *   Haiku 5.5   10.6 s, $0.001: plausible dishes, but bought 250 ml of liquid stock per cover; as the name check
 *               it threw out good rye breads
 *   Sonnet 5.5  15.9 s, $0.029: right Finnish recipes, yields and portions
 *   Opus 5.5    23.3 s, $0.059: no better on this task, too slow for a screen
 * Sonnet 5.5 at low effort, outline first and then every dish in parallel (a three-course lunch: about 15 s).
 */
export const MENU_MODEL_DEFAULT = "anthropic:claude-sonnet-5-5";

export type CallStats = { step: string; ms: number; tokens: Tokens; costUsd: number | null };
export type DraftResult = { draft: MenuDraft; raw: LlmMenuDraft; model: string; ms: number; tokens: Tokens; costUsd: number | null; calls: CallStats[] };

export type DraftOptions = {
  text: string;
  now?: Date;
  context: MenuPromptContext;
  /** `provider:model-id`, or an AI SDK model (tests). Default: DOCK_MENU_MODEL, else MENU_MODEL_DEFAULT. */
  model?: string | { model: LanguageModel; id: string; price?: Price };
  timeoutMs?: number;
  /** Called with each dish's checked ingredients as soon as that dish is written. */
  onDish?: (ingredients: DraftIngredient[]) => void;
};

export function menuModelSpec(env: Record<string, string | undefined> = process.env): string | undefined {
  const spec = env.DOCK_MENU_MODEL || MENU_MODEL_DEFAULT;
  try {
    return hasCredentials(parseModelSpec(spec).provider, env) ? spec : undefined;
  } catch {
    return undefined;
  }
}

/** Low effort keeps the planner fast; the checks after it are code, not the model's thinking. */
function providerOptionsFor(id: string): Record<string, Record<string, string>> | undefined {
  if (id.startsWith("anthropic:")) return { anthropic: { effort: "low" } };
  if (id.startsWith("openai:")) return { openai: { reasoningEffort: "low" } };
  return undefined;
}

function resolveModel(opts: DraftOptions): { model: LanguageModel; id: string; price?: Price } {
  if (opts.model && typeof opts.model !== "string") return opts.model;
  const spec = opts.model ?? menuModelSpec();
  if (!spec) throw new DockError(503, "model_unavailable", "No model is configured for menu planning: set DOCK_MENU_MODEL or ANTHROPIC_API_KEY.");
  try {
    const m = createModel(spec);
    return { model: m.model, id: m.spec.id, price: m.price };
  } catch (err) {
    if (err instanceof ModelConfigError) throw new DockError(503, "model_unavailable", err.message);
    throw err;
  }
}

export async function draftMenu(opts: DraftOptions): Promise<DraftResult> {
  const text = opts.text.trim();
  if (!text) throw new DockError(400, "invalid_request", "text must not be empty.");
  if (text.length > 4000) throw new DockError(400, "invalid_request", "text must be at most 4000 characters.");
  const { model, id, price } = resolveModel(opts);
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  const calls: CallStats[] = [];

  async function call<T>(step: string, schema: z.ZodType<T>, instructions: string, prompt: string): Promise<T> {
    const s0 = Date.now();
    let res;
    try {
      res = await withRetry(
        () =>
          generateText({
            model,
            instructions,
            prompt,
            output: Output.object({ schema, name: step.startsWith("dish") ? "dish_ingredients" : "menu_outline" }),
            maxOutputTokens: 12_000,
            maxRetries: 0,
            providerOptions: providerOptionsFor(id),
            abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          }),
        { deadline, policy: { maxRetries: 1, baseMs: 500, maxMs: 3000 } },
      );
    } catch (err) {
      if (Date.now() >= deadline || (err as Error)?.name === "TimeoutError") throw new DockError(504, "menu_timeout", `The model did not answer within ${timeoutMs} ms.`);
      throw new DockError(isRetryable(err) ? 503 : 502, "menu_model_failed", `The model call failed (${step}): ${describeError(err)}`);
    }
    const tokens = tokensFromUsage(res.usage);
    calls.push({ step, ms: Date.now() - s0, tokens, costUsd: costOf(tokens, price) });
    return res.output as T;
  }

  const outline = await call("outline", LlmOutline, outlineSystem(opts.context), outlineUser(text, calendar(now)));
  const dishes = outline.isFoodOrderRequest ? outline.dishes.slice(0, 12) : [];
  const details = await Promise.all(
    dishes.map((d, i) =>
      call(
        `dish ${i + 1}`,
        LlmDishDetail,
        dishSystem(opts.context),
        dishUser({ text, dish: d, otherDishes: dishes.filter((x) => x !== d).map((x) => x.name), claims: outline.requiredClaims, allergens: outline.forbiddenAllergens }),
      ).then((detail) => {
        // Hand each dish on as soon as it is in, so the catalogue search for it overlaps the dishes still being written.
        try {
          opts.onDish?.(sanitiseDraft({ ...outline, conflicts: [], dishes: [{ ...d, ingredients: detail.ingredients }] }).dishes[0]?.ingredients ?? []);
        } catch {
          // the plan is assembled from the full draft anyway
        }
        return detail;
      }),
    ),
  );
  const raw: LlmMenuDraft = {
    ...outline,
    conflicts: [...outline.conflicts, ...details.flatMap((d) => d.conflicts)],
    dishes: dishes.map((d, i) => ({ ...d, ingredients: details[i].ingredients })),
  };
  const tokens = calls.reduce((a, c) => addTokens(a, c.tokens), ZERO_TOKENS);
  return { draft: sanitiseDraft(raw), raw, model: id, ms: Date.now() - t0, tokens, costUsd: costOf(tokens, price), calls };
}

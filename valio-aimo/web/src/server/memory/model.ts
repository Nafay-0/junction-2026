import { z } from "zod";
import { SPEC_DIMENSIONS, dimensionLabel, formatAmount, OPTIMISE_GOALS } from "@/core/need";
import type { MemoryDoor, MemoryFact, MemoryItem, MemoryKind, MemoryStrength } from "@/core/kitchen";
import { normaliseAllergen, normaliseWantedTag, slug } from "@/core/vocabulary";
import { sha256Hex } from "@/core/util";

/**
 * The memory model's vocabulary: what an interaction looks like when it reaches the writer, what a candidate
 * item is, and the plain-code helpers that validate a fact, name it, and tell whether two facts are about the
 * same thing (merge) or say opposite things about it (contradiction). No model calls here.
 */

// ---------- interactions: what happened, through any door ----------

/**
 * A segment is a piece of text in the record, with who wrote it:
 *   buyer        words a person typed
 *   transcript   a voice note, transcribed
 *   photo_text   text read from a photo of a list
 *   product_text a product's name or description shown to the buyer: never evidence, it is the wholesaler's text
 *   system       Dock's own words (a question it asked): never evidence
 */
export type SegmentSource = "buyer" | "transcript" | "photo_text" | "product_text" | "system";
export const EVIDENCE_SOURCES: readonly SegmentSource[] = ["buyer", "transcript", "photo_text"];

export type Segment = { id: string; source: SegmentSource; text: string };

export type InteractionEvent =
  | { type: "option_chosen"; family: string; productId: string; name: string; brand?: string; packSize?: number; unit?: "L" | "kg" | "pcs"; labels?: string[]; preselectedProductId?: string }
  | { type: "substitute"; family: string; forProductId?: string; forName?: string; productId?: string; name: string; accepted: boolean; reason?: string }
  | { type: "concern_response"; code: string; memoryItemIds: string[]; action: "confirmed" | "corrected" | "cancelled" }
  | { type: "answer"; family: string; questionId: string; optionId: string; remember?: boolean }
  | { type: "order_committed"; orderId: string }
  | { type: "rule_stated"; fact: MemoryFact; family?: string; text?: string; strength?: MemoryStrength; scope?: { site?: string; person?: string } };

export type Interaction = {
  id: string;
  at: string;
  door: MemoryDoor;
  /** The person behind it (the portal relays for a named person). */
  by?: string;
  site?: string;
  requestId?: string;
  orderId?: string;
  segments: Segment[];
  events: InteractionEvent[];
};

export const InteractionSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  door: z.enum(["typed", "voice", "photo", "option_choice", "concern_response", "substitute", "answer", "memory_page", "order", "staff_proposal"]),
  site: z.string().min(1).max(80).optional(),
  requestId: z.string().min(1).max(80).optional(),
  orderId: z.string().min(1).max(80).optional(),
  segments: z.array(z.object({ id: z.string().min(1).max(40), source: z.enum(["buyer", "transcript", "photo_text", "product_text", "system"]), text: z.string().max(4000) })).max(20).default([]),
  events: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
});

// ---------- candidates: a proposed item, before plain code decides ----------

export type CandidateOrigin = "inferred" | "learned" | "stated";

export type Candidate = {
  fact: MemoryFact;
  family?: string;
  scope?: { site?: string; person?: string };
  /** What the proposer thinks it is; plain code has the last word. */
  strength: MemoryStrength;
  /** The person said it as lasting: "always", "never", "every Monday", "we are a school". */
  explicit: boolean;
  origin: CandidateOrigin;
  /** A model's candidate must point at the record: a segment and the exact words in it. Code-made candidates point at orders or events. */
  evidence: { segmentId?: string; quote?: string; orderIds?: string[]; event?: string };
  reason?: string;
  /** The person's own wording for the item (the memory page), instead of the generated line. */
  text?: string;
  /** Learned candidates: how much the behaviour says (0..1). */
  weight?: number;
};

// ---------- facts ----------

/** The fourteen allergens EU food law requires to be declared (Regulation 1169/2011, Annex II), in the catalogue's words. */
export const KNOWN_ALLERGENS = ["milk", "eggs", "fish", "crustaceans", "molluscs", "nuts", "peanuts", "soy", "gluten", "celery", "mustard", "sesame", "sulphites", "lupin"];
/** Dietary claims a kitchen can make a rule of. */
export const DIET_CLAIMS = ["lactose_free", "low_lactose", "gluten_free", "wheat_free", "egg_free", "soy_free", "vegan", "vegetarian", "organic"];

const weekday = z.number().int().min(1).max(7);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const short = z.string().trim().min(1).max(120);
const amount = z.number().positive().max(1_000_000);
const unit = z.enum(["L", "kg", "pcs"]);
const stance = z.enum(["prefer", "avoid"]);

export const FactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allergen"), allergen: short }),
  z.object({ kind: z.literal("diet"), claim: short }),
  z.object({ kind: z.literal("spec"), dimension: short, choice: short }),
  z.object({ kind: z.literal("product"), productId: short, name: short, stance }),
  z.object({ kind: z.literal("brand"), brand: short, stance }),
  z.object({ kind: z.literal("pack"), packSize: amount, unit, stance }),
  z.object({ kind: z.literal("delivery_days"), weekdays: z.array(weekday).min(1).max(7) }),
  z.object({ kind: z.literal("receiving_hours"), from: time, to: time }),
  z.object({ kind: z.literal("budget"), weeklyCents: z.number().int().positive().max(100_000_000).optional(), perOrderCents: z.number().int().positive().max(100_000_000).optional() }),
  z.object({ kind: z.literal("substitute"), forProductId: short.optional(), forName: short.optional(), productId: short.optional(), name: short, accepted: z.boolean(), reason: z.string().trim().max(300).optional() }),
  z.object({ kind: z.literal("standing_order"), weekdays: z.array(weekday).min(1).max(7), amount, unit, low: amount, high: amount }),
  z.object({ kind: z.literal("seasonal"), months: z.array(z.number().int().min(1).max(12)).min(1).max(12), description: z.string().trim().min(3).max(300), factor: z.number().positive().max(20).optional() }),
  z.object({ kind: z.literal("goal"), goal: z.enum(OPTIMISE_GOALS) }),
  z.object({ kind: z.literal("note"), text: z.string().trim().min(3).max(500) }),
]);

export type FactProblem = { ok: false; reason: string };

/** Validate and put a fact in the catalogue's words. Unknown allergens, claims and dimensions are refused, not guessed. */
export function normaliseFact(input: unknown): { ok: true; fact: MemoryFact } | FactProblem {
  const parsed = FactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: `malformed: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const f = parsed.data as MemoryFact;
  switch (f.kind) {
    case "allergen": {
      const a = normaliseAllergen(f.allergen);
      return KNOWN_ALLERGENS.includes(a) ? { ok: true, fact: { kind: "allergen", allergen: a } } : { ok: false, reason: `unknown allergen "${f.allergen}"` };
    }
    case "diet": {
      const t = normaliseWantedTag(f.claim);
      if (t.kind === "forbid_allergen") return { ok: true, fact: { kind: "allergen", allergen: t.value } }; // "nut free" is an allergen rule
      return t.kind === "claim" && DIET_CLAIMS.includes(t.value) ? { ok: true, fact: { kind: "diet", claim: t.value } } : { ok: false, reason: `unknown dietary claim "${f.claim}"` };
    }
    case "spec": {
      const dim = SPEC_DIMENSIONS.find((d) => d.id === f.dimension);
      const choice = f.choice === "none" ? "none" : normaliseWantedTag(f.choice).value;
      if (!dim || !(choice === "none" ? !!dim.noneLabel : dim.values.some((v) => v.attribute === choice))) return { ok: false, reason: `unknown choice ${f.dimension}=${f.choice}` };
      return { ok: true, fact: { kind: "spec", dimension: dim.id, choice } };
    }
    case "delivery_days":
      return { ok: true, fact: { kind: "delivery_days", weekdays: [...new Set(f.weekdays)].sort() } };
    case "standing_order": {
      if (f.low > f.high || f.amount < f.low || f.amount > f.high) return { ok: false, reason: "standing order range does not hold its amount" };
      return { ok: true, fact: { ...f, weekdays: [...new Set(f.weekdays)].sort() } };
    }
    case "receiving_hours":
      return f.from < f.to ? { ok: true, fact: f } : { ok: false, reason: "receiving hours end before they start" };
    case "budget":
      return f.weeklyCents || f.perOrderCents ? { ok: true, fact: f } : { ok: false, reason: "budget without an amount" };
    case "seasonal":
      return { ok: true, fact: { ...f, months: [...new Set(f.months)].sort((a, b) => a - b) } };
    default:
      return { ok: true, fact: f };
  }
}

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (tag: string) => tag.replaceAll("_", "-");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The short label a card shows when the item is used: "Lactose-free", "No nuts", "Semi-skimmed (1.5 %)". */
export function factLabel(f: MemoryFact): string {
  switch (f.kind) {
    case "allergen":
      return `No ${f.allergen}`;
    case "diet":
      return cap(pretty(f.claim));
    case "spec": {
      const dim = SPEC_DIMENSIONS.find((d) => d.id === f.dimension);
      return dim ? dimensionLabel(dim, f.choice) : f.choice;
    }
    case "product":
      return f.stance === "prefer" ? f.name : `Not ${f.name}`;
    case "brand":
      return f.stance === "prefer" ? `${f.brand} brand` : `Not ${f.brand}`;
    case "pack":
      return `${f.stance === "prefer" ? "" : "Not "}${formatAmount(f.packSize, f.unit)} packs`.trim();
    case "delivery_days":
      return `Receives ${f.weekdays.map((d) => WEEKDAY[d]).join(", ")}`;
    case "receiving_hours":
      return `Receiving ${f.from} to ${f.to}`;
    case "budget":
      return f.weeklyCents ? `About €${Math.round(f.weeklyCents / 100)} a week` : `About €${Math.round((f.perOrderCents ?? 0) / 100)} an order`;
    case "substitute":
      return `${f.accepted ? "Accepts" : "Declined"} ${f.name}${f.forName ? ` for ${f.forName}` : ""}`;
    case "standing_order":
      return `Standing ${f.weekdays.map((d) => WEEKDAY[d]).join(", ")} order`;
    case "seasonal":
      return `${f.months.map((m) => MONTH[m]).join(", ")}: ${f.description}`;
    case "goal":
      return f.goal === "price" ? "Lowest price" : f.goal === "co2" ? "Lowest CO2" : "Most reliable delivery";
    case "note":
      return "Note";
  }
}

/** One line for people: what is remembered, for what, and the kitchen's reason when it gave one. */
export function describeFact(f: MemoryFact, family?: string, reason?: string): string {
  const fam = family ? ` (${family})` : "";
  const why = reason ? `: ${reason}` : "";
  switch (f.kind) {
    case "allergen":
      return `Never ${f.allergen}${fam}${why}`;
    case "diet":
      return `Always ${pretty(f.claim)}${fam}${why}`;
    case "spec":
      return `${factLabel(f)}${fam}${why}`;
    case "product":
      return `${f.stance === "prefer" ? "Prefers" : "Avoids"} ${f.name}${why}`;
    case "brand":
      return `${f.stance === "prefer" ? "Prefers" : "Avoids"} ${f.brand}${fam}${why}`;
    case "pack":
      return `${f.stance === "prefer" ? "Prefers" : "Avoids"} ${formatAmount(f.packSize, f.unit)} packs${fam}${why}`;
    case "delivery_days":
      return `Receives deliveries on ${f.weekdays.map((d) => WEEKDAY[d]).join(", ")}${why}`;
    case "receiving_hours":
      return `Receives goods ${f.from} to ${f.to}${why}`;
    case "budget":
      return `${factLabel(f)}${fam}${why}`;
    case "substitute":
      return `${f.accepted ? "Accepted" : "Turned down"} ${f.name} as a substitute${f.forName ? ` for ${f.forName}` : ""}${f.reason ? `: "${f.reason}"` : ""}`;
    case "standing_order":
      return `Standing ${f.weekdays.map((d) => WEEKDAY[d]).join(", ")} order${fam}: usually ${formatAmount(f.amount, f.unit)}, normally ${formatAmount(f.low, f.unit)} to ${formatAmount(f.high, f.unit)}`;
    case "seasonal":
      return `${factLabel(f)}${f.factor ? ` (about ${f.factor}x)` : ""}${fam}`;
    case "goal":
      return `Chooses by ${f.goal === "co2" ? "lowest CO2" : factLabel(f).toLowerCase()}${fam}${why}`;
    case "note":
      return f.text;
  }
}

// ---------- same thing, or the opposite? ----------

type Scoped = { fact: MemoryFact; family?: string; scope?: { site?: string; person?: string } };

const scopeKey = (x: Scoped) => `${x.family ?? "*"}|${x.scope?.site ?? "*"}|${x.scope?.person ?? "*"}`;
const lower = (s: string) => s.toLowerCase().trim();

/** What a fact is about, regardless of what it says about it. Two facts with the same subject can merge or contradict. */
export function subjectOf(x: Scoped): string {
  const f = x.fact;
  const s = (() => {
    switch (f.kind) {
      case "allergen":
        return `allergen:${f.allergen}`;
      case "diet":
        return `diet:${f.claim}`;
      case "spec":
        return `spec:${f.dimension}`;
      case "product":
        return `product:${f.productId}`;
      case "brand":
        return `brand:${lower(f.brand)}`;
      case "pack":
        return `pack:${f.packSize}${f.unit}`;
      case "substitute":
        return `substitute:${f.forProductId ?? lower(f.forName ?? "")}:${f.productId ?? lower(f.name)}`;
      case "standing_order":
        return `standing:${f.weekdays.join(",")}`;
      case "seasonal":
        return `seasonal:${f.months.join(",")}:${slug(f.description).slice(0, 40)}`;
      case "note":
        return `note:${slug(f.text).slice(0, 60)}`;
      default:
        return f.kind; // delivery_days, receiving_hours, budget, goal: one per scope
    }
  })();
  return `${s}|${scopeKey(x)}`;
}

/** What the fact says about its subject. Same subject and same value: the same item. */
export function valueOf(f: MemoryFact): string {
  switch (f.kind) {
    case "spec":
      return f.choice;
    case "product":
    case "brand":
    case "pack":
      return f.stance;
    case "delivery_days":
      return f.weekdays.join(",");
    case "receiving_hours":
      return `${f.from}-${f.to}`;
    case "budget":
      return `${f.weeklyCents ?? ""}/${f.perOrderCents ?? ""}`;
    case "substitute":
      return f.accepted ? "accepted" : "declined";
    case "goal":
      return f.goal;
    default:
      return ""; // allergen, diet, standing orders (updated in place), seasonal, note
  }
}

/**
 * Preferences that exclude each other within a family: a kitchen that prefers product A and is now seen to
 * prefer B is moving away from A. Returns the exclusive group, or undefined.
 */
export function preferenceGroup(x: Scoped): string | undefined {
  const f = x.fact;
  if ((f.kind === "product" || f.kind === "brand" || f.kind === "pack") && f.stance === "prefer") return `${f.kind}-prefer|${scopeKey(x)}`;
  return undefined;
}

/** A hash of what an item is about and says, for "asked once, never again" without keeping the content. */
export function keyHash(x: Scoped): string {
  return sha256Hex(`${subjectOf(x)}=${valueOf(x.fact)}`).slice(0, 24);
}

export const KIND_LABEL: Record<MemoryKind, string> = {
  allergen: "allergen rule",
  diet: "dietary rule",
  spec: "product specification",
  product: "product preference",
  brand: "brand preference",
  pack: "pack preference",
  delivery_days: "delivery days",
  receiving_hours: "receiving hours",
  budget: "budget habit",
  substitute: "substitute decision",
  standing_order: "standing order",
  seasonal: "seasonal pattern",
  goal: "how it chooses",
  note: "note",
};

/** What the kitchen's portal and the wholesaler's staff see of an item. */
export function itemView(m: MemoryItem) {
  const s = m.sources.at(-1);
  return {
    id: m.id,
    kind: m.fact.kind,
    kindLabel: KIND_LABEL[m.fact.kind],
    text: m.text,
    label: factLabel(m.fact),
    fact: m.fact,
    family: m.family,
    scope: m.scope,
    strength: m.strength,
    origin: m.origin,
    status: m.status,
    audience: m.audience,
    safety: m.safety,
    weight: Math.round(m.weight * 100) / 100,
    confirmations: m.confirmations,
    contradictions: m.contradictions,
    sources: m.sources,
    lastSource: s ? `${s.by ?? (m.origin === "learned" ? "learned from orders" : "the kitchen")}, ${s.at.slice(0, 10)}${s.quote ? `: "${s.quote}"` : ""}` : undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastUsedAt: m.lastUsedAt,
    confirmedBy: m.confirmedBy,
    mandate: m.mandate,
    history: m.history,
  };
}
export type MemoryItemView = ReturnType<typeof itemView>;

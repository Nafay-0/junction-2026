import {
  defaultAudience,
  emptyMemory,
  isSafetyFact,
  memoryPreferenceId,
  type KitchenMemory,
  type KitchenProfile,
  type MemoryFact,
  type MemoryItem,
  type MemorySource,
  type MemoryStrength,
  type MemoryTombstone,
  type StatedPreference,
} from "@/core/kitchen";
import { newId } from "@/core/util";
import { checkEvidence } from "./evidence";
import { DIET_CLAIMS, describeFact, keyHash, normaliseFact, preferenceGroup, subjectOf, valueOf, type Candidate, type Interaction } from "./model";

/**
 * The memory writer's decisions, all plain code. A candidate (from the model, or made by code from an order or
 * a tap) becomes exactly one of:
 *
 *   stored       a new item: a habit (pre-selects), a one-off (context), or a rule a person stated
 *   confirm      a one-line "should I remember this?" for the person: a model's proposal that would CONSTRAIN
 *                (an allergen or dietary rule), or a newer statement against a rule a person set
 *   merged       the same thing again: one more confirmation, more weight
 *   superseded   a newer explicit statement replaces an older item; the old one is kept, marked superseded
 *   contradicted behaviour went against an item: a habit loses weight (and fades), a rule counts it
 *   discarded    with the reason: no evidence in the record, not a person's words, an instruction inside
 *                content, an unknown allergen, a proposal the person already declined, a forgotten item's data
 *
 * Nothing a model inferred becomes a rule here: a model's candidate is at most a habit until a person says yes.
 */

// ---------- weights and thresholds ----------

/** A model's reading of a lasting statement ("we always take the 10 L boxes"): enough to pre-select at once. */
export const W_INFERRED_EXPLICIT = 0.6;
/** Said in passing ("the oat drink was nice"): below MEMORY_HABIT_MIN_WEIGHT; one more sign makes it a habit. */
export const W_INFERRED_PASSING = 0.4;
/** One option chosen: a weak sign; three choices of the same product cross the pre-select line. */
export const W_CHOICE = 0.3;
/** Each repeat confirmation adds this much, up to 1. */
export const W_CONFIRM = 0.2;
/** Contrary behaviour multiplies a habit's weight by this: two contrary choices take a fresh habit below the fade line. */
export const W_CONTRADICT = 0.6;
/** Below this a habit fades: listed, never used. */
export const FADE_BELOW = 0.25;
/** A habit not seen again halves in weight every 45 days (a kitchen's menu changes with the season, about every three months). */
export const HALF_LIFE_DAYS = 45;
/** A rule contradicted this many times since it was last confirmed is put to the person once: keep it? */
export const RULE_REVIEW_AFTER = 3;
/** One-offs are context for two weeks, then fade. */
export const ONE_OFF_DAYS = 14;
/** Per kitchen. Past this, the faintest faded habits go first. */
export const MAX_ITEMS = 300;
/** Per interaction: a model proposing more than this is not reading a kitchen's request. */
export const MAX_CANDIDATES = 8;
const MAX_SOURCES = 12;
/**
 * Kinds a lasting statement makes a rule of, after one confirmation. Everything else said as lasting is a habit
 * at once (it only pre-selects, so it needs no question): the least manual correction.
 */
export const RULE_KINDS = new Set(["allergen", "diet", "goal", "delivery_days"]);
/**
 * A habit learned from what the kitchen ORDERED this many times is put to its person once as a standing rule ("You've
 * asked for lactose-free milk three times. Shall I treat that as a standing rule?"). Never applied by itself: it waits
 * for a yes (answerConfirmation); a no is remembered and not asked again. Only kinds that narrow what is bought.
 */
export const PROPOSE_RULE_AFTER = 3;
const PROPOSABLE = new Set(["spec", "goal"]);
const PROPOSED = "proposed as a standing rule";

export type Outcome = {
  action: "stored" | "confirm" | "merged" | "superseded" | "contradicted" | "discarded";
  reason: string;
  itemId?: string;
  /** For `confirm`: the one line to put to the person. */
  question?: string;
  text?: string;
  candidate?: Candidate;
};

const iso = (d: Date) => d.toISOString();
const days = (from: string, to: Date) => (to.getTime() - Date.parse(from)) / 86_400_000;

function memoryOf(profile: KitchenProfile): KitchenMemory {
  const m = profile.memory ?? emptyMemory();
  return { items: m.items ?? [], forgotten: m.forgotten ?? [], staffReads: m.staffReads ?? [], proposals: m.proposals ?? [] };
}

function sourceOf(interaction: Interaction, c: Candidate, quote?: string): MemorySource[] {
  const base = { door: interaction.door, at: interaction.at, by: interaction.by, interactionId: interaction.id, requestId: interaction.requestId };
  if (c.evidence.orderIds?.length) return c.evidence.orderIds.slice(-MAX_SOURCES).map((orderId) => ({ ...base, door: "order" as const, orderId, by: undefined }));
  return [{ ...base, orderId: interaction.orderId, ...(quote ? { quote } : {}) }];
}

function addSources(item: MemoryItem, sources: MemorySource[]) {
  const seen = new Set(item.sources.map((s) => `${s.interactionId}|${s.orderId}|${s.quote}`));
  for (const s of sources) if (!seen.has(`${s.interactionId}|${s.orderId}|${s.quote}`)) item.sources.push(s);
  item.sources = item.sources.slice(-MAX_SOURCES);
}

function newItem(c: Candidate, fact: MemoryFact, interaction: Interaction, now: Date, over: Partial<MemoryItem>, quote?: string): MemoryItem {
  const at = iso(now);
  const strength = over.strength ?? c.strength;
  return {
    id: newId("mem"),
    fact,
    text: c.text?.trim().slice(0, 300) || describeFact(fact, c.family, c.reason),
    ...(c.family ? { family: c.family } : {}),
    ...(c.scope && (c.scope.site || c.scope.person) ? { scope: c.scope } : {}),
    strength,
    origin: c.origin,
    status: "active",
    audience: defaultAudience(fact),
    safety: isSafetyFact(fact),
    weight: strength === "rule" ? 1 : (c.weight ?? W_INFERRED_PASSING),
    confirmations: 1,
    contradictions: 0,
    sources: sourceOf(interaction, c, quote),
    createdAt: at,
    updatedAt: at,
    lastConfirmedAt: at,
    weighedAt: at,
    ...(strength === "one_off" ? { expiresAt: iso(new Date(now.getTime() + ONE_OFF_DAYS * 86_400_000)) } : {}),
    history: [{ at, change: `created (${c.origin}${c.explicit ? ", stated as lasting" : ""})`, by: interaction.by }],
    ...over,
  };
}

const live = (m: MemoryItem) => m.status === "active" || m.status === "pending_confirmation" || m.status === "faded";

/** Apply candidates from one interaction to a profile. Pure: returns a new profile and one outcome per candidate. */
export function decide(profile: KitchenProfile, candidates: Candidate[], interaction: Interaction, now: Date): { profile: KitchenProfile; outcomes: Outcome[] } {
  const p: KitchenProfile = structuredClone(profile);
  const mem = memoryOf(p);
  p.memory = mem;
  const outcomes: Outcome[] = [];
  const discard = (c: Candidate, reason: string) => outcomes.push({ action: "discarded", reason, candidate: c });

  let inferred = 0;
  candidates.forEach((c) => {
    if (c.origin === "inferred" && ++inferred > MAX_CANDIDATES) return discard(c, `too_many: more than ${MAX_CANDIDATES} proposals from one interaction`);
    const n = normaliseFact(c.fact);
    if (!n.ok) return discard(c, n.reason);
    const fact = n.fact;
    const cand: Candidate = { ...c, fact };

    // The no-evidence rule: a model's candidate must rest on a person's exact words in this record.
    let quote: string | undefined;
    if (cand.origin === "inferred") {
      const v = checkEvidence(cand, interaction);
      if (!v.ok) return discard(cand, v.reason);
      quote = v.quote;
    } else if (cand.origin === "learned" && !cand.evidence.orderIds?.length && !cand.evidence.event) {
      return discard(cand, "no_evidence: a learned candidate names no order or event");
    }
    // A model may never invent a person's scope: a site must be named in its quote.
    if (cand.origin === "inferred" && cand.scope?.site && !quote!.toLowerCase().includes(cand.scope.site.toLowerCase())) {
      return discard(cand, "no_evidence: the site is not in the quote");
    }

    const hash = keyHash(cand);
    if (cand.origin !== "stated" && mem.forgotten.some((t) => t.reason === "declined" && t.keyHash === hash)) return discard(cand, "declined_before: the person already said no to this");
    if (cand.origin === "learned" && cand.evidence.orderIds?.length) {
      const gone = new Set(mem.forgotten.filter((t) => t.reason !== "declined").flatMap((t) => t.interactionIds));
      if (cand.evidence.orderIds.every((o) => gone.has(o))) return discard(cand, "forgotten: rests only on orders behind a forgotten item");
    }

    const subject = subjectOf(cand);
    // Exclusive preferences: preferring B (by choice or in words) is a sign against preferring A in the same family.
    const group = preferenceGroup(cand);
    if (group && (cand.origin === "learned" || cand.explicit)) {
      for (const other of mem.items.filter((m) => m.status === "active" && m.strength === "habit" && preferenceGroup(m) === group && subjectOf(m) !== subject)) {
        weaken(other, interaction, now, `the kitchen went for ${describeFact(fact)}`);
      }
    }
    // A note that only repeats what another proposal from the same words already holds is not a second item.
    if (cand.origin === "inferred" && fact.kind === "note" && candidates.some((o) => o !== c && o.origin === "inferred" && o.fact.kind !== "note" && o.evidence.quote && quote && (quote.includes(o.evidence.quote) || o.evidence.quote.includes(quote)))) {
      return discard(cand, "covered: the same words are already a typed item");
    }
    const exact = mem.items.find((m) => live(m) && subjectOf(m) === subject && valueOf(m.fact) === valueOf(fact));
    if (exact) {
      const merged = merge(exact, cand, interaction, now, quote);
      return outcomes.push(proposeRule(mem, exact, cand, interaction, now) ?? merged);
    }
    const same = mem.items.find((m) => (m.status === "active" || m.status === "pending_confirmation") && subjectOf(m) === subject) ?? mem.items.find((m) => live(m) && subjectOf(m) === subject);
    // Deliveries on some of the days a person said the kitchen receives agree with what they said.
    if (same && fact.kind === "delivery_days" && same.fact.kind === "delivery_days" && cand.origin === "learned" && same.origin !== "learned") {
      const said = same.fact.weekdays;
      if (fact.weekdays.every((d) => said.includes(d))) return outcomes.push({ action: "merged", reason: "deliveries fall on the days the kitchen said it receives", itemId: same.id, text: same.text });
    }
    if (same) return outcomes.push(contradict(mem, same, cand, fact, interaction, now, quote));
    outcomes.push(create(mem, cand, fact, interaction, now, quote));
  });

  fade(mem, now);
  cap(mem);
  project(p, now);
  return { profile: p, outcomes };
}

/**
 * After a merge: a habit learned from orders that has now been seen PROPOSE_RULE_AFTER times becomes a one-line
 * question to the kitchen's person (a rule waiting for a yes, replacing the habit when confirmed). Once per habit.
 */
function proposeRule(mem: KitchenMemory, habit: MemoryItem, c: Candidate, interaction: Interaction, now: Date): Outcome | undefined {
  if (c.origin !== "learned" || habit.strength !== "habit" || habit.status !== "active" || !PROPOSABLE.has(habit.fact.kind)) return undefined;
  if (habit.confirmations < PROPOSE_RULE_AFTER || habit.history.some((h) => h.change.startsWith(PROPOSED))) return undefined;
  if (mem.items.some((m) => m.status === "pending_confirmation" && m.replaces === habit.id)) return undefined;
  const at = iso(now);
  habit.history.push({ at, change: `${PROPOSED} after ${habit.confirmations} orders`, by: interaction.by });
  const item = newItem({ ...c, text: habit.text }, habit.fact, interaction, now, { strength: "rule", status: "pending_confirmation", weight: 1, replaces: habit.id, sources: habit.sources.slice(-MAX_SOURCES) });
  item.history.push({ at, change: `${PROPOSED}: seen in ${habit.confirmations} orders`, by: interaction.by });
  mem.items.push(item);
  const what = habit.text.charAt(0).toLowerCase() + habit.text.slice(1);
  return { action: "confirm", reason: `learned from ${habit.confirmations} orders: put to the person once as a standing rule, never applied alone`, itemId: item.id, text: item.text, question: `You've asked for ${what} ${habit.confirmations} times. Shall I treat that as a standing rule?` };
}

function create(mem: KitchenMemory, c: Candidate, fact: MemoryFact, interaction: Interaction, now: Date, quote: string | undefined): Outcome {
  if (c.origin === "stated") {
    // A person said it on the memory page, answered "remember this", or confirmed a substitute: it is theirs.
    const strength: MemoryStrength = c.strength;
    const item = newItem(c, fact, interaction, now, { strength, weight: c.weight ?? 1, ...(interaction.by ? { confirmedBy: { by: interaction.by, at: iso(now) } } : {}) }, quote);
    mem.items.push(item);
    return { action: "stored", reason: `stated by ${interaction.by ?? "the kitchen"}`, itemId: item.id, text: item.text };
  }
  if (c.origin === "learned") {
    const item = newItem(c, fact, interaction, now, { strength: c.strength === "rule" ? "habit" : c.strength, weight: c.weight ?? W_CHOICE });
    mem.items.push(item);
    return { action: "stored", reason: "learned from behaviour: a habit, it only pre-selects", itemId: item.id, text: item.text };
  }
  // Inferred by a model from a person's words.
  if (c.strength === "one_off") {
    const item = newItem(c, fact, interaction, now, { strength: "one_off", weight: W_INFERRED_PASSING }, quote);
    mem.items.push(item);
    return { action: "stored", reason: "one-off: context for this request, never applied later", itemId: item.id, text: item.text };
  }
  if (c.explicit && RULE_KINDS.has(fact.kind)) {
    // A rule constrains (allergens, diets), lets the agent act alone (the goal) or blocks a day (delivery days):
    // a model's reading of one needs a person's yes, once.
    const item = newItem(c, fact, interaction, now, { strength: "rule", status: "pending_confirmation", weight: 1 }, quote);
    mem.items.push(item);
    return { action: "confirm", reason: isSafetyFact(fact) ? "a rule that would constrain every order: a person confirms it once" : "a rule that would change what the agent does alone: a person confirms it once", itemId: item.id, text: item.text, question: `Remember "${item.text}" for every ${c.family ? `${c.family} ` : ""}order${c.scope?.site ? ` for ${c.scope.site}` : ""}?` };
  }
  const weight = c.explicit ? W_INFERRED_EXPLICIT : W_INFERRED_PASSING;
  const item = newItem(c, fact, interaction, now, { strength: "habit", weight }, quote);
  mem.items.push(item);
  return { action: "stored", reason: c.explicit ? "stated as lasting: kept as a habit, which only pre-selects or informs (the memory page can make it a rule)" : "said in passing: a faint habit until seen again", itemId: item.id, text: item.text };
}

function merge(item: MemoryItem, c: Candidate, interaction: Interaction, now: Date, quote?: string): Outcome {
  const at = iso(now);
  const fresh = sourceOf(interaction, c, quote).filter((s) => !item.sources.some((x) => (s.orderId ? x.orderId === s.orderId : x.interactionId === s.interactionId && x.quote === s.quote)));
  // Learned facts (standing orders) are recomputed from history: take the new numbers.
  if (c.origin === "learned" && JSON.stringify(item.fact) !== JSON.stringify(c.fact)) {
    item.history.push({ at, change: "updated from recent orders", previous: item.fact });
    item.fact = c.fact;
    item.text = describeFact(c.fact, item.family);
  }
  if (!fresh.length) return { action: "merged", reason: "already known from the same record", itemId: item.id, text: item.text };
  addSources(item, fresh);
  item.confirmations += 1;
  item.lastConfirmedAt = at;
  item.updatedAt = at;
  if (item.strength !== "rule") item.weight = Math.min(1, Math.max(item.weight + W_CONFIRM, c.weight ?? 0));
  item.weighedAt = at;
  if (item.status === "faded") {
    item.status = "active";
    item.history.push({ at, change: "seen again: active", by: interaction.by });
  }
  // A person saying a habit as a rule makes it one; a model's reading of it stays a habit.
  if (c.origin === "stated" && c.strength === "rule" && item.strength !== "rule") {
    item.strength = "rule";
    item.weight = 1;
    item.confirmedBy = { by: interaction.by ?? "the kitchen", at };
    item.history.push({ at, change: "made a rule", by: interaction.by });
  }
  return { action: "merged", reason: item.status === "pending_confirmation" ? "already waiting for the person's answer: not asked twice" : `confirmed again (${item.confirmations} times)`, itemId: item.id, text: item.text };
}

/**
 * Behaviour went against an item. A habit loses weight and fades below FADE_BELOW; a rule is never changed by
 * behaviour, but after RULE_REVIEW_AFTER contradictions since it was last confirmed the person is asked once.
 */
function weaken(item: MemoryItem, interaction: Interaction, now: Date, why: string): Outcome | undefined {
  const at = iso(now);
  item.contradictions += 1;
  item.updatedAt = at;
  if (item.strength === "rule") {
    item.history.push({ at, change: `contradicted: ${why}`, by: interaction.by });
    const since = item.lastConfirmedAt ?? item.createdAt;
    const asked = item.history.some((h) => h.change.startsWith("review asked") && h.at >= since);
    if (item.status === "active" && !asked && item.contradictions >= RULE_REVIEW_AFTER) {
      item.history.push({ at, change: "review asked: contradicted repeatedly" });
      return { action: "confirm", reason: `the rule was gone against ${item.contradictions} times`, itemId: item.id, text: item.text, question: `Orders went against "${item.text}" ${item.contradictions} times. Keep the rule?` };
    }
    return undefined;
  }
  item.weight *= W_CONTRADICT;
  item.weighedAt = at;
  item.history.push({ at, change: `contradicted: ${why}; weight ${item.weight.toFixed(2)}`, by: interaction.by });
  if (item.weight < FADE_BELOW && item.status === "active") {
    item.status = "faded";
    item.history.push({ at, change: "faded: behaviour changed" });
  }
  return undefined;
}

/**
 * The buyer answered a mistake check that cited memory: correcting it confirms the cited items, confirming the
 * order "as intended" goes against them.
 */
export function respondToCitedItems(profile: KitchenProfile, itemIds: string[], agreed: boolean, interaction: Interaction, now: Date): { profile: KitchenProfile; outcomes: Outcome[] } {
  const p = structuredClone(profile);
  const mem = memoryOf(p);
  p.memory = mem;
  const outcomes: Outcome[] = [];
  for (const id of itemIds) {
    const item = mem.items.find((m) => m.id === id && m.status === "active");
    if (!item) continue;
    if (agreed) {
      const at = iso(now);
      item.confirmations += 1;
      item.lastConfirmedAt = at;
      item.updatedAt = at;
      if (item.strength === "habit") item.weight = Math.min(1, item.weight + W_CONFIRM);
      item.weighedAt = at;
      addSources(item, [{ door: interaction.door, at, by: interaction.by, interactionId: interaction.id, requestId: interaction.requestId }]);
      item.history.push({ at, change: "the check it raised was right: the buyer corrected the order", by: interaction.by });
      outcomes.push({ action: "merged", reason: "the mistake check it raised was taken", itemId: id, text: item.text });
    } else {
      const review = weaken(item, interaction, now, "the buyer ordered as intended despite it");
      outcomes.push(review ?? { action: "contradicted", reason: "the buyer ordered as intended despite it", itemId: id, text: item.text });
    }
  }
  fade(mem, now);
  project(p, now);
  return { profile: p, outcomes };
}

function contradict(mem: KitchenMemory, old: MemoryItem, c: Candidate, fact: MemoryFact, interaction: Interaction, now: Date, quote?: string): Outcome {
  const at = iso(now);
  const explicitPerson = c.origin === "stated" || (c.origin === "inferred" && c.explicit);
  if (!explicitPerson) {
    // Behaviour against an item: weaken it, and start the new pattern as a faint habit.
    const review = weaken(old, interaction, now, describeFact(fact, c.family));
    if (review) return review;
    if (c.origin === "learned" && old.strength !== "rule") {
      const item = newItem(c, fact, interaction, now, { strength: "habit", weight: c.weight ?? W_CHOICE });
      if (old.status === "faded") {
        old.status = "superseded";
        old.supersededBy = item.id;
        item.history.push({ at, change: `replaces a faded habit: ${old.text}` });
      }
      mem.items.push(item);
      return { action: "contradicted", reason: `behaviour went against "${old.text}"; the new pattern starts as a faint habit`, itemId: item.id, text: item.text };
    }
    return { action: "contradicted", reason: `behaviour went against "${old.text}"`, itemId: old.id, text: old.text };
  }
  // A newer explicit statement. It wins, unless it would replace a rule on a model's reading alone, or weaken a safety rule.
  const needsPerson = c.origin === "inferred" && (old.strength === "rule" || old.safety || RULE_KINDS.has(fact.kind));
  if (needsPerson) {
    const asRule = old.strength === "rule" || RULE_KINDS.has(fact.kind);
    const item = newItem(c, fact, interaction, now, { strength: asRule ? "rule" : old.strength, status: "pending_confirmation", weight: 1, replaces: old.id }, quote);
    mem.items.push(item);
    return old.strength === "rule"
      ? { action: "confirm", reason: "a newer statement against a rule a person set: the person decides", itemId: item.id, text: item.text, question: `Replace "${old.text}" with "${item.text}"?` }
      : { action: "confirm", reason: "a rule in the person's words that replaces a learned habit: confirmed once", itemId: item.id, text: item.text, question: `Remember "${item.text}" for every order (instead of "${old.text}")?` };
  }
  const strength: MemoryStrength = c.origin === "stated" ? c.strength : "habit";
  const item = newItem(c, fact, interaction, now, { strength, weight: strength === "rule" ? 1 : W_INFERRED_EXPLICIT, ...(c.origin === "stated" && interaction.by ? { confirmedBy: { by: interaction.by, at } } : {}) }, quote);
  supersede(old, item, interaction, now);
  mem.items.push(item);
  return { action: "superseded", reason: `newer explicit statement replaces "${old.text}" (kept in its history)`, itemId: item.id, text: item.text };
}

function supersede(old: MemoryItem, by: MemoryItem, interaction: Interaction, now: Date) {
  const at = iso(now);
  old.status = "superseded";
  old.supersededBy = by.id;
  old.updatedAt = at;
  old.history.push({ at, change: `superseded by "${by.text}"`, by: interaction.by });
  by.history.push({ at, change: `replaces "${old.text}"`, by: interaction.by, previous: old.fact });
  if (old.derived?.deliveryWeekdaysBefore) by.derived = { ...by.derived, deliveryWeekdaysBefore: old.derived.deliveryWeekdaysBefore };
}

/** Time fades habits; expired one-offs fade; long-faded one-offs go. */
export function fade(mem: KitchenMemory, now: Date) {
  const at = iso(now);
  for (const m of mem.items) {
    if (m.status !== "active") continue;
    if (m.strength === "one_off") {
      if (m.expiresAt && m.expiresAt <= at) {
        m.status = "faded";
        m.history.push({ at, change: "one-off expired" });
      }
      continue;
    }
    if (m.strength !== "habit") continue;
    const since = days(m.weighedAt ?? m.lastConfirmedAt ?? m.createdAt, now);
    if (since <= 0) continue;
    m.weight *= Math.pow(0.5, since / HALF_LIFE_DAYS);
    m.weighedAt = at;
    if (m.weight < FADE_BELOW) {
      m.status = "faded";
      m.history.push({ at, change: `faded: not seen for ${Math.round(days(m.lastConfirmedAt ?? m.createdAt, now))} days` });
    }
  }
  mem.items = mem.items.filter((m) => !(m.strength === "one_off" && m.status === "faded" && m.expiresAt && days(m.expiresAt, now) > 30));
}

function cap(mem: KitchenMemory) {
  if (mem.items.length <= MAX_ITEMS) return;
  const order = [...mem.items].sort((a, b) => rank(a) - rank(b));
  const drop = new Set(order.slice(0, mem.items.length - MAX_ITEMS).map((m) => m.id));
  mem.items = mem.items.filter((m) => !drop.has(m.id));
}
const rank = (m: MemoryItem) => (m.strength === "rule" && m.status === "active" ? 10 : 0) + (m.status === "active" ? 2 : m.status === "pending_confirmation" ? 3 : 0) + m.weight;

// ---------- projection into what the intake already reads ----------

/** The stated preference a memory rule becomes, if the intake can enforce it. */
function preferenceFor(m: MemoryItem): StatedPreference | undefined {
  if (m.status !== "active" || m.strength !== "rule" || m.scope) return undefined;
  const common = {
    id: memoryPreferenceId(m.id),
    ...(m.family ? { family: m.family } : {}),
    text: m.text,
    statedBy: m.confirmedBy?.by ?? m.sources.find((s) => s.by)?.by ?? "the kitchen",
    statedAt: m.confirmedBy?.at ?? m.createdAt,
    ...(m.sources[0]?.requestId ? { requestId: m.sources[0].requestId } : {}),
  };
  const f = m.fact;
  if (f.kind === "allergen") return { ...common, kind: "forbid_allergen", allergen: f.allergen };
  if (f.kind === "diet") return { ...common, kind: "require_claim", claim: f.claim };
  if (f.kind === "spec") return { ...common, kind: "dimension", dimension: f.dimension, choice: f.choice };
  if (f.kind === "goal") return { ...common, kind: "optimise", goal: f.goal };
  return undefined;
}

/** The memory item mirroring a stated preference that was set outside memory (an answer with "remember", the portal). */
function adopt(pref: StatedPreference): Omit<MemoryItem, "id"> | undefined {
  let fact: MemoryFact | undefined;
  if (pref.kind === "forbid_allergen") fact = { kind: "allergen", allergen: pref.allergen };
  else if (pref.kind === "require_claim") fact = DIET_CLAIMS.includes(pref.claim) ? { kind: "diet", claim: pref.claim } : undefined;
  else if (pref.kind === "dimension" && pref.choice !== "no_preference") fact = { kind: "spec", dimension: pref.dimension, choice: pref.choice };
  else if (pref.kind === "optimise" && pref.goal !== "no_preference") fact = { kind: "goal", goal: pref.goal };
  if (!fact) return undefined;
  return {
    fact,
    text: pref.text,
    ...(pref.family ? { family: pref.family } : {}),
    strength: "rule",
    origin: "stated",
    status: "active",
    audience: defaultAudience(fact),
    safety: isSafetyFact(fact),
    weight: 1,
    confirmations: 1,
    contradictions: 0,
    sources: [{ door: pref.requestId ? "answer" : "memory_page", at: pref.statedAt, by: pref.statedBy, ...(pref.requestId ? { requestId: pref.requestId } : {}) }],
    createdAt: pref.statedAt,
    updatedAt: pref.statedAt,
    confirmedBy: { by: pref.statedBy, at: pref.statedAt },
    history: [{ at: pref.statedAt, change: "stated as a rule", by: pref.statedBy }],
    derived: { preferenceId: pref.id },
  };
}

/**
 * Keep the profile's stated preferences and delivery days in step with memory:
 *   - an active, kitchen-wide rule the intake understands is a stated preference `pref_mem_<id>`
 *   - a stated preference set elsewhere (the intake's "remember", the portal) gets a mirroring item
 *   - a stated preference someone removed elsewhere takes its item with it
 *   - a delivery-days rule a person stated sets the kitchen's delivery days; the old days are kept to restore
 */
export function project(p: KitchenProfile, now: Date) {
  const mem = memoryOf(p);
  p.memory = mem;
  const stated = new Map(p.stated.map((s) => [s.id, s]));
  // Removed elsewhere: an item whose projected (or adopted) preference is gone was forgotten there.
  for (const m of [...mem.items]) {
    const pid = m.derived?.preferenceId;
    if (pid && !stated.has(pid) && m.status === "active") forgetInPlace(p, m.id, "the kitchen portal", now);
  }
  // Adopt preferences set outside memory.
  const mirrored = new Set(mem.items.flatMap((m) => (m.derived?.preferenceId ? [m.derived.preferenceId] : [])));
  for (const pref of p.stated) {
    if (pref.id.startsWith("pref_mem_") || mirrored.has(pref.id)) continue;
    const item = adopt(pref);
    if (item) mem.items.push({ id: newId("mem"), ...item });
  }
  // Project memory rules.
  const want = new Map<string, StatedPreference>();
  for (const m of mem.items) {
    const pref = preferenceFor(m);
    if (pref && !(m.derived?.preferenceId && !m.derived.preferenceId.startsWith("pref_mem_"))) want.set(pref.id, pref);
  }
  p.stated = [...p.stated.filter((s) => !s.id.startsWith("pref_mem_")), ...want.values()];
  for (const m of mem.items) {
    if (want.has(memoryPreferenceId(m.id))) m.derived = { ...m.derived, preferenceId: memoryPreferenceId(m.id) };
    else if (m.derived?.preferenceId?.startsWith("pref_mem_")) {
      const { preferenceId: _, ...rest } = m.derived;
      void _;
      m.derived = rest;
    }
  }
  // Delivery days a person stated.
  const days = mem.items.find((m) => m.status === "active" && m.strength === "rule" && !m.scope && m.fact.kind === "delivery_days");
  if (days && days.fact.kind === "delivery_days") {
    if (!days.derived?.deliveryWeekdaysBefore) days.derived = { ...days.derived, deliveryWeekdaysBefore: [...p.deliveryWeekdays] };
    p.deliveryWeekdays = [...days.fact.weekdays];
  }
}

// ---------- a person's own changes ----------

function tombstone(m: MemoryItem, by: string, now: Date, reason: "forgotten" | "declined"): MemoryTombstone {
  return {
    itemId: m.id,
    kind: m.fact.kind,
    at: iso(now),
    by,
    interactionIds: [...new Set(m.sources.flatMap((s) => [s.interactionId, s.orderId].filter((x): x is string => !!x)))],
    reason,
    ...(reason === "declined" ? { keyHash: keyHash(m) } : {}),
  };
}

/** Remove an item, the items it superseded, and everything derived from it. Returns the tombstone, or undefined if there was no such item. */
function forgetInPlace(p: KitchenProfile, itemId: string, by: string, now: Date): MemoryTombstone | undefined {
  const mem = memoryOf(p);
  p.memory = mem;
  const item = mem.items.find((m) => m.id === itemId);
  if (!item) return undefined;
  const chain = new Set([itemId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of mem.items) {
      if (m.supersededBy && chain.has(m.supersededBy) && !chain.has(m.id)) {
        chain.add(m.id);
        grew = true;
      }
    }
  }
  const gone = mem.items.filter((m) => chain.has(m.id));
  mem.items = mem.items.filter((m) => !chain.has(m.id));
  for (const m of mem.items) if (m.replaces && chain.has(m.replaces)) delete m.replaces;
  const prefIds = new Set(gone.flatMap((m) => (m.derived?.preferenceId ? [m.derived.preferenceId] : [])).concat(gone.map((m) => memoryPreferenceId(m.id))));
  p.stated = p.stated.filter((s) => !prefIds.has(s.id));
  const restore = gone.find((m) => m.derived?.deliveryWeekdaysBefore)?.derived?.deliveryWeekdaysBefore;
  if (restore && item.fact.kind === "delivery_days" && !mem.items.some((m) => m.status === "active" && m.strength === "rule" && m.fact.kind === "delivery_days")) p.deliveryWeekdays = [...restore];
  mem.proposals = mem.proposals.filter((x) => !x.itemId || !chain.has(x.itemId));
  const t = tombstone(item, by, now, "forgotten");
  t.interactionIds = [...new Set(gone.flatMap((m) => tombstone(m, by, now, "forgotten").interactionIds))];
  mem.forgotten.push(t);
  return t;
}

export function forget(profile: KitchenProfile, itemId: string, by: string, now: Date): { profile: KitchenProfile; tombstone?: MemoryTombstone } {
  const p = structuredClone(profile);
  const t = forgetInPlace(p, itemId, by, now);
  if (t) project(p, now);
  return { profile: p, tombstone: t };
}

/** A person's yes or no to a "should I remember this?" (or "keep this rule?"). */
export function answerConfirmation(profile: KitchenProfile, itemId: string, yes: boolean, by: string, now: Date): { profile: KitchenProfile; outcome: string } {
  const p = structuredClone(profile);
  const mem = memoryOf(p);
  p.memory = mem;
  const item = mem.items.find((m) => m.id === itemId);
  const at = iso(now);
  if (!item) return { profile: p, outcome: "not_found" };
  if (item.status === "active" && item.strength === "rule") {
    // "Keep this rule?" after repeated contradiction.
    if (yes) {
      item.contradictions = 0;
      item.lastConfirmedAt = at;
      item.confirmedBy = { by, at };
      item.history.push({ at, change: "kept after review", by });
      return { profile: p, outcome: "kept" };
    }
    const t = forgetInPlace(p, itemId, by, now);
    if (t) t.reason = "declined";
    project(p, now);
    return { profile: p, outcome: "removed" };
  }
  if (item.status !== "pending_confirmation") return { profile: p, outcome: "not_pending" };
  if (!yes) {
    mem.items = mem.items.filter((m) => m.id !== itemId);
    mem.forgotten.push(tombstone(item, by, now, "declined"));
    return { profile: p, outcome: "declined" };
  }
  item.status = "active";
  item.confirmedBy = { by, at };
  item.lastConfirmedAt = at;
  item.updatedAt = at;
  item.history.push({ at, change: `confirmed as a ${item.strength}`, by });
  const old = item.replaces && mem.items.find((m) => m.id === item.replaces);
  if (old) supersede(old, item, { id: "confirm", at, door: "memory_page", by, segments: [], events: [] }, now);
  delete item.replaces;
  project(p, now);
  return { profile: p, outcome: "confirmed" };
}

export type ItemChange = { text?: string; fact?: unknown; family?: string | null; strength?: MemoryStrength; site?: string | null };

/** A person corrects an item on the memory page. Their edit is a statement: the item becomes theirs. */
export function correct(profile: KitchenProfile, itemId: string, change: ItemChange, by: string, now: Date): { profile: KitchenProfile; ok: boolean; reason?: string } {
  const p = structuredClone(profile);
  const mem = memoryOf(p);
  p.memory = mem;
  const item = mem.items.find((m) => m.id === itemId);
  if (!item) return { profile: p, ok: false, reason: "not_found" };
  const at = iso(now);
  const previous = item.fact;
  if (change.fact !== undefined) {
    const n = normaliseFact(change.fact);
    if (!n.ok) return { profile: p, ok: false, reason: n.reason };
    item.fact = n.fact;
    item.safety = isSafetyFact(n.fact);
  }
  if (change.family !== undefined) {
    if (change.family === null) delete item.family;
    else item.family = change.family;
  }
  if (change.site !== undefined) item.scope = change.site ? { ...item.scope, site: change.site } : item.scope?.person ? { person: item.scope.person } : undefined;
  if (change.strength) item.strength = change.strength;
  item.text = change.text?.trim().slice(0, 300) || (change.fact !== undefined || change.family !== undefined ? describeFact(item.fact, item.family) : item.text);
  item.origin = "stated";
  item.confirmedBy = { by, at };
  item.status = item.status === "superseded" ? "superseded" : "active";
  item.weight = item.strength === "rule" ? 1 : Math.max(item.weight, W_INFERRED_EXPLICIT);
  item.updatedAt = at;
  item.lastConfirmedAt = at;
  item.weighedAt = at;
  item.sources.push({ door: "memory_page", at, by });
  item.history.push({ at, change: "corrected on the memory page", by, ...(change.fact !== undefined ? { previous } : {}) });
  project(p, now);
  return { profile: p, ok: true };
}

export function setAudience(profile: KitchenProfile, itemId: string, audience: "shared" | "private", by: string, now: Date): { profile: KitchenProfile; ok: boolean } {
  const p = structuredClone(profile);
  const item = p.memory?.items.find((m) => m.id === itemId);
  if (!item) return { profile: p, ok: false };
  if (item.audience !== audience) {
    item.audience = audience;
    item.updatedAt = iso(now);
    item.history.push({ at: iso(now), change: audience === "shared" ? "shared with the wholesaler" : "made private to the kitchen", by });
  }
  return { profile: p, ok: true };
}

/** Mark items as used on a card now. */
export function touch(profile: KitchenProfile, itemIds: string[], now: Date): KitchenProfile {
  if (!itemIds.length || !profile.memory) return profile;
  const p = structuredClone(profile);
  for (const m of p.memory!.items) if (itemIds.includes(m.id)) m.lastUsedAt = iso(now);
  return p;
}

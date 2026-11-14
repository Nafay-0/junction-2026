import { SPEC_DIMENSIONS, dimensionLabel, dimensionValue, formatAmount, type BaseUnit, type OptimiseGoal } from "./need";

/**
 * What Dock remembers about a buyer kitchen (one per organisation for now): what it ordered, what a person
 * told us it always wants, and what we infer from its history. Plain JSON, so the in-memory repository can
 * become a Postgres table without changing callers.
 *
 * The rule that matters: a learned preference only PRE-SELECTS (the buyer sees it and can change it);
 * only a preference a person stated CONSTRAINS what Dock will offer.
 */

export type HistoryLine = {
  productId: string;
  name: string;
  category: string;
  attributes: string[];
  packs: number;
  packSize: number;
  unit: BaseUnit;
  unitPriceCents: number;
};

export type HistoryEntry = {
  orderId: string;
  /** The site within the kitchen the order was for ("Päiväkoti Satu"), when the request came from one. */
  site?: string;
  requestId?: string;
  placedAt: string; // ISO timestamp the order was committed
  neededBy?: string; // what the buyer asked for
  deliveryDate: string; // latest line delivery date in the quote
  family: string; // product family: the category of the main line
  amount: number; // total in base units
  unit: BaseUnit;
  totalCents: number;
  lines: HistoryLine[];
  /** Option labels the buyer chose this order by, when it came through the intake ("best_price", ...). */
  chosenLabels?: string[];
};

type StatedCommon = {
  id: string;
  family?: string; // undefined: applies to every family
  text: string; // as shown to people: "Always lactose-free"
  statedBy: string; // the person who said it
  statedAt: string;
  requestId?: string; // the clarification it came from
};

export type StatedPreference = StatedCommon &
  (
    | { kind: "require_claim"; claim: string }
    | { kind: "forbid_allergen"; allergen: string }
    | { kind: "optimise"; goal: OptimiseGoal | "no_preference"; withinPctOfCheapest?: number }
    | { kind: "dimension"; dimension: string; choice: string } // an attribute, "none" or "no_preference"
  );

export type Evidence = { matching: number; total: number; orderIds: string[] };

/** `memoryItemId`: the habit came from the kitchen's typed memory (see MemoryItem), not from order history alone. */
export type LearnedPreference = { family: string; text: string; evidence: Evidence; memoryItemId?: string } & (
  | { kind: "dimension"; dimension: string; choice: string }
  | { kind: "product"; productId: string; name: string }
  | { kind: "optimise"; goal: OptimiseGoal }
);

export type KitchenProfile = {
  orgId: string;
  name: string;
  deliveryWeekdays: number[]; // ISO weekdays, 1 = Monday ... 7 = Sunday
  history: HistoryEntry[];
  stated: StatedPreference[];
  /** Typed memory items, written by server/memory. Absent on profiles that predate it. */
  memory?: KitchenMemory;
};

// ---------- typed memory ----------

/**
 * What the kitchen's agent remembers beyond order history: typed items, never a blob. Plain code in
 * server/memory decides what gets stored; this module only defines the shape and how habits pre-select.
 *
 *   rule      a person stated it (or confirmed a model's proposal once): it CONSTRAINS, like a stated preference
 *   habit     learned from behaviour or said in passing: it only PRE-SELECTS, and fades when behaviour changes
 *   one_off   true for one request or event ("this week only"): context, never applied to later requests
 *
 * Kitchen-wide rules that the intake understands (allergen, diet, a spec choice, the goal) are projected into
 * `stated` with id `pref_mem_<itemId>`, so the intake enforces them unchanged; delivery days a person stated
 * are projected into `deliveryWeekdays`. Forgetting an item removes those projections too.
 */
export type MemoryStrength = "rule" | "habit" | "one_off";
/** stated: a person said or confirmed it; learned: plain code read it from behaviour; inferred: a model proposed it from words. */
export type MemoryOrigin = "stated" | "learned" | "inferred";
export type MemoryStatus = "active" | "pending_confirmation" | "faded" | "superseded";
/** shared: the wholesaler's staff can read it (to serve the kitchen better); private: only the kitchen. */
export type MemoryAudience = "shared" | "private";
export type MemoryDoor = "typed" | "voice" | "photo" | "option_choice" | "concern_response" | "substitute" | "answer" | "memory_page" | "order" | "staff_proposal";
export type MemoryStance = "prefer" | "avoid";

export type MemoryFact =
  | { kind: "allergen"; allergen: string } // never this allergen
  | { kind: "diet"; claim: string } // always this claim (lactose_free, gluten_free, vegan)
  | { kind: "spec"; dimension: string; choice: string } // a SPEC_DIMENSIONS choice (fat content)
  | { kind: "product"; productId: string; name: string; stance: MemoryStance }
  | { kind: "brand"; brand: string; stance: MemoryStance }
  | { kind: "pack"; packSize: number; unit: BaseUnit; stance: MemoryStance }
  | { kind: "delivery_days"; weekdays: number[] }
  | { kind: "receiving_hours"; from: string; to: string } // "06:00".."10:00"
  | { kind: "budget"; weeklyCents?: number; perOrderCents?: number } // a habit; never touches the mandate's limits
  | { kind: "substitute"; forProductId?: string; forName?: string; productId?: string; name: string; accepted: boolean; reason?: string }
  | { kind: "standing_order"; weekdays: number[]; amount: number; unit: BaseUnit; low: number; high: number }
  | { kind: "seasonal"; months: number[]; description: string; factor?: number }
  | { kind: "goal"; goal: OptimiseGoal }
  | { kind: "note"; text: string };
export type MemoryKind = MemoryFact["kind"];

/** Where an item came from: which door, which order or request, which exact words, who, when. */
export type MemorySource = {
  door: MemoryDoor;
  at: string;
  by?: string;
  interactionId?: string;
  requestId?: string;
  orderId?: string;
  /** The exact words it rests on, copied from the record (never the model's paraphrase). */
  quote?: string;
};

export type MemoryItem = {
  id: string;
  fact: MemoryFact;
  /** One line for people: "Never nuts: this is a school kitchen". */
  text: string;
  family?: string; // product family; undefined = every family
  /** Within the kitchen: a site ("Päiväkoti Satu") or a named person the item is about. Undefined = the whole kitchen. */
  scope?: { site?: string; person?: string };
  strength: MemoryStrength;
  origin: MemoryOrigin;
  status: MemoryStatus;
  audience: MemoryAudience;
  /** Allergen and dietary items: offered for the mandate, never weakened without a person. */
  safety: boolean;
  /** Habit strength, 0..1. Rules stay at 1; habits fade with time and contrary behaviour. */
  weight: number;
  confirmations: number;
  contradictions: number;
  sources: MemorySource[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastConfirmedAt?: string;
  /** When `weight` was last decayed for time (habits fade; see server/memory/decide.ts). */
  weighedAt?: string;
  confirmedBy?: { by: string; at: string };
  expiresAt?: string; // one-offs
  /** What happened to it, oldest first; a superseded value is kept here, not lost. */
  history: { at: string; change: string; by?: string; previous?: MemoryFact }[];
  /** Data derived from it elsewhere in the profile, removed when it is forgotten. */
  derived?: { preferenceId?: string; deliveryWeekdaysBefore?: number[] };
  /** A safety rule offered for the kitchen's signed mandate, so the gate enforces it and not only memory. */
  /**
   * offered: the rule can be stated in the mandate and is not in it yet. added: the kitchen reissued its mandate with
   * it (`mandateId`), so the gate enforces it. declined: kept in memory only. intake_only: a rule the mandate cannot
   * state (a word outside its vocabulary, or one that holds for one family or site only): a preference the intake
   * uses, not something the gate enforces.
   */
  mandate?: { status: "offered" | "added" | "declined" | "intake_only"; at: string; by?: string; mandateId?: string };
  supersededBy?: string;
  /** A pending proposal that would replace this item when a person confirms it. */
  replaces?: string;
};

/** The fact that something was forgotten: no content, only what kind it was and which interactions it rested on. */
/** `declined`: a person said no to a proposal; `keyHash` (a hash of what it was about) keeps it from being asked again. */
export type MemoryTombstone = { itemId: string; kind: MemoryKind; at: string; by: string; interactionIds: string[]; reason?: "forgotten" | "declined"; keyHash?: string };
export type MemoryStaffRead = { by: string; at: string; items: number };
export type MemoryProposal = { id: string; by: string; at: string; itemId?: string; text: string; fact?: MemoryFact; status: "open" | "accepted" | "declined"; decidedBy?: string; decidedAt?: string };
export type KitchenMemory = { items: MemoryItem[]; forgotten: MemoryTombstone[]; staffReads: MemoryStaffRead[]; proposals: MemoryProposal[] };

/** A memory habit must weigh at least this much to pre-select: one passing remark (0.4) is not yet a habit. */
export const MEMORY_HABIT_MIN_WEIGHT = 0.5;

export function emptyMemory(): KitchenMemory {
  return { items: [], forgotten: [], staffReads: [], proposals: [] };
}

/** The stated-preference id a memory rule is projected to, and back. */
export const memoryPreferenceId = (itemId: string) => `pref_mem_${itemId}`;
export const memoryItemIdOf = (preferenceId: string | undefined) => (preferenceId?.startsWith("pref_mem_") ? preferenceId.slice("pref_mem_".length) : undefined);

export function isSafetyFact(f: MemoryFact): boolean {
  return f.kind === "allergen" || f.kind === "diet";
}

/** Shared with the wholesaler unless it is the kitchen's own business: free-form notes and budget habits stay private. */
export function defaultAudience(f: MemoryFact): MemoryAudience {
  return f.kind === "note" || f.kind === "budget" ? "private" : "shared";
}

/** Items in force: active, not expired, for this family (or every family). Scoped items only when the scope matches. */
export function activeMemory(profile: KitchenProfile, opts: { family?: string; site?: string; person?: string; now?: Date } = {}): MemoryItem[] {
  const now = (opts.now ?? new Date()).toISOString();
  return (profile.memory?.items ?? []).filter(
    (m) =>
      m.status === "active" &&
      (!m.expiresAt || m.expiresAt > now) &&
      (opts.family === undefined || m.family === undefined || m.family === opts.family) &&
      (!m.scope?.site || m.scope.site === opts.site) &&
      (!m.scope?.person || m.scope.person === opts.person),
  );
}

/** Habits from memory that pre-select like history-learned ones: kitchen-wide, active, heavy enough. */
function memoryHabits(profile: KitchenProfile, family: string): LearnedPreference[] {
  const out: LearnedPreference[] = [];
  for (const m of activeMemory(profile, { family })) {
    if (m.strength !== "habit" || m.weight < MEMORY_HABIT_MIN_WEIGHT || m.scope) continue;
    const evidence: Evidence = { matching: m.confirmations, total: m.confirmations + m.contradictions, orderIds: m.sources.flatMap((s) => (s.orderId ? [s.orderId] : [])) };
    const base = { family, text: `${m.text} (remembered)`, evidence, memoryItemId: m.id };
    const f = m.fact;
    if (f.kind === "spec") out.push({ ...base, kind: "dimension", dimension: f.dimension, choice: f.choice });
    else if (f.kind === "product" && f.stance === "prefer") out.push({ ...base, kind: "product", productId: f.productId, name: f.name, text: `Usually ${f.name}: ${m.text} (remembered)` });
    else if (f.kind === "goal") out.push({ ...base, kind: "optimise", goal: f.goal });
  }
  return out;
}

/** Products the kitchen's memory says it turned down: a habit read from history must not pre-select them. */
function avoidedProducts(profile: KitchenProfile, family: string): Set<string> {
  const ids = new Set<string>();
  for (const m of activeMemory(profile, { family })) {
    if (m.scope) continue;
    if (m.fact.kind === "product" && m.fact.stance === "avoid") ids.add(m.fact.productId);
    if (m.fact.kind === "substitute" && !m.fact.accepted && m.fact.productId) ids.add(m.fact.productId);
  }
  return ids;
}

// ---------- thresholds ----------

/** Learning needs at least this many orders of a family: one or two orders are a coincidence, not a habit. */
export const LEARN_MIN_ORDERS = 3;
/** ...and this share of them agreeing. 80 % lets one odd order (a sell-out week) not erase a habit. */
export const LEARN_MIN_SHARE = 0.8;
/** Only the most recent orders count, so a kitchen that changed its habits is not held to old ones. */
export const LEARN_WINDOW = 10;
/** The usual quantity is the median of this many recent orders: robust to one big catering week. */
export const QUANTITY_WINDOW = 8;
/** History kept per kitchen; older orders say little about today's needs. */
export const HISTORY_LIMIT = 200;
/**
 * Food-service routes run on weekdays. The partner's data has no route calendar, so each kitchen profile
 * carries its own delivery days; this is the default for a new one.
 */
export const DEFAULT_DELIVERY_WEEKDAYS = [1, 2, 3, 4, 5];

// ---------- history ----------

export function emptyProfile(orgId: string, name: string): KitchenProfile {
  return { orgId, name, deliveryWeekdays: [...DEFAULT_DELIVERY_WEEKDAYS], history: [], stated: [] };
}

/** Orders of one family, oldest first. */
export function familyHistory(profile: KitchenProfile, family: string): HistoryEntry[] {
  return profile.history.filter((h) => h.family === family).sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}

export function lastOrder(profile: KitchenProfile, family: string): HistoryEntry | undefined {
  return familyHistory(profile, family).at(-1);
}

/** The line that carried most of the order: what "the product" of an order is. */
export function primaryLine(entry: HistoryEntry): HistoryLine {
  return [...entry.lines].sort((a, b) => b.packs * b.packSize - a.packs * a.packSize)[0];
}

export function usualAmount(profile: KitchenProfile, family: string, site?: string): { amount: number; unit: BaseUnit; orders: number } | undefined {
  // A site's own orders are its pattern (a daycare unit's 30 L is not the school kitchen's 200 L).
  const recent = familyHistory(profile, family).filter((h) => (site ? h.site === site : !h.site)).slice(-QUANTITY_WINDOW);
  if (recent.length === 0) return undefined;
  const unit = recent.at(-1)!.unit;
  const amounts = recent.filter((h) => h.unit === unit).map((h) => h.amount).sort((a, b) => a - b);
  const mid = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
  return { amount: median, unit, orders: amounts.length };
}

export function recordOrder(profile: KitchenProfile, entry: HistoryEntry): KitchenProfile {
  const history = [...profile.history.filter((h) => h.orderId !== entry.orderId), entry]
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    .slice(-HISTORY_LIMIT);
  return { ...profile, history };
}

// ---------- preferences ----------

function prefKey(p: StatedPreference): string {
  const what = p.kind === "require_claim" ? p.claim : p.kind === "forbid_allergen" ? p.allergen : p.kind === "dimension" ? p.dimension : "";
  return `${p.kind}:${what}:${p.family ?? "*"}`;
}

/** Add a stated preference, replacing an earlier one about the same thing. */
export function addStatedPreference(profile: KitchenProfile, pref: StatedPreference): KitchenProfile {
  return { ...profile, stated: [...profile.stated.filter((p) => prefKey(p) !== prefKey(pref)), pref] };
}

export function statedFor(profile: KitchenProfile, family: string): StatedPreference[] {
  return profile.stated.filter((p) => p.family === undefined || p.family === family);
}

/** Habits read from history (and, when the profile has typed memory, its habits), each with its evidence. Never a rule: callers pre-select with these. */
export function learnPreferences(profile: KitchenProfile, family: string): LearnedPreference[] {
  return profile.memory?.items.length ? learnWithMemory(profile, family) : learnFromHistory(profile, family);
}

function learnFromHistory(profile: KitchenProfile, family: string): LearnedPreference[] {
  const recent = familyHistory(profile, family).slice(-LEARN_WINDOW);
  if (recent.length < LEARN_MIN_ORDERS) return [];
  const out: LearnedPreference[] = [];
  const habit = (key: (h: HistoryEntry) => string | undefined) => {
    const counts = new Map<string, HistoryEntry[]>();
    for (const h of recent) {
      const k = key(h);
      if (k !== undefined) counts.set(k, [...(counts.get(k) ?? []), h]);
    }
    const [best] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (!best || best[1].length / recent.length < LEARN_MIN_SHARE) return undefined;
    return { value: best[0], evidence: { matching: best[1].length, total: recent.length, orderIds: best[1].map((h) => h.orderId) } };
  };
  const of = (e: Evidence) => `${e.matching} of your last ${e.total} ${family} orders`;

  for (const dim of SPEC_DIMENSIONS) {
    const h = habit((x) => dimensionValue(dim, primaryLine(x).attributes));
    if (h) out.push({ kind: "dimension", family, dimension: dim.id, choice: h.value, evidence: h.evidence, text: `${dimensionLabel(dim, h.value)}: ${of(h.evidence)}` });
  }
  const product = habit((x) => primaryLine(x).productId);
  if (product) {
    const name = recent.flatMap((x) => x.lines).find((l) => l.productId === product.value)!.name;
    out.push({ kind: "product", family, productId: product.value, name, evidence: product.evidence, text: `Usually ${name}: ${of(product.evidence)}` });
  }
  const goal = habit((x) => x.chosenLabels?.map(labelGoal).find(Boolean));
  if (goal) out.push({ kind: "optimise", family, goal: goal.value as OptimiseGoal, evidence: goal.evidence, text: `Chose by ${goal.value === "co2" ? "lowest CO2" : goal.value}: ${of(goal.evidence)}` });
  return out;
}

/**
 * History-learned habits plus the typed memory's habits, for one family. Memory adds what history cannot say
 * (a habit stated in passing, a goal) and removes a product the kitchen turned down; a history habit about the
 * same thing wins over a memory habit, because it rests on more orders. Without memory this is learnPreferences.
 */
function learnWithMemory(profile: KitchenProfile, family: string): LearnedPreference[] {
  const avoided = avoidedProducts(profile, family);
  const fromHistory = learnFromHistory(profile, family).filter((l) => !(l.kind === "product" && avoided.has(l.productId)));
  const key = (l: LearnedPreference) => (l.kind === "dimension" ? `d:${l.dimension}` : l.kind);
  const have = new Set(fromHistory.map(key));
  return [...fromHistory, ...memoryHabits(profile, family).filter((l) => !have.has(key(l)) && !(l.kind === "product" && avoided.has(l.productId)))];
}

function labelGoal(label: string): OptimiseGoal | undefined {
  return label === "best_price" ? "price" : label === "lowest_carbon" ? "co2" : label === "most_reliable" ? "reliability" : undefined;
}

/** What an outside agent or the UI may show about the kitchen. */
export function kitchenView(profile: KitchenProfile) {
  const families = [...new Set(profile.history.map((h) => h.family))].sort();
  return {
    orgId: profile.orgId,
    name: profile.name,
    deliveryWeekdays: profile.deliveryWeekdays,
    stated: profile.stated,
    families: families.map((family) => {
      const last = lastOrder(profile, family)!;
      const usual = usualAmount(profile, family)!;
      return {
        family,
        orders: familyHistory(profile, family).length,
        usual: { amount: usual.amount, unit: usual.unit, text: `usually about ${formatAmount(usual.amount, usual.unit)}` },
        lastOrder: last,
        learned: learnPreferences(profile, family),
      };
    }),
    recentHistory: profile.history.slice(-20),
    /** What the typed memory holds in force, one line each (the full items are at /ui-api/memory). */
    remembered: activeMemory(profile).map((m) => ({ id: m.id, text: m.text, strength: m.strength, family: m.family, audience: m.audience })),
  };
}

// ---------- repository ----------

/** Async on purpose, so Postgres can replace the in-memory version without touching callers. */
export interface KitchenRepository {
  getProfile(orgId: string): Promise<KitchenProfile | undefined>;
  saveProfile(profile: KitchenProfile): Promise<void>;
  /** Every kitchen's org id, for the wholesaler's read of shared memory. Optional: adapters without it fall back to known kitchens. */
  listOrgIds?(): Promise<string[]>;
}

export class InMemoryKitchenRepository implements KitchenRepository {
  private profiles = new Map<string, KitchenProfile>();
  constructor(seed: KitchenProfile[] = []) {
    for (const p of seed) this.profiles.set(p.orgId, structuredClone(p));
  }
  async getProfile(orgId: string) {
    const p = this.profiles.get(orgId);
    return p && structuredClone(p);
  }
  async saveProfile(profile: KitchenProfile) {
    this.profiles.set(profile.orgId, structuredClone(profile));
  }
  async listOrgIds() {
    return [...this.profiles.keys()];
  }
}

// ---------- delivery calendar ----------

/**
 * Order cut-off: an order placed before 12:00 Helsinki time is delivered the next day (the seed catalogue's
 * fastest lead time is one day). The partner's live API returns a per-product `closingTime`; when the
 * catalogue adapter exposes it, it can replace this kitchen-level default.
 */
export const ORDER_CUTOFF_LOCAL_TIME = "12:00";
export const DELIVERY_TIME_ZONE = "Europe/Helsinki";

/** Local date and time in Helsinki: { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function localNow(now: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: DELIVERY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The Helsinki calendar date of an ISO timestamp (an order placed at 00:30 Helsinki is that day's, not yesterday's in UTC). */
export function localDateOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localNow(new Date(t)).date : iso.slice(0, 10);
}

/**
 * The latest delivery day a mandate allows: maxLeadDays Helsinki calendar days after today in Helsinki. Every
 * comparison of delivery dates (the gate, the option cards, the seed's mocked availability) counts in Helsinki days.
 */
export function latestDeliveryDay(now: Date, maxLeadDays: number): string {
  return addDaysIso(localNow(now).date, maxLeadDays);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

const WEEKDAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY_NAMES[isoWeekday(date)]} ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/** Can an order placed now still arrive on `date`? Cut-off is ORDER_CUTOFF_LOCAL_TIME the day before. */
export function beforeCutoff(date: string, now: Date): boolean {
  const local = localNow(now);
  return `${local.date}T${local.time}` < `${addDaysIso(date, -1)}T${ORDER_CUTOFF_LOCAL_TIME}`;
}

/** The first delivery day in a direction from `from` (exclusive), within four weeks. */
export function nextDeliveryDay(from: string, weekdays: number[], step: 1 | -1 = 1): string | undefined {
  for (let i = 1; i <= 28; i++) {
    const d = addDaysIso(from, i * step);
    if (weekdays.includes(isoWeekday(d))) return d;
  }
  return undefined;
}

/** The earliest delivery day an order placed now can make. */
export function earliestDeliveryDay(now: Date, weekdays: number[]): string | undefined {
  let d = localNow(now).date;
  for (let i = 0; i < 6; i++) {
    const next = nextDeliveryDay(d, weekdays);
    if (!next) return undefined;
    if (beforeCutoff(next, now)) return next;
    d = next;
  }
  return undefined;
}

/**
 * The claims and allergens a kitchen's own rules require for a product family: the signed mandate, every rule a
 * person stated (a dimension rule such as "Always lactose-free" whose choice is a claim counts), and the safety rules
 * its memory holds. For anything that proposes products (the assistant, the product map): what it may not break.
 */
export function kitchenRulesFor(profile: KitchenProfile | undefined, mandate: { requiredAttributes: string[]; forbiddenAllergens: string[] }, family?: string, now = new Date()): { requiredClaims: string[]; forbiddenAllergens: string[]; sources: { text: string; source: string }[] } {
  const claims = new Set<string>(mandate.requiredAttributes);
  const allergens = new Set<string>(mandate.forbiddenAllergens);
  const sources: { text: string; source: string }[] = [];
  for (const c of mandate.requiredAttributes) sources.push({ text: `Must be ${c.replaceAll("_", "-")}`, source: "mandate" });
  for (const a of mandate.forbiddenAllergens) sources.push({ text: `No ${a.replaceAll("_", " ")}`, source: "mandate" });
  for (const p of profile ? (family ? statedFor(profile, family) : profile.stated) : []) {
    const by = `stated by ${p.statedBy}`;
    if (p.kind === "require_claim" && !claims.has(p.claim)) { claims.add(p.claim); sources.push({ text: p.text, source: by }); }
    else if (p.kind === "forbid_allergen" && !allergens.has(p.allergen)) { allergens.add(p.allergen); sources.push({ text: p.text, source: by }); }
    else if (p.kind === "dimension" && /_free$|^organic$|^vegan$|^vegetarian$/.test(p.choice) && !claims.has(p.choice)) { claims.add(p.choice); sources.push({ text: p.text, source: by }); }
  }
  for (const m of profile ? activeMemory(profile, { now }) : []) {
    if (m.strength !== "rule" || m.scope || (family && m.family && m.family !== family)) continue;
    if (m.fact.kind === "allergen" && !allergens.has(m.fact.allergen)) { allergens.add(m.fact.allergen); sources.push({ text: m.text, source: "kitchen memory" }); }
    else if (m.fact.kind === "diet" && !claims.has(m.fact.claim)) { claims.add(m.fact.claim); sources.push({ text: m.text, source: "kitchen memory" }); }
  }
  return { requiredClaims: [...claims], forbiddenAllergens: [...allergens], sources };
}

/**
 * What the kitchen's memory says it turned down, for the option cards: a substitute a person declined, a product
 * it avoids. `leaveOut`: a rule ("never order this"), or a substitute declined for the very product the request is
 * about: not offered at all. The rest rank last and say why. Reasons name who said it and when.
 */
export function declinedProducts(profile: KitchenProfile, family: string, opts: { now?: Date; referenceId?: string } = {}): Map<string, { reason: string; leaveOut: boolean; itemId: string }> {
  const out = new Map<string, { reason: string; leaveOut: boolean; itemId: string }>();
  for (const m of activeMemory(profile, { family, now: opts.now })) {
    if (m.scope) continue;
    const f = m.fact;
    const s = m.sources.at(-1);
    const who = m.confirmedBy?.by ?? s?.by;
    const when = s ? ` on ${formatDay(localDateOf(s.at))}` : "";
    if (f.kind === "substitute" && !f.accepted && f.productId) {
      const forRef = !!opts.referenceId && f.forProductId === opts.referenceId;
      out.set(f.productId, { reason: `${who ?? "the kitchen"} turned it down as a substitute${f.forName ? ` for ${f.forName}` : ""}${when}${f.reason ? `: "${f.reason}"` : ""}`, leaveOut: forRef || m.strength === "rule", itemId: m.id });
    } else if (f.kind === "product" && f.stance === "avoid" && (m.strength === "rule" || m.weight >= 0.5)) {
      out.set(f.productId, { reason: `${m.text}${who ? ` (${m.origin === "learned" ? "learned" : `said by ${who}`}${when})` : ""}`, leaveOut: m.strength === "rule", itemId: m.id });
    }
  }
  return out;
}

// ---------- one change at a time per kitchen ----------

const profileLocks = new WeakMap<KitchenRepository, Map<string, Promise<unknown>>>();

/**
 * Read, change and save a kitchen's profile without losing a concurrent change: every writer of a profile (the
 * intake's remembered answers, the order history at commit, the memory service, the portal's rule changes) goes
 * through this, so they queue per kitchen instead of overwriting each other. In process; a shared store would hold
 * the same lock in the database.
 */
export function withKitchenLock<T>(repo: KitchenRepository, orgId: string, fn: () => Promise<T>): Promise<T> {
  let locks = profileLocks.get(repo);
  if (!locks) profileLocks.set(repo, (locks = new Map()));
  const prev = locks.get(orgId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(orgId, tail);
  void tail.then(() => {
    if (locks!.get(orgId) === tail) locks!.delete(orgId);
  });
  return run;
}

/** `fn` gets the latest profile (or undefined) and returns the profile to save, or undefined to save nothing. */
export function updateKitchenProfile(repo: KitchenRepository, orgId: string, fn: (p: KitchenProfile | undefined) => KitchenProfile | undefined | Promise<KitchenProfile | undefined>): Promise<KitchenProfile | undefined> {
  return withKitchenLock(repo, orgId, async () => {
    const next = await fn(await repo.getProfile(orgId));
    if (next) await repo.saveProfile(next);
    return next;
  });
}

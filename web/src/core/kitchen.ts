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

export type LearnedPreference = { family: string; text: string; evidence: Evidence } & (
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
};

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

export function usualAmount(profile: KitchenProfile, family: string): { amount: number; unit: BaseUnit; orders: number } | undefined {
  const recent = familyHistory(profile, family).slice(-QUANTITY_WINDOW);
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

/** Habits read from history, each with the orders that support it. Never a rule: callers pre-select with these. */
export function learnPreferences(profile: KitchenProfile, family: string): LearnedPreference[] {
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
  };
}

// ---------- repository ----------

/** Async on purpose, so Postgres can replace the in-memory version without touching callers. */
export interface KitchenRepository {
  getProfile(orgId: string): Promise<KitchenProfile | undefined>;
  saveProfile(profile: KitchenProfile): Promise<void>;
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

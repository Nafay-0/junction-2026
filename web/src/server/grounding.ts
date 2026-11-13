import { groundField, groundText, type CheckOptions, type Facts, type Grounded, type Violation } from "@/core/grounding";

/**
 * The grounding check on the server: every place where text a model wrote is shown to a person runs it through
 * core/grounding.ts first, against the data that text rests on, and counts here how often it fired. The counts
 * are in process (since this server started) and appear on the operations portal's safeguards page (rule
 * `grounding_check`, and `grounding` in GET /ops-api/safeguards).
 *
 * Surfaces:
 *   assistant  the kitchen shop's assistant panel answers
 *   voice      the voice agent's speech (the call screen cuts it; it reports each cut here)
 *   menu       the menu planner's model-written dish texts, assumptions, warnings and reasons
 *   interpret  the interpreter's structured need (a claim, allergen, product, amount or date nobody said)
 *   memory     memory proposals the writer model made (an item whose words the interaction does not back)
 *   aiven      the Aiven agent's and the operations copilot's transcript in the operations portal
 */
export const GROUNDING_SURFACES = ["assistant", "voice", "menu", "interpret", "memory", "aiven"] as const;
export type GroundingSurface = (typeof GROUNDING_SURFACES)[number];

export type GroundingFire = { at: string; surface: GroundingSurface; kinds: Violation["kind"][]; said: string[]; where?: string };
export type GroundingStats = {
  since: string;
  /** Per surface: texts checked, texts in which the check fired, and statements it removed. */
  surfaces: Record<GroundingSurface, { checked: number; fired: number; removed: number }>;
  totals: { checked: number; fired: number; removed: number };
  /** The latest fires, newest first. Only what was removed is named (a figure or a claim), never the rest of the text. */
  recent: GroundingFire[];
};

type State = { since: string; counts: GroundingStats["surfaces"]; recent: GroundingFire[] };
const g = globalThis as typeof globalThis & { __dockGrounding?: State };
const MAX_RECENT = 50;

function fresh(): State {
  return { since: new Date().toISOString(), counts: Object.fromEntries(GROUNDING_SURFACES.map((s) => [s, { checked: 0, fired: 0, removed: 0 }])) as State["counts"], recent: [] };
}
const state = () => (g.__dockGrounding ??= fresh());

/**
 * Count one check. `violations`: what it removed (empty when the text was fine). `countChecked: false` when the
 * check itself was counted already (the call screen reports its checks with each heartbeat, its cuts one by one).
 */
export function recordGrounding(surface: GroundingSurface, violations: readonly Violation[], where?: string, countChecked = true): void {
  const s = state();
  const c = s.counts[surface];
  if (countChecked) c.checked += 1;
  if (!violations.length) return;
  c.fired += 1;
  c.removed += violations.length;
  s.recent.unshift({ at: new Date().toISOString(), surface, kinds: [...new Set(violations.map((v) => v.kind))], said: violations.slice(0, 5).map((v) => v.said.slice(0, 60)), ...(where ? { where: where.slice(0, 80) } : {}) });
  if (s.recent.length > MAX_RECENT) s.recent.length = MAX_RECENT;
}

/** Checks that found nothing, counted where they ran (the call screen's sentences). */
export function recordGroundingChecks(surface: GroundingSurface, n: number): void {
  if (n > 0) state().counts[surface].checked += Math.floor(n);
}

export function groundingStats(): GroundingStats {
  const s = state();
  const surfaces = structuredClone(s.counts);
  const totals = Object.values(surfaces).reduce((a, c) => ({ checked: a.checked + c.checked, fired: a.fired + c.fired, removed: a.removed + c.removed }), { checked: 0, fired: 0, removed: 0 });
  return { since: s.since, surfaces, totals, recent: s.recent.slice(0, 20) };
}

/** For tests. */
export function resetGroundingStats(): void {
  g.__dockGrounding = fresh();
}

/** A text shown to a person: grounded and counted. Returns the text to show. */
export function groundForDisplay(surface: GroundingSurface, text: string, facts: Facts, opts: CheckOptions & { where?: string; replacement?: string } = {}): Grounded {
  const r = groundText(text, facts, opts);
  recordGrounding(surface, r.violations, opts.where);
  return r;
}

/**
 * Several short fields of one model answer (a plan's dish texts, say), grounded together and counted as one check.
 * Returns the fields with every unbacked one replaced.
 */
export function groundFields(surface: GroundingSurface, fields: string[], facts: Facts, opts: CheckOptions & { where?: string; replacement?: string; sentences?: boolean } = {}): string[] {
  const all: Violation[] = [];
  const out = fields.map((t) => {
    if (!t) return t;
    const r = opts.sentences ? groundText(t, facts, opts) : groundField(t, facts, opts);
    all.push(...r.violations);
    return r.text;
  });
  recordGrounding(surface, all, opts.where);
  return out;
}

// ---------- brand names ----------

type BrandSource = { searchProducts: (q: { category?: string; limit: number }) => Promise<{ brand: string }[]> };
const brandCache = new WeakMap<object, Map<string, Promise<string[]>>>();

/**
 * The catalogue's brand names, for the product check: those of the given product groups (as the voice door does),
 * or of the first products of the catalogue. Cached per catalogue.
 */
export function catalogBrands(catalog: BrandSource, categories: string[] = []): Promise<string[]> {
  let byKey = brandCache.get(catalog);
  if (!byKey) brandCache.set(catalog, (byKey = new Map()));
  const key = categories.slice(0, 8).sort().join(",");
  let p = byKey.get(key);
  if (!p) {
    p = (async () => {
      const cats = categories.slice(0, 8);
      const lists = await Promise.all((cats.length ? cats : [undefined]).map((category) => catalog.searchProducts({ ...(category ? { category } : {}), limit: 100 })));
      return [...new Set(lists.flat().map((x) => (x.brand ?? "").trim()).filter((b) => b.length >= 3))].slice(0, 300);
    })().catch(() => []);
    byKey.set(key, p);
  }
  return p;
}

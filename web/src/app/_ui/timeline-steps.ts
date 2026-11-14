/**
 * An order's timeline, made calm for reading (store and operations alike): the live price checks of one request
 * become one line that opens ("Checked live price for 10, then 2 products"), and the steps a reader cares about are
 * picked out (asked, what was found, the fixed price, the rules check, who decided, placed, what happened after).
 * Everything else stays one tap away ("Show every step"). Pure functions over the server's steps.
 */

type Step = { seq: number; phase: string; title: string; agentChoice?: boolean };

export type Shown<T extends Step> = { kind: "step"; step: T; key: boolean } | { kind: "lookups"; steps: T[]; key: true; seq: number };

/** The phases a buyer or a desk reads first; the rest (turns, memory, history checks, searches) wait behind "every step". */
const KEY = new Set(["asked", "quoted", "gate", "signoff", "committed", "refused", "after", "chosen", "offer", "watch"]);

const isLookup = (s: Step) => s.phase === "priced" && /^Checked live price/.test(s.title);

/** Steps in order, with every live price check folded into one entry at the place of the first. */
export function shownSteps<T extends Step>(steps: T[]): Shown<T>[] {
  const lookups = steps.filter(isLookup);
  const out: Shown<T>[] = [];
  let placed = false;
  for (const s of steps) {
    if (isLookup(s) && lookups.length > 1) {
      if (!placed) out.push({ kind: "lookups", steps: lookups, key: true, seq: s.seq });
      placed = true;
      continue;
    }
    out.push({ kind: "step", step: s, key: KEY.has(s.phase) || isLookup(s) || !!s.agentChoice });
  }
  return out;
}

/** The products each live check covered, from the lookups' own titles ("… for 10 products", "… for one product"). */
export function lookupCounts(steps: Step[]): number[] {
  return steps.map((s) => (/for one product/.test(s.title) ? 1 : Number(/for (\d+) products/.exec(s.title)?.[1] ?? 0)));
}

/** "Checked live price for 10, then 5, then 1 products" (operations; the store says it in the buyer's language). */
export function lookupsTitle(steps: Step[]): string {
  return `Checked live price for ${lookupCounts(steps).join(", then ")} products`;
}

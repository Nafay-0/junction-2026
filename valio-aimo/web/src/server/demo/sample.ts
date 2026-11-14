import type { Product } from "@/core/catalog";
import { addDaysIso, isoWeekday, localNow, type HistoryEntry } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import { forbiddenBy } from "@/core/offers";
import { deliveryRecordOf } from "@/core/reliability";
import { creeping, series, sorted } from "../accounts/test-accounts";

/**
 * A demo account's SAMPLE HISTORY: several weeks of made-up orders, so everything the agent does with a kitchen's
 * past can be tried on day one. Built with the same seeding code as the public test accounts (accounts/test-accounts.ts
 * `series`, `creeping`), adapted to the account's own rules: every product is one its signed mandate allows (its
 * product groups, its required claims, its forbidden allergens and nutrition rules: core/offers.ts forbiddenBy, the
 * gate's own hard-rule check), so nothing in the sample breaks them.
 *
 *   weekly     two recurring orders on the kitchen's delivery days (the watch watches them, auto-renew renews them)
 *   creeping   one recurring order whose amount has crept up over the last four weeks (the watch's drift)
 *   poor       one product whose delivery record (the wholesaler's file) is below the line, ordered a few times
 *              (a backup is offered when it is ordered again)
 *   variety    one-off orders across other families the mandate allows (the selling agent has something to go on)
 *
 * Every entry is `sample: true` and its order id starts with `ord_sample_`: labelled sample wherever it shows, and
 * never an order in the wholesaler's books (the gate's orders are separate; this is the kitchen profile's history).
 * Plain code, no model, no live call: master data only.
 */

export const SAMPLE_PREFIX = "ord_sample_";

export type SampleSummary = {
  weekly: { family: string; productId: string; name: string; weekdays: number[] }[];
  creeping?: { family: string; productId: string; name: string };
  poor?: { productId: string; name: string; family: string; words: string };
  variety: { family: string; productId: string; name: string }[];
  orders: number;
};

type Catalog = { searchProducts(q: { category?: string; ids?: string[]; text?: string; limit?: number }): Promise<Product[]> };

/** Families tried, in order, for each part of the sample (the first one the mandate allows and the catalogue has). */
const WEEKLY = [["milk", "plant_drink"], ["cat_10900", "cat_11030", "cat_10901", "cat_10902", "butter", "cheese", "cat_17401", "cat_17421", "cat_21340"]];
const CREEPING = ["yoghurt", "cream", "quark", "cat_10418", "cat_17403", "cat_21380", "cat_41732"];
const VARIETY = ["cat_21310", "cat_22300", "cat_41732", "cheese", "cat_17405", "cat_18750", "cat_21380", "cat_10590", "cat_22530", "cat_21900"];

const sample = (h: HistoryEntry[]): HistoryEntry[] => h.map((e) => ({ ...e, orderId: e.orderId.replace(/^ord_/, SAMPLE_PREFIX), sample: true as const }));

async function usable(catalog: Catalog, mandate: Mandate, family: string, now: Date, avoid: Set<string>): Promise<Product[]> {
  if (!mandate.allowedCategories.includes(family)) return [];
  const found = await catalog.searchProducts({ category: family, limit: 100 }).catch(() => [] as Product[]);
  return found
    .filter((p) => !avoid.has(p.id) && p.packSize > 0 && mandate.requiredAttributes.every((x) => p.attributes.includes(x)) && !forbiddenBy(p, { mandate, profile: undefined }, now))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A product a kitchen would buy every week: a common pack, not a novelty (the middle of the family by pack size). */
function everyday(ps: Product[], prefer?: (p: Product) => boolean): Product | undefined {
  const pool = prefer ? ps.filter(prefer) : [];
  const from = pool.length ? pool : ps;
  const sizes = [...from].sort((a, b) => a.packSize - b.packSize || a.id.localeCompare(b.id));
  return sizes[Math.floor(sizes.length / 2)];
}

/** Delivery days in the six weeks before today on the given weekdays, the most recent `count`. */
function pastDays(now: Date, weekdays: number[], count: number): string[] {
  const today = localNow(now).date;
  const out: string[] = [];
  for (let d = addDaysIso(today, -42); d < today; d = addDaysIso(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out.slice(-count);
}

/** The sample history for a kitchen with this mandate and these delivery days. */
export async function sampleHistory(catalog: Catalog, mandate: Mandate, opts: { weekdays: number[]; now: Date; warn?: number }): Promise<{ history: HistoryEntry[]; summary: SampleSummary }> {
  const { now } = opts;
  const days = opts.weekdays.length >= 2 ? opts.weekdays.slice(0, 3) : opts.weekdays.length === 1 ? [opts.weekdays[0], ((opts.weekdays[0] + 2) % 7) + 1] : [2, 5];
  const used = new Set<string>();
  const history: HistoryEntry[] = [];
  const summary: SampleSummary = { weekly: [], variety: [], orders: 0 };
  const lactoseFree = mandate.requiredAttributes.includes("lactose_free");

  // Two recurring orders: the first on every delivery day, the second on one of them.
  for (const [i, families] of WEEKLY.entries()) {
    for (const family of families) {
      const ps = await usable(catalog, mandate, family, now, used);
      const p = everyday(ps, family === "milk" ? (x) => x.packSize >= 1 && x.packSize <= 10 && (lactoseFree || x.attributes.includes("fat_1_5")) : undefined);
      if (!p) continue;
      used.add(p.id);
      const on = i === 0 ? days.slice(0, 2) : [days[days.length - 1]];
      const base = Math.max(p.packSize, (p.unit === "L" ? 40 : p.unit === "kg" ? 10 : 12) * (i === 0 ? 1 : 0.6));
      const amounts = [1, 1, 0.9, 1, 1.1, 1, 1, 0.9, 1, 1.05].map((f) => base * f);
      history.push(...sample(series(p, pastDays(now, on, i === 0 ? 10 : 6), amounts, `ord_w${i}_`)));
      summary.weekly.push({ family: p.category, productId: p.id, name: p.name, weekdays: on });
      break;
    }
  }

  // One recurring order that has crept up over the last four weeks.
  for (const family of CREEPING) {
    const p = everyday(await usable(catalog, mandate, family, now, used));
    if (!p) continue;
    used.add(p.id);
    const on = [days[0]];
    history.push(...sample(creeping(p, pastDays(now, on, 6), Math.max(p.packSize * 4, p.unit === "L" ? 16 : 8), `ord_c_`)));
    summary.creeping = { family: p.category, productId: p.id, name: p.name };
    break;
  }

  // One product with a poor delivery record, ordered three times (not yet a recurring order).
  const warn = opts.warn ?? 0.9;
  const poorFamilies = [...new Set([...WEEKLY.flat(), ...CREEPING, ...VARIETY, ...mandate.allowedCategories.slice(0, 40)])];
  for (const family of poorFamilies) {
    const ps = (await usable(catalog, mandate, family, now, used)).filter((p) => deliveryRecordOf(p, warn)?.poor && !/hand ?made|käsin ?tehty|artisan/i.test(`${p.name} ${p.names?.en ?? ""}`));
    // A name a person would type (an English name, plain case, no words that read as a claim such as "hand made").
    const plain = (x: Product) => (x.names?.en ? 2 : 0) + (x.name === x.name.toUpperCase() ? 0 : 1) + (/hand ?made|käsin|artisan/i.test(x.names?.en ?? x.name) ? -3 : 0);
    const p = ps.sort((a, b) => plain(b) - plain(a) || b.deliveryReliability - a.deliveryReliability)[0];
    if (!p) continue;
    used.add(p.id);
    const when = pastDays(now, [days[days.length - 1]], 6).filter((_, i) => i % 2 === 1);
    history.push(...sample(series(p, when, [Math.max(p.packSize * 3, 6)], `ord_p_`)));
    summary.poor = { productId: p.id, name: p.names?.en ?? p.name, family: p.category, words: deliveryRecordOf(p, warn)!.words };
    break;
  }

  // Variety: one-off orders across other families the mandate allows.
  const variety = VARIETY.filter((f) => !history.some((h) => h.family === f));
  let n = 0;
  for (const family of variety) {
    if (n >= 5) break;
    const p = everyday(await usable(catalog, mandate, family, now, used));
    if (!p) continue;
    used.add(p.id);
    const day = pastDays(now, days, 12)[n * 2 + 1];
    if (!day) continue;
    history.push(...sample(series(p, [day], [Math.max(p.packSize * 2, p.unit === "pcs" ? 6 : 5)], `ord_v${n}_`)));
    summary.variety.push({ family: p.category, productId: p.id, name: p.name });
    n += 1;
  }
  summary.orders = history.length;
  return { history: sorted(history), summary };
}


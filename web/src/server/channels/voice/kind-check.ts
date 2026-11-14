import { usableOffer, type LiveStatus, type Product } from "@/core/catalog";
import { hardConstraints, violation } from "@/core/clarify";
import { statedFor } from "@/core/kitchen";
import { NeedSchema, type NeedInput, type StructuredNeed } from "@/core/need";
import { qualifiersOf } from "@/core/qualifiers";
import type { KitchenAgent } from "../flow";

/**
 * Before a spoken request is read back for the caller's yes: can the kind asked for be offered at all? So "I can't get
 * oat drink for Thursday; I can offer other plant drinks instead" is said before the yes, never after it.
 *
 * The same reasons as the thread's options card (`insteadOf` in server/thread/pipeline.ts afterStep), worked out from
 * the product data and the kitchen's own rules (mandate and stated rules, core/clarify.ts violation), then, for at
 * most three products of that kind, the wholesaler's live status for the day asked: a short list, never the
 * catalogue. Undefined when the kind can be offered, when the words name no kind within the family, or when it
 * cannot be told (an unknown family, a live service that does not answer): the engine still says it after the yes.
 */
export type KindNote = { asked: string; why: "rules" | "day" | "stock" | "other"; day?: string };

const LIVE_MAX = 3;

export async function kindCheck(a: KitchenAgent, need: NeedInput): Promise<KindNote | undefined> {
  const parsed = NeedSchema.safeParse(need);
  if (!parsed.success) return undefined;
  const n = parsed.data as StructuredNeed;
  if (n.item.productId) return undefined;
  const catalog = a.rt.catalog;
  const family = n.item.category ?? (await familyOf(a, n.item.text));
  if (!family) return undefined;
  // A product group the kitchen may not buy at all: its rules allow none of it.
  if (!a.session.mandate.allowedCategories.includes(family)) return { asked: n.item.text, why: "rules" };
  const q = await qualifiersOf(catalog, family, n.item.text).catch(() => undefined);
  if (!q || !q.words.length) return undefined;
  const day = n.deliverOn ?? n.deliverBy;
  if (q.absent.length) return { asked: n.item.text, why: "other" };
  // The products of the kind: every qualifier word carried.
  const ids = q.words.map((w) => new Set(w.carriedBy)).reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
  if (!ids.size) return { asked: n.item.text, why: "other" };
  const kind: Product[] = await catalog.searchProducts({ ids: [...ids].slice(0, 100), limit: 100 });
  const profile = await a.rt.kitchens.getProfile(a.session.mandate.issuer.orgId);
  const constraints = hardConstraints(a.session.mandate, n, profile ? statedFor(profile, family) : []);
  const allowed = kind.filter((p) => !violation(p, constraints));
  if (!allowed.length) return { asked: n.item.text, why: "rules" };
  // Live, for a few of them only, on the day asked.
  const few = allowed.slice(0, LIVE_MAX).map((p) => p.id);
  const live = catalog as unknown as { getLiveStatus?: (ids: string[], o?: { deliveryDate?: string }) => Promise<LiveStatus[]> };
  if (!live.getLiveStatus) return undefined;
  const statuses = await live.getLiveStatus(few, day ? { deliveryDate: day } : undefined).catch(() => undefined);
  if (!statuses?.length) return undefined;
  // Usable for the day asked: an offer, not blocked or past its cut-off, arriving on or before that day.
  const inTime = (s: LiveStatus) => {
    const o = usableOffer(s);
    return !!o && !s.problems.includes("cutoff_passed") && !(day && o.deliveryDate > day);
  };
  if (statuses.some(inTime)) return undefined;
  const outOfStock = statuses.every((s) => s.problems.includes("out_of_stock") || (s.offer?.availablePacks ?? 1) <= 0);
  return { asked: n.item.text, why: outOfStock ? "stock" : "day", ...(day ? { day } : {}) };
}

/** The family the words name, as the intake resolves it (its most matched product group the kitchen may buy). */
async function familyOf(a: KitchenAgent, text: string): Promise<string | undefined> {
  const hits = await a.rt.catalog.searchProducts({ text, limit: 100 }).catch(() => []);
  const counts = new Map<string, number>();
  for (const p of hits) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const allowed = new Set(a.session.mandate.allowedCategories);
  const most = Math.max(0, ...counts.values());
  const score = (c: string, k: number) => k + (allowed.has(c) && k * 2 >= most ? 1_000 : 0);
  return [...counts.entries()].sort((x, y) => score(y[0], y[1]) - score(x[0], x[1]))[0]?.[0];
}

const WHY: Record<KindNote["why"], (day: string) => string> = {
  rules: () => "your rules do not allow any of it",
  day: (day) => (day ? `none can arrive ${day}` : "none can arrive on the day asked"),
  stock: () => "it is out of stock",
  other: () => "the wholesaler has none",
};

/** The sentence said before the read-back's question: what cannot be had and why, and that other products follow. */
export function kindSay(k: KindNote, spokenDay: (d: string) => string): string {
  return `I can't get ${k.asked}: ${WHY[k.why](k.day ? `for ${spokenDay(k.day)}` : "")}. I can offer other products instead.`;
}

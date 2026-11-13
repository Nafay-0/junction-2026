import { AUTO_HOLD_MAX_AGE_DAYS, REVIEW_MAX_AGE_DAYS } from "./sources";
import type { Lots, MatchBasis, MatchStatus, MatchStrength, NoticeFacts, NoticeProduct } from "./types";
import { describePack, fold, gtinKey, nameTokens, parsePack, samePack, sameCompany, type PackSize } from "./text";

/**
 * Matching a notice to the wholesaler's assortment, in code. A wrong match either blocks a safe product or, worse,
 * misses an unsafe one, so the rules are few and strict:
 *
 *   confirmed   a hard identifier: a GTIN/EAN on the notice is one of this product's GTINs (any packaging level),
 *               or the producer (or brand), the exact product name and the pack size all agree.
 *   possible    the brand or producer agrees and the name is close, or the name is exact but the pack differs.
 *               Never a hold by itself: a person confirms or dismisses it.
 *   none        anything else, including a look-alike name from another brand. Nothing is forced: the catalogue is
 *               synthetic, and most real notices match nothing in it.
 *
 * Unverified facts (a name whose sentence code could not find on the page) can at most make a possible match.
 */

export type AssortmentItem = {
  id: string;
  names: { fi?: string; sv?: string; en?: string };
  brand?: string | null;
  vendor?: string | null;
  /** One consumer pack, from the name or the partner's pack data. */
  pack?: PackSize;
  /** Every GTIN the partner lists for it (sales unit and each packaging level). */
  gtins: string[];
};

export type ProposedMatch = {
  productId: string;
  productName: string;
  strength: MatchStrength;
  basis: MatchBasis;
  why: string;
  noticeProduct?: string;
  lots: Lots;
  score: number;
};

const MAX_POSSIBLE_PER_PRODUCT = 3;

export function displayName(item: AssortmentItem): string {
  return item.names.en ?? item.names.fi ?? item.names.sv ?? item.id;
}

/** Shared family words, by their first five letters: "kebab" meets "kebablastut", "kaurajuoma" meets "kaurajuomat". */
function familyOverlap(a: string[], b: string[]): { shared: number; share: number } {
  const key = (t: string) => t.slice(0, 5);
  const bs = new Set(b.map(key));
  const shared = [...new Set(a.map(key))].filter((k) => bs.has(k)).length;
  return { shared, share: shared / Math.max(1, Math.min(new Set(a).size, new Set(b).size)) };
}

function sameTokens(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const x = [...a].sort().join(" ");
  const y = [...b].sort().join(" ");
  return x === y;
}

function brandTokens(item: AssortmentItem): string[] {
  return item.brand ? nameTokens(item.brand) : [];
}

/** The notice names this product's brand: as its brand field, or the brand's words inside the product name. */
function brandAgrees(np: NoticeProduct, item: AssortmentItem): boolean {
  const bt = brandTokens(item);
  if (bt.length === 0 || item.brand === "unknown") return false;
  if (np.brand && fold(np.brand.value).replace(/\s/g, "") === fold(item.brand!).replace(/\s/g, "")) return true;
  const nt = new Set(nameTokens(np.name.value));
  return bt.every((t) => nt.has(t));
}

function lotsOf(np: NoticeProduct | undefined, facts: NoticeFacts): Lots {
  const own = np?.lots;
  if (own && (own.bestBefore.length || own.batches.length || own.marks.length)) return { ...own, ...(facts.lots.bestBeforeUpTo ? { bestBeforeUpTo: facts.lots.bestBeforeUpTo } : {}) };
  return facts.lots;
}

/** Every product of the assortment this notice may concern, strongest first. */
export function matchNotice(facts: NoticeFacts, assortment: AssortmentItem[]): ProposedMatch[] {
  const out = new Map<string, ProposedMatch>();
  const keep = (m: ProposedMatch) => {
    const prev = out.get(m.productId);
    if (!prev || rank(m) > rank(prev)) out.set(m.productId, m);
  };
  const noticeGtins = new Map(facts.eans.map((e) => [gtinKey(e), e]));
  const productOfEan = (code: string) => facts.products.find((p) => p.eans.includes(code));

  for (const item of assortment) {
    // 1. A GTIN on the notice is this product's.
    const hit = item.gtins.map(gtinKey).find((g) => noticeGtins.has(g));
    if (hit) {
      const code = noticeGtins.get(hit)!;
      const np = productOfEan(code);
      keep({
        productId: item.id,
        productName: displayName(item),
        strength: "confirmed",
        basis: "gtin",
        why: `EAN ${code} on the notice is one of this product's GTINs${np ? ` (the notice's "${np.name.value}")` : ""}.`,
        noticeProduct: np?.name.value,
        lots: lotsOf(np, facts),
        score: 100,
      });
      continue;
    }
    // 2. Names, brands, producers and packs, product by product of the notice.
    for (const np of facts.products) {
      const nt = nameTokens(np.name.value);
      if (nt.length === 0) continue;
      const names = [item.names.fi, item.names.sv, item.names.en].filter((n): n is string => !!n);
      const exact = names.some((n) => sameTokens(nt, nameTokens(n)));
      const brandOk = brandAgrees(np, item);
      const producer = np.producer?.value ?? facts.producer?.value;
      const producerOk = sameCompany(producer, item.vendor) || sameCompany(producer, item.brand);
      const npPack = parsePack(np.pack?.value ?? "") ?? parsePack(np.name.value);
      const packOk = samePack(npPack, item.pack);
      const verified = np.name.verified;
      const base = { productId: item.id, productName: displayName(item), noticeProduct: np.name.value, lots: lotsOf(np, facts) };

      if (exact && packOk && (producerOk || brandOk) && verified) {
        keep({ ...base, strength: "confirmed", basis: "producer_name_pack", why: `Same ${producerOk ? "producer" : "brand"}, exact product name and pack size (${describePack(npPack!)}).`, score: 90 });
        continue;
      }
      if (exact && (producerOk || brandOk)) {
        const packWhy = !npPack ? "the notice gives no pack size" : !item.pack ? "our pack size is not known" : `the notice's pack is ${describePack(npPack)}, ours ${describePack(item.pack)}`;
        keep({ ...base, strength: "possible", basis: "brand_name", why: `Same ${producerOk ? "producer" : "brand"} and name, but ${verified ? packWhy : "the name could not be found verbatim on the page"}. A person decides.`, score: 70 });
        continue;
      }
      if (brandOk || producerOk) {
        // Brand and company words do not count as product words: two words of the product itself must agree.
        const noise = new Set([...brandTokens(item), ...(item.vendor ? nameTokens(item.vendor) : []), ...(np.brand ? nameTokens(np.brand.value) : []), ...(producer ? nameTokens(producer) : [])]);
        const strip = (ts: string[]) => ts.filter((t) => !noise.has(t) && !/^[a-z]?\d/.test(t));
        const overlaps = names.map((n) => familyOverlap(strip(nt), strip(nameTokens(n))));
        const best = Math.max(...overlaps.map((o) => o.share), 0);
        const shared = Math.max(...overlaps.map((o) => o.shared), 0);
        if (shared >= 2 && best >= 0.5) {
          keep({ ...base, strength: "possible", basis: "brand_family", why: `Same ${brandOk ? "brand" : "producer"} and a similar product (${Math.round(best * 100)} % of the name's words), but no EAN and not the exact name. A person decides.`, score: 40 + best * 20 });
        }
      }
      // Another brand with a look-alike name is not a match.
    }
  }
  const all = [...out.values()].sort((a, b) => b.score - a.score);
  // A notice product that matched on a hard identifier is that product: its look-alikes are not also possible.
  const key = (n: string) => [...nameTokens(n)].sort().join(" ");
  const confirmedNames = new Set(all.filter((m) => m.strength === "confirmed" && m.noticeProduct).map((m) => key(m.noticeProduct!)));
  const distinct = new Set(facts.products.map((p) => key(p.name.value)));
  const onlyOne = distinct.size === 1 && all.some((m) => m.strength === "confirmed");
  const possible = all.filter((m) => m.strength === "possible" && !onlyOne && !confirmedNames.has(key(m.noticeProduct ?? "")));
  const byNoticeProduct = new Map<string, number>();
  const keptPossible = possible.filter((m) => {
    const k = m.noticeProduct ?? "";
    const n = (byNoticeProduct.get(k) ?? 0) + 1;
    byNoticeProduct.set(k, n);
    return n <= MAX_POSSIBLE_PER_PRODUCT;
  });
  return [...all.filter((m) => m.strength === "confirmed"), ...keptPossible];
}

const rank = (m: ProposedMatch) => (m.strength === "confirmed" ? 1000 : 0) + m.score;

// ---------- lots and dates ----------

/** The latest best-before date the notice limits itself to, if it limits by date at all. */
export function latestAffectedDate(lots: Lots): string | undefined {
  return [...lots.bestBefore, ...(lots.bestBeforeUpTo ? [lots.bestBeforeUpTo] : [])].sort().pop();
}

/**
 * Can a delivery on `deliveryDate` contain an affected pack? A wholesaler does not deliver food past its best-before
 * date, so a delivery on D only holds packs dated D or later: if every affected date is before D, it cannot. A
 * notice limited by batch codes or stamps alone cannot be ruled out this way.
 */
export function deliveryAffected(lots: Lots, deliveryDate: string): boolean {
  const latest = latestAffectedDate(lots);
  if (!latest) return true;
  return deliveryDate <= latest;
}

/** Whether deliveries made from `today` on can be affected (see deliveryAffected). */
export function newDeliveriesAffected(lots: Lots, today: string): boolean {
  return deliveryAffected(lots, today);
}

export function describeLots(lots: Lots): string | undefined {
  const parts: string[] = [];
  const d = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
  if (lots.bestBeforeUpTo) parts.push(`best before ${d(lots.bestBeforeUpTo)} or earlier`);
  else if (lots.bestBefore.length) parts.push(`best before ${lots.bestBefore.map(d).join(", ")}`);
  if (lots.batches.length) parts.push(`batch ${lots.batches.join(", ")}`);
  if (lots.marks.length) parts.push(`marked ${lots.marks.join(", ")}`);
  return parts.length ? parts.join("; ") : undefined;
}

// ---------- what code does with a match ----------

export type MatchDecision = { status: MatchStatus; hold: boolean; reviewReason?: string; note?: string };

/**
 * What happens to a match, in code:
 *   confirmed, recent notice, current lots   hold the product (autonomous orders refused, waiting orders flagged)
 *   confirmed, every affected date passed    no hold: deliveries now carry later dates; earlier buyers are told
 *   confirmed, older notice                  a person decides (a first read goes months back)
 *   possible                                 a person confirms or dismisses
 *   possible, notice older than 60 days      kept with the notice as history (a first read goes back months)
 */
export function decide(m: { strength: MatchStrength; lots: Lots }, ctx: { today: string; noticeAgeDays: number | undefined }): MatchDecision {
  if (m.strength === "possible") {
    if (ctx.noticeAgeDays !== undefined && ctx.noticeAgeDays > REVIEW_MAX_AGE_DAYS) return { status: "history", hold: false, note: `Possible match on a notice ${ctx.noticeAgeDays} days old: kept with the notice, not queued for review.` };
    return { status: "review", hold: false, reviewReason: "Possible match: no hard identifier agrees. Confirm to hold the product, or dismiss with a reason." };
  }
  if (!newDeliveriesAffected(m.lots, ctx.today)) {
    return { status: "confirmed", hold: false, note: `Every affected best-before date (${describeLots(m.lots)}) has passed, so deliveries from today cannot contain an affected pack. No hold; kitchens that received it earlier are told.` };
  }
  if (ctx.noticeAgeDays === undefined || ctx.noticeAgeDays > AUTO_HOLD_MAX_AGE_DAYS) {
    return { status: "review", hold: false, reviewReason: `Confirmed on a hard identifier, but the notice is ${ctx.noticeAgeDays === undefined ? "undated" : `${ctx.noticeAgeDays} days old`}: the stock has likely been cleared already. Confirm to hold it, or dismiss with a reason.` };
  }
  return { status: "confirmed", hold: true };
}

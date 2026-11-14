import { SignJWT, decodeProtectedHeader, errors, jwtVerify } from "jose";
import type { LiveOffer, Product } from "./catalog";
import { CLAIM_CTY, CLAIM_TYP, PRICE_CLAIM_MAX_HOURS, VC_CONTEXT, WHOLESALER_ISSUER, statedUntilMs, type ClaimRef } from "./claims";
import { violation, type HardConstraints } from "./clarify";
import { activeMemory, kitchenRulesFor, type KitchenProfile } from "./kitchen";
import { SIGN_ALG, VERIFY_ALGS, type SigningKey, type VerifyingKey } from "./keys";
import type { Mandate } from "./mandate";
import { SEASON, helsinkiMonth, seasonFor, type SeasonEntry } from "./season";
import { formatEur } from "./util";

/**
 * The wholesaler's selling agent, as plain code: which few products are genuinely worth suggesting to one kitchen,
 * the guardrails every suggestion must pass, and the signed offer that carries one to the buyer's agent.
 *
 * What it may say, and only when the data backs it (anything else is withheld with rule `unsupported_claim`):
 *   new_in_assortment  the wholesaler's own listing record says the product was listed in the last 90 days
 *   new_to_kitchen     the kitchen never bought it, in a product family it does buy (only ever a second reason)
 *   in_season          core/season.ts has it in season this month in Finland, with a source
 *   cheaper            like for like with what the kitchen orders every week, cheaper per litre or kilo at live,
 *                      signed prices, both pack contents certain
 *   more_reliable      like for like, delivered on time more often (both figures from the partner's file)
 *   lower_carbon       like for like, lower CO2e per litre or kilo (both figures known; group averages say so)
 *
 * What it may never do: suggest what the kitchen's signed mandate, a rule its people stated or its memory forbids;
 * suggest what the kitchen muted, or anything when the kitchen turned offers off; send more than OFFER_WEEKLY_CAP
 * offers to one kitchen in seven days; offer a product it declined in the last 30 days.
 *
 * An offer is never an order. It is a W3C Verifiable Credential secured with JOSE, like the product claims
 * (claims.ts): a compact JWS `typ: vc+jwt`, type `DockProductOffer`, signed Ed25519 with the wholesaler key in the
 * published JWK Set, addressed (`aud`) to the buyer organisation. Accepting one starts an ordinary order: a fresh
 * signed quote, the buyer's own mandate gate, and its sign-off. No model is called here.
 */

export const OFFER_TYPE = "DockProductOffer";
export const SELLING_AGENT = { id: "dock-selling-agent", name: "AimoPilot selling agent" } as const;
/** At most this many offers reach one kitchen in any seven days, whatever campaigns staff start. */
export const OFFER_WEEKLY_CAP = 2;
/** A product the kitchen declined is not offered to it again for this long. */
export const DECLINED_QUIET_DAYS = 30;
/** "New in the assortment" holds this long after the product was listed. */
export const NEW_LISTING_DAYS = 90;
/** An offer's price holds as long as a price claim does, and never past the price's own stated validity. */
export const OFFER_HOLD_HOURS = PRICE_CLAIM_MAX_HOURS;
/** Smallest difference worth saying. Below it, "cheaper" or "more reliable" is noise. */
export const MIN_SAVING_PCT = 3;
export const MIN_RELIABILITY_POINTS = 3;
export const MIN_CARBON_PCT = 10;
/** Most products the selling agent asks live prices for, per kitchen and run (the usual products included). */
export const MAX_PRICED = 6;

export const OFFER_TERMS =
  "This is an offer, not an order. Nothing is bought until the buyer orders: accepting starts an ordinary order, priced by a fresh quote the wholesaler signs and checked by the buyer's own mandate and sign-off.";

export const REASON_KINDS = ["new_in_assortment", "new_to_kitchen", "in_season", "cheaper", "more_reliable", "lower_carbon"] as const;
export type OfferReasonKind = (typeof REASON_KINDS)[number];
/** Reasons that make a product worth suggesting on their own; `new_to_kitchen` only adds to one of them. */
export const PRIMARY_REASONS: OfferReasonKind[] = ["cheaper", "new_in_assortment", "in_season", "more_reliable", "lower_carbon"];

export type ProductRef = { productId: string; name: string };
export type OfferReason =
  | { kind: "new_in_assortment"; listedAt: string }
  | { kind: "new_to_kitchen"; family: string; familyOrders: number }
  | { kind: "in_season"; season: string; label: string; months: number[]; why: string; source: { title: string; url: string } }
  | { kind: "cheaper"; comparedWith: ProductRef; unit: "L" | "kg"; perUnitCents: number; theirPerUnitCents: number; savingPct: number; usualAmount?: number; savingPerOrderCents?: number }
  | { kind: "more_reliable"; comparedWith: ProductRef; reliabilityPct: number; theirReliabilityPct: number }
  | { kind: "lower_carbon"; comparedWith: ProductRef; unit: string; kgCo2e: number; theirKgCo2e: number; lowerPct: number; basis: "group_average" | "product" };

export type OfferProduct = {
  productId: string;
  name: string;
  brand?: string;
  category: string;
  unit: "L" | "kg" | "pcs";
  packSize: number;
  attributes: string[];
  allergens: string[];
  allergensDeclared: boolean;
  /** Fresh, whole produce without the maker's allergen data: what it contains by its nature (core/catalog/nature.ts). */
  allergensByNature?: { allergens: string[]; basis: string };
  certificates: string[];
};

export type OfferBody = {
  offerId: string;
  /** Always false: an offer buys nothing. */
  isOrder: false;
  seller: { issuer: string; agent: string; name: string };
  buyer: { orgId: string; name: string };
  product: OfferProduct;
  /** Why, with the figures; the first is the main reason. */
  reasons: OfferReason[];
  /** The reason in one line, for people: written from the reasons, checked against them. */
  line: string;
  /** The price per pack the wholesaler states now (a signed price claim, `claimId`), and per litre or kilo. */
  price: { unitPriceCents: number; currency: "EUR"; per: string; perUnitCents?: number; unit?: "L" | "kg"; claimId?: string };
  /** A suggestion only: the kitchen's usual amount in packs for a like-for-like, else one pack to try. */
  suggestedPacks: number;
  validFrom: string;
  /** The price and the offer hold until then. */
  validUntil: string;
  campaignId?: string;
  terms: string;
  /** The signed claims the offer rests on (price, origin), by id and token hash. */
  evidence: ClaimRef[];
};

// ---------- the kitchen's side: what it allows, muted, turned off ----------

export type MuteScope = "product" | "family" | "reason" | "all";
export type OfferMute = { scope: Exclude<MuteScope, "all">; value: string; by: string; at: string; offerId?: string };
/** `off`: the kitchen turned offers off entirely. Kept with the kitchen's profile; the selling agent reads and respects it. */
export type OfferPrefs = { off?: { by: string; at: string }; mutes: OfferMute[] };
export const emptyPrefs = (): OfferPrefs => ({ mutes: [] });

export type OfferStatus = "offered" | "accepted" | "declined" | "muted" | "expired" | "withheld";
/** What the selling agent sent this kitchen before (and what came of it). */
export type PastOffer = { offerId: string; productId: string; family: string; at: string; status: OfferStatus };

export type MandateRules = Pick<Mandate, "allowedCategories" | "requiredAttributes" | "forbiddenAllergens" | "requiredCertificates"> & Partial<Pick<Mandate, "allergenEvidence" | "nutritionRules">>;

export type KitchenView = {
  orgId: string;
  name: string;
  profile?: KitchenProfile;
  mandate: MandateRules;
  prefs: OfferPrefs;
  past: PastOffer[];
  /** Products the kitchen has bought (history and orders through the gate). */
  bought: string[];
};

export type NewListing = { productId: string; listedAt: string; by?: string };
export type SellerContext = {
  now: Date;
  newListings: NewListing[];
  season?: SeasonEntry[];
  /** Live offers the wholesaler's price service gave for the shortlist (and the kitchen's usual products). */
  live?: Map<string, LiveOffer>;
};

export const GUARD_RULES = ["offers_off", "forbidden_by_rule", "muted", "declined_recently", "already_offered", "weekly_cap", "not_available", "unsupported_claim"] as const;
export type GuardRule = (typeof GUARD_RULES)[number];
export type GuardResult = { ok: true } | { ok: false; rule: GuardRule; reason: string };

const DAY = 86_400_000;

/**
 * Why the kitchen's rules forbid this product, or undefined when they allow it: the core's own hard-rule check
 * (clarify.ts violation: the mandate's groups, claims, allergens with the same evidence rule, certificates) over the
 * mandate plus every rule its people stated and its memory's safety rules, then what its memory says to avoid.
 */
export function forbiddenBy(p: Product, k: Pick<KitchenView, "mandate" | "profile">, now: Date): string | undefined {
  const m = k.mandate;
  const rules = kitchenRulesFor(k.profile, { requiredAttributes: m.requiredAttributes, forbiddenAllergens: m.forbiddenAllergens }, p.category, now);
  const c: HardConstraints = { categories: [...m.allowedCategories], requiredAttributes: rules.requiredClaims, excludedAttributes: [], forbiddenAllergens: rules.forbiddenAllergens, requiredCertificates: [...m.requiredCertificates], nutritionRules: [...(m.nutritionRules ?? [])], sources: [], ...(m.allergenEvidence ? { allergenEvidence: m.allergenEvidence } : {}) };
  const why = violation(p, c);
  if (why) return why.startsWith("category ") ? `the kitchen's mandate does not cover ${p.category.replaceAll("_", " ")}` : `the kitchen's rules: ${why}`;
  for (const item of k.profile ? activeMemory(k.profile, { family: p.category, now }) : []) {
    if (item.scope) continue;
    const f = item.fact;
    if (f.kind === "product" && f.stance === "avoid" && f.productId === p.id) return `the kitchen's memory says to avoid it: "${item.text}"`;
    if (f.kind === "brand" && f.stance === "avoid" && p.brand && f.brand.toLowerCase() === p.brand.toLowerCase()) return `the kitchen's memory says to avoid ${f.brand}: "${item.text}"`;
    if (f.kind === "substitute" && !f.accepted && f.productId === p.id && item.strength === "rule") return `the kitchen turned it down: "${item.text}"`;
  }
  return undefined;
}

/** The mute that covers this product and these reasons, if any. A reason mute covers it only when it covers every main reason. */
export function muteFor(prefs: OfferPrefs, p: { productId: string; category: string }, reasons: OfferReasonKind[]): OfferMute | undefined {
  const direct = prefs.mutes.find((m) => (m.scope === "product" && m.value === p.productId) || (m.scope === "family" && m.value === p.category));
  if (direct) return direct;
  const main = reasons.filter((r) => PRIMARY_REASONS.includes(r));
  const byReason = main.map((r) => prefs.mutes.find((m) => m.scope === "reason" && m.value === r));
  return main.length && byReason.every(Boolean) ? byReason[0] : undefined;
}

/** Offers that count against the weekly cap: everything sent to the kitchen in the last seven days. */
export function sentThisWeek(past: PastOffer[], now: Date): number {
  return past.filter((o) => o.status !== "withheld" && now.getTime() - Date.parse(o.at) < 7 * DAY).length;
}

// ---------- the figures, and whether the data backs each reason ----------

const MATERIAL = /^(lactose_free|low_lactose|gluten_free|milk_free|vegan|organic|fat_.*)$/;
const perUnit = (price: number, p: Pick<Product, "unit" | "packSize">) => (p.unit !== "pcs" && p.packSize > 0 ? price / p.packSize : undefined);
const reliabilityOf = (p: Product) => (p.deliveryReliabilityKnown === false || !(p.deliveryReliability > 0) ? undefined : p.deliveryReliability);
const carbonOf = (p: Product) => (p.carbonKnown === false || !(p.carbonKgPerUnit > 0) ? undefined : p.carbonKgPerUnit);
const kindsKey = (p: Product) => [...(p.kinds ?? [])].sort().join(",");

/** Like for like with what the kitchen usually buys: same family and unit, every material attribute it relies on, a similar pack, the same kind. */
export function likeForLike(candidate: Product, usual: Product): boolean {
  if (candidate.id === usual.id || candidate.category !== usual.category || candidate.unit !== usual.unit || candidate.unit === "pcs") return false;
  if (!usual.attributes.filter((a) => MATERIAL.test(a)).every((a) => candidate.attributes.includes(a))) return false;
  const ratio = candidate.packSize / usual.packSize;
  return ratio >= 0.5 && ratio <= 2 && kindsKey(candidate) === kindsKey(usual);
}

export type Usual = { family: string; product: Product; orders: number; amountPerOrder: number };

/** What the kitchen orders regularly: per family with at least three orders in the last eight weeks, its latest product and median amount per order. */
export function usualsOf(profile: KitchenProfile | undefined, products: Product[], now: Date): Usual[] {
  const out: Usual[] = [];
  const recent = (profile?.history ?? []).filter((h) => now.getTime() - Date.parse(h.placedAt) < 56 * DAY);
  for (const family of [...new Set(recent.map((h) => h.family))]) {
    const hist = recent.filter((h) => h.family === family).sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    if (hist.length < 3) continue;
    const count = new Map<string, number>();
    for (const h of hist) for (const l of h.lines) count.set(l.productId, (count.get(l.productId) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const product = products.find((p) => p.id === top);
    if (!product) continue;
    const amounts = hist.map((h) => h.amount).sort((a, b) => a - b);
    out.push({ family, product, orders: hist.length, amountPerOrder: amounts[Math.floor(amounts.length / 2)] });
  }
  return out;
}

export function familyOrders(profile: KitchenProfile | undefined, family: string): number {
  return (profile?.history ?? []).filter((h) => h.family === family).length;
}

const listingOf = (ctx: SellerContext, productId: string) => ctx.newListings.find((l) => l.productId === productId && ctx.now.getTime() - Date.parse(l.listedAt) < NEW_LISTING_DAYS * DAY && Date.parse(l.listedAt) <= ctx.now.getTime());

/** The reasons the data backs for this product and this kitchen, with their figures. Live figures need ctx.live. */
export function reasonsFor(p: Product, k: KitchenView, usuals: Usual[], ctx: SellerContext): OfferReason[] {
  const out: OfferReason[] = [];
  const live = ctx.live;
  const listed = listingOf(ctx, p.id);
  if (listed) out.push({ kind: "new_in_assortment", listedAt: listed.listedAt.slice(0, 10) });
  const season = seasonFor(p, helsinkiMonth(ctx.now), ctx.season ?? SEASON)[0];
  if (season) out.push({ kind: "in_season", season: season.kind, label: season.label.en, months: season.months, why: season.why, source: season.source });
  const usual = usuals.find((u) => likeForLike(p, u.product));
  if (usual) {
    const ref = { productId: usual.product.id, name: usual.product.name };
    const mine = live?.get(p.id);
    const theirs = live?.get(usual.product.id);
    const a = mine && perUnit(mine.unitPriceCents, p);
    const b = theirs && perUnit(theirs.unitPriceCents, usual.product);
    if (a !== undefined && b !== undefined && b > 0 && (p.unit === "L" || p.unit === "kg")) {
      const savingPct = Math.round(((b - a) / b) * 1000) / 10;
      if (savingPct >= MIN_SAVING_PCT) out.push({ kind: "cheaper", comparedWith: ref, unit: p.unit, perUnitCents: Math.round(a * 10) / 10, theirPerUnitCents: Math.round(b * 10) / 10, savingPct, usualAmount: usual.amountPerOrder, savingPerOrderCents: Math.round((b - a) * usual.amountPerOrder) });
    }
    const ra = reliabilityOf(p);
    const rb = reliabilityOf(usual.product);
    if (ra !== undefined && rb !== undefined && (ra - rb) * 100 >= MIN_RELIABILITY_POINTS) out.push({ kind: "more_reliable", comparedWith: ref, reliabilityPct: Math.round(ra * 1000) / 10, theirReliabilityPct: Math.round(rb * 1000) / 10 });
    const ca = carbonOf(p);
    const cb = carbonOf(usual.product);
    if (ca !== undefined && cb !== undefined && cb > 0 && ((cb - ca) / cb) * 100 >= MIN_CARBON_PCT) {
      out.push({ kind: "lower_carbon", comparedWith: ref, unit: p.unit, kgCo2e: ca, theirKgCo2e: cb, lowerPct: Math.round(((cb - ca) / cb) * 1000) / 10, basis: p.source === "valio" ? "group_average" : "product" });
    }
  }
  const orders = familyOrders(k.profile, p.category);
  if (orders > 0 && !k.bought.includes(p.id)) out.push({ kind: "new_to_kitchen", family: p.category, familyOrders: orders });
  return order(out);
}

const RANK: Record<OfferReasonKind, number> = { cheaper: 0, new_in_assortment: 1, in_season: 2, more_reliable: 3, lower_carbon: 4, new_to_kitchen: 5 };
const order = (r: OfferReason[]) => [...r].sort((a, b) => RANK[a.kind] - RANK[b.kind]);

/** Does the data back this one reason, as stated? Recomputed from the same sources, never taken from the reason itself. */
export function supported(reason: OfferReason, p: Product, k: KitchenView, usuals: Usual[], ctx: SellerContext): boolean {
  const fresh = reasonsFor(p, k, usuals, ctx).find((r) => r.kind === reason.kind);
  if (!fresh) return false;
  switch (reason.kind) {
    case "cheaper":
      return fresh.kind === "cheaper" && fresh.comparedWith.productId === reason.comparedWith.productId && Math.abs(fresh.perUnitCents - reason.perUnitCents) < 0.6 && Math.abs(fresh.theirPerUnitCents - reason.theirPerUnitCents) < 0.6 && fresh.savingPct + 0.05 >= reason.savingPct;
    case "more_reliable":
      return fresh.kind === "more_reliable" && fresh.reliabilityPct + 0.05 >= reason.reliabilityPct && fresh.theirReliabilityPct <= reason.theirReliabilityPct + 0.05;
    case "lower_carbon":
      return fresh.kind === "lower_carbon" && fresh.lowerPct + 0.05 >= reason.lowerPct;
    case "in_season":
      return fresh.kind === "in_season" || reasonsFor(p, k, usuals, ctx).some((r) => r.kind === "in_season" && r.season === reason.season);
    default:
      return true;
  }
}

/**
 * Every guardrail, in order: offers off, the kitchen's rules, mutes, a recent decline, the weekly cap, a live price to
 * state, and the data behind each reason (and behind each claim a campaign asks to make). The first that fails decides.
 */
export function guardOffer(c: { product: Product; reasons: OfferReason[]; claimed?: OfferReasonKind[] }, k: KitchenView, usuals: Usual[], ctx: SellerContext): GuardResult {
  const p = c.product;
  if (k.prefs.off) return { ok: false, rule: "offers_off", reason: `${k.name} turned offers off (${k.prefs.off.by}, ${k.prefs.off.at.slice(0, 10)}).` };
  const forbidden = forbiddenBy(p, k, ctx.now);
  if (forbidden) return { ok: false, rule: "forbidden_by_rule", reason: `Not offered: ${forbidden}.` };
  const mute = muteFor(k.prefs, { productId: p.id, category: p.category }, c.reasons.map((r) => r.kind));
  if (mute) return { ok: false, rule: "muted", reason: `${mute.by} asked not to be offered ${mute.scope === "product" ? "this product" : mute.scope === "family" ? `${mute.value.replaceAll("_", " ")} products` : `"${mute.value.replaceAll("_", " ")}" suggestions`} (${mute.at.slice(0, 10)}).` };
  const declined = k.past.find((o) => o.productId === p.id && o.status === "declined" && ctx.now.getTime() - Date.parse(o.at) < DECLINED_QUIET_DAYS * DAY);
  if (declined) return { ok: false, rule: "declined_recently", reason: `The kitchen declined this product on ${declined.at.slice(0, 10)}; not offered again for ${DECLINED_QUIET_DAYS} days.` };
  const open = k.past.find((o) => o.productId === p.id && o.status === "offered" && ctx.now.getTime() - Date.parse(o.at) < 7 * DAY);
  if (open) return { ok: false, rule: "already_offered", reason: `The kitchen already has an open offer of this product (${open.at.slice(0, 10)}): one is enough.` };
  const sent = sentThisWeek(k.past, ctx.now);
  if (sent >= OFFER_WEEKLY_CAP) return { ok: false, rule: "weekly_cap", reason: `${k.name} already had ${sent} offers in the last seven days; the cap is ${OFFER_WEEKLY_CAP}.` };
  const live = ctx.live?.get(p.id);
  if (!live) return { ok: false, rule: "not_available", reason: "The wholesaler's live service gave no price or delivery for it now: nothing to offer." };
  for (const want of c.claimed ?? []) {
    if (!c.reasons.some((r) => r.kind === want && supported(r, p, k, usuals, ctx))) return { ok: false, rule: "unsupported_claim", reason: `The data does not support "${want.replaceAll("_", " ")}" for this product and this kitchen.` };
  }
  const bad = c.reasons.find((r) => !supported(r, p, k, usuals, ctx));
  if (bad) return { ok: false, rule: "unsupported_claim", reason: `The data does not support "${bad.kind.replaceAll("_", " ")}" as stated.` };
  if (!c.reasons.some((r) => PRIMARY_REASONS.includes(r.kind))) return { ok: false, rule: "unsupported_claim", reason: "Nothing the data supports makes it worth suggesting to this kitchen now." };
  return { ok: true };
}

// ---------- selection ----------

export type Shortlisted = { product: Product; reasons: OfferReason[]; score: number; campaign?: { campaignId: string; claims: OfferReasonKind[] } };
export type Proposal = Shortlisted & { live: LiveOffer; suggestedPacks: number };
export type Withheld = { product: Product; reasons: OfferReason[]; rule: GuardRule; reason: string; campaignId?: string };

function score(r: OfferReason[], campaign: boolean): number {
  let s = campaign ? 20 : 0;
  for (const x of r) {
    if (x.kind === "cheaper") s += 10 + Math.min(x.savingPct, 30);
    else if (x.kind === "new_in_assortment") s += 8;
    else if (x.kind === "in_season") s += 6;
    else if (x.kind === "more_reliable") s += 4 + (x.reliabilityPct - x.theirReliabilityPct) / 2;
    else if (x.kind === "lower_carbon") s += 3;
    else if (x.kind === "new_to_kitchen") s += 1;
  }
  return s;
}

/**
 * From master data only (no live call): the products worth a live price for this kitchen, best first, and the ids
 * to price (the shortlist and the kitchen's usual products), at most MAX_PRICED. Products the kitchen's rules
 * forbid, or it muted, are not even priced; the campaign product always is, so its decision is recorded.
 */
export function shortlist(k: KitchenView, products: Product[], ctx: SellerContext, campaign?: { productId: string; campaignId: string; claims: OfferReasonKind[] }): { usuals: Usual[]; candidates: Shortlisted[]; priceIds: string[] } {
  const usuals = usualsOf(k.profile, products, ctx.now);
  const pre = { ...ctx, live: undefined };
  const candidates: Shortlisted[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const isCampaign = campaign?.productId === p.id;
    if (!isCampaign && (k.bought.includes(p.id) || k.past.some((o) => o.productId === p.id && o.status === "offered") || forbiddenBy(p, k, ctx.now) || muteFor(k.prefs, { productId: p.id, category: p.category }, []))) continue;
    const reasons = reasonsFor(p, k, usuals, pre);
    const lfl = usuals.some((u) => likeForLike(p, u.product));
    if (!isCampaign && !lfl && !reasons.some((r) => PRIMARY_REASONS.includes(r.kind))) continue;
    if (!isCampaign && familyOrders(k.profile, p.category) === 0) continue; // only families the kitchen buys
    candidates.push({ product: p, reasons, score: score(reasons, isCampaign) + (lfl ? 2 : 0), ...(isCampaign ? { campaign: { campaignId: campaign!.campaignId, claims: campaign!.claims } } : {}) });
  }
  candidates.sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
  const usualIds = usuals.filter((u) => candidates.some((c) => likeForLike(c.product, u.product))).map((u) => u.product.id);
  const room = Math.max(1, MAX_PRICED - usualIds.length);
  const top = candidates.slice(0, room);
  // A campaign product the kitchen cannot be offered is not priced: the guardrail decides before any price is needed.
  const priced = top.filter((c) => !c.campaign || (!k.prefs.off && !forbiddenBy(c.product, k, ctx.now)));
  return { usuals, candidates: top, priceIds: [...new Set([...priced.map((c) => c.product.id), ...usualIds])].slice(0, MAX_PRICED) };
}

/**
 * With live prices: the figures, the guardrails, and at most what the weekly cap leaves, one per product family.
 * Everything not proposed that was considered is returned as withheld, with the rule.
 */
export function finalize(k: KitchenView, short: { usuals: Usual[]; candidates: Shortlisted[] }, ctx: SellerContext): { proposals: Proposal[]; withheld: Withheld[] } {
  const proposals: Proposal[] = [];
  const withheld: Withheld[] = [];
  const families = new Set<string>();
  const ranked = short.candidates
    .map((c) => {
      const reasons = reasonsFor(c.product, k, short.usuals, ctx).filter((r) => !k.prefs.mutes.some((m) => m.scope === "reason" && m.value === r.kind) || c.campaign);
      return { ...c, reasons, score: score(reasons, !!c.campaign) };
    })
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
  for (const c of ranked) {
    const past = [...k.past, ...proposals.map((x) => ({ offerId: "", productId: x.product.id, family: x.product.category, at: ctx.now.toISOString(), status: "offered" as const }))];
    const g = guardOffer({ product: c.product, reasons: c.reasons, claimed: c.campaign?.claims }, { ...k, past }, short.usuals, ctx);
    if (!g.ok) {
      withheld.push({ product: c.product, reasons: c.reasons, rule: g.rule, reason: g.reason, ...(c.campaign ? { campaignId: c.campaign.campaignId } : {}) });
      continue;
    }
    if (families.has(c.product.category) && !c.campaign) continue; // one suggestion per family per run: the best
    families.add(c.product.category);
    const usual = short.usuals.find((u) => likeForLike(c.product, u.product));
    const suggestedPacks = usual && c.reasons.some((r) => r.kind === "cheaper" || r.kind === "more_reliable" || r.kind === "lower_carbon") ? Math.max(1, Math.round(usual.amountPerOrder / c.product.packSize)) : 1;
    proposals.push({ ...c, live: ctx.live!.get(c.product.id)!, suggestedPacks });
  }
  return { proposals, withheld };
}

// ---------- the offer: its one line, its body, its signature ----------

const pct = (n: number) => `${Math.round(n * 10) / 10} %`;
const perUnitText = (cents: number, unit: string) => `${formatEur(cents)} per ${unit === "L" ? "litre" : unit === "kg" ? "kilo" : unit}`;
const MONTH = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The reason in one line, from the reasons alone (the template a model's line falls back to). */
export function offerLine(reasons: OfferReason[]): string {
  const main = reasons.find((r) => PRIMARY_REASONS.includes(r.kind));
  const extra = reasons.some((r) => r.kind === "new_to_kitchen") ? " New to you." : "";
  if (!main) return "A product the wholesaler suggests.";
  switch (main.kind) {
    case "cheaper":
      return `${perUnitText(main.perUnitCents, main.unit)} against ${perUnitText(main.theirPerUnitCents, main.unit)} for your usual ${main.comparedWith.name}: ${pct(main.savingPct)} less${main.savingPerOrderCents ? `, about ${formatEur(main.savingPerOrderCents)} an order at your usual amount` : ""}.${extra}`;
    case "new_in_assortment":
      return `New in the assortment since ${main.listedAt}.${extra}`;
    case "in_season":
      return `In season now: ${main.label} (${MONTH[main.months[0]]} to ${MONTH[main.months.at(-1)!]}).${extra}`;
    case "more_reliable":
      return `Delivered on time ${pct(main.reliabilityPct)} of the time, against ${pct(main.theirReliabilityPct)} for your usual ${main.comparedWith.name}.${extra}`;
    case "lower_carbon":
      return `${main.kgCo2e} kg CO2e per ${main.unit === "L" ? "litre" : main.unit}, ${pct(main.lowerPct)} lower than your usual ${main.comparedWith.name}${main.basis === "group_average" ? " (product-group averages)" : ""}.${extra}`;
    default:
      return `A product the wholesaler suggests.${extra}`;
  }
}

export function offerProduct(p: Product): OfferProduct {
  return {
    productId: p.id,
    name: p.name,
    ...(p.brand && p.brand !== "unknown" ? { brand: p.brand } : {}),
    category: p.category,
    unit: p.unit,
    packSize: p.packSize,
    attributes: [...p.attributes],
    allergens: [...p.allergens],
    allergensDeclared: p.allergenInfo ? p.allergenInfo.declared : true,
    ...(p.allergenInfo?.byNature ? { allergensByNature: p.allergenInfo.byNature } : {}),
    certificates: [...p.certificates],
  };
}

/** When an offer's price stops holding: OFFER_HOLD_HOURS from now, never past the price's stated validity. */
export function offerUntil(now: Date, live: LiveOffer): Date {
  const stated = statedUntilMs(live.priceValidUntil);
  return new Date(Math.min(now.getTime() + OFFER_HOLD_HOURS * 3600_000, stated ?? Infinity));
}

export async function signOffer(body: OfferBody, key: SigningKey): Promise<string> {
  const credential = {
    "@context": [VC_CONTEXT],
    id: `urn:dock:offer:${body.offerId}`,
    type: ["VerifiableCredential", OFFER_TYPE],
    issuer: WHOLESALER_ISSUER,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    credentialSubject: { id: `urn:dock:org:${body.buyer.orgId}`, offer: body },
  };
  return new SignJWT(JSON.parse(JSON.stringify(credential)) as Record<string, unknown>)
    .setProtectedHeader({ alg: SIGN_ALG, kid: key.kid, typ: CLAIM_TYP, cty: CLAIM_CTY })
    .setIssuer(WHOLESALER_ISSUER)
    .setSubject(body.product.productId)
    .setAudience(body.buyer.orgId)
    .setJti(body.offerId)
    .setIssuedAt(Math.floor(Date.parse(body.validFrom) / 1000))
    .setNotBefore(Math.floor(Date.parse(body.validFrom) / 1000))
    .setExpirationTime(Math.ceil(Date.parse(body.validUntil) / 1000))
    .sign(key.privateKey);
}

export type OfferErrorCode = "offer_malformed" | "offer_unknown_key" | "offer_signature_invalid" | "offer_expired" | "offer_wrong_buyer";
export class OfferError extends Error {
  constructor(
    readonly code: OfferErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OfferError";
  }
}

/**
 * Verify an offer offline: the wholesaler's signature (key by kid from the published JWK Set), the type, the issuer,
 * the validity window at `now`, that it is addressed to `orgId` when given, and that it is not an order.
 */
export async function verifyOffer(token: string, keys: VerifyingKey[], opts: { now?: Date; orgId?: string } = {}): Promise<OfferBody> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    throw new OfferError("offer_malformed", "The offer is not a compact JWS.");
  }
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new OfferError("offer_unknown_key", `No published wholesaler key "${kid ?? "(none)"}".`);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key.publicKey, { algorithms: VERIFY_ALGS, typ: CLAIM_TYP, issuer: WHOLESALER_ISSUER, currentDate: opts.now ?? new Date(), requiredClaims: ["sub", "jti", "exp", "aud"], ...(opts.orgId ? { audience: opts.orgId } : {}) }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw new OfferError("offer_expired", "The offer has expired: its price no longer holds.");
    if (err instanceof errors.JWTClaimValidationFailed && err.claim === "aud") throw new OfferError("offer_wrong_buyer", "The offer is addressed to another buyer.");
    if (err instanceof errors.JWSSignatureVerificationFailed) throw new OfferError("offer_signature_invalid", "The offer's signature does not verify: it was altered or not made by the wholesaler.");
    throw new OfferError("offer_malformed", `Offer rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  const types = payload.type as unknown;
  const offer = (payload.credentialSubject as { offer?: OfferBody } | undefined)?.offer;
  if (!Array.isArray(types) || !types.includes(OFFER_TYPE) || !offer || offer.offerId !== payload.jti || offer.product?.productId !== payload.sub || offer.buyer?.orgId !== payload.aud || offer.isOrder !== false) {
    throw new OfferError("offer_malformed", "The token is not an AimoPilot product offer.");
  }
  return offer;
}

// ---------- the buyer's side: does this offer belong in front of the kitchen? ----------

/**
 * The kitchen's own agent checks each offer against the kitchen before showing it, in plain code: still valid,
 * allowed by its rules (the mandate it signed, rules its people stated, its memory), not muted, offers not off, and
 * not something it already buys. The wholesaler's agent ran its own guardrails; the buyer's agent does not rely on them.
 */
export function buyerCheck(offer: OfferBody, k: Pick<KitchenView, "mandate" | "profile" | "prefs" | "bought">, now: Date, product?: Product): { show: true } | { show: false; why: string } {
  if (Date.parse(offer.validUntil) <= now.getTime()) return { show: false, why: "expired" };
  if (k.prefs.off) return { show: false, why: "offers are off" };
  const p = offer.product;
  // The product's own master data when the caller has it (nutrition declarations, allergens by nature): the offer
  // carries only what a buyer needs to read, and judging a nutrition rule on it would hide every offer as "undeclared".
  const forbidden = forbiddenBy(product && product.id === p.productId ? product : { id: p.productId, name: p.name, brand: p.brand ?? "unknown", category: p.category, unit: p.unit, packSize: p.packSize, attributes: p.attributes, allergens: p.allergens, certificates: p.certificates, deliveryReliability: 0, carbonKgPerUnit: 0, allergenInfo: { declared: p.allergensDeclared, contains: p.allergens, mayContain: [], freeFrom: [], ...(p.allergensByNature ? { byNature: p.allergensByNature } : {}) } }, k, now);
  if (forbidden) return { show: false, why: forbidden };
  const mute = muteFor(k.prefs, { productId: p.productId, category: p.category }, offer.reasons.map((r) => r.kind));
  if (mute) return { show: false, why: "muted" };
  if (k.bought.includes(p.productId) && !offer.reasons.some((r) => r.kind === "cheaper")) return { show: false, why: "the kitchen already buys it" };
  return { show: true };
}

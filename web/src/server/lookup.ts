import { claimEvidence, claimsEvidence, shortfallText, subjectOfProduct } from "@/core/claim-evidence";
import { nutritionFindings } from "@/core/nutrition";
import { holdsLabel } from "@/core/vocabulary";
import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL, type LiveOffer, type Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { takeBackUntil, type AgentSession, type Dock, type PublicOrder } from "@/core/orders";
import type { LiveBudget } from "@/server/aiven/valkey";

/**
 * The structured lookup an outside agent gets, over MCP (find_products, find_alternatives, list_orders) and REST
 * (POST /api/v1/lookup, POST /api/v1/alternatives, GET /api/v1/orders). Nothing here decides anything: it is the
 * core's own master-data search (dock.searchProducts), the core's live lookup (dock.lookupAvailability, metered and
 * capped per agent), the product knowledge map (dock.alternativesFor) and the gate's own preview
 * (dock.previewDecision), put together so one call returns products, prices and availability in structured form.
 * The kitchen's own agent reads the same functions (server/thread/home.ts, server/thread/sheet.ts).
 */

const CLAIM = z.string().min(1).max(40);
const BaseUnit = z.enum(["L", "kg", "pcs"]);

export const LookupInput = z.object({
  requestId: z.string().min(1).optional().describe("Your request, if you have one."),
  text: z.string().min(1).max(120).optional().describe("e.g. 'lactose-free milk'."),
  category: z.string().min(1).max(60).optional().describe("e.g. milk, cream, plant_drink."),
  brand: z.string().min(1).max(60).optional(),
  productIds: z.array(z.string().min(1).max(60)).min(1).max(20).optional(),
  requiredClaims: z.array(CLAIM).max(8).optional().describe("e.g. ['lactose_free']."),
  forbiddenAllergens: z.array(CLAIM).max(14).optional().describe("Unknown allergen data counts as unsafe."),
  packSize: z
    .object({ min: z.number().positive().optional(), max: z.number().positive().optional(), unit: BaseUnit.optional() })
    .optional()
    .describe("Pack size window."),
  quantity: z.object({ amount: z.number().positive().max(1_000_000), unit: BaseUnit }).optional().describe("Packs needed and whether stock covers it."),
  deliverOn: z.iso.date().optional().describe("Wanted delivery day."),
  live: z.boolean().optional().describe("false: master data only (free)."),
  limit: z.number().int().min(1).max(MAX_LIVE_IDS_PER_CALL).optional().describe("Default 5."),
});
export type LookupInput = z.input<typeof LookupInput>;

/** Why the mandate keeps a product out, in its own terms; empty when it may be bought. */
export function mandateMisfit(m: Mandate, p: Product): string[] {
  return mandateMisfits(m, p).map((x) => x.reason);
}

/**
 * Why a product falls outside the mandate, each with its rule and the facts a sentence needs: a dietary claim it is
 * not shown to meet (core/claim-evidence.ts: claim, declaration, nature or not food), an allergen, a label, a
 * nutrition rule with the product's own figure and the rule's bound ("13 g sugar per 100 g; at most 12 g").
 */
export function mandateMisfits(m: Mandate, p: Product): { rule: string; reason: string; details?: Record<string, unknown> }[] {
  const out: { rule: string; reason: string; details?: Record<string, unknown> }[] = [];
  if (!m.allowedCategories.includes(p.category)) out.push({ rule: "category_allowed", reason: `category ${p.category} is outside the mandate` });
  for (const e of claimsEvidence(subjectOfProduct(p), m.requiredAttributes, { strict: m.allergenEvidence === "declared" }))
    if (!e.met) out.push({ rule: "required_attributes", reason: `${shortfallText(e)}, which the mandate requires`, details: { claim: e.claim, shortfall: e.why } });
  for (const a of m.forbiddenAllergens) if (p.allergens.includes(a)) out.push({ rule: "forbidden_allergens", reason: `contains ${a}, which the mandate forbids`, details: { allergen: a } });
  for (const f of nutritionFindings(m.nutritionRules ?? [], { productId: p.id, category: p.category, nutrition: p.nutrition }))
    out.push({ rule: "nutrition_rules", reason: f.reason.replace(new RegExp(`^${p.id} `), `${p.name} `), details: { nutrient: f.rule.nutrient, problem: f.problem, ...(f.value !== undefined ? { value: f.value } : {}), ...(f.rule.max !== undefined ? { max: f.rule.max } : {}), ...(f.rule.min !== undefined ? { min: f.rule.min } : {}), per: p.nutrition?.per ?? "100g", ...(f.rule.categories?.length ? { kinds: f.rule.categories } : {}) } });
  for (const c of m.requiredCertificates) if (!holdsLabel(p, c)) out.push({ rule: "required_certificates", reason: `lacks the ${c} label the mandate requires`, details: { label: c } });
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Smart search's labels, as an outside agent reads them: is this the thing asked for, a variant of it, or a stand-in? */
const MATCH: Record<string, string> = { exact: "exact", variant: "variant", standin: "stand_in", other: "not_the_kind" };

/** Keys of a product that the compact view already says (or that only matter to the catalogue). Anything else passes through in `more`. */
const SAID = new Set(["id", "name", "brand", "category", "unit", "packSize", "attributes", "allergens", "certificates", "deliveryReliability", "carbonKgPerUnit", "source", "names", "vendor", "categoryCode", "salesUnit", "baseUnit", "lotSize", "packContent", "allergenInfo", "deliveryReliabilityKnown", "carbonKnown", "carbonGroupAvgKgCo2ePerKg", "temperatureClass", "countryOfOrigin", "substitutes", "kinds", "gtin", "origin"]);

/** A product as an outside agent reads it: the facts a buyer compares, in one shape, with unknowns said as null. */
export function productFacts(p: Product) {
  const info = p.allergenInfo;
  const more = Object.fromEntries(Object.entries(p).filter(([k, v]) => !SAID.has(k) && v !== undefined && v !== null));
  return {
    productId: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    pack: { size: p.packSize, unit: p.unit, ...(p.packContent?.label ? { label: p.packContent.label } : {}), ...(p.packContent && !p.packContent.certain ? { estimated: true } : {}) },
    claims: p.attributes,
    labels: p.certificates,
    allergens: info ? { declared: info.declared, contains: info.contains, mayContain: info.mayContain, freeFrom: info.freeFrom } : { declared: true, contains: p.allergens, mayContain: [], freeFrom: [] },
    origin: p.countryOfOrigin ?? (p as { origin?: string }).origin ?? null,
    temperature: p.temperatureClass ?? null,
    deliveryReliability: p.deliveryReliabilityKnown === false ? null : p.deliveryReliability,
    carbon:
      p.carbonKnown === false
        ? { basis: "missing" as const, kgCo2ePerUnit: null, unit: p.unit, groupAverageKgCo2ePerKg: p.carbonGroupAvgKgCo2ePerKg ?? null }
        : { basis: "product_group_average" as const, kgCo2ePerUnit: p.carbonKgPerUnit, unit: p.unit, groupAverageKgCo2ePerKg: p.carbonGroupAvgKgCo2ePerKg ?? null },
    ...(Object.keys(more).length ? { more } : {}),
  };
}

/** Live price, stock and delivery for one product, against the day and amount asked. */
export function liveFacts(o: LiveOffer, p: Product, ask: { deliverOn?: string; quantity?: { amount: number; unit: string } }) {
  const packs = ask.quantity && ask.quantity.unit === p.unit ? Math.max(1, Math.ceil(ask.quantity.amount / p.packSize - 1e-9)) : undefined;
  const stockKnown = o.stockKnown !== false;
  return {
    unitPriceCents: o.unitPriceCents,
    perUnit: { cents: Math.round(o.unitPriceCents / p.packSize), unit: p.unit },
    ...(o.unitPriceWithTaxCents !== undefined ? { unitPriceWithTaxCents: o.unitPriceWithTaxCents } : {}),
    ...(o.taxRatePct !== undefined ? { taxRatePct: o.taxRatePct } : {}),
    ...(o.netPrice ? { customerPrice: true } : {}),
    ...(o.priceValidUntil ? { priceValidUntil: o.priceValidUntil } : {}),
    availablePacks: stockKnown ? o.availablePacks : null,
    stock: stockKnown ? ("reported" as const) : ("not_reported" as const),
    ...(o.logisticModel ? { logistics: o.logisticModel } : {}),
    earliestDelivery: o.deliveryDate,
    ...(o.orderBy ? { orderBy: o.orderBy } : {}),
    ...(o.cutoffPassed ? { cutoffPassed: true } : {}),
    ...(ask.deliverOn ? { meetsDay: o.deliveryDate <= ask.deliverOn && !o.laterThanRequested && !o.cutoffPassed } : {}),
    ...(packs !== undefined ? { packsForQuantity: packs, coversQuantity: stockKnown ? o.availablePacks >= packs : null, lineTotalCents: packs * o.unitPriceCents } : {}),
    ...(o.claims ? { signedClaims: o.claims } : {}),
    ...(o.simulated ? { simulated: true } : {}),
  };
}

async function requestFor(dock: Dock, session: AgentSession, input: { requestId?: string; text: string; deliverOn?: string; category?: string; productIds?: string[] }): Promise<{ requestId: string; opened: boolean }> {
  if (input.requestId) return { requestId: input.requestId, opened: false };
  const r = await dock.openRequest(session, { text: input.text.slice(0, 2000), ...(input.deliverOn ? { deliverOn: input.deliverOn } : {}), ...(input.category ? { category: input.category } : {}), ...(input.productIds?.length ? { productIds: input.productIds.slice(0, 20) } : {}) });
  return { requestId: r.requestId, opened: true };
}

const describe = (i: z.output<typeof LookupInput>) =>
  [i.quantity && `${i.quantity.amount} ${i.quantity.unit}`, i.text, i.brand && `by ${i.brand}`, i.category && `(${i.category})`, i.requiredClaims?.length && i.requiredClaims.join(", "), i.forbiddenAllergens?.length && `without ${i.forbiddenAllergens.join(", ")}`, i.deliverOn && `for ${i.deliverOn}`]
    .filter(Boolean)
    .join(" ") || "products";

/** find_products / POST /api/v1/lookup. */
export async function lookupProducts(dock: Dock, session: AgentSession, raw: unknown, guard?: { budget: LiveBudget; agentKey: string }) {
  const input = LookupInput.parse(raw);
  if (!input.text && !input.category && !input.productIds?.length && !input.brand) throw new DockError(400, "invalid_request", "Say what to look for: text, category, brand or productIds.");
  const { requestId, opened } = await requestFor(dock, session, { requestId: input.requestId, text: `Lookup: ${describe(input)}`, deliverOn: input.deliverOn, category: input.category, productIds: input.productIds });
  // Words go through the one product search (smart search, as the kitchen's own agent gets it); ids and a bare
  // category through the master-data search. Either way the mandate's and the buyer's hard rules apply in code.
  const words = [input.text, input.brand].filter(Boolean).join(" ");
  const claims = [...new Set([...(input.requiredClaims ?? []), ...session.mandate.requiredAttributes])];
  const avoid = [...new Set([...(input.forbiddenAllergens ?? []), ...session.mandate.forbiddenAllergens])];
  let found: Awaited<ReturnType<Dock["findProducts"]>> | undefined;
  let hits: Product[];
  if (words && !input.productIds?.length) {
    found = await dock.findProducts(session, { requestId, text: words, ...(input.category ? { category: input.category } : {}), ...(claims.length ? { requiredClaims: claims } : {}), ...(avoid.length ? { forbiddenAllergens: avoid } : {}), ...(session.mandate.allergenEvidence === "declared" ? { declaredAllergensOnly: true } : {}), limit: 100 });
    hits = found.hits.map((h) => h.product);
    // What the kitchen's nutrition rules leave out is counted as outside the mandate below, with the rule and its figure.
  } else {
    hits = await dock.searchProducts(session, {
      requestId,
      ...(input.productIds?.length ? { ids: input.productIds } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.requiredClaims?.length ? { attributes: input.requiredClaims } : {}),
      ...(input.forbiddenAllergens?.length ? { forbiddenAllergens: input.forbiddenAllergens } : {}),
      limit: 100,
    });
  }
  const label = new Map((found?.hits ?? []).flatMap((h) => (h.label ? [[h.product.id, MATCH[h.label] ?? h.label] as const] : [])));
  const brand = input.brand?.toLowerCase();
  const filtered = hits.filter(
    (p) =>
      (!brand || p.brand.toLowerCase().includes(brand) || (p.vendor ?? "").toLowerCase().includes(brand)) &&
      (!input.packSize?.unit || p.unit === input.packSize.unit) &&
      (input.packSize?.min === undefined || p.packSize >= input.packSize.min) &&
      (input.packSize?.max === undefined || p.packSize <= input.packSize.max) &&
      (input.requiredClaims ?? []).every((c) => claimEvidence(subjectOfProduct(p), c, { strict: session.mandate.allergenEvidence === "declared" }).met) &&
      // smart search applied the allergen rule already (with its fresh-produce reading); the master-data path is strict
      !(input.forbiddenAllergens ?? []).some((a) => p.allergens.includes(a) || p.allergenInfo?.mayContain.includes(a) || (!found && p.allergenInfo?.declared === false)),
  );
  const allowed = filtered.filter((p) => !mandateMisfit(session.mandate, p).length);
  const outside = filtered.filter((p) => mandateMisfit(session.mandate, p).length);
  const limit = input.limit ?? 5;
  const shown = allowed.slice(0, limit);
  const live = input.live !== false && shown.length > 0;
  let offers: LiveOffer[] = [];
  let unavailable: { productId: string; message: string; problems: string[] }[] = [];
  if (live) {
    const ids = shown.map((p) => p.id);
    await guard?.budget.reserve(guard.agentKey, ids);
    const r = await dock.lookupAvailability(session, { requestId, productIds: ids, ...(input.deliverOn ? { deliveryDate: input.deliverOn } : {}) });
    offers = r.offers;
    unavailable = r.unavailable.map((u) => ({ productId: u.productId, message: u.message, problems: u.problems }));
  }
  const products = shown.map((p) => {
    const o = offers.find((x) => x.productId === p.id);
    const u = unavailable.find((x) => x.productId === p.id);
    return { ...productFacts(p), ...(label.get(p.id) ? { match: label.get(p.id) } : {}), ...(o ? { live: liveFacts(o, p, input) } : {}), ...(u ? { unavailable: { reason: u.message, problems: u.problems } } : {}) };
  });
  return {
    requestId,
    ...(opened ? { opened: true } : {}),
    matched: filtered.length,
    ...(found ? { search: { path: found.path, notSold: found.notSold, onlyStandins: found.onlyStandins, unsure: found.unsure, notes: found.notes } } : {}),
    products,
    outsideMandate: { count: outside.length, examples: outside.slice(0, 3).map((p) => ({ productId: p.id, name: p.name, why: mandateMisfit(session.mandate, p), rules: mandateMisfits(session.mandate, p).map(({ rule, details }) => ({ rule, ...(details ? { details } : {}) })) })) },
    liveChecked: live ? shown.length : 0,
    ...(guard ? { liveLookupBudget: await guard.budget.remaining(guard.agentKey) } : {}),
  };
}

// ---------- alternatives: good, better, best ----------

export const RANK_BY = ["same_kind", "price", "co2", "reliability", "pack_size"] as const;

export const AlternativesInput = z.object({
  requestId: z.string().min(1).optional().describe("Your request, if you have one."),
  productId: z.string().min(1).max(60),
  quantity: z.object({ amount: z.number().positive().max(1_000_000), unit: BaseUnit }).optional(),
  deliverOn: z.iso.date().optional(),
  requiredClaims: z.array(CLAIM).max(8).optional(),
  forbiddenAllergens: z.array(CLAIM).max(14).optional(),
  rankBy: z.enum(RANK_BY).optional().describe("Default same_kind."),
});
export type AlternativesInput = z.input<typeof AlternativesInput>;

/** Claims a substitute must keep from the product it replaces: a lactose-free milk stays lactose-free. */
const KEPT = /^(lactose_free|gluten_free|organic|vegan|milk_free|vegetarian)$/;

type Candidate = ReturnType<typeof productFacts> & {
  packs: number;
  totalCents: number;
  live: ReturnType<typeof liveFacts>;
  co2Kg: number | null;
  why?: string;
  mapTier?: string;
  tradeOffs: string[];
  gate: { outcome: string; approver?: { name: string; role: string }; reasons: string[] };
  rank: "best" | "better" | "good";
};

/** find_alternatives / POST /api/v1/alternatives: what can stand in, within the mandate, ranked best, better, good, each with the gate's own preview. */
export async function findAlternatives(dock: Dock, session: AgentSession, raw: unknown, guard?: { budget: LiveBudget; agentKey: string }) {
  const input = AlternativesInput.parse(raw);
  const { requestId, opened } = await requestFor(dock, session, { requestId: input.requestId, text: `Alternatives for ${input.productId}${input.quantity ? `, ${input.quantity.amount} ${input.quantity.unit}` : ""}${input.deliverOn ? ` for ${input.deliverOn}` : ""}`, deliverOn: input.deliverOn, productIds: [input.productId] });
  const [current] = await dock.searchProducts(session, { requestId, ids: [input.productId], limit: 1 });
  if (!current) throw new DockError(404, "product_not_found", `No product ${input.productId} in the assortment.`);
  const m = session.mandate;
  const keep = [...new Set([...current.attributes.filter((a) => KEPT.test(a)), ...(input.requiredClaims ?? [])])];
  const avoid = [...new Set([...m.forbiddenAllergens, ...(input.forbiddenAllergens ?? [])])];
  const map = await dock.alternativesFor(current.id, { text: current.name, requiredClaims: keep, forbiddenAllergens: avoid });
  const family = await dock.searchProducts(session, { requestId, category: current.category, limit: 100 });
  const proposed = map ? [...new Set(map.substitutes.flatMap((s) => [s.productId, ...s.otherPacks.slice(0, 1)]))] : [];
  const proposedProducts = proposed.length ? await dock.searchProducts(session, { requestId, ids: proposed.slice(0, 20), limit: 20 }) : [];
  const fits = (p: Product) => p.id !== current.id && p.unit === current.unit && !mandateMisfit(m, p).length && keep.every((a) => p.attributes.includes(a)) && !avoid.some((a) => p.allergens.includes(a));
  const pool = [...new Map([...proposedProducts, ...family].filter(fits).map((p) => [p.id, p])).values()];
  const rankBy = input.rankBy ?? "same_kind";
  const tier = (p: Product) => map?.substitutes.find((s) => s.productId === p.id || s.otherPacks.includes(p.id));
  const tierN = (p: Product) => ({ best: 0, better: 1, good: 2 })[tier(p)?.tier ?? "good"] + (tier(p) ? 0 : 3);
  const kind = (p: Product) => -p.attributes.filter((a) => current.attributes.includes(a)).length;
  const masterScore = (p: Product) =>
    rankBy === "co2" ? (p.carbonKnown === false ? 99 : p.carbonKgPerUnit) : rankBy === "reliability" ? -(p.deliveryReliabilityKnown === false ? 0 : p.deliveryReliability) : rankBy === "pack_size" ? Math.abs(p.packSize - current.packSize) : kind(p);
  // Master data narrows to a short list first (no live call); then live prices for that short list only.
  const short = pool.sort((a, b) => tierN(a) - tierN(b) || masterScore(a) - masterScore(b)).slice(0, 5);
  const ids = [current.id, ...short.map((p) => p.id)];
  await guard?.budget.reserve(guard.agentKey, ids);
  const live = await dock.lookupAvailability(session, { requestId, productIds: ids, ...(input.deliverOn ? { deliveryDate: input.deliverOn } : {}) });
  const amount = input.quantity && input.quantity.unit === current.unit ? input.quantity.amount : current.packSize;
  const packsOf = (p: Product) => Math.max(1, Math.ceil(amount / p.packSize - 1e-9));
  const offerOf = (id: string) => live.offers.find((o) => o.productId === id);
  const cur = offerOf(current.id);
  const curPacks = packsOf(current);
  const requested = {
    ...productFacts(current),
    packs: curPacks,
    ...(cur ? { live: liveFacts(cur, current, { deliverOn: input.deliverOn, quantity: { amount, unit: current.unit } }) } : {}),
    ...(live.unavailable.find((u) => u.productId === current.id) ? { unavailable: { reason: live.unavailable.find((u) => u.productId === current.id)!.message } } : {}),
  };
  const candidates: Candidate[] = [];
  const refused: { productId: string; name: string; rule?: string; reason: string }[] = [];
  for (const p of short) {
    const o = offerOf(p.id);
    if (!o) {
      const u = live.unavailable.find((x) => x.productId === p.id);
      refused.push({ productId: p.id, name: p.name, reason: u?.message ?? "no live offer" });
      continue;
    }
    const packs = packsOf(p);
    // The gate's preview of ordering it: what stock allows when it is short (the trade-offs say so).
    const previewPacks = o.stockKnown === false ? packs : Math.max(1, Math.min(packs, o.availablePacks));
    const d = await dock.previewDecision(session, requestId, [{ productId: p.id, quantity: previewPacks, substituteFor: current.id }], live.offers, { referencePrices: true }).catch(() => undefined);
    const failed = d?.rules.find((x) => x.outcome === "fail");
    if (d?.outcome === "reject") {
      refused.push({ productId: p.id, name: p.name, rule: failed?.rule, reason: failed?.reason ?? d.reasons[0] ?? "the gate would refuse it" });
      continue;
    }
    const total = packs * o.unitPriceCents;
    const perUnit = o.unitPriceCents / p.packSize;
    const curPerUnit = cur ? cur.unitPriceCents / current.packSize : undefined;
    const tradeOffs: string[] = [];
    if (curPerUnit !== undefined) {
      const pct = Math.round(((perUnit - curPerUnit) / curPerUnit) * 100);
      if (pct) tradeOffs.push(`${Math.abs(pct)} % ${pct > 0 ? "dearer" : "cheaper"} per ${p.unit} than the product asked for`);
    }
    if (p.packSize !== current.packSize) tradeOffs.push(`${p.packSize} ${p.unit} packs instead of ${current.packSize} ${current.unit}`);
    if (p.brand !== current.brand) tradeOffs.push(`another brand (${p.brand})`);
    const lost = current.attributes.filter((a) => !p.attributes.includes(a));
    if (lost.length) tradeOffs.push(`not ${lost.join(", ")}`);
    if (packs * p.packSize > amount + 1e-9) tradeOffs.push(`rounds up to ${r2(packs * p.packSize)} ${p.unit}`);
    if (input.deliverOn && o.deliveryDate > input.deliverOn) tradeOffs.push(`arrives ${o.deliveryDate}, after ${input.deliverOn}`);
    if (o.stockKnown === false) tradeOffs.push("stock not reported by the wholesaler");
    else if (o.availablePacks < packs) tradeOffs.push(`only ${o.availablePacks} packs in stock`);
    const t = tier(p);
    candidates.push({
      ...productFacts(p),
      packs,
      totalCents: total,
      live: liveFacts(o, p, { deliverOn: input.deliverOn, quantity: { amount, unit: p.unit } }),
      co2Kg: p.carbonKnown === false ? null : r2(p.carbonKgPerUnit * packs * p.packSize),
      ...(t ? { why: t.reason, mapTier: t.tier } : {}),
      tradeOffs,
      gate: { outcome: d?.outcome ?? "unknown", ...(d?.outcome === "needs_human_approval" ? { approver: { name: d.approver.name, role: d.approver.role } } : {}), reasons: d?.reasons ?? [] },
      rank: "good",
    });
  }
  const score = (c: Candidate) => (rankBy === "price" ? c.totalCents : rankBy === "co2" ? (c.co2Kg ?? 1e9) : rankBy === "reliability" ? -(c.deliveryReliability ?? 0) : 0);
  const ranked = candidates.sort((a, b) => score(a) - score(b) || (input.deliverOn ? Number(!a.live.meetsDay) - Number(!b.live.meetsDay) : 0));
  ranked.forEach((c, i) => (c.rank = (["best", "better", "good"] as const)[Math.min(i, 2)]));
  return {
    requestId,
    ...(opened ? { opened: true } : {}),
    requested,
    rankedBy: rankBy,
    alternatives: ranked.slice(0, 3),
    ...(map?.none && !ranked.length ? { none: map.none } : {}),
    leftOut: refused,
    ...(guard ? { liveLookupBudget: await guard.budget.remaining(guard.agentKey) } : {}),
  };
}

// ---------- the agent's orders ----------

export const ListOrdersInput = z.object({
  status: z.enum(["pending_approval", "committed", "declined", "rejected", "withdrawn", "expired"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** One order, short: what an agent needs to follow it. */
export function orderSummary(o: PublicOrder, session: AgentSession) {
  const until = takeBackUntil(o);
  const mine = o.agentId === session.agentId;
  return {
    orderId: o.orderId,
    requestId: o.requestId,
    status: o.status,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    deliveryDate: o.lines.map((l) => l.deliveryDate).sort().at(-1),
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, ...(l.substituteFor ? { substituteFor: l.substituteFor.productId } : {}) })),
    placedBy: mine ? "this agent" : o.agentId,
    ...(o.approval ? { signOff: { approver: { name: o.approval.approver.name, role: o.approval.approver.role }, status: o.approval.status, requestedAt: o.approval.requestedAt, ...(o.approval.decidedAt ? { decidedAt: o.approval.decidedAt } : {}), ...(o.approval.note ? { note: o.approval.note } : {}) } } : {}),
    canTakeBack:
      o.status === "pending_approval" ? { how: "withdraw_order: it waits for sign-off; taking it back frees the weekly budget it holds" } : until && !o.approval && mine ? { until, how: "withdraw_order: this agent placed it alone; possible until the order cut-off" } : until && o.approval ? { until, how: "only the kitchen's signed-in person, in its store: a person signed it" } : undefined,
  };
}

export async function listOrders(dock: Dock, session: AgentSession, raw: unknown) {
  const input = ListOrdersInput.parse(raw ?? {});
  const all = await dock.listOrders({ orgId: session.mandate.issuer.orgId });
  const rows = all
    .filter((o) => !input.status || o.status === input.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, input.limit ?? 20);
  return { orders: rows.map((o) => orderSummary(o, session)), waitingForSignOff: all.filter((o) => o.status === "pending_approval").length };
}

/** Wait up to `seconds` for a person to decide an order that waits for sign-off. Plain polling of the order record: nothing is decided here. */
export async function awaitDecision(dock: Dock, session: AgentSession, orderId: string, seconds: number, signal?: AbortSignal): Promise<{ order: PublicOrder; waitedSeconds: number; decided: boolean }> {
  const t0 = Date.now();
  let order = await dock.getOrder(session, orderId);
  const until = t0 + Math.max(0, Math.min(seconds, 55)) * 1000;
  while (order.status === "pending_approval" && Date.now() < until && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, 1000));
    order = await dock.getOrder(session, orderId);
  }
  return { order, waitedSeconds: Math.round((Date.now() - t0) / 1000), decided: order.status !== "pending_approval" };
}

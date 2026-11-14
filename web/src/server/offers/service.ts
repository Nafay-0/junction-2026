import { decodeJwt, importJWK, type CryptoKey } from "jose";
import { usableOffer, type LiveOffer, type Product } from "@/core/catalog";
import { refOf } from "@/core/claims";
import { DockError, type AgentSession } from "@/core/orders";
import type { LedgerEntryType } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import { factsFrom, checkText } from "@/core/grounding";
import { newId } from "@/core/util";
import {
  OFFER_TERMS,
  OFFER_WEEKLY_CAP,
  SELLING_AGENT,
  REASON_KINDS,
  buyerCheck,
  emptyPrefs,
  finalize,
  forbiddenBy,
  familyOrders,
  offerLine,
  offerProduct,
  offerUntil,
  sentThisWeek,
  shortlist,
  verifyOffer,
  type KitchenView,
  type MuteScope,
  type NewListing,
  type OfferBody,
  type OfferPrefs,
  type OfferReason,
  type OfferReasonKind,
  type OfferStatus,
  type PastOffer,
  type Proposal,
  type Withheld,
} from "@/core/offers";
import { WHOLESALER_ISSUER } from "@/core/claims";
import { recordGrounding } from "../grounding";
import { radarStore } from "../radar/store";
import type { Runtime } from "../runtime";
import type { RecordStore } from "../records";

/**
 * The wholesaler's selling agent, and both sides of an offer, over the plain code in core/offers.ts.
 *
 *   run        for each kitchen (or a campaign's product): shortlist from master data, one live price call for at
 *              most six products, the guardrails, then a signed offer per proposal and a ledger entry for every
 *              offer and every product held back with its rule
 *   list       the buyer's agent's view: the offers addressed to its organisation, each verified against the
 *              wholesaler key and checked against the kitchen in plain code (core/offers.ts buyerCheck)
 *   answer     accept (the caller starts an ordinary order), decline, or mute (a product, its family, a kind of
 *              reason, or every offer); every answer is a ledger entry both sides read
 *
 * Records outlive a restart with DOCK_STORE=postgres (server/records.ts): offers, campaigns, listings, preferences.
 */

export type OfferRecord = {
  offerId: string;
  orgId: string;
  kitchen: string;
  kitchenName: string;
  productId: string;
  productName: string;
  family: string;
  reasons: OfferReason[];
  line: string;
  lineBy: "model" | "template";
  status: OfferStatus;
  at: string;
  validUntil?: string;
  token?: string;
  body?: OfferBody;
  campaignId?: string;
  rule?: string;
  reason?: string;
  answer?: { at: string; by: string; via: string; scope?: MuteScope; requestId?: string; orderId?: string };
};

export type CampaignResult = { kitchen: string; name: string; outcome: "offered" | "not_relevant" | "withheld"; rule?: string; reason: string; offerId?: string };
export type Campaign = { campaignId: string; productId: string; productName: string; category: string; by: string; at: string; claims: OfferReasonKind[]; listedAsNew: boolean; results: CampaignResult[] };
type PrefsRecord = OfferPrefs & { orgId: string };

type State = {
  offers: Map<string, OfferRecord>;
  campaigns: Map<string, Campaign>;
  listings: Map<string, NewListing>;
  prefs: Map<string, PrefsRecord>;
  stores: { offers: RecordStore<OfferRecord>; campaigns: RecordStore<Campaign>; listings: RecordStore<NewListing>; prefs: RecordStore<PrefsRecord> };
  restored: Promise<void>;
  liveCalls: number;
  key?: Promise<{ kid: string; publicKey: CryptoKey }>;
};
const states = new WeakMap<Runtime, State>();

function stateOf(rt: Runtime): State {
  let s = states.get(rt);
  if (s) return s;
  const stores = { offers: rt.records<OfferRecord>("offers"), campaigns: rt.records<Campaign>("offer_campaigns"), listings: rt.records<NewListing>("offer_listings"), prefs: rt.records<PrefsRecord>("offer_prefs") };
  const st: State = { offers: new Map(), campaigns: new Map(), listings: new Map(), prefs: new Map(), stores, liveCalls: 0, restored: Promise.resolve() };
  st.restored = (async () => {
    for (const o of await stores.offers.list()) st.offers.set(o.offerId, o);
    for (const c of await stores.campaigns.list()) st.campaigns.set(c.campaignId, c);
    for (const l of await stores.listings.list()) st.listings.set(l.productId, l);
    for (const p of await stores.prefs.list()) st.prefs.set(p.orgId, p);
  })().catch((err) => console.error("[offers] restore", err));
  states.set(rt, (s = st));
  return s;
}

async function ready(rt: Runtime): Promise<State> {
  const s = stateOf(rt);
  await s.restored;
  return s;
}

const save = (s: State, o: OfferRecord) => {
  s.offers.set(o.offerId, o);
  void s.stores.offers.put(o.offerId, o);
};

function ledger(rt: Runtime, entry: { actor: string; summary: string; requestId?: string; data: Record<string, unknown> }) {
  rt.dock.ledger.append({ type: "offer" as LedgerEntryType, ...entry });
}

// ---------- the kitchen, as the selling agent sees it ----------

export type OfferKitchen = { slug: string; orgId: string; name: string; mandate: Mandate };

/** Every kitchen the selling agent may write to: the two demo kitchens, visitors' kitchens, account kitchens. */
export async function allKitchens(rt: Runtime): Promise<OfferKitchen[]> {
  const { resolveKitchen } = await import("../console-kitchens");
  const slugs = ["kaari", "laakso", ...(await rt.sandboxes.list()).map((s) => s.sandboxId), ...(await rt.accounts.list()).flatMap((a) => (a.kitchen && a.kind !== "demo" ? [a.kitchen] : []))];
  const out: OfferKitchen[] = [];
  for (const slug of [...new Set(slugs)]) {
    const k = await resolveKitchen(slug).catch(() => undefined);
    if (!k) continue;
    out.push({ slug, orgId: k.info.orgId, name: k.info.name, mandate: (decodeJwt(k.mandateToken) as { mandate: Mandate }).mandate });
  }
  return out;
}

async function bought(rt: Runtime, orgId: string, profileIds: string[]): Promise<string[]> {
  const orders = (await rt.dock.listOrders()).filter((o) => o.orgId === orgId && (o.status === "committed" || o.status === "pending_approval"));
  return [...new Set([...profileIds, ...orders.flatMap((o) => o.lines.map((l) => l.productId))])];
}

async function viewOf(rt: Runtime, k: { orgId: string; name: string; mandate: Pick<Mandate, "allowedCategories" | "requiredAttributes" | "forbiddenAllergens" | "requiredCertificates"> }): Promise<KitchenView> {
  const s = await ready(rt);
  const profile = await rt.kitchens.getProfile(k.orgId);
  const past: PastOffer[] = [...s.offers.values()].filter((o) => o.orgId === k.orgId).map((o) => ({ offerId: o.offerId, productId: o.productId, family: o.family, at: o.at, status: o.status }));
  const prefs = s.prefs.get(k.orgId) ?? { orgId: k.orgId, ...emptyPrefs() };
  return { orgId: k.orgId, name: k.name, profile, mandate: k.mandate, prefs: { off: prefs.off, mutes: prefs.mutes }, past, bought: await bought(rt, k.orgId, (profile?.history ?? []).flatMap((h) => h.lines.map((l) => l.productId))) };
}

// ---------- the one line ----------

/**
 * The one-line reason. Plain code writes it from the reasons. With DOCK_OFFER_LLM=on a model may write it instead
 * (DOCK_OFFER_MODEL, or the cheap default of a provider with a key; never under tests); the grounding check then holds
 * it to the offer's own figures, and any line that says what they do not is replaced by the plain-code line.
 */
export type LineWriter = (input: { product: string; reasons: OfferReason[]; template: string }) => Promise<string | undefined>;

async function modelLine(input: Parameters<LineWriter>[0]): Promise<string | undefined> {
  // Opt-in. Measured 14 Nov 2026 on the real catalogue: a cheap model's lines passed the grounding check (every number
  // was in the data) while saying what the data does not ("has not ordered milk before" to a kitchen that orders it
  // weekly; "10 kitchens" from a count of its own orders). The check holds figures, not meaning, so plain code writes
  // the line unless DOCK_OFFER_LLM=on.
  if (process.env.DOCK_OFFER_LLM !== "on" || process.env.VITEST || process.env.NODE_ENV === "test") return undefined;
  const { defaultModel, createModel } = await import("../agent/models");
  const spec = defaultModel("DOCK_OFFER_MODEL");
  if (!spec) return undefined;
  const { generateText } = await import("ai");
  const { model } = createModel(spec);
  const r = await generateText({
    model,
    maxOutputTokens: 80,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(8000),
    system:
      "You write the one-line reason a food wholesaler gives a restaurant kitchen for suggesting a product. One plain sentence, at most 25 words, in English. Use only the facts given: no other numbers, prices, dates, products or claims. No greeting, no exclamation marks, no selling words.",
    prompt: `Product: ${input.product}\nFacts (JSON): ${JSON.stringify(input.reasons)}\nA correct line, for reference: ${input.template}`,
  });
  return r.text.trim().replace(/\s+/g, " ").slice(0, 240) || undefined;
}

async function lineFor(product: Product, reasons: OfferReason[], live: LiveOffer, writer: LineWriter | undefined): Promise<{ line: string; by: "model" | "template" }> {
  const template = offerLine(reasons);
  let said: string | undefined;
  try {
    said = await (writer ?? modelLine)({ product: product.name, reasons, template });
  } catch {
    said = undefined;
  }
  if (!said) return { line: template, by: "template" };
  const facts = factsFrom({ product: { name: product.name, brand: product.brand, attributes: product.attributes }, reasons, price: live.unitPriceCents, template });
  const violations = checkText(said, facts);
  recordGrounding("offer", violations, "selling agent line");
  return violations.length ? { line: template, by: "template" } : { line: said, by: "model" };
}

// ---------- the selling agent's run ----------

export type RunReport = { kitchen: string; name: string; offered: OfferRecord[]; withheld: OfferRecord[]; notRelevant?: string; liveCalls: number };

const heldBack = (w: Withheld) => ({ rule: w.rule, reason: w.reason });

/** Products the recall radar holds: never offered, whatever else the data says. */
function recalled(rt: Runtime): Set<string> {
  return new Set(radarStore(rt.dock).state.holds.filter((h) => !h.liftedAt).map((h) => h.productId));
}

async function liveFor(rt: Runtime, ids: string[]): Promise<Map<string, LiveOffer>> {
  const out = new Map<string, LiveOffer>();
  if (!ids.length) return out;
  const s = stateOf(rt);
  s.liveCalls += 1;
  const cat = rt.catalog as { getLiveStatus?: (ids: string[]) => Promise<import("@/core/catalog").LiveStatus[]>; getLiveOffers: (ids: string[]) => Promise<LiveOffer[]> };
  if (cat.getLiveStatus) for (const st of await cat.getLiveStatus(ids)) {
    const o = usableOffer(st);
    if (o) out.set(o.productId, o);
  }
  else for (const o of await cat.getLiveOffers(ids)) out.set(o.productId, o);
  return out;
}

/**
 * The products worth looking at for this kitchen, through the one product search (server/search findProducts, no
 * relevance judge: recall only, so a run costs no model call): per family it buys, like-for-likes of its usual product
 * (the same material claims) and the family at large (new and seasonal products in it); then what the wholesaler
 * listed as new and a campaign's product, by id. Recalled products never.
 */
async function productsFor(rt: Runtime, view: KitchenView, extra: string[]): Promise<Product[]> {
  const { findProducts } = await import("../search/service");
  const history = view.profile?.history ?? [];
  const families = [...new Set(history.map((h) => h.family))].filter((f) => view.mandate.allowedCategories.includes(f));
  const queries = families.flatMap((family) => {
    const last = history.filter((h) => h.family === family).at(-1)?.lines[0];
    const text = family.startsWith("cat_") ? (last?.name ?? family) : family.replaceAll("_", " ");
    const claims = (last?.attributes ?? []).filter((a) => /^(lactose_free|low_lactose|gluten_free|milk_free|vegan|organic|fat_.*)$/.test(a));
    return [
      { text, category: family, ...(claims.length ? { requiredClaims: claims } : {}), limit: 50, noJudge: true },
      { text, category: family, limit: 50, noJudge: true },
    ];
  });
  const found = await Promise.all(queries.map((q) => findProducts(rt.catalog, q).then((r) => r.hits.map((h) => h.product)).catch(() => [] as Product[])));
  const listed = [...stateOf(rt).listings.keys(), ...extra];
  const named = listed.length ? await rt.catalog.searchProducts({ ids: [...new Set(listed)], limit: 100 }) : [];
  const usual = history.length ? await rt.catalog.searchProducts({ ids: [...new Set(history.flatMap((h) => h.lines.map((l) => l.productId)))].slice(0, 100), limit: 100 }) : [];
  const held = recalled(rt);
  const seen = new Set<string>();
  return [...usual, ...found.flat(), ...named].filter((p) => !held.has(p.id) && !seen.has(p.id) && (seen.add(p.id), true));
}

/** Run the selling agent for one kitchen: at most the weekly cap of signed offers, and what it held back. */
async function runKitchen(rt: Runtime, k: OfferKitchen, opts: { now: Date; writer?: LineWriter; campaign?: { campaignId: string; product: Product; claims: OfferReasonKind[] } }): Promise<RunReport> {
  const s = await ready(rt);
  const view = await viewOf(rt, k);
  const ctx = { now: opts.now, newListings: [...s.listings.values()] };
  const report: RunReport = { kitchen: k.slug, name: k.name, offered: [], withheld: [], liveCalls: 0 };
  const camp = opts.campaign;
  if (camp && familyOrders(view.profile, camp.product.category) === 0 && !forbiddenBy(camp.product, view, opts.now)) {
    report.notRelevant = `${k.name} does not buy ${camp.product.category.replaceAll("_", " ")}.`;
    return report;
  }
  if (camp && view.bought.includes(camp.product.id)) {
    report.notRelevant = `${k.name} already buys it.`;
    return report;
  }
  const products = await productsFor(rt, view, camp ? [camp.product.id] : []);
  const short = shortlist(view, products, ctx, camp ? { productId: camp.product.id, campaignId: camp.campaignId, claims: camp.claims } : undefined);
  if (camp) {
    // A campaign is about its product: the usual products are priced too, so a like-for-like figure can be checked.
    short.candidates = short.candidates.filter((c) => c.product.id === camp.product.id);
  }
  const needsLive = !view.prefs.off && sentThisWeek(view.past, opts.now) < OFFER_WEEKLY_CAP && short.priceIds.length > 0;
  const live = needsLive ? await liveFor(rt, short.priceIds).catch(() => new Map<string, LiveOffer>()) : new Map<string, LiveOffer>();
  report.liveCalls = needsLive ? 1 : 0;
  const result = finalize(view, short, { ...ctx, live });
  for (const p of result.proposals) report.offered.push(await issue(rt, k, p, opts));
  // What it held back: a campaign's product always; otherwise the best few, so staff see why.
  for (const w of result.withheld.filter((x) => camp || !["not_available"].includes(x.rule)).slice(0, camp ? 1 : 3)) report.withheld.push(withhold(rt, k, w, opts.now));
  return report;
}

async function issue(rt: Runtime, k: OfferKitchen, p: Proposal, opts: { now: Date; writer?: LineWriter }): Promise<OfferRecord> {
  const s = stateOf(rt);
  const offerId = newId("ofr");
  const claims = await rt.dock.signOfferClaims(k.orgId, p.live, p.product, opts.now);
  const price = claims.find((c) => c.type === "price");
  const { line, by } = await lineFor(p.product, p.reasons, p.live, opts.writer);
  const until = offerUntil(opts.now, p.live);
  const product = offerProduct(p.product);
  const body: OfferBody = {
    offerId,
    isOrder: false,
    seller: { issuer: WHOLESALER_ISSUER, agent: SELLING_AGENT.id, name: SELLING_AGENT.name },
    buyer: { orgId: k.orgId, name: k.name },
    product,
    reasons: p.reasons,
    line,
    price: { unitPriceCents: p.live.unitPriceCents, currency: "EUR", per: p.live.salesUnit ?? "pack", ...(p.product.unit !== "pcs" ? { perUnitCents: Math.round((p.live.unitPriceCents / p.product.packSize) * 10) / 10, unit: p.product.unit } : {}), ...(price ? { claimId: price.claimId } : {}) },
    suggestedPacks: p.suggestedPacks,
    validFrom: opts.now.toISOString(),
    validUntil: until.toISOString(),
    ...(p.campaign ? { campaignId: p.campaign.campaignId } : {}),
    terms: OFFER_TERMS,
    evidence: claims.map(refOf),
  };
  const token = await rt.dock.signOffer(body);
  const rec: OfferRecord = { offerId, orgId: k.orgId, kitchen: k.slug, kitchenName: k.name, productId: product.productId, productName: product.name, family: product.category, reasons: p.reasons, line, lineBy: by, status: "offered", at: opts.now.toISOString(), validUntil: body.validUntil, token, body, ...(p.campaign ? { campaignId: p.campaign.campaignId } : {}) };
  save(s, rec);
  ledger(rt, {
    actor: `wholesaler:${SELLING_AGENT.id}`,
    summary: `The selling agent offered ${k.name} ${product.name} at ${(p.live.unitPriceCents / 100).toFixed(2)} € a pack until ${body.validUntil.slice(0, 16).replace("T", " ")} UTC: ${line} It is an offer, not an order.`,
    data: { step: "offered", offerId, kitchen: k.slug, orgId: k.orgId, productId: product.productId, reasons: p.reasons, line, lineBy: by, price: body.price, validUntil: body.validUntil, campaignId: p.campaign?.campaignId, evidence: body.evidence },
  });
  return rec;
}

function withhold(rt: Runtime, k: OfferKitchen, w: Withheld, now: Date): OfferRecord {
  const rec: OfferRecord = { offerId: newId("ofw"), orgId: k.orgId, kitchen: k.slug, kitchenName: k.name, productId: w.product.id, productName: w.product.name, family: w.product.category, reasons: w.reasons, line: "", lineBy: "template", status: "withheld", at: now.toISOString(), ...heldBack(w), ...(w.campaignId ? { campaignId: w.campaignId } : {}) };
  save(stateOf(rt), rec);
  ledger(rt, {
    actor: `wholesaler:${SELLING_AGENT.id}`,
    summary: `The selling agent held back ${w.product.name} for ${k.name} (rule ${w.rule}): ${w.reason}`,
    data: { step: "withheld", offerId: rec.offerId, kitchen: k.slug, orgId: k.orgId, productId: w.product.id, rule: w.rule, reason: w.reason, campaignId: w.campaignId },
  });
  return rec;
}

/** One run of the selling agent over every kitchen (or the given ones). */
export async function runSellingAgent(rt: Runtime, opts: { kitchens?: string[]; now?: Date; writer?: LineWriter; by?: string } = {}): Promise<RunReport[]> {
  const now = opts.now ?? new Date();
  const kitchens = (await allKitchens(rt)).filter((k) => !opts.kitchens || opts.kitchens.includes(k.slug));
  const out: RunReport[] = [];
  for (const k of kitchens) out.push(await runKitchen(rt, k, { now, writer: opts.writer }).catch((err) => ({ kitchen: k.slug, name: k.name, offered: [], withheld: [], notRelevant: `The run failed for this kitchen: ${(err as Error).message}`, liveCalls: 0 })));
  return out;
}

/**
 * A campaign: staff name a product (and, if it is new to the assortment, say so: that is the wholesaler's own listing
 * record, dated); the selling agent decides kitchen by kitchen whether it is relevant, and offers it only where every
 * guardrail passes. `claims`: what staff want said about it; each must be backed by the data for that kitchen.
 */
export async function startCampaign(rt: Runtime, input: { productId: string; by: string; listAsNew?: boolean; claims?: OfferReasonKind[]; kitchens?: string[]; now?: Date; writer?: LineWriter }): Promise<Campaign> {
  const s = await ready(rt);
  const now = input.now ?? new Date();
  const [product] = await rt.catalog.searchProducts({ ids: [input.productId], limit: 1 });
  if (!product) throw new DockError(404, "product_not_found", `No product ${input.productId} in the assortment.`);
  const claims = (input.claims ?? []).filter((c): c is OfferReasonKind => (REASON_KINDS as readonly string[]).includes(c));
  if (input.listAsNew) {
    const listing: NewListing = s.listings.get(product.id) ?? { productId: product.id, listedAt: now.toISOString(), by: input.by };
    s.listings.set(product.id, listing);
    await s.stores.listings.put(product.id, listing);
  }
  const campaign: Campaign = { campaignId: newId("cmp"), productId: product.id, productName: product.name, category: product.category, by: input.by, at: now.toISOString(), claims, listedAsNew: !!input.listAsNew, results: [] };
  ledger(rt, { actor: `staff:${input.by}`, summary: `${input.by} started a campaign for ${product.name}${input.listAsNew ? " (listed as new in the assortment)" : ""}; the selling agent decides which kitchens it is relevant to.`, data: { step: "campaign", campaignId: campaign.campaignId, productId: product.id, claims, listedAsNew: !!input.listAsNew, by: input.by } });
  const held = recalled(rt).has(product.id);
  for (const k of (await allKitchens(rt)).filter((x) => !input.kitchens || input.kitchens.includes(x.slug))) {
    if (held) {
      campaign.results.push({ kitchen: k.slug, name: k.name, outcome: "withheld", rule: "recall_hold", reason: "The recall radar holds this product: it is not offered to anyone." });
      continue;
    }
    const r = await runKitchen(rt, k, { now, writer: input.writer, campaign: { campaignId: campaign.campaignId, product, claims } });
    const offered = r.offered.find((o) => o.productId === product.id);
    const w = r.withheld.find((o) => o.productId === product.id);
    if (offered) campaign.results.push({ kitchen: k.slug, name: k.name, outcome: "offered", reason: offered.line, offerId: offered.offerId });
    else if (w) campaign.results.push({ kitchen: k.slug, name: k.name, outcome: w.rule === "unsupported_claim" && !claims.length ? "not_relevant" : "withheld", rule: w.rule, reason: w.reason ?? "" });
    else campaign.results.push({ kitchen: k.slug, name: k.name, outcome: "not_relevant", reason: r.notRelevant ?? "Nothing the data supports makes it worth suggesting there." });
  }
  s.campaigns.set(campaign.campaignId, campaign);
  await s.stores.campaigns.put(campaign.campaignId, campaign);
  return campaign;
}

// ---------- the buyer's side ----------

async function wholesalerKey(rt: Runtime) {
  const s = stateOf(rt);
  s.key ??= (async () => ({ kid: rt.dock.wholesalerPublicJwk.kid!, publicKey: (await importJWK(rt.dock.wholesalerPublicJwk, "Ed25519")) as CryptoKey }))();
  return s.key;
}

/** What a buyer's agent sees of one offer: the signed token, what it says, where it stands. */
export type BuyerOffer = { offerId: string; token: string; offer: OfferBody; status: OfferStatus; verified: boolean; answer?: OfferRecord["answer"] };

const expire = (s: State, o: OfferRecord, now: Date) => {
  if (o.status === "offered" && o.validUntil && Date.parse(o.validUntil) <= now.getTime()) save(s, { ...o, status: "expired" });
};

/**
 * The offers addressed to this organisation, newest first, each verified against the wholesaler's key. `open`: only
 * those still open. The selling agent's guardrails ran before; this is the record of what it sent.
 */
export async function offersForOrg(rt: Runtime, orgId: string, opts: { open?: boolean; now?: Date } = {}): Promise<BuyerOffer[]> {
  const s = await ready(rt);
  const now = opts.now ?? new Date();
  const key = await wholesalerKey(rt);
  const out: BuyerOffer[] = [];
  for (const o of [...s.offers.values()].filter((x) => x.orgId === orgId && x.token).sort((a, b) => b.at.localeCompare(a.at))) {
    expire(s, o, now);
    const cur = s.offers.get(o.offerId)!;
    if (opts.open && cur.status !== "offered") continue;
    const verified = await verifyOffer(cur.token!, [key], { now: cur.status === "offered" ? now : new Date(Date.parse(cur.at) + 1000), orgId }).then(() => true, () => false);
    out.push({ offerId: cur.offerId, token: cur.token!, offer: cur.body!, status: cur.status, verified, ...(cur.answer ? { answer: cur.answer } : {}) });
  }
  return out;
}

/**
 * The kitchen's own agent's pick for "Today": the open offers that pass its own check against the kitchen (core
 * buyerCheck: its rules, memory, mutes, offers off, what it already buys), verified, best first. At most one is shown.
 */
export async function offerForToday(rt: Runtime, session: AgentSession, name: string, now = new Date()): Promise<BuyerOffer | undefined> {
  const orgId = session.mandate.issuer.orgId;
  const view = await viewOf(rt, { orgId, name, mandate: session.mandate });
  for (const o of await offersForOrg(rt, orgId, { open: true, now })) {
    if (o.verified && buyerCheck(o.offer, view, now).show) return o;
  }
  return undefined;
}

async function own(rt: Runtime, orgId: string, offerId: string, now: Date): Promise<OfferRecord> {
  const s = await ready(rt);
  const o = s.offers.get(offerId);
  if (!o || o.orgId !== orgId || !o.token) throw new DockError(404, "offer_not_found", `No offer ${offerId} for this organisation.`);
  expire(s, o, now);
  return s.offers.get(offerId)!;
}

function answered(rt: Runtime, o: OfferRecord, answer: NonNullable<OfferRecord["answer"]>, status: OfferStatus, summary: string) {
  const s = stateOf(rt);
  save(s, { ...o, status, answer });
  ledger(rt, { actor: `buyer:${o.orgId}`, summary, ...(answer.requestId ? { requestId: answer.requestId } : {}), data: { step: status === "accepted" ? "accepted" : status === "declined" ? "declined" : "muted", offerId: o.offerId, kitchen: o.kitchen, orgId: o.orgId, productId: o.productId, answer: status, scope: answer.scope, by: answer.by, via: answer.via, requestId: answer.requestId } });
}

export type Answer = { by: string; via: string; now?: Date };

/**
 * Accept: the offer only starts an ordinary order; the caller opens it (the order sheet, or the intake for an
 * outside agent) and passes its requestId. The offer is checked again here, as the buyer's own agent would.
 */
export async function acceptOffer(rt: Runtime, session: AgentSession, offerId: string, a: Answer & { name: string }): Promise<{ offer: OfferBody; record: OfferRecord }> {
  const now = a.now ?? new Date();
  const o = await own(rt, session.mandate.issuer.orgId, offerId, now);
  if (o.status !== "offered") throw new DockError(409, "offer_closed", `Offer ${offerId} is ${o.status}: it can no longer be accepted.`, "offer_state", { status: o.status });
  const key = await wholesalerKey(rt);
  const offer = await verifyOffer(o.token!, [key], { now, orgId: o.orgId }).catch((err: Error) => {
    throw new DockError(409, "offer_invalid", `Offer ${offerId} does not verify: ${err.message}`, "offer_signature");
  });
  const view = await viewOf(rt, { orgId: o.orgId, name: a.name, mandate: session.mandate });
  const check = buyerCheck(offer, { ...view, bought: [] }, now);
  if (!check.show) throw new DockError(409, "offer_not_for_kitchen", `The kitchen's own rules do not allow this offer: ${check.why}.`, "offer_rules");
  return { offer, record: o };
}

/** Record the acceptance once the ordinary order it started has a request. */
export function acceptedInto(rt: Runtime, o: OfferRecord, a: Answer, requestId: string) {
  answered(rt, o, { at: (a.now ?? new Date()).toISOString(), by: a.by, via: a.via, requestId }, "accepted", `${a.by} accepted the offer of ${o.productName}: it started an ordinary order (${requestId}), priced by a fresh quote and checked by the kitchen's own mandate. The offer itself bought nothing.`);
}

export async function declineOffer(rt: Runtime, session: AgentSession, offerId: string, a: Answer): Promise<OfferRecord> {
  const now = a.now ?? new Date();
  const o = await own(rt, session.mandate.issuer.orgId, offerId, now);
  if (o.status !== "offered") throw new DockError(409, "offer_closed", `Offer ${offerId} is ${o.status}.`, "offer_state", { status: o.status });
  answered(rt, o, { at: now.toISOString(), by: a.by, via: a.via }, "declined", `${a.by} declined the offer of ${o.productName}; it is not offered to this kitchen again for 30 days.`);
  return (await ready(rt)).offers.get(offerId)!;
}

const SCOPE_TEXT = (scope: MuteScope, o: OfferRecord) => (scope === "product" ? o.productName : scope === "family" ? `${o.family.replaceAll("_", " ")} products` : scope === "reason" ? `"${(o.reasons.find((r) => r.kind !== "new_to_kitchen")?.kind ?? "").replaceAll("_", " ")}" suggestions` : "any offers");

/**
 * Mute: from an offer, its product, its family, or its kind of reason ("in season"), or every offer (offers off).
 * Kept with the kitchen and read by the selling agent before it picks anything; the offer is closed.
 */
export async function muteOffers(rt: Runtime, session: AgentSession, input: { offerId?: string; scope: MuteScope; value?: string }, a: Answer): Promise<OfferPrefs> {
  const s = await ready(rt);
  const now = a.now ?? new Date();
  const orgId = session.mandate.issuer.orgId;
  const o = input.offerId ? await own(rt, orgId, input.offerId, now) : undefined;
  const prefs: PrefsRecord = structuredClone(s.prefs.get(orgId) ?? { orgId, ...emptyPrefs() });
  const at = now.toISOString();
  if (input.scope === "all") prefs.off = { by: a.by, at };
  else {
    const value = input.value ?? (o ? (input.scope === "product" ? o.productId : input.scope === "family" ? o.family : o.reasons.find((r) => r.kind !== "new_to_kitchen")?.kind) : undefined);
    if (!value) throw new DockError(400, "invalid_request", "Say what to mute: an offerId, or a value for the scope.");
    if (input.scope === "reason" && !(REASON_KINDS as readonly string[]).includes(value)) throw new DockError(400, "invalid_request", `A reason is one of ${REASON_KINDS.join(", ")}.`);
    if (!prefs.mutes.some((m) => m.scope === input.scope && m.value === value)) prefs.mutes.push({ scope: input.scope, value, by: a.by, at, ...(o ? { offerId: o.offerId } : {}) });
  }
  s.prefs.set(orgId, prefs);
  await s.stores.prefs.put(orgId, prefs);
  if (o && o.status === "offered") answered(rt, o, { at, by: a.by, via: a.via, scope: input.scope }, "muted", `${a.by} asked not to be offered ${SCOPE_TEXT(input.scope, o)} again; the selling agent will not suggest ${input.scope === "all" ? "anything" : "them"}.`);
  else ledger(rt, { actor: `buyer:${orgId}`, summary: `${a.by} ${input.scope === "all" ? "turned offers off" : `muted ${input.scope} ${input.value ?? ""} offers`}.`, data: { step: "muted", orgId, scope: input.scope, value: input.value, by: a.by, via: a.via } });
  return { off: prefs.off, mutes: prefs.mutes };
}

/** Turn offers on again (after "all"), or lift one mute. */
export async function unmuteOffers(rt: Runtime, session: AgentSession, input: { scope: MuteScope; value?: string }, a: Answer): Promise<OfferPrefs> {
  const s = await ready(rt);
  const orgId = session.mandate.issuer.orgId;
  const prefs: PrefsRecord = structuredClone(s.prefs.get(orgId) ?? { orgId, ...emptyPrefs() });
  if (input.scope === "all") delete prefs.off;
  else prefs.mutes = prefs.mutes.filter((m) => !(m.scope === input.scope && (!input.value || m.value === input.value)));
  s.prefs.set(orgId, prefs);
  await s.stores.prefs.put(orgId, prefs);
  ledger(rt, { actor: `buyer:${orgId}`, summary: `${a.by} ${input.scope === "all" ? "turned offers on again" : `lifted the ${input.scope} mute${input.value ? ` on ${input.value}` : ""}`}.`, data: { step: "unmuted", orgId, scope: input.scope, value: input.value, by: a.by, via: a.via } });
  return { off: prefs.off, mutes: prefs.mutes };
}

export async function prefsOf(rt: Runtime, orgId: string): Promise<OfferPrefs> {
  const p = (await ready(rt)).prefs.get(orgId);
  return p ? { off: p.off, mutes: p.mutes } : emptyPrefs();
}

// ---------- the operations view ----------

export type OffersView = {
  stats: { offered: number; accepted: number; declined: number; muted: number; expired: number; withheld: number; open: number; kitchensOff: number; liveCalls: number; weeklyCap: number };
  offers: Omit<OfferRecord, "token" | "body">[];
  campaigns: Campaign[];
  listings: NewListing[];
  prefs: (OfferPrefs & { orgId: string; name?: string })[];
};

export async function offersView(rt: Runtime, now = new Date()): Promise<OffersView> {
  const s = await ready(rt);
  for (const o of s.offers.values()) expire(s, o, now);
  const all = [...s.offers.values()].sort((a, b) => b.at.localeCompare(a.at));
  const count = (st: OfferStatus) => all.filter((o) => o.status === st).length;
  return {
    stats: { offered: all.filter((o) => o.status !== "withheld").length, accepted: count("accepted"), declined: count("declined"), muted: count("muted"), expired: count("expired"), withheld: count("withheld"), open: count("offered"), kitchensOff: [...s.prefs.values()].filter((p) => p.off).length, liveCalls: s.liveCalls, weeklyCap: OFFER_WEEKLY_CAP },
    offers: all.slice(0, 200).map(({ token: _t, body: _b, ...o }) => (void _t, void _b, o)),
    campaigns: [...s.campaigns.values()].sort((a, b) => b.at.localeCompare(a.at)),
    listings: [...s.listings.values()],
    // Staff read kitchens by name, not by organisation id.
    prefs: await (async () => {
      const names = new Map((await allKitchens(rt).catch(() => [])).map((k) => [k.orgId, k.name]));
      return [...s.prefs.values()].map((p) => ({ ...p, ...(names.get(p.orgId) ? { name: names.get(p.orgId) } : {}) }));
    })(),
  };
}

/** One offer's signed token, for staff to check (operations view). */
export async function offerToken(rt: Runtime, offerId: string): Promise<string | undefined> {
  return (await ready(rt)).offers.get(offerId)?.token;
}

import { decodeJwt } from "jose";
import { MAX_LIVE_IDS_PER_CALL, type LiveOffer, type LiveProblem, type Product } from "@/core/catalog";
import type { IssuedClaim } from "@/core/claims";
import { DockError, isDockError } from "@/core/errors";
import { addDaysIso, localNow, updateKitchenProfile, type HistoryEntry, type KitchenProfile } from "@/core/kitchen";
import type { LedgerEntryType } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { formatEur, newId } from "@/core/util";
import { isMaterialAttribute } from "@/core/vocabulary";
import { likeForLike } from "@/core/options";
import {
  decideRenewal,
  driftOf,
  drifted,
  learnPatterns,
  nextSlot,
  rankSubstitutes,
  renewalAmounts,
  shortfallOf,
  type Drift,
  type Pattern,
  type RankedSubstitute,
  type RenewalChoice,
  type RenewalDecision,
  type Shortfall,
  type SubstituteCandidate,
} from "@/core/watch";
import { WATCH_TEXT } from "../portal-requests";
import { STAGED_PREFIX, setStaged } from "./overlay";
import type { KitchenKind } from "../console-kitchens";
import type { RecordStore } from "../records";
import type { Runtime } from "../runtime";

/**
 * The kitchen agent's watch: the kitchen's own purchasing agent keeps an eye on what it buys every week and on what
 * it ordered and is still to come, so it notices before the kitchen does. Plain code decides (core/watch.ts); this
 * module gathers records and live answers and acts through the one gate.
 *
 *   watch       the key products (each recurring order's product, the lines of orders not yet delivered): ONE live
 *               availability call for at most ten of them, cached ten minutes, through the kitchen's own session (so
 *               it is metered, capped and in the ledger like any lookup, and its availability statement is a signed
 *               claim). A product that cannot come for the day it is needed is a finding, with good, better, best
 *               substitutes (the knowledge map and the one product search, one more live call for their prices).
 *   renew       for a recurring order the kitchen switched auto-renew on for (off by default, recorded with who):
 *               nothing drifted, the usual product can come: placed alone before the cut-off through the gate;
 *               drifted: held, and the kitchen is asked (renew at the new amount, the usual, skip this week); the
 *               usual product cannot come: the best substitute is placed, alone when it is inside the kitchen's stated
 *               preferences, for a person's sign-off otherwise (the gate decides that too).
 *   stage       staff stage a stock-out (or a creeping recurring order) for a demo kitchen; marked "staged"
 *               everywhere it shows, signed with `simulated: true`, and lifted again.
 *
 * Every order goes openRequest -> requestQuote -> placeOrder with the kitchen's mandate: the same gate, rules,
 * mistake check and sign-off as every other door. Every finding, renewal, answer and stage is a ledger entry
 * (type `watch`) in the same hash chain. Records outlive a restart with DOCK_STORE=postgres (server/records.ts).
 */

// ---------- records ----------

export type KeyProduct = { productId: string; name: string; family: string; source: "standing" | "order"; date: string; amount: number; unit: string; orderId?: string };

export type FindingDecision = {
  at: string;
  by: string;
  via: string;
  action: "switched" | "kept" | "ordered_alone" | "sent_for_sign_off" | "refused";
  productId?: string;
  requestId?: string;
  orderId?: string;
  status?: PublicOrder["status"];
  totalCents?: number;
  approver?: string;
  reasons?: string[];
  note?: string;
};

export type Finding = {
  findingId: string;
  orgId: string;
  kitchen: string;
  kitchenName: string;
  at: string;
  product: { productId: string; name: string; family: string; packSize: number; unit: string; brand: string | null };
  need: KeyProduct;
  shortfall: Shortfall;
  problems: LiveProblem[];
  message: string;
  staged: boolean;
  /** The signed availability statement it rests on (vc+jwt, the wholesaler key). */
  claim?: { claimId: string; token: string; simulated: boolean; statement: Record<string, unknown> };
  usualPerUnitCents: number | null;
  substitutes: RankedSubstitute[];
  /** Where the candidates came from and how many were looked at. */
  search: { mapCandidates: number; searchCandidates: number; priced: number; path?: string };
  state: "open" | "decided" | "resolved";
  decision?: FindingDecision;
  saidAt?: string;
};

export type Renewal = {
  renewalId: string;
  orgId: string;
  kitchen: string;
  kitchenName: string;
  family: string;
  product: { productId: string; name: string; packSize: number; unit: string };
  deliveryDate: string;
  at: string;
  decision: RenewalDecision;
  drift: Drift;
  amounts: { usual: number; latest: number; unit: string };
  basedOn: Pattern["basedOn"];
  staged: boolean;
  state: "placed" | "held" | "answered" | "skipped" | "failed";
  /** The order it placed (alone, or sent for sign-off), or why the gate refused. */
  outcome?: { requestId?: string; orderId?: string; status?: PublicOrder["status"]; totalCents?: number; approver?: string; reasons?: string[]; refused?: { code: string; rule?: string; message: string }; substitute?: { productId: string; name: string; insidePreferences: boolean; findingId: string } };
  answer?: { choice: RenewalChoice; by: string; via: string; at: string };
  autoRenew: AutoRenew;
  saidAt?: string;
};

export type AutoRenew = { orgId: string; family: string; on: boolean; by: string; via: string; at: string };

export type Stage = {
  stageId: string;
  kind: "stock_out" | "drift";
  orgId: string;
  kitchen: string;
  kitchenName: string;
  productId?: string;
  productName?: string;
  /** stock_out: the day it can come again. */
  until?: string;
  family?: string;
  /** drift: the history entries it replaced (restored when lifted) and the ids of the staged ones. */
  replaced?: HistoryEntry[];
  stagedIds?: string[];
  by: string;
  at: string;
  liftedAt?: string;
  liftedBy?: string;
};

type Cached = { at: number; keys: KeyProduct[]; statuses: Map<string, WatchStatus>; claims: IssuedClaim[]; requestId: string; liveCalls: number };
export type WatchStatus = { productId: string; offer?: LiveOffer; problems: LiveProblem[]; orderable: boolean; message: string; staged?: boolean };

type State = {
  findings: Map<string, Finding>;
  renewals: Map<string, Renewal>;
  auto: Map<string, AutoRenew>;
  stages: Map<string, Stage>;
  stores: { findings: RecordStore<Finding>; renewals: RecordStore<Renewal>; auto: RecordStore<AutoRenew>; stages: RecordStore<Stage> };
  restored: Promise<void>;
  cache: Map<string, Cached>;
  requests: Map<string, string>;
  liveCalls: number;
  runs: { at: string; by: string; kitchens: number; findings: number; placed: number; held: number; liveCalls: number }[];
};
// On globalThis: the bundler may load this module once per route; every route must see the same watch.
const gw = globalThis as typeof globalThis & { __dockWatchStates?: WeakMap<Runtime, State> };
const states = (gw.__dockWatchStates ??= new WeakMap<Runtime, State>());

function stateOf(rt: Runtime): State {
  let s = states.get(rt);
  if (s) return s;
  const stores = { findings: rt.records<Finding>("watch_findings"), renewals: rt.records<Renewal>("watch_renewals"), auto: rt.records<AutoRenew>("watch_auto_renew"), stages: rt.records<Stage>("watch_stages") };
  const st: State = { findings: new Map(), renewals: new Map(), auto: new Map(), stages: new Map(), stores, restored: Promise.resolve(), cache: new Map(), requests: new Map(), liveCalls: 0, runs: [] };
  st.restored = (async () => {
    for (const f of await stores.findings.list()) st.findings.set(f.findingId, f);
    for (const r of await stores.renewals.list()) st.renewals.set(r.renewalId, r);
    for (const a of await stores.auto.list()) st.auto.set(`${a.orgId}:${a.family}`, a);
    for (const g of await stores.stages.list()) st.stages.set(g.stageId, g);
    for (const orgId of new Set([...st.stages.values()].map((g) => g.orgId))) syncOverlay(rt, st, orgId);
  })().catch((err) => console.error("[watch] restore", err));
  states.set(rt, (s = st));
  return s;
}

async function ready(rt: Runtime): Promise<State> {
  const s = stateOf(rt);
  await s.restored;
  return s;
}

const saveFinding = (s: State, f: Finding) => (s.findings.set(f.findingId, f), void s.stores.findings.put(f.findingId, f));
const saveRenewal = (s: State, r: Renewal) => (s.renewals.set(r.renewalId, r), void s.stores.renewals.put(r.renewalId, r));
const saveStage = (s: State, g: Stage) => (s.stages.set(g.stageId, g), void s.stores.stages.put(g.stageId, g));

export const WATCH_ACTOR = (agentId: string) => `agent:${agentId}`;

function ledger(rt: Runtime, entry: { actor: string; summary: string; requestId?: string; orderId?: string; data: Record<string, unknown> }) {
  rt.dock.ledger.append({ type: "watch" as LedgerEntryType, ...entry });
}

const today = (now: Date) => localNow(now).date;
const fiDay = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const dayName = (d: string) => `${WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay() || 7]} ${fiDay(d)}`;
const unitWord = (u: string) => (u === "kg" ? "kg" : u === "L" ? "L" : u);

// ---------- the kitchens it watches ----------

export type WatchKitchen = { slug: string; kind: KitchenKind; orgId: string; name: string; mandate: Mandate; mandateToken: string; agentId: string; by: string; /** A shared public test account (reset on a timer). */ shared?: boolean };

/** The kitchens with an agent: the two demo kitchens, visitors' kitchens, account kitchens. */
export async function watchKitchens(rt: Runtime, only?: string[]): Promise<WatchKitchen[]> {
  const { resolveKitchen } = await import("../console-kitchens");
  const slugs = only ?? ["kaari", "laakso", ...(await rt.sandboxes.list()).map((s) => s.sandboxId), ...(await rt.accounts.list()).flatMap((a) => (a.kitchen && a.kind !== "demo" ? [a.kitchen] : []))];
  const out: WatchKitchen[] = [];
  for (const slug of [...new Set(slugs)]) {
    const k = await resolveKitchen(slug).catch(() => undefined);
    if (!k) continue;
    out.push({ slug, kind: k.info.kind, orgId: k.info.orgId, name: k.info.name, mandate: (decodeJwt(k.mandateToken) as { mandate: Mandate }).mandate, mandateToken: k.mandateToken, agentId: k.agentId, by: k.info.by, ...(k.info.account?.shared ? { shared: true } : {}) });
  }
  return out;
}

export async function watchKitchen(rt: Runtime, slug: string): Promise<WatchKitchen> {
  const [k] = await watchKitchens(rt, [slug]);
  if (!k) throw new DockError(404, "kitchen_not_found", `No kitchen ${slug}.`);
  return k;
}

/** The kitchen's agent, in-process, on its own share of the live allowance (the watch does not use up the store's). */
async function sessionOf(rt: Runtime, k: WatchKitchen): Promise<AgentSession> {
  const s = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", transport: "direct", path: "kitchen agent's watch" });
  return { ...s, share: "watch" };
}

/** The kitchen whose session this is (an outside agent's or the conversation's). */
async function kitchenOfSession(rt: Runtime, session: AgentSession): Promise<WatchKitchen> {
  const orgId = session.mandate.issuer.orgId;
  const known = (await watchKitchens(rt)).find((k) => k.orgId === orgId);
  if (known) return { ...known, mandate: session.mandate };
  return { slug: orgId, kind: "account", orgId, name: session.mandate.issuer.name, mandate: session.mandate, mandateToken: "", agentId: session.agentId, by: `${session.mandate.issuer.name}'s buying agent` };
}

// ---------- patterns and key products ----------

const isStaged = (s: State, orgId: string) => {
  const ids = new Set([...s.stages.values()].filter((g) => g.orgId === orgId && g.kind === "drift" && !g.liftedAt).flatMap((g) => g.stagedIds ?? []));
  return (orderId: string) => ids.has(orderId);
};

/** The kitchen's recurring orders as learned from its own orders, each with its next day and drift (no live call). */
export async function patternsOf(rt: Runtime, orgId: string): Promise<{ profile?: KitchenProfile; patterns: Pattern[] }> {
  const s = await ready(rt);
  const profile = await rt.kitchens.getProfile(orgId);
  return { profile, patterns: learnPatterns(profile, { staged: isStaged(s, orgId) }) };
}

async function keyProducts(rt: Runtime, orgId: string, now: Date): Promise<{ keys: KeyProduct[]; patterns: Pattern[]; profile?: KitchenProfile }> {
  const { profile, patterns } = await patternsOf(rt, orgId);
  const day = today(now);
  const keys: KeyProduct[] = [];
  const orders = (await rt.dock.listOrders({ orgId })).filter((o) => o.status === "committed" || o.status === "pending_approval");
  for (const o of orders) for (const l of o.lines) if (l.deliveryDate > day) keys.push({ productId: l.productId, name: l.name, family: l.category, source: "order", date: l.deliveryDate, amount: Math.round(l.quantity * l.packSize * 100) / 100, unit: l.unit, orderId: o.orderId });
  for (const p of patterns) {
    if (profile?.pausedStanding?.includes(p.family)) continue;
    const next = nextSlot(p, day);
    if (!next) continue;
    keys.push({ productId: p.product.productId, name: p.product.name, family: p.family, source: "standing", date: next.date, amount: next.slot.usualAmount, unit: p.unit });
  }
  const seen = new Set<string>();
  return { keys: keys.sort((a, b) => a.date.localeCompare(b.date)).filter((k) => !seen.has(k.productId) && (seen.add(k.productId), true)).slice(0, MAX_LIVE_IDS_PER_CALL), patterns, profile };
}

// ---------- the live call ----------

const CACHE_MS = 10 * 60_000;

/** One request a day per kitchen for the watch's live calls, so every one is in the ledger under it. */
async function watchRequest(rt: Runtime, s: State, session: AgentSession, now: Date): Promise<string> {
  const key = `${session.mandate.issuer.orgId}:${today(now)}`;
  const hit = s.requests.get(key);
  if (hit && (await rt.dock.orgOfRequest(hit))) return hit;
  const r = await rt.dock.openRequest(session, { text: WATCH_TEXT });
  s.requests.set(key, r.requestId);
  return r.requestId;
}

const activeStockOuts = (s: State, orgId: string) => [...s.stages.values()].filter((g) => g.kind === "stock_out" && g.orgId === orgId && !g.liftedAt);

/** The staged stock-outs of an organisation, laid over every live answer it gets (overlay.ts, the core's liveOverlay). */
function syncOverlay(rt: Runtime, s: State, orgId: string) {
  setStaged(rt.dock, orgId, activeStockOuts(s, orgId).map((g) => ({ stageId: g.stageId, productId: g.productId!, until: g.until!, by: g.by })));
}

/**
 * The watch's live answer for the kitchen's key products: one call, cached ten minutes. A staged stock-out arrives
 * already in it (the core's overlay, so the intake sees the same), marked by its message and `simulated` offer.
 */
async function liveOf(rt: Runtime, k: WatchKitchen, keys: KeyProduct[], now: Date, fresh: boolean): Promise<Cached> {
  const s = await ready(rt);
  const hit = s.cache.get(k.orgId);
  const ids = keys.map((x) => x.productId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS && ids.every((id) => hit.statuses.has(id))) return { ...hit, liveCalls: 0 };
  const session = await sessionOf(rt, k);
  const requestId = await watchRequest(rt, s, session, now);
  const statuses = new Map<string, WatchStatus>();
  let claims: IssuedClaim[] = [];
  if (ids.length) {
    const r = await rt.dock.lookupAvailability(session, { requestId, productIds: ids, includeClaims: true });
    s.liveCalls += 1;
    claims = r.claims ?? [];
    for (const o of r.offers) {
      // A real stock figure of zero is offered by the core (it may come later); for the watch it cannot come.
      const empty = o.availablePacks <= 0 && o.stockKnown !== false;
      statuses.set(o.productId, { productId: o.productId, offer: o, problems: empty ? ["out_of_stock"] : [], orderable: !empty, message: empty ? "Out of stock (the wholesaler's live figure is 0)." : "" });
    }
    for (const u of r.unavailable) {
      // The offer of a product that cannot be quoted, as the wholesaler stated it: from its signed availability claim.
      const c = claims.find((x) => x.productId === u.productId && x.type === "availability");
      const st = c ? (claimStatement(c.token) as { deliveryDate?: string }) : undefined;
      statuses.set(u.productId, { productId: u.productId, problems: u.problems, orderable: false, message: u.message, ...(u.message.startsWith(STAGED_PREFIX) ? { staged: true } : {}), ...(st?.deliveryDate ? { offer: { productId: u.productId, unitPriceCents: 0, availablePacks: 0, deliveryDate: st.deliveryDate } } : {}) });
    }
  }
  const value: Cached = { at: Date.now(), keys, statuses, claims, requestId, liveCalls: ids.length ? 1 : 0 };
  s.cache.set(k.orgId, value);
  return value;
}

/** When this kitchen's key products were last looked at (the cache's age), for the conversation's "is it fresh". */
export async function watchedAt(rt: Runtime, orgId: string): Promise<number | undefined> {
  return (await ready(rt)).cache.get(orgId)?.at;
}

// ---------- substitutes ----------

/** The words that say what kind of product it is: the name without the maker, figures and pack words. */
export function kindWords(p: Product): string {
  const brand = p.brand && p.brand !== "unknown" ? p.brand.toLowerCase().split(/\s+/) : [];
  return p.name
    .replace(/\d+([.,]\d+)?\s*(%|l|kg|g|ml|dl|cl|x)?(?=\b|\s|,|$)/gi, " ")
    .replace(/bag-in-box|carton|tetra|pack|box|bottle|ltk|kpl|×/gi, " ")
    .split(/[\s,]+/)
    .filter((w) => w.length > 1 && !brand.includes(w.toLowerCase()))
    .join(" ")
    .trim() || p.name;
}

/**
 * The claims every candidate must carry: the diet ones (lactose-free, gluten-free, vegan...). Not fat level and not
 * organic: a substitute without them is still worth showing, and the ranking says it needs a person ("not organic
 * like the usual").
 */
const dietClaims = (p: Product) => p.attributes.filter((a) => isMaterialAttribute(a) && !/^fat_/.test(a) && a !== "organic");

async function substitutesFor(rt: Runtime, k: WatchKitchen, session: AgentSession, requestId: string, original: Product, key: KeyProduct, usualPerUnitCents: number | null): Promise<{ ranked: RankedSubstitute[]; search: Finding["search"] }> {
  const s = stateOf(rt);
  const claims = [...new Set([...k.mandate.requiredAttributes, ...dietClaims(original)])];
  const forbidden = k.mandate.forbiddenAllergens;
  const candidates = new Map<string, SubstituteCandidate>();
  let mapCount = 0;
  try {
    const { alternativesFor } = await import("../knowledge/service");
    const a = await alternativesFor(original.id, { constraints: { requiredClaims: claims, forbiddenAllergens: forbidden }, max: 5 });
    if (a.available && "substitutes" in a) {
      const rows = [...a.substitutes, ...a.packAlternatives].slice(0, 8);
      const products = await rt.catalog.searchProducts({ ids: rows.map((r) => r.productId), limit: 20 });
      for (const r of rows) {
        const p = products.find((x) => x.id === r.productId);
        if (!p) continue;
        mapCount += 1;
        candidates.set(p.id, { product: p, ...(r.relation === "pack_alternative" ? { label: "exact" as const } : {}), map: { tier: r.tier, reason: r.reason, sameKind: r.sameKind, conditions: r.conditions.map((c) => c.text) } });
      }
    }
  } catch {
    // the knowledge map is optional; the search follows
  }
  // The wholesaler's own substitute list for the product (its product file): always a candidate, ranked first among equals.
  if (original.substitutes?.length) {
    for (const p of await rt.catalog.searchProducts({ ids: original.substitutes.slice(0, 6), limit: 6 })) if (!candidates.has(p.id)) candidates.set(p.id, { product: p });
  }
  let path: string | undefined;
  let searchCount = 0;
  try {
    const { findProducts } = await import("../search/service");
    const found = await findProducts(rt.catalog, { text: kindWords(original), category: original.category, requiredClaims: claims, forbiddenAllergens: forbidden, ...(k.mandate.allergenEvidence === "declared" ? { declaredAllergensOnly: true } : {}), limit: 12 });
    path = found.path;
    for (const h of found.hits) {
      if (h.product.id === original.id) continue;
      searchCount += 1;
      const had = candidates.get(h.product.id);
      candidates.set(h.product.id, { ...(had ?? { product: h.product }), ...(h.label ? { label: h.label } : had?.label ? { label: had.label } : {}) });
    }
  } catch {
    // no search: the map's candidates stand
  }
  // The family at large, with the same diet claims (master data): what the search's words did not reach.
  for (const p of await rt.catalog.searchProducts({ category: original.category, attributes: claims, ...(forbidden.length ? { forbiddenAllergens: forbidden } : {}), limit: 30 }).catch(() => [] as Product[])) {
    if (p.id !== original.id && !candidates.has(p.id)) candidates.set(p.id, { product: p, ...(p.attributes.filter(isMaterialAttribute).join() === original.attributes.filter(isMaterialAttribute).join() ? {} : { label: "variant" as const }) });
  }
  // One live call for the closest few: the map's first, then the search's matches before its stand-ins.
  const close = (c: SubstituteCandidate) => (c.label === "exact" ? 0 : c.label === "variant" ? 2 : c.label ? 3 : likeForLike(original, c.product) ? 1 : 2);
  const order = [...candidates.values()].sort((a, b) => Number(!!original.substitutes?.includes(b.product.id)) - Number(!!original.substitutes?.includes(a.product.id)) || Number(!!b.map) - Number(!!a.map) || close(a) - close(b) || Number(b.product.brand === original.brand) - Number(a.product.brand === original.brand));
  const ids = order.map((c) => c.product.id).filter((id) => id !== original.id).slice(0, MAX_LIVE_IDS_PER_CALL);
  if (ids.length) {
    const live = await rt.dock.lookupAvailability(session, { requestId, productIds: ids, deliveryDate: key.date }).catch(() => undefined);
    if (live) s.liveCalls += 1;
    for (const o of live?.offers ?? []) {
      const c = candidates.get(o.productId);
      if (c) c.offer = o;
    }
  }
  const stated = (await rt.kitchens.getProfile(k.orgId))?.stated ?? [];
  const ranked = rankSubstitutes(original, usualPerUnitCents, ids.map((id) => candidates.get(id)!), { amount: key.amount, date: key.date }, { mandate: k.mandate, stated });
  return { ranked, search: { mapCandidates: mapCount, searchCandidates: searchCount, priced: ids.length, ...(path ? { path } : {}) } };
}

// ---------- the watch's run ----------

export type WatchReport = { kitchen: string; name: string; keys: KeyProduct[]; findings: Finding[]; renewals: Renewal[]; liveCalls: number; note?: string };

/**
 * One look over one kitchen: its key products (one live call, cached), a finding for each that cannot come for its
 * day (with substitutes), then the recurring orders it may renew. `fresh`: ask the wholesaler again now.
 */
export type WatchRunOptions = { now?: Date; fresh?: boolean; by?: string; renew?: "due" | "now" | "none"; families?: string[]; holdOnly?: boolean };

/** One run per kitchen at a time (the schedule, staff, the conversation's look and a switch-on may meet): no renewal twice. */
const gl = globalThis as typeof globalThis & { __dockWatchLocks?: Map<string, Promise<unknown>> };
const locks = (gl.__dockWatchLocks ??= new Map());

export async function runWatchFor(rt: Runtime, k: WatchKitchen, opts: WatchRunOptions = {}): Promise<WatchReport> {
  const prev = locks.get(k.orgId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => runWatchLocked(rt, k, opts));
  locks.set(k.orgId, run);
  try {
    return await run;
  } finally {
    if (locks.get(k.orgId) === run) locks.delete(k.orgId);
  }
}

async function runWatchLocked(rt: Runtime, k: WatchKitchen, opts: WatchRunOptions): Promise<WatchReport> {
  const s = await ready(rt);
  const now = opts.now ?? new Date();
  const { keys, patterns } = await keyProducts(rt, k.orgId, now);
  const report: WatchReport = { kitchen: k.slug, name: k.name, keys, findings: [], renewals: [], liveCalls: 0 };
  if (!keys.length) return { ...report, note: "Nothing to watch: no recurring order and nothing on its way." };
  const before = s.liveCalls;
  const live = await liveOf(rt, k, keys, now, !!opts.fresh);
  const products = await rt.catalog.searchProducts({ ids: keys.map((x) => x.productId), limit: 20 });
  for (const key of keys) {
    const st = live.statuses.get(key.productId);
    const original = products.find((p) => p.id === key.productId);
    if (!st || !original) continue;
    const short = shortfallOf(st, key.date);
    const open = [...s.findings.values()].find((f) => f.orgId === k.orgId && f.need.productId === key.productId && f.need.date === key.date && f.state !== "resolved");
    if (!short) {
      if (open && open.state === "open") resolve(rt, open, "The product can come for the day again.");
      continue;
    }
    if (open && open.staged === !!st.staged) {
      report.findings.push(open);
      continue;
    }
    // Staged (or lifted) since: the earlier finding is closed and the new one says what holds now.
    if (open) resolve(rt, open, st.staged ? "A stock-out was staged for the demo over it." : "The staged stock-out was lifted.");
    report.findings.push(await addFinding(rt, k, key, original, st, short, live, patterns, now));
  }
  if (opts.renew === "none") {
    report.liveCalls = s.liveCalls - before;
    return report;
  }
  report.renewals = await renewDue(rt, k, { now, window: opts.renew ?? "due", holdOnly: !!opts.holdOnly, live, patterns: opts.families ? patterns.filter((p) => opts.families!.includes(p.family)) : patterns });
  report.liveCalls = s.liveCalls - before;
  return report;
}

async function addFinding(rt: Runtime, k: WatchKitchen, key: KeyProduct, original: Product, st: WatchStatus, short: Shortfall, live: Cached, patterns: Pattern[], now: Date): Promise<Finding> {
  const s = stateOf(rt);
  const session = await sessionOf(rt, k);
  const pattern = patterns.find((p) => p.family === key.family && p.product.productId === key.productId);
  const usual = pattern?.usualPerUnitCents ?? null;
  const subs = await substitutesFor(rt, k, session, live.requestId, original, key, usual);
  // The availability claim the core signed for this kitchen's lookup (simulated when staged: the overlay marks it).
  let claim: Finding["claim"];
  const c = live.claims.find((x) => x.productId === key.productId && x.type === "availability");
  if (c) claim = { claimId: c.claimId, token: c.token, simulated: !!(decodeJwt(c.token) as { evidence?: { simulated?: boolean }[] }).evidence?.some((e) => e.simulated), statement: claimStatement(c.token) };
  const f: Finding = {
    findingId: newId("wf"),
    orgId: k.orgId,
    kitchen: k.slug,
    kitchenName: k.name,
    at: now.toISOString(),
    product: { productId: original.id, name: original.name, family: original.category, packSize: original.packSize, unit: original.unit, brand: original.brand && original.brand !== "unknown" ? original.brand : null },
    need: key,
    shortfall: short,
    problems: st.problems,
    message: st.message,
    staged: !!st.staged,
    ...(claim ? { claim } : {}),
    usualPerUnitCents: usual,
    substitutes: subs.ranked,
    search: subs.search,
    state: "open",
  };
  saveFinding(s, f);
  const best = subs.ranked[0];
  ledger(rt, {
    actor: WATCH_ACTOR(k.agentId),
    requestId: live.requestId,
    summary: `${f.staged ? "STAGED: " : ""}The watch found that ${original.name} cannot come for ${k.name}'s ${key.source === "order" ? `order ${key.orderId}` : "recurring order"} on ${key.date} (${short.reason === "later" ? `earliest ${short.backOn}` : st.problems.join(", ")}${short.backOn ? `, back ${short.backOn}` : ""}). ${best ? `Best substitute: ${best.name} (${best.why}); ${best.insidePreferences ? "inside the kitchen's preferences" : `needs a person: ${best.outside.join("; ")}`}.` : "No substitute can come by the day."}`,
    data: { step: "found", findingId: f.findingId, productId: original.id, family: original.category, deliveryDate: key.date, source: key.source, orderId: key.orderId, shortfall: short, problems: st.problems, staged: f.staged, claimId: claim?.claimId, substitutes: subs.ranked.map((r) => ({ rank: r.rank, productId: r.productId, insidePreferences: r.insidePreferences, perUnitDiffCents: r.tradeOff.perUnitDiffCents })) },
  });
  return f;
}

const claimStatement = (token: string) => ((decodeJwt(token) as { credentialSubject?: { availability?: Record<string, unknown> } }).credentialSubject?.availability ?? {}) as Record<string, unknown>;

function resolve(rt: Runtime, f: Finding, why: string) {
  const s = stateOf(rt);
  saveFinding(s, { ...f, state: "resolved" });
  ledger(rt, { actor: "dock", summary: `Watch finding closed for ${f.kitchenName}: ${f.product.name} on ${f.need.date}. ${why}`, data: { step: "resolved", findingId: f.findingId, productId: f.product.productId, deliveryDate: f.need.date, staged: f.staged } });
}

/** The watch over every kitchen (or the given ones): the "run now" staff press, and what the schedule runs. */
export async function runWatch(rt: Runtime, opts: { kitchens?: string[]; now?: Date; fresh?: boolean; by?: string; renew?: "due" | "now" } = {}): Promise<WatchReport[]> {
  const s = await ready(rt);
  const out: WatchReport[] = [];
  for (const k of await watchKitchens(rt, opts.kitchens)) {
    out.push(await runWatchFor(rt, k, opts).catch((err: Error) => ({ kitchen: k.slug, name: k.name, keys: [], findings: [], renewals: [], liveCalls: 0, note: `The watch failed for this kitchen: ${err.message}` })));
  }
  s.runs.unshift({ at: (opts.now ?? new Date()).toISOString(), by: opts.by ?? "schedule", kitchens: out.length, findings: out.reduce((n, r) => n + r.findings.length, 0), placed: out.reduce((n, r) => n + r.renewals.filter((x) => x.state === "placed").length, 0), held: out.reduce((n, r) => n + r.renewals.filter((x) => x.state === "held").length, 0), liveCalls: out.reduce((n, r) => n + r.liveCalls, 0) });
  s.runs.length = Math.min(s.runs.length, 20);
  return out;
}

// ---------- placing an order through the gate ----------

type Placed = { requestId?: string; order?: PublicOrder; refused?: { code: string; rule?: string; message: string } };

/** openRequest -> requestQuote -> placeOrder with the kitchen's mandate: the one path to an order. */
async function placeThroughGate(rt: Runtime, session: AgentSession, input: { text: string; date: string; productId: string; packs: number; substituteFor?: string }): Promise<Placed> {
  let requestId: string | undefined;
  try {
    const req = await rt.dock.openRequest(session, { text: input.text.slice(0, 2000), deliverOn: input.date, productIds: [input.substituteFor ?? input.productId] });
    requestId = req.requestId;
    const q = await rt.dock.requestQuote(session, { requestId, lines: [{ productId: input.productId, quantity: input.packs, ...(input.substituteFor ? { substituteFor: input.substituteFor } : {}) }] });
    const order = await rt.dock.placeOrder(session, { requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    return { requestId, order };
  } catch (err) {
    if (isDockError(err)) return { requestId, refused: { code: err.code, ...(err.rule ? { rule: err.rule } : {}), message: err.message } };
    throw err;
  }
}

const outcomeOf = (p: Placed) => ({
  ...(p.requestId ? { requestId: p.requestId } : {}),
  ...(p.order ? { orderId: p.order.orderId, status: p.order.status, totalCents: p.order.totalCents, reasons: p.order.decision.reasons, ...(p.order.approval ? { approver: `${p.order.approval.approver.name} (${p.order.approval.approver.role.replaceAll("_", " ")})` } : {}) } : {}),
  ...(p.refused ? { refused: p.refused } : {}),
});

const packsFor = (amount: number, packSize: number) => Math.max(1, Math.ceil(amount / packSize - 1e-9));

// ---------- auto-renew ----------

export function autoRenewOf(s: State, orgId: string, family: string): AutoRenew {
  return s.auto.get(`${orgId}:${family}`) ?? { orgId, family, on: false, by: "nobody (off by default)", via: "default", at: "" };
}

/** The kitchen's explicit choice, recorded with who made it and through which door. Off by default. */
export async function setAutoRenew(rt: Runtime, session: AgentSession, input: { family: string; on: boolean; by: string; via: string; now?: Date; renewNow?: boolean }): Promise<AutoRenew & { renewal?: Renewal }> {
  const s = await ready(rt);
  const orgId = session.mandate.issuer.orgId;
  const { patterns } = await patternsOf(rt, orgId);
  const p = patterns.find((x) => x.family === input.family);
  if (!p) throw new DockError(404, "standing_not_found", `There is no recurring ${input.family.replaceAll("_", " ")} order to renew: it needs ${3} orders over two weeks first.`);
  const a: AutoRenew = { orgId, family: input.family, on: input.on, by: input.by, via: input.via, at: (input.now ?? new Date()).toISOString() };
  s.auto.set(`${orgId}:${input.family}`, a);
  await s.stores.auto.put(`${orgId}:${input.family}`, a);
  ledger(rt, { actor: `buyer:${orgId}`, summary: `${input.by} switched auto-renew ${input.on ? "on" : "off"} for the recurring ${input.family.replaceAll("_", " ")} order (${p.product.name}, usually ${p.slots.map((x) => `${WEEKDAY[x.weekday]} ${x.usualAmount} ${unitWord(p.unit)}`).join(", ")}), via ${input.via}. ${input.on ? "The agent renews it before the cut-off when nothing has drifted, within the mandate and through the gate; when something drifted it holds it and asks." : "The agent only reminds."}`, data: { step: "auto_renew", family: input.family, on: input.on, by: input.by, via: input.via } });
  // Switched on: if the next one has drifted it is held and asked now; placing it waits for its cut-off window.
  if (input.on && input.renewNow !== false) {
    const k = await kitchenOfSession(rt, session);
    if (k.mandateToken) {
      const r = await runWatchFor(rt, k, { now: input.now, renew: "now", families: [input.family], holdOnly: true }).catch(() => undefined);
      const renewal = r?.renewals.find((x) => x.family === input.family);
      if (renewal) return { ...a, renewal };
    }
  }
  return a;
}

/** Due: the cut-off for the day is within 30 hours (or, when the wholesaler states none, the day is within two). */
function due(next: { date: string }, st: WatchStatus | undefined, now: Date): boolean {
  const by = st?.offer?.orderBy ? Date.parse(st.offer.orderBy.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
  if (Number.isFinite(by)) return by > now.getTime() && by - now.getTime() <= 30 * 3600_000;
  return addDaysIso(today(now), 2) >= next.date;
}

async function renewDue(rt: Runtime, k: WatchKitchen, ctx: { now: Date; window: "due" | "now"; holdOnly?: boolean; live: Cached; patterns: Pattern[] }): Promise<Renewal[]> {
  const s = stateOf(rt);
  const out: Renewal[] = [];
  const profile = await rt.kitchens.getProfile(k.orgId);
  const orders = (await rt.dock.listOrders({ orgId: k.orgId })).filter((o) => o.status === "committed" || o.status === "pending_approval");
  for (const p of ctx.patterns) {
    const auto = autoRenewOf(s, k.orgId, p.family);
    if (!auto.on) continue;
    const next = nextSlot(p, today(ctx.now));
    if (!next) continue;
    const st = ctx.live.statuses.get(p.product.productId);
    if (ctx.window === "due" && !due(next, st, ctx.now)) continue;
    const existing = [...s.renewals.values()].find((r) => r.orgId === k.orgId && r.family === p.family && r.deliveryDate === next.date && r.state !== "failed");
    if (existing) {
      out.push(existing);
      continue;
    }
    const handled = orders.some((o) => o.lines.some((l) => l.category === p.family && l.deliveryDate === next.date));
    const short = st ? shortfallOf(st, next.date) : undefined;
    const livePerUnit = st?.offer && st.orderable && p.unit !== "pcs" && st.offer.unitPriceCents > 0 ? Math.round((st.offer.unitPriceCents / p.product.packSize) * 10) / 10 : null;
    const drift = driftOf(p, next.slot, { perUnitCents: livePerUnit, staged: !!st?.offer?.simulated });
    const decision = decideRenewal({ autoRenew: true, paused: !!profile?.pausedStanding?.includes(p.family), drift, available: st ? !short : undefined, handled, cutoffPassed: !!st?.problems.includes("cutoff_passed") && !short });
    if (decision.action === "none" || decision.action === "remind") continue;
    // Just switched on: ask now about a drift; placing (or a substitute for a stock-out) waits for its cut-off window.
    if (ctx.holdOnly && (decision.action !== "hold" || decision.because.every((b) => b === "stock"))) continue;
    out.push(await renew(rt, k, p, next, drift, decision, auto, ctx.now));
  }
  return out;
}

async function renew(rt: Runtime, k: WatchKitchen, p: Pattern, next: { date: string; slot: Pattern["slots"][number] }, drift: Drift, decision: RenewalDecision, auto: AutoRenew, now: Date): Promise<Renewal> {
  const s = stateOf(rt);
  const amounts = { ...renewalAmounts(next.slot, drift), unit: p.unit };
  const r: Renewal = {
    renewalId: newId("wr"),
    orgId: k.orgId,
    kitchen: k.slug,
    kitchenName: k.name,
    family: p.family,
    product: { productId: p.product.productId, name: p.product.name, packSize: p.product.packSize, unit: p.product.unit },
    deliveryDate: next.date,
    at: now.toISOString(),
    decision,
    drift,
    amounts,
    basedOn: p.basedOn,
    staged: p.stagedPoints > 0 || !!drift.basket?.staged,
    state: decision.action === "place" ? "placed" : "held",
    autoRenew: auto,
  };
  const session = await sessionOf(rt, k);
  const onlyStock = decision.action === "hold" && decision.because.length === 1 && decision.because[0] === "stock";
  if (decision.action === "place") {
    const placed = await placeThroughGate(rt, session, { text: `Recurring ${p.family.replaceAll("_", " ")} for ${dayName(next.date)}: renewed by the agent as usual (${amounts.usual} ${unitWord(p.unit)}; auto-renew on since ${auto.at.slice(0, 10)}, by ${auto.by})`, date: next.date, productId: p.product.productId, packs: packsFor(amounts.usual, p.product.packSize) });
    r.outcome = outcomeOf(placed);
    r.state = placed.order ? "placed" : "failed";
  } else if (onlyStock) {
    // The usual product cannot come: the best substitute, alone when inside the kitchen's preferences, else for sign-off.
    const f = [...s.findings.values()].find((x) => x.orgId === k.orgId && x.need.productId === p.product.productId && x.need.date === next.date && x.state !== "resolved");
    const best = f?.substitutes[0];
    if (f && best) {
      const placed = await placeThroughGate(rt, session, { text: `Recurring ${p.family.replaceAll("_", " ")} for ${dayName(next.date)}: ${p.product.name} cannot come${f.staged ? " (STAGED for the demo)" : ""}, so the agent renewed it with ${best.name}${best.insidePreferences ? ", inside the kitchen's preferences" : ", for a person's sign-off"}`, date: next.date, productId: best.productId, packs: best.tradeOff.packs, substituteFor: p.product.productId });
      r.outcome = { ...outcomeOf(placed), substitute: { productId: best.productId, name: best.name, insidePreferences: best.insidePreferences, findingId: f.findingId } };
      r.state = placed.order ? "placed" : "failed";
      if (f.state === "open") decideFinding(rt, f, { at: now.toISOString(), by: `the agent (auto-renew on, by ${auto.by})`, via: "auto-renew", action: placed.order ? (placed.order.status === "committed" ? "ordered_alone" : "sent_for_sign_off") : "refused", productId: best.productId, ...findingOutcome(placed) });
    }
  }
  saveRenewal(s, r);
  ledger(rt, {
    actor: WATCH_ACTOR(k.agentId),
    ...(r.outcome?.requestId ? { requestId: r.outcome.requestId } : {}),
    ...(r.outcome?.orderId ? { orderId: r.outcome.orderId } : {}),
    summary: renewalSummary(r),
    data: { step: r.state === "held" ? "renewal_held" : "renewal_placed", renewalId: r.renewalId, family: r.family, productId: r.product.productId, deliveryDate: r.deliveryDate, decision: r.decision, drift: driftData(r.drift), amounts: r.amounts, staged: r.staged, outcome: r.outcome, autoRenew: { by: auto.by, via: auto.via, at: auto.at } },
  });
  return r;
}

const driftData = (d: Drift) => ({ ...(d.portions ? { portions: { from: d.portions.from, to: d.portions.to, pct: d.portions.pct, since: d.portions.since, weeks: d.portions.weeks } } : {}), ...(d.cost ? { cost: { from: d.cost.from, to: d.cost.to, pct: d.cost.pct, since: d.cost.since } } : {}), ...(d.basket ? { basket: { usualCents: d.basket.usualCents, nowCents: d.basket.nowCents, pct: d.basket.pct } } : {}) });

/** One plain sentence for staff and the ledger: what was renewed or held, and why. */
export function renewalSummary(r: Renewal): string {
  const u = unitWord(r.amounts.unit);
  const day = dayName(r.deliveryDate);
  const st = r.staged ? "STAGED: " : "";
  if (r.state === "held") {
    const why = [
      r.drift.portions && `the amount crept from ${r.drift.portions.from} to ${r.drift.portions.to} ${u} over ${r.drift.portions.weeks} weeks since ${r.drift.portions.since}`,
      r.drift.cost && `the price per ${u} went from ${formatEur(r.drift.cost.from)} to ${formatEur(r.drift.cost.to)} (${r.drift.cost.pct > 0 ? "+" : ""}${r.drift.cost.pct} %) since ${r.drift.cost.since}`,
      r.drift.basket && `the usual ${r.drift.basket.amount} ${u} cost ${formatEur(r.drift.basket.nowCents)} at today's price against ${formatEur(r.drift.basket.usualCents)} (${r.drift.basket.pct > 0 ? "+" : ""}${r.drift.basket.pct} %)`,
    ].filter(Boolean);
    return `${st}The agent held ${r.kitchenName}'s recurring ${r.family.replaceAll("_", " ")} order for ${day} before renewing it: ${why.join("; ") || r.decision.reason}. It asks the kitchen: ${r.decision.action === "hold" ? r.decision.choices.map((c) => ({ renew_new: `renew at ${r.amounts.latest} ${u}`, usual: `go back to ${r.amounts.usual} ${u}`, skip: "skip this week" })[c]).join(", ") : ""}.`;
  }
  const o = r.outcome;
  if (r.state === "answered" || r.state === "skipped") return `${st}${r.answer?.by ?? "The kitchen"} answered the held ${r.family.replaceAll("_", " ")} renewal for ${day}: ${r.answer?.choice}${o?.orderId ? `; order ${o.orderId} ${o.status}` : ""}.`;
  if (!o?.orderId) return `${st}The agent tried to renew ${r.kitchenName}'s recurring ${r.family.replaceAll("_", " ")} order for ${day}; the gate refused it (${o?.refused?.rule ?? o?.refused?.code}): ${o?.refused?.message ?? "no order"}.`;
  const what = o.substitute ? `${o.substitute.name} instead of ${r.product.name}` : `${r.product.name}`;
  return `${st}The agent renewed ${r.kitchenName}'s recurring ${r.family.replaceAll("_", " ")} order for ${day} by itself: ${what}, ${formatEur(o.totalCents ?? 0)}; ${o.status === "committed" ? "within the mandate, committed" : `over what it may do alone, sent to ${o.approver ?? "a person"} for sign-off`} (auto-renew on since ${r.autoRenew.at.slice(0, 10)}, by ${r.autoRenew.by}).`;
}

const findingOutcome = (p: Placed) => ({ ...(p.requestId ? { requestId: p.requestId } : {}), ...(p.order ? { orderId: p.order.orderId, status: p.order.status, totalCents: p.order.totalCents, reasons: p.order.decision.reasons, ...(p.order.approval ? { approver: `${p.order.approval.approver.name} (${p.order.approval.approver.role.replaceAll("_", " ")})` } : {}) } : {}), ...(p.refused ? { note: `Refused by the gate (${p.refused.rule ?? p.refused.code}): ${p.refused.message}` } : {}) });

function decideFinding(rt: Runtime, f: Finding, d: FindingDecision) {
  const s = stateOf(rt);
  saveFinding(s, { ...f, state: "decided", decision: d });
  ledger(rt, {
    actor: d.via === "auto-renew" ? "dock" : `buyer:${f.orgId}`,
    ...(d.requestId ? { requestId: d.requestId } : {}),
    ...(d.orderId ? { orderId: d.orderId } : {}),
    summary: `${f.staged ? "STAGED: " : ""}${d.by} ${d.action === "kept" ? `kept ${f.product.name} for ${f.need.date} (no substitute)` : `chose ${d.productId} for ${f.need.date} instead of ${f.product.name}: ${d.action === "ordered_alone" ? "committed within the mandate" : d.action === "sent_for_sign_off" ? `sent to ${d.approver ?? "a person"} for sign-off` : d.action === "refused" ? `refused by the gate. ${d.note ?? ""}` : (d.note ?? "")}`} (via ${d.via}).`,
    data: { step: "decided", findingId: f.findingId, productId: d.productId ?? f.product.productId, deliveryDate: f.need.date, decision: d.action, by: d.by, requestId: d.requestId, orderId: d.orderId, staged: f.staged },
  });
}

// ---------- answers (the conversation, an outside agent) ----------

export type Who = { by: string; via: string; signedIn?: boolean; now?: Date };

async function ownFinding(rt: Runtime, orgId: string, findingId: string): Promise<Finding> {
  const f = (await ready(rt)).findings.get(findingId);
  if (!f || f.orgId !== orgId) throw new DockError(404, "finding_not_found", `No watch finding ${findingId} for this organisation.`);
  return f;
}

async function ownRenewal(rt: Runtime, orgId: string, renewalId: string): Promise<Renewal> {
  const r = (await ready(rt)).renewals.get(renewalId);
  if (!r || r.orgId !== orgId) throw new DockError(404, "renewal_not_found", `No renewal ${renewalId} for this organisation.`);
  return r;
}

/**
 * The kitchen's answer to a finding: switch to a substitute (the best, or the one named), or keep the usual. A switch
 * is an ordinary order through the gate for the same day: inside the kitchen's preferences and the mandate it
 * commits alone; otherwise it goes to the person the mandate names, on their phone. When the product was on an order
 * already placed, that order is taken back if it still waits for sign-off, or (committed) by the kitchen's own
 * signed-in person before the cut-off; otherwise the reply says it still stands.
 */
export async function answerFinding(rt: Runtime, session: AgentSession, findingId: string, answer: { choice: "switch" | "keep"; productId?: string }, who: Who): Promise<{ finding: Finding; order?: PublicOrder; refused?: Placed["refused"]; originalOrder?: { orderId: string; status: string; note: string } }> {
  const s = await ready(rt);
  const f = await ownFinding(rt, session.mandate.issuer.orgId, findingId);
  const now = who.now ?? new Date();
  if (f.state !== "open") throw new DockError(409, "finding_closed", `Finding ${findingId} is ${f.state}${f.decision ? ` (${f.decision.action} by ${f.decision.by})` : ""}.`);
  if (answer.choice === "keep") {
    decideFinding(rt, f, { at: now.toISOString(), by: who.by, via: who.via, action: "kept" });
    return { finding: s.findings.get(findingId)! };
  }
  const sub = answer.productId ? f.substitutes.find((x) => x.productId === answer.productId) : f.substitutes[0];
  if (!sub) throw new DockError(409, "no_substitute", answer.productId ? `${answer.productId} is not one of the substitutes the watch proposed for ${f.product.name}.` : `No substitute for ${f.product.name} can come by ${f.need.date}.`);
  const placed = await placeThroughGate(rt, session, { text: `${f.product.name} cannot come for ${dayName(f.need.date)}${f.staged ? " (STAGED for the demo)" : ""}: ${who.by} chose ${sub.name} instead (the watch's ${sub.rank})`, date: f.need.date, productId: sub.productId, packs: sub.tradeOff.packs, substituteFor: f.product.productId });
  let originalOrder: { orderId: string; status: string; note: string } | undefined;
  if (placed.order && f.need.source === "order" && f.need.orderId && placed.order.status !== "rejected") {
    const o = await rt.dock.getOrder(session, f.need.orderId).catch(() => undefined);
    if (o?.status === "pending_approval") {
      await rt.dock.withdrawOrder(session, o.orderId, { reason: `Replaced by ${placed.order.orderId}: ${f.product.name} cannot come`, by: who.by }).catch(() => undefined);
      originalOrder = { orderId: o.orderId, status: "withdrawn", note: "It was still waiting for sign-off: withdrawn." };
    } else if (o?.status === "committed" && who.signedIn) {
      const back = await rt.dock.withdrawOrder(session, o.orderId, { reason: `Replaced by ${placed.order.orderId}: ${f.product.name} cannot come` }, { takeBack: { by: who.by } }).catch((err: Error) => err);
      originalOrder = back instanceof Error ? { orderId: o.orderId, status: "committed", note: `It could not be taken back: ${back.message}` } : { orderId: o.orderId, status: "withdrawn", note: `Taken back by ${who.by} before the cut-off.` };
    } else if (o) originalOrder = { orderId: o.orderId, status: o.status, note: "It still stands: the kitchen's signed-in person can take it back in the store before the cut-off." };
  }
  decideFinding(rt, f, { at: now.toISOString(), by: who.by, via: who.via, action: placed.order ? (placed.order.status === "committed" ? "switched" : placed.order.status === "pending_approval" ? "sent_for_sign_off" : "refused") : "refused", productId: sub.productId, ...findingOutcome(placed), ...(originalOrder ? { note: `Original order ${originalOrder.orderId}: ${originalOrder.note}` } : {}) });
  return { finding: s.findings.get(findingId)!, ...(placed.order ? { order: placed.order } : {}), ...(placed.refused ? { refused: placed.refused } : {}), ...(originalOrder ? { originalOrder } : {}) };
}

/** The kitchen's answer to a held renewal: renew at the new amount, go back to the usual, or skip this week. */
export async function answerRenewal(rt: Runtime, session: AgentSession, renewalId: string, choice: RenewalChoice, who: Who): Promise<{ renewal: Renewal; order?: PublicOrder; refused?: Placed["refused"] }> {
  const s = await ready(rt);
  const r = await ownRenewal(rt, session.mandate.issuer.orgId, renewalId);
  const now = who.now ?? new Date();
  if (r.state !== "held") throw new DockError(409, "renewal_closed", `Renewal ${renewalId} is ${r.state}.`);
  if (r.decision.action === "hold" && !r.decision.choices.includes(choice)) throw new DockError(400, "invalid_choice", `Answer one of ${r.decision.choices.join(", ")}.`);
  const answer = { choice, by: who.by, via: who.via, at: now.toISOString() };
  if (choice === "skip") {
    const done: Renewal = { ...r, state: "skipped", answer };
    saveRenewal(s, done);
    ledger(rt, { actor: `buyer:${r.orgId}`, summary: `${who.by} skipped this week's recurring ${r.family.replaceAll("_", " ")} order for ${dayName(r.deliveryDate)} (via ${who.via}); nothing was ordered.`, data: { step: "renewal_answered", renewalId, family: r.family, deliveryDate: r.deliveryDate, choice, by: who.by, staged: r.staged } });
    return { renewal: done };
  }
  const amount = choice === "renew_new" ? r.amounts.latest : r.amounts.usual;
  // The usual product cannot come for the day (a watch finding): the amount chosen, of the best substitute.
  const f = [...s.findings.values()].find((x) => x.orgId === r.orgId && x.need.productId === r.product.productId && x.need.date === r.deliveryDate && x.state !== "resolved");
  const sub = f?.substitutes[0];
  // The amount in the substitute's measure: the finding's need says how many litres or kilos one unit of the usual is.
  const perUsualUnit = sub && f && sub.tradeOff.need && f.need.amount > 0 ? sub.tradeOff.need.amount / f.need.amount : 1;
  const subPacks = sub ? packsFor(amount * perUsualUnit, sub.tradeOff.packSize) : 0;
  const placed = await placeThroughGate(rt, session, { text: `Recurring ${r.family.replaceAll("_", " ")} for ${dayName(r.deliveryDate)}: ${who.by} chose ${choice === "renew_new" ? "the new amount" : "the usual amount"}, ${amount} ${unitWord(r.amounts.unit)}, after the agent held it (${r.decision.reason})${sub ? `; ${r.product.name} cannot come, so ${sub.name}` : ""}`, date: r.deliveryDate, ...(sub ? { productId: sub.productId, packs: subPacks, substituteFor: r.product.productId } : { productId: r.product.productId, packs: packsFor(amount, r.product.packSize) }) });
  if (f && sub && f.state === "open") decideFinding(rt, f, { at: now.toISOString(), by: who.by, via: who.via, action: placed.order ? (placed.order.status === "committed" ? "switched" : placed.order.status === "pending_approval" ? "sent_for_sign_off" : "refused") : "refused", productId: sub.productId, ...findingOutcome(placed) });
  const done: Renewal = { ...r, state: placed.order ? "answered" : "failed", answer, outcome: { ...outcomeOf(placed), ...(f && sub ? { substitute: { productId: sub.productId, name: sub.name, insidePreferences: sub.insidePreferences, findingId: f.findingId } } : {}) } };
  saveRenewal(s, done);
  ledger(rt, { actor: `buyer:${r.orgId}`, ...(placed.requestId ? { requestId: placed.requestId } : {}), ...(placed.order ? { orderId: placed.order.orderId } : {}), summary: renewalSummary(done), data: { step: "renewal_answered", renewalId, family: r.family, deliveryDate: r.deliveryDate, choice, amount, by: who.by, outcome: done.outcome, staged: r.staged } });
  return { renewal: done, ...(placed.order ? { order: placed.order } : {}), ...(placed.refused ? { refused: placed.refused } : {}) };
}

// ---------- what a kitchen (or its outside agent) sees ----------

export type StandingView = {
  family: string;
  product: Pattern["product"];
  slots: { weekday: number; usualAmount: number; usualPerUnitCents: number | null; orders: number; points: { date: string; amount: number; perUnitCents: number | null; staged?: boolean }[] }[];
  usualAmount: number;
  usualPerUnitCents: number | null;
  unit: string;
  basedOn: Pattern["basedOn"];
  next?: { date: string; weekday: number; usualAmount: number };
  drift: Drift;
  drifted: boolean;
  staged: boolean;
  paused: boolean;
  autoRenew: AutoRenew;
};

/** The learned recurring orders, as data: pattern, next day, drift (from records only, no live call), auto-renew. */
export async function standingFor(rt: Runtime, orgId: string, now = new Date()): Promise<StandingView[]> {
  const s = await ready(rt);
  const { profile, patterns } = await patternsOf(rt, orgId);
  return patterns.map((p) => {
    const next = nextSlot(p, today(now));
    const drift = next ? driftOf(p, next.slot) : {};
    return {
      family: p.family,
      product: p.product,
      slots: p.slots.map((x) => ({ weekday: x.weekday, usualAmount: x.usualAmount, usualPerUnitCents: x.usualPerUnitCents, orders: x.orders, points: x.points.map((pt) => ({ date: pt.date, amount: pt.amount, perUnitCents: pt.perUnitCents, ...(pt.staged ? { staged: true } : {}) })) })),
      usualAmount: p.usualAmount,
      usualPerUnitCents: p.usualPerUnitCents,
      unit: p.unit,
      basedOn: p.basedOn,
      ...(next ? { next: { date: next.date, weekday: next.slot.weekday, usualAmount: next.slot.usualAmount } } : {}),
      drift,
      drifted: drifted(drift),
      staged: p.stagedPoints > 0,
      paused: !!profile?.pausedStanding?.includes(p.family),
      autoRenew: autoRenewOf(s, orgId, p.family),
    };
  });
}

export type KitchenWatch = { findings: Finding[]; renewals: Renewal[]; standing: StandingView[]; stagedNow: Stage[] };

/** What the watch has for this kitchen: open findings first, then the latest renewals. */
export async function watchForOrg(rt: Runtime, orgId: string, opts: { all?: boolean; now?: Date } = {}): Promise<KitchenWatch> {
  const s = await ready(rt);
  const findings = [...s.findings.values()].filter((f) => f.orgId === orgId && (opts.all || f.state !== "resolved")).sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.at.localeCompare(a.at));
  const renewals = [...s.renewals.values()].filter((r) => r.orgId === orgId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.all ? 50 : 10);
  return { findings, renewals, standing: await standingFor(rt, orgId, opts.now), stagedNow: [...s.stages.values()].filter((g) => g.orgId === orgId && !g.liftedAt) };
}

/** Run the watch now for the kitchen of this session (an outside agent's "check again"). */
export async function watchNowFor(rt: Runtime, session: AgentSession, opts: { fresh?: boolean; now?: Date; renew?: "due" | "none" } = {}): Promise<WatchReport> {
  const k = await kitchenOfSession(rt, session);
  if (!k.mandateToken) return { kitchen: k.slug, name: k.name, keys: [], findings: [], renewals: [], liveCalls: 0, note: "This organisation has no kitchen the watch runs for." };
  return runWatchFor(rt, k, { ...opts, renew: opts.renew ?? "due" });
}

/**
 * Before the conversation says what the watch has: when this kitchen's key products have not been looked at in the
 * last ten minutes (after a restart, a test account reset, or before the first scheduled run), look now. At most
 * one live call per kitchen per ten minutes; never throws.
 */
export async function watchIfStale(rt: Runtime, session: AgentSession, now = new Date()): Promise<void> {
  const at = await watchedAt(rt, session.mandate.issuer.orgId);
  if (at && Date.now() - at < CACHE_MS) return;
  // Only looks: renewing is the schedule's and staff's run, never a side effect of opening the conversation.
  await watchNowFor(rt, session, { now, renew: "none" }).catch((err: Error) => console.warn("[watch] look before the conversation", err.message));
}

/** Marks a moment as said in the conversation, so it is not said again. */
export async function markSaid(rt: Runtime, id: string, now = new Date()): Promise<void> {
  const s = await ready(rt);
  const f = s.findings.get(id);
  if (f) return saveFinding(s, { ...f, saidAt: now.toISOString() });
  const r = s.renewals.get(id);
  if (r) saveRenewal(s, { ...r, saidAt: now.toISOString() });
}

// ---------- staging (operations, demo kitchens only) ----------

/** Demo kitchens, visitors' QR kitchens and the shared public test accounts: never a restaurant's own account. */
export const isStageable = (k: Pick<WatchKitchen, "kind" | "shared">) => k.kind === "demo" || k.kind === "visitor" || (k.kind === "account" && !!k.shared);

function stageable(k: WatchKitchen) {
  if (!isStageable(k)) throw new DockError(403, "stage_not_allowed", `${k.name} is a restaurant's own kitchen: conditions are staged only for the demo kitchens and the shared test accounts.`);
}

/** Stage a stock-out of one product for one demo kitchen: the watch reads it as out of stock until `until`. */
export async function stageStockOut(rt: Runtime, input: { kitchen: string; productId: string; until?: string; by: string; now?: Date }): Promise<Stage> {
  const s = await ready(rt);
  const k = await watchKitchen(rt, input.kitchen);
  stageable(k);
  const [p] = await rt.catalog.searchProducts({ ids: [input.productId], limit: 1 });
  if (!p) throw new DockError(404, "product_not_found", `No product ${input.productId} in the assortment.`);
  const now = input.now ?? new Date();
  const until = input.until && /^\d{4}-\d{2}-\d{2}$/.test(input.until) ? input.until : addDaysIso(today(now), 7);
  if (until <= today(now)) throw new DockError(400, "invalid_request", "The day it can come again must be after today.");
  for (const old of activeStockOuts(s, k.orgId).filter((g) => g.productId === p.id)) saveStage(s, { ...old, liftedAt: now.toISOString(), liftedBy: input.by });
  const g: Stage = { stageId: newId("stg"), kind: "stock_out", orgId: k.orgId, kitchen: k.slug, kitchenName: k.name, productId: p.id, productName: p.name, until, by: input.by, at: now.toISOString() };
  saveStage(s, g);
  syncOverlay(rt, s, k.orgId);
  s.cache.delete(k.orgId);
  ledger(rt, { actor: `staff:${input.by}`, summary: `STAGED for the demo by ${input.by}: ${p.name} (${p.id}) is out of stock for ${k.name} until ${until}, in every live answer that kitchen gets (its intake, quotes, the watch; no other kitchen). The partner's live figures are unchanged; every claim signed from it says simulated.`, data: { step: "staged", stageId: g.stageId, kind: g.kind, productId: p.id, until, staged: true, by: input.by } });
  return g;
}

/**
 * Stage a creeping recurring order for one demo kitchen: the last four orders on the weekday that comes next become 80, 90,
 * 100 and 110 % of the usual amount (portions) and, with `cost`, cost 0, 3, 6 and 10 % more per litre or kilo. The
 * orders it replaced are kept and put back when the stage is lifted.
 */
export async function stageDrift(rt: Runtime, input: { kitchen: string; family: string; cost?: boolean; by: string; now?: Date }): Promise<Stage> {
  const s = await ready(rt);
  const k = await watchKitchen(rt, input.kitchen);
  stageable(k);
  const now = input.now ?? new Date();
  for (const old of [...s.stages.values()].filter((g) => g.orgId === k.orgId && g.kind === "drift" && g.family === input.family && !g.liftedAt)) await liftStage(rt, old.stageId, input.by);
  const { patterns } = await patternsOf(rt, k.orgId);
  const p = patterns.find((x) => x.family === input.family);
  if (!p) throw new DockError(404, "standing_not_found", `${k.name} has no recurring ${input.family} order to stage drift on.`);
  // The weekday that comes next, so the next renewal is the one that has drifted.
  const slot = nextSlot(p, today(now))?.slot ?? [...p.slots].sort((a, b) => b.orders - a.orders)[0];
  const last = slot.points.slice(-4);
  if (last.length < 4) throw new DockError(409, "not_enough_orders", "Four orders on one weekday are needed to stage a trend.");
  const steps = [0.8, 0.9, 1, 1.1];
  const price = input.cost ? [1, 1.03, 1.06, 1.1] : [1, 1, 1, 1];
  const ids = new Set(last.map((x) => x.orderId));
  // Whole packs, each week at least one pack more than the one before (a 20 L case cannot step by 11 L).
  const packSize = p.product.packSize;
  const stagedPacks: number[] = [];
  for (const s0 of steps) stagedPacks.push(Math.max((stagedPacks.at(-1) ?? 0) + 1, Math.round((slot.usualAmount * s0) / packSize)));
  const g: Stage = { stageId: newId("stg"), kind: "drift", orgId: k.orgId, kitchen: k.slug, kitchenName: k.name, family: p.family, productId: p.product.productId, productName: p.product.name, by: input.by, at: now.toISOString(), replaced: [], stagedIds: [] };
  await updateKitchenProfile(rt.kitchens, k.orgId, (prof) => {
    if (!prof) return prof;
    const history = prof.history.map((h) => {
      if (!ids.has(h.orderId)) return h;
      const i = last.findIndex((x) => x.orderId === h.orderId);
      g.replaced!.push(structuredClone(h));
      const line = h.lines[0];
      const packs = Math.max(1, Math.round((stagedPacks[i] * packSize) / line.packSize));
      const unitPrice = Math.round(line.unitPriceCents * price[i]);
      const id = `${h.orderId}_staged`;
      g.stagedIds!.push(id);
      return { ...h, orderId: id, amount: Math.round(packs * line.packSize * 100) / 100, totalCents: packs * unitPrice, lines: [{ ...line, packs, unitPriceCents: unitPrice }, ...h.lines.slice(1)] };
    });
    return { ...prof, history };
  });
  saveStage(s, g);
  ledger(rt, { actor: `staff:${input.by}`, summary: `STAGED for the demo by ${input.by}: ${k.name}'s last four ${WEEKDAY[slot.weekday]} ${p.family.replaceAll("_", " ")} orders now creep up (80, 90, 100, 110 % of the usual ${slot.usualAmount} ${unitWord(p.unit)})${input.cost ? " and cost 0, 3, 6, 10 % more per unit" : ""}. The real orders are kept and put back when the stage is lifted.`, data: { step: "staged", stageId: g.stageId, kind: g.kind, family: p.family, staged: true, by: input.by, orderIds: [...ids] } });
  return g;
}

/** Lift a staged condition: the live figures (or the real orders) apply again. */
export async function liftStage(rt: Runtime, stageId: string, by: string, now = new Date()): Promise<Stage> {
  const s = await ready(rt);
  const g = s.stages.get(stageId);
  if (!g) throw new DockError(404, "stage_not_found", `No staged condition ${stageId}.`);
  if (g.liftedAt) return g;
  if (g.kind === "drift" && g.replaced?.length) {
    const back = new Map(g.replaced.map((h) => [`${h.orderId}_staged`, h]));
    await updateKitchenProfile(rt.kitchens, g.orgId, (prof) => (prof ? { ...prof, history: prof.history.map((h) => back.get(h.orderId) ?? h) } : prof));
  }
  const done: Stage = { ...g, liftedAt: now.toISOString(), liftedBy: by };
  saveStage(s, done);
  syncOverlay(rt, s, g.orgId);
  s.cache.delete(g.orgId);
  ledger(rt, { actor: `staff:${by}`, summary: `Staged condition lifted by ${by}: ${g.kind === "stock_out" ? `${g.productName} for ${g.kitchenName} is back to the partner's live figures` : `${g.kitchenName}'s ${g.family} orders are the real ones again`}.`, data: { step: "unstaged", stageId, kind: g.kind, staged: true, by } });
  return done;
}

/**
 * A shared test account was reset to its seed (accounts/service.ts resetTestAccounts): what was staged for its old
 * organisation is lifted and its auto-renew switched off, so the next person finds the kitchen as the seed has it.
 */
export async function clearForOrgs(rt: Runtime, orgIds: string[], by: string, now = new Date()): Promise<{ lifted: number; autoOff: number }> {
  const s = await ready(rt);
  let lifted = 0;
  let autoOff = 0;
  for (const g of [...s.stages.values()].filter((x) => orgIds.includes(x.orgId) && !x.liftedAt)) {
    await liftStage(rt, g.stageId, by, now);
    lifted += 1;
  }
  for (const [key, a] of [...s.auto.entries()].filter(([, x]) => orgIds.includes(x.orgId) && x.on)) {
    const off: AutoRenew = { ...a, on: false, by, via: "test account reset", at: now.toISOString() };
    s.auto.set(key, off);
    await s.stores.auto.put(key, off);
    autoOff += 1;
  }
  for (const orgId of orgIds) s.cache.delete(orgId);
  if (lifted || autoOff) ledger(rt, { actor: "dock", summary: `Test account reset (${by}): ${lifted} staged condition${lifted === 1 ? "" : "s"} lifted and auto-renew switched off for ${autoOff} recurring order${autoOff === 1 ? "" : "s"}.`, data: { step: "reset", orgIds, lifted, autoOff, staged: lifted > 0 } });
  return { lifted, autoOff };
}

// ---------- operations ----------

/** The kitchens staff may stage conditions for (demo and visitor kitchens), with what each buys every week. */
export async function stageableKitchens(rt: Runtime): Promise<{ slug: string; name: string; kind: KitchenKind; standing: { family: string; productId: string; name: string; weekdays: number[] }[] }[]> {
  const out = [];
  for (const k of (await watchKitchens(rt)).filter(isStageable)) {
    const { patterns } = await patternsOf(rt, k.orgId);
    out.push({ slug: k.slug, name: k.name, kind: k.kind, standing: patterns.map((p) => ({ family: p.family, productId: p.product.productId, name: p.product.name, weekdays: p.slots.map((x) => x.weekday) })) });
  }
  return out;
}

export type WatchView = {
  stats: { findingsOpen: number; findings: number; decided: number; placedAlone: number; sentForSignOff: number; held: number; skipped: number; autoRenewOn: number; staged: number; liveCalls: number };
  findings: Finding[];
  renewals: Renewal[];
  auto: (AutoRenew & { kitchenName?: string })[];
  stages: Stage[];
  runs: State["runs"];
  schedule: { minutes: number | null; reason?: string };
};

export async function watchView(rt: Runtime): Promise<WatchView> {
  const s = await ready(rt);
  const findings = [...s.findings.values()].sort((a, b) => b.at.localeCompare(a.at));
  const renewals = [...s.renewals.values()].sort((a, b) => b.at.localeCompare(a.at));
  const { scheduleInfo } = await import("./schedule");
  return {
    stats: {
      findingsOpen: findings.filter((f) => f.state === "open").length,
      findings: findings.length,
      decided: findings.filter((f) => f.state === "decided").length,
      placedAlone: renewals.filter((r) => r.outcome?.status === "committed").length + findings.filter((f) => f.decision?.action === "ordered_alone" || f.decision?.action === "switched").length,
      sentForSignOff: renewals.filter((r) => r.outcome?.status === "pending_approval").length + findings.filter((f) => f.decision?.action === "sent_for_sign_off").length,
      held: renewals.filter((r) => r.state === "held").length,
      skipped: renewals.filter((r) => r.state === "skipped").length,
      autoRenewOn: [...s.auto.values()].filter((a) => a.on).length,
      staged: [...s.stages.values()].filter((g) => !g.liftedAt).length,
      liveCalls: s.liveCalls,
    },
    findings: findings.slice(0, 100),
    renewals: renewals.slice(0, 100),
    // Staff read kitchens by name, not by organisation id.
    auto: await (async () => {
      const names = new Map<string, string>([...findings, ...renewals, ...s.stages.values()].map((x) => [x.orgId, x.kitchenName]));
      const missing = [...s.auto.values()].some((a) => !names.has(a.orgId));
      if (missing) for (const k of await (await import("../offers/service")).allKitchens(rt).catch(() => [])) names.set(k.orgId, k.name);
      return [...s.auto.values()].sort((a, b) => b.at.localeCompare(a.at)).map((a) => ({ ...a, ...(names.get(a.orgId) ? { kitchenName: names.get(a.orgId) } : {}) }));
    })(),
    stages: [...s.stages.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
    runs: s.runs,
    schedule: scheduleInfo(),
  };
}

/** One finding's signed availability claim, for staff to check. */
export async function findingClaim(rt: Runtime, findingId: string): Promise<string | undefined> {
  return (await ready(rt)).findings.get(findingId)?.claim?.token;
}

/** For tests: forget the watch's cached live answers (a test changes the stock). */
export function forgetLiveCache(rt: Runtime): void {
  stateOf(rt).cache.clear();
}

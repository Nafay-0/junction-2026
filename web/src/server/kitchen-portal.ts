import { attachConsoleContext, type ConsoleContext } from "./console-context";
import type { LiveOffer, LiveProblem, Product } from "@/core/catalog";
import type { IntakeView } from "@/core/intake";
import { addDaysIso, addStatedPreference, isoWeekday, kitchenView, localNow, primaryLine, withKitchenLock, type HistoryEntry, type KitchenProfile, type StatedPreference } from "@/core/kitchen";
import { SPEC_DIMENSIONS, dimensionLabel, type StructuredNeed } from "@/core/need";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { newId } from "@/core/util";
import { resolveKitchen } from "./console-kitchens";
import { localFetch } from "./local-transport";
import { STORE_PAGE_READ } from "./ops/onsite";
import { suspensions } from "./ops/suspensions";
import { getRuntime, type Runtime } from "./runtime";

/**
 * The kitchen portal's back end: what the shop's pages show about one kitchen, built from Dock's own records
 * (orders, ledger, intake sessions, kitchen memory). Everything a page CHANGES still goes through Dock's public
 * v1 API with the kitchen's mandate (agentCall), so the shop is one more client of the same gate.
 *
 * Reads here never touch the partner's live API. The two live paths (a product the buyer opens, and the
 * order cut-off of the kitchen's standing orders) go through POST /api/v1/availability: metered, capped and
 * written to the ledger like any agent's lookup.
 */

/** A resolved kitchen; `console` when a console route resolved it for a browser (server/authz.ts consoleKitchen). */
export type Kitchen = NonNullable<Awaited<ReturnType<typeof resolveKitchen>>> & { console?: ConsoleContext };

/** One call to Dock's public API as this kitchen's agent, in-process. */
export async function agentCall<T = unknown>(k: Kitchen, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { accept: "application/json", authorization: `Mandate ${k.mandateToken}`, "dock-agent-id": k.agentId };
  if (method === "POST") headers["content-type"] = "application/json";
  const forwarded = new Request(new URL(path, "http://dock.local"), { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  if (k.console) attachConsoleContext(forwarded, k.console);
  const res = await localFetch(forwarded);
  return { status: res.status, json: (await res.json()) as T };
}

async function sessionOf(rt: Runtime, k: Kitchen): Promise<AgentSession> {
  // The store's pages read the kitchen's own records; a suspended kitchen still sees them, with the suspension shown.
  return rt.dock.authenticate(k.mandateToken, k.agentId, STORE_PAGE_READ);
}

// ---------- requests the portal opens for itself ----------

/** Request texts the portal writes; the request history shows them as what they are. */
import { BASKET_PREFIX, BROWSE_TEXT } from "./portal-requests";
export { BASKET_PREFIX, BROWSE_TEXT };

// ---------- the overview ----------

export type PortalOrder = {
  orderId: string;
  requestId?: string;
  status: PublicOrder["status"] | "history";
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  deliveryDate: string;
  lines: { productId: string; name: string; quantity: number; packSize?: number; unit?: string; attributes?: string[]; unitPriceCents?: number; substituteFor?: string }[];
  /** Who let it through: the agent alone (within the mandate), a named person, or nobody yet. */
  authorised: { by: "agent" } | { by: "person"; name: string; role: string; method?: string; verified?: boolean; at?: string } | { by: "waiting"; name: string; role: string; approvalId: string; requestedAt: string } | { by: "nobody" } | { by: "before_dock" };
  reasons: string[];
  signed: boolean;
};

export type PortalRequest = {
  key: string; // requestId, or the order id for history orders that had no request
  requestId?: string;
  at: string;
  /** The buyer's own words; null for orders from the history the kitchen brought with it. */
  text: string | null;
  kind: "agent" | "basket" | "history";
  family?: string;
  state?: IntakeView["state"];
  need?: StructuredNeed;
  corrected: number;
  order?: PortalOrder;
};

export type Standing = {
  family: string;
  orders: number;
  weekdays: number[];
  usual: { amount: number; unit: string };
  lastAmount: number;
  product: { productId: string; name: string };
  attributes: string[];
  lastAt: string;
  nextDue?: string;
  drift: { amountPct: number | null; pricePct: number | null; warning: string | null };
};

export type WeekNumbers = {
  since: string;
  placedAlone: number;
  sentForSignOff: number;
  waiting: number;
  corrected: number;
  refused: number;
  /** Against the cheapest option offered and not chosen, summed over orders that had one. */
  versusAlternative: { orders: number; eurCents: number; co2Kg: number | null; co2Orders: number };
};

export type Overview = {
  now: string;
  today: string;
  memory: ReturnType<typeof kitchenView>;
  requests: PortalRequest[];
  orders: PortalOrder[];
  week: WeekNumbers;
  standing: Standing[];
  liveCalls: number;
  /** Set while the wholesaler's operations staff have stopped this kitchen's agent: it can do nothing until resumed. */
  suspension?: { scope: "agent" | "org"; since: string; reason: string; message: string };
};

function portalOrder(o: PublicOrder): PortalOrder {
  const a = o.approval;
  const authorised: PortalOrder["authorised"] =
    a?.status === "approved"
      ? { by: "person", name: a.approver.name, role: a.approver.role, method: a.signOff?.method, verified: a.signOff?.verified, at: a.decidedAt }
      : a?.status === "pending"
        ? { by: "waiting", name: a.approver.name, role: a.approver.role, approvalId: a.approvalId, requestedAt: a.requestedAt }
        : o.status === "committed"
          ? { by: "agent" }
          : { by: "nobody" };
  return {
    orderId: o.orderId,
    requestId: o.requestId,
    status: o.status,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deliveryDate: o.lines.map((l) => l.deliveryDate).sort().at(-1) ?? o.createdAt.slice(0, 10),
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, packSize: l.packSize, unit: l.unit, attributes: l.attributes, unitPriceCents: l.unitPriceCents, substituteFor: l.substituteFor?.name })),
    authorised,
    reasons: o.decision.reasons.filter((r) => !r.startsWith("Sent to ")),
    signed: !!o.confirmation,
  };
}

function historyOrder(h: HistoryEntry): PortalOrder {
  return {
    orderId: h.orderId,
    requestId: h.requestId,
    status: "history",
    totalCents: h.totalCents,
    createdAt: h.placedAt,
    updatedAt: h.placedAt,
    deliveryDate: h.deliveryDate,
    lines: h.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.packs, packSize: l.packSize, unit: l.unit, attributes: l.attributes, unitPriceCents: l.unitPriceCents })),
    authorised: { by: "before_dock" },
    reasons: [],
    signed: false,
  };
}

export async function overview(k: Kitchen): Promise<Overview> {
  const rt = await getRuntime();
  const { dock } = rt;
  const session = await sessionOf(rt, k);
  const now = new Date();
  const today = localNow(now).date;
  const memory = await dock.intake.kitchen(session);
  const profile = (await rt.kitchens.getProfile(k.info.orgId)) as KitchenProfile | undefined;

  const all = (await dock.listOrders({ orgId: k.info.orgId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const orders = all.map(portalOrder);
  const byRequest = new Map<string, PortalOrder>();
  for (const o of orders) if (o.requestId && !byRequest.has(o.requestId)) byRequest.set(o.requestId, o);

  const entries = dock.ledger.readonly();
  const actor = `agent:${k.agentId}`;
  const corrections = new Map<string, number>();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const correctedThisWeek = new Set<string>();
  for (const e of entries) {
    if (e.type !== "intake" || !e.requestId || e.data.step !== "correction") continue;
    corrections.set(e.requestId, (corrections.get(e.requestId) ?? 0) + 1);
    if (e.at >= weekAgo) correctedThisWeek.add(e.requestId);
  }

  const intakes = new Map<string, IntakeView>();
  const requests: PortalRequest[] = [];
  for (const e of entries) {
    if (e.type !== "request" || e.actor !== actor || !e.requestId) continue;
    const text = typeof e.data.text === "string" ? e.data.text : e.summary;
    if (text === BROWSE_TEXT) continue;
    const intake = await dock.intake.get(session, e.requestId).catch(() => undefined);
    if (intake) intakes.set(e.requestId, intake);
    const basket = text.startsWith(BASKET_PREFIX);
    requests.push({
      key: e.requestId,
      requestId: e.requestId,
      at: e.at,
      text,
      kind: basket ? "basket" : "agent",
      family: intake?.family,
      state: intake?.state,
      need: intake?.need,
      corrected: corrections.get(e.requestId) ?? 0,
      order: byRequest.get(e.requestId),
    });
  }
  const known = new Set(orders.map((o) => o.orderId));
  for (const h of profile?.history ?? []) {
    if (known.has(h.orderId)) continue;
    requests.push({ key: h.orderId, at: h.placedAt, text: null, kind: "history", family: h.family, corrected: 0, order: historyOrder(h) });
    orders.push(historyOrder(h));
  }
  requests.sort((a, b) => b.at.localeCompare(a.at));
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const stopped = suspensions(dock).find(k.agentId, k.info.orgId);
  const suspension = stopped && {
    scope: stopped.scope,
    since: stopped.at,
    reason: stopped.reason,
    message: `The wholesaler's operations staff stopped ${stopped.scope === "agent" ? "this kitchen's purchasing agent" : "every agent of this kitchen"}: "${stopped.reason}". It cannot look up prices, quote or order until they resume it; orders already waiting for sign-off stay with their signer.`,
  };
  return { ...(suspension ? { suspension } : {}), now: now.toISOString(), today, memory, requests, orders, week: weekNumbers(all, intakes, [...correctedThisWeek].filter((id) => requests.some((r) => r.requestId === id)).length, now), standing: standing(profile, today), liveCalls: dock.stats().liveCalls };
}

function weekNumbers(orders: PublicOrder[], intakes: Map<string, IntakeView>, corrected: number, now: Date): WeekNumbers {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const recent = orders.filter((o) => o.createdAt >= since);
  const vs = { orders: 0, eurCents: 0, co2Kg: 0 as number | null, co2Orders: 0 };
  for (const o of recent) {
    if (o.status !== "committed") continue;
    const i = intakes.get(o.requestId);
    const chosen = i?.options.find((c) => c.optionId === i.chosen?.optionId);
    const others = (i?.options ?? []).filter((c) => c.optionId !== chosen?.optionId);
    if (!chosen || others.length === 0) continue;
    const alt = [...others].sort((a, b) => a.totalCents - b.totalCents)[0];
    vs.orders += 1;
    vs.eurCents += alt.totalCents - chosen.totalCents;
    if (alt.co2.kg !== null && chosen.co2.kg !== null) {
      vs.co2Kg = (vs.co2Kg ?? 0) + (alt.co2.kg - chosen.co2.kg);
      vs.co2Orders += 1;
    }
  }
  if (vs.co2Orders === 0) vs.co2Kg = null;
  return {
    since,
    placedAlone: recent.filter((o) => o.status === "committed" && !o.approval).length,
    sentForSignOff: recent.filter((o) => !!o.approval).length,
    waiting: recent.filter((o) => o.status === "pending_approval").length,
    corrected,
    refused: recent.filter((o) => o.status === "rejected").length,
    versusAlternative: vs,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Repeated orders per product family, with their usual days and a warning when the last ones drifted from the usual. */
export function standing(profile: KitchenProfile | undefined, today: string): Standing[] {
  if (!profile) return [];
  const families = [...new Set(profile.history.map((h) => h.family))];
  const out: Standing[] = [];
  for (const family of families) {
    const hist = profile.history.filter((h) => h.family === family).sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    if (hist.length < 3) continue;
    const days = new Map<number, number>();
    for (const h of hist) {
      const d = isoWeekday(h.neededBy ?? h.deliveryDate);
      days.set(d, (days.get(d) ?? 0) + 1);
    }
    const weekdays = [...days.entries()].filter(([, n]) => n / hist.length >= 0.25).map(([d]) => d).sort();
    const last3 = hist.slice(-3);
    const before = hist.slice(0, -3);
    const base = median(before.map((h) => h.amount)) ?? median(hist.map((h) => h.amount))!;
    const recentAvg = last3.reduce((s, h) => s + h.amount, 0) / last3.length;
    const amountPct = before.length >= 3 && base > 0 ? Math.round(((recentAvg - base) / base) * 100) : null;
    const perUnit = (h: HistoryEntry) => (h.amount > 0 ? h.totalCents / h.amount : null);
    const basePrice = median(before.map(perUnit).filter((x): x is number => x !== null));
    const lastPrice = perUnit(hist.at(-1)!);
    const pricePct = basePrice && lastPrice ? Math.round(((lastPrice - basePrice) / basePrice) * 100) : null;
    const unit = hist.at(-1)!.unit;
    const warnings: string[] = [];
    if (amountPct !== null && Math.abs(amountPct) >= 10) warnings.push(`the last three orders average ${Math.round(recentAvg)} ${unit}, ${amountPct > 0 ? "up" : "down"} ${Math.abs(amountPct)} % on the usual ${base} ${unit}`);
    if (pricePct !== null && Math.abs(pricePct) >= 10) warnings.push(`the last price per ${unit} is ${pricePct > 0 ? "up" : "down"} ${Math.abs(pricePct)} % on the usual`);
    let nextDue: string | undefined;
    for (let i = 1; i <= 7 && weekdays.length; i++) {
      const d = addDaysIso(today, i);
      if (weekdays.includes(isoWeekday(d))) {
        nextDue = d;
        break;
      }
    }
    const main = primaryLine(hist.at(-1)!);
    out.push({
      family,
      orders: hist.length,
      weekdays,
      usual: { amount: base, unit },
      lastAmount: hist.at(-1)!.amount,
      product: { productId: main.productId, name: main.name },
      attributes: main.attributes,
      lastAt: hist.at(-1)!.placedAt,
      nextDue,
      drift: { amountPct, pricePct, warning: warnings.length ? `${warnings.join("; ")}.` : null },
    });
  }
  return out.sort((a, b) => b.orders - a.orders);
}

// ---------- live checks ----------

const g = globalThis as typeof globalThis & {
  __dockPortalBrowse?: Map<string, string>;
  __dockPortalCutoffs?: Map<string, { at: number; value: CutoffReply }>;
};

/** The portal's own request for live checks while browsing, one per kitchen and day, so each check is in the ledger. */
async function browseRequest(k: Kitchen): Promise<string> {
  g.__dockPortalBrowse ??= new Map();
  const key = `${k.info.slug}:${localNow(new Date()).date}`;
  const hit = g.__dockPortalBrowse.get(key);
  if (hit) return hit;
  const r = await agentCall<{ request?: { requestId: string }; error?: { message: string } }>(k, "POST", "/api/v1/requests", { text: BROWSE_TEXT });
  if (!r.json.request) throw new Error(r.json.error?.message ?? "AimoPilot did not open a request for the live checks.");
  g.__dockPortalBrowse.set(key, r.json.request.requestId);
  return r.json.request.requestId;
}

export const PORTAL_MAX_LIVE = 5;

export type LiveResult = { productId: string; offer?: LiveOffer; problems: LiveProblem[]; message: string };
export type LiveReply = { results: LiveResult[]; liveCallsSoFar: number; upstreamRequests: number | null; checkedAt: string };

/** Live price, availability and cut-off for a handful of products, through Dock's metered availability call. */
export async function liveCheck(k: Kitchen, productIds: string[]): Promise<LiveReply> {
  const ids = [...new Set(productIds)].slice(0, PORTAL_MAX_LIVE);
  const rt = await getRuntime();
  const before = rt.dock.stats().upstream?.httpRequests ?? null;
  let requestId = await browseRequest(k);
  type Reply = { offers?: LiveOffer[]; unavailable?: { productId: string; problems: LiveProblem[]; message: string }[]; liveCallsSoFar?: number; error?: { code: string; message: string } };
  let r = await agentCall<Reply>(k, "POST", "/api/v1/availability", { requestId, productIds: ids });
  if (r.status === 404) {
    g.__dockPortalBrowse?.clear(); // the server's store was reset: open a new browse request
    requestId = await browseRequest(k);
    r = await agentCall<Reply>(k, "POST", "/api/v1/availability", { requestId, productIds: ids });
  }
  if (!r.json.offers) throw Object.assign(new Error(r.json.error?.message ?? "The live check failed."), { status: r.status, code: r.json.error?.code });
  const offers = r.json.offers;
  const why = new Map((r.json.unavailable ?? []).map((u) => [u.productId, u]));
  const after = rt.dock.stats().upstream?.httpRequests ?? null;
  return {
    results: ids.map((id) => {
      const offer = offers.find((o) => o.productId === id);
      if (offer) return { productId: id, offer, problems: [], message: "" };
      const w = why.get(id);
      return { productId: id, problems: w?.problems ?? [], message: w?.message ?? "The wholesaler gave no offer for this product now." };
    }),
    liveCallsSoFar: r.json.liveCallsSoFar ?? rt.dock.stats().liveCalls,
    upstreamRequests: before !== null && after !== null ? after - before : null,
    checkedAt: new Date().toISOString(),
  };
}

export type CutoffReply = {
  items: { family: string; productId: string; name: string; match: "same" | "nearest"; result?: LiveResult }[];
  checkedAt: string;
  cached: boolean;
  liveCalls: number;
};

const CUTOFF_TTL_MS = 10 * 60_000;

/**
 * The order cut-off for each standing order's product: one live call for at most three products, kept ten
 * minutes, so opening Home again costs nothing. A product from the history that is no longer in the catalogue
 * is replaced by the nearest catalogue product with the same claims, and labelled as such.
 */
export async function standingCutoffs(k: Kitchen): Promise<CutoffReply> {
  g.__dockPortalCutoffs ??= new Map();
  const hit = g.__dockPortalCutoffs.get(k.info.slug);
  if (hit && Date.now() - hit.at < CUTOFF_TTL_MS) return { ...hit.value, cached: true, liveCalls: 0 };
  const rt = await getRuntime();
  const profile = await rt.kitchens.getProfile(k.info.orgId);
  const items: CutoffReply["items"] = [];
  for (const s of standing(profile, localNow(new Date()).date).slice(0, 3)) {
    const [same] = await rt.catalog.searchProducts({ ids: [s.product.productId], limit: 1 });
    if (same) {
      items.push({ family: s.family, productId: same.id, name: same.name, match: "same" });
      continue;
    }
    const claims = s.attributes.filter((a) => a === "lactose_free" || a === "organic" || a.startsWith("fat_"));
    let near: Product | undefined = (await rt.catalog.searchProducts({ category: s.family, attributes: claims, limit: 1 }))[0];
    near ??= (await rt.catalog.searchProducts({ category: s.family, limit: 1 }))[0];
    if (near) items.push({ family: s.family, productId: near.id, name: near.name, match: "nearest" });
  }
  let liveCalls = 0;
  if (items.length) {
    const live = await liveCheck(k, items.map((i) => i.productId));
    liveCalls = 1;
    for (const i of items) i.result = live.results.find((r) => r.productId === i.productId);
  }
  const value: CutoffReply = { items, checkedAt: new Date().toISOString(), cached: false, liveCalls };
  g.__dockPortalCutoffs.set(k.info.slug, { at: Date.now(), value });
  return value;
}

// ---------- the basket: the human path through the same gate ----------

export type BasketLine = { productId: string; packs: number };

/** Open a request for the basket and ask the wholesaler for a fixed price. Placing it is POST /api/v1/orders, as for the agent. */
export async function basketQuote(k: Kitchen, lines: BasketLine[], deliverBy?: string): Promise<{ status: number; json: unknown }> {
  const rt = await getRuntime();
  const products = await rt.catalog.searchProducts({ ids: lines.map((l) => l.productId), limit: 20 });
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const text = `${BASKET_PREFIX} ${lines.map((l) => `${l.packs} × ${name(l.productId)}`).join(", ")}`.slice(0, 2000);
  const req = await agentCall<{ request?: { requestId: string } }>(k, "POST", "/api/v1/requests", { text, ...(deliverBy ? { neededBy: deliverBy } : {}) });
  if (!req.json.request) return req;
  const requestId = req.json.request.requestId;
  const q = await agentCall<Record<string, unknown>>(k, "POST", "/api/v1/quotes", { requestId, lines: lines.map((l) => ({ productId: l.productId, quantity: l.packs })) });
  // The gate's mistake check runs on every order. Here the kitchen's own signed-in person is at the screen, so its
  // question is put to them with the price (basketPlace records the answer); to anyone else nothing is shown, and an
  // order the check flags goes to sign-off.
  const person = basketPerson(k);
  const quoteToken = typeof q.json.quoteToken === "string" ? q.json.quoteToken : undefined;
  const session = person && quoteToken ? await sessionOf(rt, k) : undefined;
  const concerns = session && quoteToken ? await rt.dock.orderConcerns(session, { requestId, quoteToken }).catch(() => []) : [];
  if (!session || !quoteToken || !concerns.length) return { status: q.status, json: { ...q.json, requestId } };
  // The gate's preview as it will decide once this person has confirmed what is asked: no sign-off announced that
  // their own answer removes.
  const policyPreview = await rt.dock.previewConfirmed(session, { requestId, quoteToken, keys: concerns.map((c) => c.key) });
  return { status: q.status, json: { ...q.json, requestId, policyPreview, concerns: concerns.map(({ key, message }) => ({ key, message })) } };
}

/** The kitchen's own signed-in person at this screen (not a phone signed in by the call code), if any. */
function basketPerson(k: Kitchen) {
  const p = k.console?.person;
  return p && !p.callOnly ? p : undefined;
}

/**
 * Send the basket's quoted order to the gate. `confirm` names the mistake check's concerns the person at the screen
 * saw and confirmed as intended: recorded as their verified confirmation (only for the kitchen's own signed-in
 * person; from anyone else it is ignored), so the gate does not send the order to sign-off for them.
 */
export async function basketPlace(k: Kitchen, input: { requestId: string; quoteToken: string; lines: { productId: string; quantity: number; unitPriceCents: number }[]; confirm?: string[] }): Promise<{ status: number; json: unknown }> {
  const rt = await getRuntime();
  const person = basketPerson(k);
  if (person && input.confirm?.length) {
    await rt.dock.confirmConcerns(await sessionOf(rt, k), { requestId: input.requestId, quoteToken: input.quoteToken, keys: input.confirm }, { channel: "portal_session", person: person.name });
  }
  return agentCall(k, "POST", "/api/v1/orders", { requestId: input.requestId, quoteToken: input.quoteToken, lines: input.lines });
}

// ---------- memory corrections ----------

export type MemoryChange =
  | { action: "forget"; preferenceId: string; by: string }
  | { action: "rule"; family: string; dimension: string; choice: string; by: string };

/** Forget a stated rule, or turn a learned habit (or its opposite) into a stated rule. Written to the ledger. */
export async function changeMemory(k: Kitchen, change: MemoryChange): Promise<ReturnType<typeof kitchenView>> {
  const rt = await getRuntime();
  // The kitchen's lock (core/kitchen.ts): a memory write or an order's history in between is not lost.
  return withKitchenLock(rt.kitchens, k.info.orgId, () => changeMemoryLocked(rt, k, change));
}

async function changeMemoryLocked(rt: Awaited<ReturnType<typeof getRuntime>>, k: Kitchen, change: MemoryChange): Promise<ReturnType<typeof kitchenView>> {
  const profile = (await rt.kitchens.getProfile(k.info.orgId)) ?? { orgId: k.info.orgId, name: k.info.name, deliveryWeekdays: [1, 2, 3, 4, 5], history: [], stated: [] };
  const actor = `buyer:${change.by}`;
  if (change.action === "forget") {
    const pref = profile.stated.find((p) => p.id === change.preferenceId);
    if (!pref) throw Object.assign(new Error("That rule is not in the kitchen's memory any more."), { status: 404 });
    await rt.kitchens.saveProfile({ ...profile, stated: profile.stated.filter((p) => p.id !== pref.id) });
    rt.dock.ledger.append({ type: "intake", actor, summary: `${change.by} removed a stated rule from the kitchen's memory: "${pref.text}" (stated by ${pref.statedBy}).`, data: { step: "memory", action: "forget", preference: pref } });
  } else {
    const dim = SPEC_DIMENSIONS.find((d) => d.id === change.dimension);
    if (!dim) throw Object.assign(new Error(`No such choice: ${change.dimension}.`), { status: 400 });
    const label = dimensionLabel(dim, change.choice);
    const pref: StatedPreference = {
      id: newId("pref"),
      kind: "dimension",
      family: change.family,
      dimension: dim.id,
      choice: change.choice,
      text: `For ${change.family.replaceAll("_", " ")}, ${dim.question.replace(/\?$/, "").toLowerCase()}: ${label}`,
      statedBy: change.by,
      statedAt: new Date().toISOString(),
    };
    await rt.kitchens.saveProfile(addStatedPreference(profile, pref));
    rt.dock.ledger.append({ type: "intake", actor, summary: `${change.by} stated a rule for the kitchen: "${pref.text}". It now constrains what the agent may offer.`, data: { step: "memory", action: "rule", preference: pref } });
  }
  const session = await sessionOf(rt, k);
  return rt.dock.intake.kitchen(session);
}

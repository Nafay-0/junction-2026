import { CompactSign } from "jose";
import { z } from "zod";
import {
  ApprovalProofSchema,
  checkLinkToken,
  describeSignOff,
  linkTokenVerifier,
  newApprovalToken,
  orderDigest,
  type Approval,
  type ApprovalNotifier,
  type ApprovalVerifier,
  type SignOff,
} from "./approval";
import type { EventPublisher } from "./events";
import { CatalogError, ProductQuerySchema, usableOffer, type LiveOffer, type LiveStatus, type MeteredCatalog, type Product } from "./catalog";
import { ClaimStore, availabilityClaimInput, issueClaim, originClaimInput, priceClaimInput, refOf, type IssuedClaim } from "./claims";
import { DockError, parse } from "./errors";
import { InMemoryIntakeRepository, createIntakeFlow, recordCommittedOrder, type IntakeRepository } from "./intake";
import { InMemoryKitchenRepository, localNow, type KitchenRepository } from "./kitchen";
import { SIGN_ALG, type KeyPair } from "./keys";
import type { Ledger, LedgerHead } from "./ledger";
import { LiveLookupAllowance, shareKeyOf } from "./live-allowance";
import { MAX_LIVE_IDS_PER_CALL } from "./catalog";
import { MandateError, verifyMandate, type Mandate, type TrustRegistry } from "./mandate";
import { SPLIT_WINDOW_HOURS, decidingRule, evaluatePolicy, type Decision, type OrderDraftLine, type RecentOrder } from "./policy";
import { QuoteError, QuoteRequestLineSchema, buildQuote, signQuote, verifyQuote, type Quote, type QuoteLine } from "./quote";
import { addDays, canonicalJson, formatEur, newId } from "./util";

/**
 * The order flow: request -> lookup -> quote -> policy decision -> (human approval) -> committed order.
 * Every step is written to the ledger. Transport-agnostic: the REST routes, a future MCP server and the
 * demo script all call these functions. Inputs are validated here with zod, so every caller gets the same checks.
 */

// ---------- errors ----------

// DockError lives in errors.ts so the intake modules can use it without an import cycle.
export { DockError };

// ---------- inputs ----------

export const OpenRequestInput = z.object({
  text: z.string().min(1).max(2000), // the buyer's need in their own words
  neededBy: z.iso.date().optional(),
  /** Products the buyer asked for by id. Product ids written in `text` count too (when they exist in the catalogue). */
  productIds: z.array(z.string().min(1).max(60)).max(20).optional(),
  /** The product family asked for, when known (the intake sets it). */
  category: z.string().min(1).max(60).optional(),
});
export const SearchInput = ProductQuerySchema.omit({ ids: true }).extend({ requestId: z.string().min(1) });
export const AvailabilityInput = z.object({
  requestId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1),
  /** Delivery date to ask about. Default: the request's need-by date, else the earliest possible. */
  deliveryDate: z.iso.date().optional(),
  /** Also return the signed claims (price, availability, origin) as compact JWS tokens. Their ids are always on each offer. */
  includeClaims: z.boolean().optional(),
});
/**
 * Lines one quote may hold: a wholesale basket (a week's menu) has dozens. The money rules (per-order limit, weekly
 * budget, order splitting) are what protect the buyer, not a line count; the live lookup for a long quote is made
 * in calls of MAX_LIVE_IDS_PER_CALL, each counted against the agent's allowance.
 */
export const MAX_QUOTE_LINES = 60;
export const QuoteInput = z.object({ requestId: z.string().min(1), lines: z.array(QuoteRequestLineSchema).min(1).max(MAX_QUOTE_LINES) });
export const PlaceOrderInput = z.object({
  requestId: z.string().min(1),
  quoteToken: z.string().min(1),
  lines: z.array(z.object({ productId: z.string(), quantity: z.number(), unitPriceCents: z.number() })),
});
export const ChangeNeededByInput = z.object({
  /** The new need-by date (Helsinki day), or null for "the earliest possible". */
  neededBy: z.iso.date().nullable(),
  /** Who asked for it, as relayed by the agent. */
  by: z.string().min(1).max(120).optional(),
  /** Why, in a few words; written to the ledger. */
  reason: z.string().max(300).optional(),
});
export const WithdrawInput = z.object({
  /** Why, in the buyer's words; written to the ledger. */
  reason: z.string().max(300).optional(),
  /** Who asked for it, as relayed by the agent (recorded as relayed, not verified). */
  by: z.string().min(1).max(120).optional(),
});
export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approve", "decline"]),
  proof: ApprovalProofSchema,
  note: z.string().max(500).optional(),
});

// ---------- records ----------

/**
 * `share`: an on-site console's browser session, set by the server only (never from a header an outside caller can
 * send). It gives that session its own share of the agent's live-lookup allowance (see live-allowance.ts).
 */
export type AgentSession = { mandate: Mandate; agentId: string; share?: string };

export type PurchaseRequest = {
  requestId: string;
  orgId: string;
  agentId: string;
  mandateId: string;
  text: string;
  neededBy?: string;
  /**
   * What the buyer asked for, as Dock read it (never what the agent declares at quote time): products named by id
   * (in the request's fields or its text) and the family. The gate treats any other product as a substitute of it.
   */
  asked?: { productIds: string[]; category?: string };
  createdAt: string;
};

/**
 * pending_approval: waiting for a person, holding its total against the weekly budget until its quote expires.
 * withdrawn: the buyer took it back before anyone signed. expired: its fixed price ran out before anyone signed.
 */
export type OrderStatus = "pending_approval" | "committed" | "rejected" | "declined" | "withdrawn" | "expired";

export type Order = {
  orderId: string;
  requestId: string;
  orgId: string;
  orgName: string;
  agentId: string;
  mandateId: string;
  quoteId: string;
  status: OrderStatus;
  lines: QuoteLine[];
  totalCents: number;
  decision: Decision;
  /** Things the intake carried to the person signing off instead of asking the buyer first (see intake.ts). */
  notes?: string[];
  approval?: Approval;
  /** Compact JWS signed by the wholesaler once the order is committed. */
  confirmation?: string;
  createdAt: string;
  updatedAt: string;
  // kept for the re-check at sign-off
  quote: Quote;
  draftLines: OrderDraftLine[];
  mandate: Mandate;
};

/** What leaves Dock: no token hash, no internal snapshots. */
export type PublicOrder = Omit<Order, "approval" | "quote" | "draftLines" | "mandate"> & {
  approval?: Omit<Approval, "tokenHash">;
};

export type PendingApproval = {
  approvalId: string;
  orderId: string;
  orgName: string;
  agentId: string;
  approver: Approval["approver"];
  totalCents: number;
  reasons: string[];
  lines: { productId: string; name: string; quantity: number; substituteFor?: string }[];
  requestedAt: string;
};

export type ApprovalContext = {
  order: PublicOrder;
  approval: Omit<Approval, "tokenHash">;
  orderDigest: string;
  request?: { text: string; neededBy?: string };
  quoteExpiresAt: string;
  mandate: Mandate;
};

export function toPublicOrder(o: Order): PublicOrder {
  const { approval, quote: _q, draftLines: _d, mandate: _m, ...rest } = o;
  void _q;
  void _d;
  void _m;
  if (!approval) return structuredClone(rest);
  const { tokenHash: _t, ...publicApproval } = approval;
  void _t;
  return structuredClone({ ...rest, approval: publicApproval });
}

// ---------- storage ----------

/** Async on purpose, so a database can replace the in-memory version without touching callers. */
export interface DockRepository {
  saveRequest(r: PurchaseRequest): Promise<void>;
  getRequest(id: string): Promise<PurchaseRequest | undefined>;
  saveOrder(o: Order): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrderByApprovalId(approvalId: string): Promise<Order | undefined>;
  listOrders(): Promise<Order[]>;
  /** Atomically mark a quote as used. Returns false if it already was. */
  claimQuote(quoteId: string): Promise<boolean>;
  isQuoteUsed(quoteId: string): Promise<boolean>;
}

export class InMemoryDockRepository implements DockRepository {
  private requests = new Map<string, PurchaseRequest>();
  private orders = new Map<string, Order>();
  private usedQuotes = new Set<string>();

  async saveRequest(r: PurchaseRequest) {
    this.requests.set(r.requestId, structuredClone(r));
  }
  async getRequest(id: string) {
    const r = this.requests.get(id);
    return r && structuredClone(r);
  }
  async saveOrder(o: Order) {
    this.orders.set(o.orderId, structuredClone(o));
  }
  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o && structuredClone(o);
  }
  async getOrderByApprovalId(approvalId: string) {
    const o = [...this.orders.values()].find((x) => x.approval?.approvalId === approvalId);
    return o && structuredClone(o);
  }
  async listOrders() {
    return structuredClone([...this.orders.values()]);
  }
  async claimQuote(quoteId: string) {
    if (this.usedQuotes.has(quoteId)) return false;
    this.usedQuotes.add(quoteId);
    return true;
  }
  async isQuoteUsed(quoteId: string) {
    return this.usedQuotes.has(quoteId);
  }
}

// ---------- the flow ----------

export type DockDeps = {
  catalog: MeteredCatalog;
  repo: DockRepository;
  ledger: Ledger;
  trustedIssuers: TrustRegistry; // buyer organisations' mandate keys
  wholesalerKey: KeyPair; // signs quotes and order confirmations
  notifier: ApprovalNotifier;
  verifier?: ApprovalVerifier; // passkeys: PasskeyService.verifier (see passkeys.ts); default accepts link tokens only
  events?: EventPublisher; // live updates for the approver's phone and the big screen
  now?: () => Date;
  quoteTtlMinutes?: number;
  kitchens?: KitchenRepository; // kitchen memory: order history and preferences (see kitchen.ts)
  intakes?: IntakeRepository; // structured-need intake sessions (see intake.ts)
  liveAllowance?: LiveLookupAllowance; // per-agent hourly allowance of live lookups (see live-allowance.ts)
  /** How long a live answer (per product and delivery date) is reused for option cards. Quotes always ask afresh. Default 120 s; 0 switches it off. */
  liveCacheTtlMs?: number;
  claims?: ClaimStore; // signed claims handed out (see claims.ts)
};

/** What one live lookup found: quotable offers (with claim ids), the products that have none and why, and the claims. */
export type LiveLookupResult = {
  offers: LiveOffer[];
  statuses: LiveStatus[];
  unavailable: { productId: string; problems: LiveStatus["problems"]; message: string }[];
  claims: IssuedClaim[];
};

/** One line about an offer for people: never prints a placeholder amount as stock. */
export function describeOffer(o: LiveOffer): string {
  const stock = o.stockKnown === false ? "stock not reported" : `${o.availablePacks} ${o.salesUnit ?? "packs"} in stock`;
  return `${o.productId} ${stock} at ${formatEur(o.unitPriceCents)}/${o.salesUnit ?? "pack"}, delivery ${o.deliveryDate}${o.orderBy ? ` if ordered by ${o.orderBy.slice(0, 16).replace("T", " ")}` : ""}${o.simulated ? " (simulated)" : ""}`;
}

export type Dock = ReturnType<typeof createDock>;

/** "3 x A, 2 x B" for the ledger; a long basket names its first 12 lines and counts the rest. */
function listLines(lines: { quantity: number; productId: string }[]): string {
  const shown = lines.slice(0, 12).map((l) => `${l.quantity} x ${l.productId}`).join(", ");
  return lines.length > 12 ? `${shown} and ${lines.length - 12} more line${lines.length - 12 > 1 ? "s" : ""} (${lines.length} in all)` : shown;
}

export const ORDER_TYP = "order+jws";

export function createDock(deps: DockDeps) {
  const { catalog, repo, ledger, trustedIssuers, wholesalerKey, notifier } = deps;
  const verifier = deps.verifier ?? linkTokenVerifier;
  const now = deps.now ?? (() => new Date());
  const quoteTtlMinutes = deps.quoteTtlMinutes ?? 30;
  const kitchens = deps.kitchens ?? new InMemoryKitchenRepository();
  const intakes = deps.intakes ?? new InMemoryIntakeRepository();
  const liveAllowance = deps.liveAllowance ?? new LiveLookupAllowance(undefined, now);
  const claimStore = deps.claims ?? new ClaimStore();
  const liveCacheTtlMs = deps.liveCacheTtlMs ?? 120_000;
  /** Live answers by product and delivery date, with when the partner gave them. Bounded; oldest dropped first. */
  const liveCache = new Map<string, { at: number; status: LiveStatus }>();
  const LIVE_CACHE_MAX = 5000;
  const agentActor = (s: AgentSession) => `agent:${s.agentId}`;
  const publish: EventPublisher["publish"] = (e) => {
    try {
      deps.events?.publish(e);
    } catch {
      // live updates are best effort; they never block an order
    }
  };

  // One order decision per organisation at a time, so budget and replay checks never race.
  const locks = new Map<string, Promise<unknown>>();
  function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn);
    locks.set(key, run.catch(() => undefined));
    return run;
  }

  /** Product ids the buyer asked for: the explicit list, plus ids written in the text that exist in the catalogue. */
  async function askedProducts(text: string, explicit: string[]): Promise<string[]> {
    // Only id-shaped tokens (letters and digits with a dash, or six or more digits), never a plain amount like "1000".
    const tokens = [...new Set(text.match(/\b(?:[A-Z]{1,5}-\d{2,8}|\d{6,10})\b/g) ?? [])].slice(0, 20);
    const ids = [...new Set([...explicit, ...tokens])];
    if (!ids.length) return [];
    const found = new Set((await catalog.searchProducts({ ids, limit: 100 })).map((p) => p.id));
    return ids.filter((id) => found.has(id) || explicit.includes(id));
  }

  /** Quote lines with substitutes as Dock reads them from the request (see requestQuote). */
  async function substitutesOf(request: PurchaseRequest, lines: z.output<typeof QuoteInput>["lines"]): Promise<z.output<typeof QuoteInput>["lines"]> {
    const asked = request.asked?.productIds ?? [];
    if (!asked.length) return lines;
    const products = await catalog.searchProducts({ ids: [...new Set([...asked, ...lines.map((l) => l.productId)])], limit: 100 });
    const byId = new Map(products.map((p) => [p.id, p]));
    const closest = (id: string) => {
      const p = byId.get(id);
      return asked.find((a) => byId.get(a)?.category === p?.category && byId.get(a)?.unit === p?.unit) ?? asked.find((a) => byId.get(a)?.category === p?.category) ?? asked[0];
    };
    return lines.map((l) => {
      if (asked.includes(l.productId)) return l.substituteFor && asked.includes(l.substituteFor) ? l : { ...l, substituteFor: undefined };
      return { ...l, substituteFor: l.substituteFor && asked.includes(l.substituteFor) ? l.substituteFor : closest(l.productId) };
    });
  }

  async function ownRequest(session: AgentSession, requestId: string): Promise<PurchaseRequest> {
    const r = await repo.getRequest(requestId);
    if (!r || r.orgId !== session.mandate.issuer.orgId || r.agentId !== session.agentId) {
      throw new DockError(404, "request_not_found", `No open request ${requestId} for this agent. Open one with POST /api/v1/requests.`);
    }
    return r;
  }

  /**
   * An order waiting for sign-off holds its total only while its fixed price does: once the quote expires nobody
   * can sign it any more (the re-check would refuse it), so it is closed as expired, logged, and stops holding money.
   */
  const expiring = new Set<string>();
  async function expireStale(orgId?: string): Promise<void> {
    const t = now().getTime();
    for (const o of await repo.listOrders()) {
      if ((orgId && o.orgId !== orgId) || o.status !== "pending_approval" || Date.parse(o.quote.expiresAt) > t || expiring.has(o.orderId)) continue;
      expiring.add(o.orderId);
      try {
        const at = now().toISOString();
        o.status = "expired";
        o.updatedAt = at;
        if (o.approval && o.approval.status === "pending") {
          o.approval.status = "expired";
          o.approval.decidedAt = at;
        }
        await repo.saveOrder(o);
        ledger.append({
          type: "approval",
          actor: "dock",
          requestId: o.requestId,
          orderId: o.orderId,
          summary: `Order ${o.orderId} (${formatEur(o.totalCents)}) expired unsigned: its quote's fixed price ran out at ${o.quote.expiresAt.slice(0, 16).replace("T", " ")} UTC before anyone signed. It no longer holds the weekly budget; ask for a new quote to order again.`,
          data: { approvalId: o.approval?.approvalId, decision: "expired", quoteExpiresAt: o.quote.expiresAt },
        });
        publish({ type: "approval_expired", at, orgId: o.orgId, orderId: o.orderId, approvalId: o.approval?.approvalId, totalCents: o.totalCents, summary: `${o.orgName}: the ${formatEur(o.totalCents)} order waiting for sign-off expired unsigned (its price ran out).` });
      } finally {
        expiring.delete(o.orderId);
      }
    }
  }

  /** The organisation's spend over the last 7 days: committed, and held by orders still waiting for sign-off. */
  async function budgetUse(orgId: string, excludeOrderId?: string): Promise<{ spentCents: number; heldCents: number; held: { orderId: string; totalCents: number; expiresAt: string }[] }> {
    await expireStale(orgId);
    const since = addDays(now(), -7).getTime();
    const t = now().getTime();
    const recent = (await repo.listOrders()).filter((o) => o.orgId === orgId && o.orderId !== excludeOrderId && Date.parse(o.createdAt) > since);
    const committed = recent.filter((o) => o.status === "committed");
    const held = recent.filter((o) => o.status === "pending_approval" && Date.parse(o.quote.expiresAt) > t);
    const sum = (xs: Order[]) => xs.reduce((s, o) => s + o.totalCents, 0);
    return { spentCents: sum(committed) + sum(held), heldCents: sum(held), held: held.map((o) => ({ orderId: o.orderId, totalCents: o.totalCents, expiresAt: o.quote.expiresAt })) };
  }

  async function spentThisWeek(orgId: string, excludeOrderId?: string): Promise<number> {
    return (await budgetUse(orgId, excludeOrderId)).spentCents;
  }

  async function budgetContext(orgId: string, excludeOrderId?: string) {
    const b = await budgetUse(orgId, excludeOrderId);
    return { spentThisWeekCents: b.spentCents, heldThisWeekCents: b.heldCents, heldOrders: b.held };
  }

  /** Confirmations of the request's intake that matter but were only relayed by the agent (policy human_confirmation). */
  async function unverifiedOf(requestId: string) {
    const u = (await intakes.get(requestId))?.unverified ?? [];
    return u.length ? { unverifiedConfirmations: u.map(({ code, message, by }) => ({ code, message, by })) } : {};
  }

  /** Orders of this organisation in the splitting window, for the order_splitting rule. */
  async function recentOrders(orgId: string, excludeOrderId?: string): Promise<RecentOrder[]> {
    const since = now().getTime() - SPLIT_WINDOW_HOURS * 3600_000;
    return (await repo.listOrders())
      .filter((o) => o.orgId === orgId && o.orderId !== excludeOrderId && Date.parse(o.createdAt) > since)
      .filter((o) => o.status === "committed" || o.status === "pending_approval")
      .map((o) => ({
        orderId: o.orderId,
        requestId: o.requestId,
        placedAt: o.createdAt,
        totalCents: o.totalCents,
        categories: [...new Set(o.lines.map((l) => l.category))],
        deliveryDates: [...new Set(o.lines.map((l) => l.deliveryDate))],
        authorisedBy: o.status === "pending_approval" ? "pending" : o.approval ? "approver" : "mandate",
      }));
  }

  /**
   * The one way Dock asks the partner's live API: counted against the agent's hourly allowance, for the request's
   * delivery date, with every statement signed as a claim and every problem named. A failure of the partner's
   * service is reported as that (503, retry), not as a refusal by a rule.
   */
  async function liveLookup(
    session: AgentSession,
    requestId: string,
    productIds: string[],
    deliveryDate: string | undefined,
    why: string,
    opts: { fresh?: boolean; batch?: boolean } = {},
  ): Promise<LiveLookupResult> {
    const actor = agentActor(session);
    const ids = [...new Set(productIds)];
    const cacheKey = (id: string) => `${id}|${deliveryDate ?? ""}`;
    const t0 = now().getTime();
    // Answers the partner gave a moment ago are reused for option cards: they cost the partner nothing and are not
    // counted. A quote fixes a price, so it always asks afresh.
    const fromCache = new Map<string, { at: number; status: LiveStatus }>();
    if (!opts.fresh && liveCacheTtlMs > 0) {
      for (const id of ids) {
        const hit = liveCache.get(cacheKey(id));
        if (hit && t0 - hit.at < liveCacheTtlMs) fromCache.set(id, hit);
      }
    }
    const missing = ids.filter((id) => !fromCache.has(id));
    if (!opts.batch && ids.length > MAX_LIVE_IDS_PER_CALL) {
      // The per-call cap is on what the agent asks for, cached or not: a short list is a short list.
      throw refuse(new DockError(400, "too_many_products", `At most ${MAX_LIVE_IDS_PER_CALL} products per live price/availability call; this asked for ${ids.length}. Shortlist first with a master-data search.`, "live_lookup_limit"), actor, { requestId });
    }
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_LIVE_IDS_PER_CALL) chunks.push(missing.slice(i, i + MAX_LIVE_IDS_PER_CALL));
    const shareKey = shareKeyOf(session.mandate.issuer.orgId, session.agentId, session.share);
    let statuses: LiveStatus[] = [];
    const fetchedAt = new Map<string, number>();
    for (const chunk of chunks) {
      try {
        liveAllowance.reserve(shareKey, chunk);
      } catch (err) {
        if (err instanceof DockError) throw refuse(err, actor, { requestId });
        throw err;
      }
      let got: LiveStatus[];
      try {
        got = await catalog.getLiveStatus(chunk, deliveryDate ? { deliveryDate } : undefined);
      } catch (err) {
        if (err instanceof CatalogError && err.code === "too_many_products") throw refuse(new DockError(400, err.code, err.message, "live_lookup_limit"), actor, { requestId });
        if (err instanceof CatalogError) {
          ledger.append({ type: "lookup", actor: "dock", requestId, summary: `The wholesaler's live price/availability service did not answer (${why}); nothing was looked up or refused.`, data: { source: "live", failed: true, code: err.code, productIds: ids } });
          throw new DockError(503, "live_unavailable", `${err.message} This is the wholesaler's service, not a rule: try again in a minute.`, undefined, { retryable: true });
        }
        throw err;
      }
      const at = now().getTime();
      for (const st of got) {
        fetchedAt.set(st.productId, at);
        if (liveCacheTtlMs > 0) {
          liveCache.delete(cacheKey(st.productId));
          liveCache.set(cacheKey(st.productId), { at, status: structuredClone(st) });
        }
      }
      while (liveCache.size > LIVE_CACHE_MAX) liveCache.delete(liveCache.keys().next().value!);
      statuses.push(...got);
    }
    const cached = [...fromCache.values()].map((h) => {
      const st = structuredClone(h.status);
      fetchedAt.set(st.productId, h.at);
      return st;
    });
    statuses = [...statuses, ...cached].sort((a, b) => ids.indexOf(a.productId) - ids.indexOf(b.productId));
    const at = now();
    const audience = session.mandate.issuer.orgId;
    const products = await catalog.searchProducts({ ids, limit: 100 });
    const claims: IssuedClaim[] = [];
    const sign = async (input: Parameters<typeof issueClaim>[0]) => {
      const c = await issueClaim(input, wholesalerKey);
      claimStore.put(c, input.audience);
      claims.push(c);
      return c.claimId;
    };
    const offers: LiveOffer[] = [];
    for (const st of statuses) {
      const product = products.find((p) => p.id === st.productId);
      const seen = new Date(fetchedAt.get(st.productId) ?? at.getTime()); // a cached answer is claimed as of when the partner gave it
      const origin = product ? await sign(originClaimInput(product, seen)) : undefined;
      if (st.offer) {
        st.offer.claims = { price: await sign(priceClaimInput(st.offer, seen, audience)), availability: await sign(availabilityClaimInput(st.offer, seen, audience)), origin };
      }
      const usable = usableOffer(st);
      if (usable) offers.push(usable);
    }
    const unavailable = statuses.filter((st) => !usableOffer(st)).map((st) => ({ productId: st.productId, problems: st.problems, message: st.message }));
    ledger.append({
      type: "lookup",
      actor,
      requestId,
      summary: `${why} for ${ids.length} product(s)${deliveryDate ? ` for delivery by ${deliveryDate}` : ""} (${chunks.length ? `${chunks.length} live call${chunks.length > 1 ? "s" : ""}, #${catalog.stats().liveCalls} so far` : "no live call"}${fromCache.size ? `; ${fromCache.size} answer${fromCache.size > 1 ? "s" : ""} reused from the last ${Math.round(liveCacheTtlMs / 1000)} s, not counted` : ""}): ${[...offers.map(describeOffer), ...unavailable.map((u) => `${u.productId} not quotable: ${u.problems.join(", ")}`)].join("; ")}. ${claims.length} signed claims issued.`,
      data: { source: "live", productIds: ids, deliveryDate, offers, unavailable, claimIds: claims.map((c) => c.claimId), liveCalls: chunks.length, cached: [...fromCache.keys()] },
    });
    return { offers, statuses, unavailable, claims };
  }

  function refuse(error: DockError, actor: string, extra: { requestId?: string; orderId?: string } = {}): DockError {
    ledger.append({
      type: "refusal",
      actor,
      ...extra,
      summary: `Refused: ${error.message}`,
      data: { code: error.code, rule: error.rule, status: error.status },
    });
    return error;
  }

  function decisionSummary(orderId: string, d: Decision, prefix = "Gate decision"): string {
    if (d.outcome === "auto_approve") return `${prefix} on order ${orderId}: approved within the mandate (${formatEur(d.totalCents)}).`;
    if (d.outcome === "needs_human_approval")
      return `${prefix} on order ${orderId}: needs sign-off from ${d.approver.name} (${d.approver.role}) for ${formatEur(d.totalCents)}.`;
    return `${prefix} on order ${orderId}: refused (${decidingRule(d)?.rule}).`;
  }

  function decisionData(d: Decision) {
    return {
      outcome: d.outcome,
      totalCents: d.totalCents,
      approver: d.outcome === "needs_human_approval" ? { role: d.approver.role, name: d.approver.name } : undefined,
      reasons: d.reasons,
      rules: d.rules.map((r) => ({ rule: r.rule, outcome: r.outcome })),
    };
  }

  type AuthorisedBy =
    | { kind: "mandate" }
    | {
        kind: "approver";
        role: string;
        name: string;
        signOff: { method: SignOff["method"]; verified: boolean; at: string; orderDigest: string; approverId?: string; credentialId?: string };
      };

  async function commit(order: Order, authorisedBy: AuthorisedBy) {
    const committedAt = now().toISOString();
    const ledgerHead: LedgerHead | null = ledger.head();
    const body = {
      orderId: order.orderId,
      quoteId: order.quoteId,
      requestId: order.requestId,
      buyerOrgId: order.orgId,
      agentId: order.agentId,
      mandateId: order.mandateId,
      currency: "EUR",
      lines: order.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        deliveryDate: l.deliveryDate,
        substituteFor: l.substituteFor?.productId,
      })),
      totalCents: order.totalCents,
      committedAt,
      authorisedBy,
      ledgerHead, // anchors the audit trail: a later cut-off of the ledger is detectable against this
    };
    order.confirmation = await new CompactSign(new TextEncoder().encode(canonicalJson(body)))
      .setProtectedHeader({ alg: SIGN_ALG, kid: wholesalerKey.kid, typ: ORDER_TYP })
      .sign(wholesalerKey.privateKey);
    order.status = "committed";
    order.updatedAt = committedAt;
    await repo.saveOrder(order);
    await recordCommittedOrder({ kitchens, intakes }, order, (await repo.getRequest(order.requestId))?.neededBy);
    ledger.append({
      type: "order",
      actor: "dock",
      requestId: order.requestId,
      orderId: order.orderId,
      summary: `Committed order ${order.orderId} at the quoted ${formatEur(order.totalCents)}; the wholesaler signed the confirmation.`,
      data: { authorisedBy, ledgerHead },
    });
    publish({
      type: "order_committed",
      at: committedAt,
      orgId: order.orgId,
      orderId: order.orderId,
      approvalId: order.approval?.approvalId,
      totalCents: order.totalCents,
      summary:
        authorisedBy.kind === "mandate"
          ? `${order.orgName}: order placed by the agent within its mandate, ${formatEur(order.totalCents)}.`
          : `${order.orgName}: order placed, ${formatEur(order.totalCents)}, signed by ${authorisedBy.name}${authorisedBy.signOff.verified ? "" : " (UNVERIFIED demo tap)"}.`,
    });
  }

  const dock = {
    /** Verify the mandate the agent presents. Throws DockError (401/403) naming the failed check. */
    async authenticate(mandateToken: string | undefined, agentId: string | undefined): Promise<AgentSession> {
      const actor = `agent:${agentId ?? "unknown"}`;
      if (!mandateToken) throw refuse(new DockError(401, "mandate_missing", "No mandate presented. Send it as `Authorization: Mandate <jws>`.", "mandate_signature"), actor);
      let mandate: Mandate;
      try {
        mandate = await verifyMandate(mandateToken, trustedIssuers, now());
      } catch (err) {
        if (!(err instanceof MandateError)) throw err;
        const rule = err.code === "mandate_expired" || err.code === "mandate_not_yet_valid" ? "mandate_window" : "mandate_signature";
        throw refuse(new DockError(401, err.code, err.message, rule), actor);
      }
      if (!agentId) throw refuse(new DockError(401, "agent_id_missing", "No agent id presented. Send it as `Dock-Agent-Id`.", "mandate_agent"), actor);
      // AGENT-KEY SEAM: today the agent id is a claim. Bind it with proof of possession (a `cnf` key in the mandate
      // and a signed request) when real agents connect.
      if (agentId !== mandate.agentId) {
        throw refuse(new DockError(403, "mandate_agent_mismatch", `This mandate is for agent ${mandate.agentId}, not ${agentId}.`, "mandate_agent"), actor);
      }
      return { mandate, agentId };
    },

    async openRequest(session: AgentSession, input: z.input<typeof OpenRequestInput>): Promise<PurchaseRequest> {
      const { text, neededBy, productIds, category } = parse(OpenRequestInput, input);
      const named = await askedProducts(text, productIds ?? []);
      const r: PurchaseRequest = {
        requestId: newId("req"),
        orgId: session.mandate.issuer.orgId,
        agentId: session.agentId,
        mandateId: session.mandate.mandateId,
        text,
        neededBy,
        ...(named.length || category ? { asked: { productIds: named, ...(category ? { category } : {}) } } : {}),
        createdAt: now().toISOString(),
      };
      await repo.saveRequest(r);
      ledger.append({
        type: "request",
        actor: agentActor(session),
        requestId: r.requestId,
        summary: `Agent ${session.agentId} of ${session.mandate.issuer.name} opened a request: "${text}"${neededBy ? `, needed by ${neededBy}` : ""}.`,
        data: { text, neededBy, mandateId: r.mandateId, ...(r.asked ? { asked: r.asked } : {}) },
      });
      return r;
    },

    /**
     * Move a request's need-by date (the buyer chose a later day, the chef changed the service day). The gate's
     * delivery check and every later live lookup follow it. Not once an order for the request waits or is
     * committed: that order was decided against the old date. A date before today is refused.
     */
    async changeNeededBy(session: AgentSession, requestId: string, input: z.input<typeof ChangeNeededByInput>): Promise<PurchaseRequest> {
      const { neededBy, by, reason } = parse(ChangeNeededByInput, input);
      const r = await ownRequest(session, requestId);
      const was = r.neededBy ?? null;
      if (was === neededBy) return r;
      const today = localNow(now()).date;
      if (neededBy && neededBy < today) throw new DockError(400, "needed_by_in_past", `${neededBy} is before today (${today}).`, "delivery_deadline");
      const placed = (await repo.listOrders()).find((o) => o.requestId === requestId && (o.status === "pending_approval" || o.status === "committed"));
      if (placed) throw new DockError(409, "request_has_order", `Order ${placed.orderId} for request ${requestId} is ${placed.status.replace("_", " ")}; it was decided against ${was ?? "the earliest date"}. Open a new request for another date.`, "intake_sequence", { orderId: placed.orderId });
      const next: PurchaseRequest = { ...r, neededBy: neededBy ?? undefined };
      await repo.saveRequest(next);
      ledger.append({
        type: "intake",
        actor: agentActor(session),
        requestId,
        summary: `The need-by date of request ${requestId} changed from ${was ?? "the earliest possible"} to ${neededBy ?? "the earliest possible"}${by ? `, for ${by} (relayed by the agent)` : ""}${reason ? `: ${reason}` : ""}.`,
        data: { step: "needed_by", from: was, to: neededBy, ...(by ? { by } : {}), ...(reason ? { reason } : {}) },
      });
      return next;
    },

    /** Master-data search. Local, cheap, does not touch the live price/availability API. */
    async searchProducts(session: AgentSession, input: z.input<typeof SearchInput>): Promise<Product[]> {
      const { requestId, ...query } = parse(SearchInput, input);
      await ownRequest(session, requestId);
      const products = await catalog.searchProducts(query);
      const filters = [query.text && `"${query.text}"`, query.category && `category ${query.category}`, query.attributes?.length && query.attributes.join(", ")]
        .filter(Boolean)
        .join(", ");
      ledger.append({
        type: "lookup",
        actor: agentActor(session),
        requestId,
        summary: `Agent searched product master data (${filters || "no filters"}): ${products.length} products. No live API call.`,
        data: { source: "master_data", query, resultIds: products.map((p) => p.id) },
      });
      return products;
    },

    /** Live price and availability for a short list. This is the partner's API; it is metered and capped. */
    async checkAvailability(session: AgentSession, input: z.input<typeof AvailabilityInput>): Promise<LiveOffer[]> {
      return (await dock.lookupAvailability(session, input)).offers;
    },

    /**
     * checkAvailability with everything around it: the products that cannot be quoted and why (a passed order
     * cut-off, a sales block, no price), and, with includeClaims, the signed claims as tokens.
     */
    async lookupAvailability(session: AgentSession, input: z.input<typeof AvailabilityInput>): Promise<{ offers: LiveOffer[]; unavailable: LiveLookupResult["unavailable"]; claims?: IssuedClaim[] }> {
      const { requestId, productIds, deliveryDate, includeClaims } = parse(AvailabilityInput, input);
      const request = await ownRequest(session, requestId);
      const r = await liveLookup(session, requestId, productIds, deliveryDate ?? request.neededBy, "Agent checked live price and availability");
      return { offers: r.offers, unavailable: r.unavailable, ...(includeClaims ? { claims: r.claims } : {}) };
    },

    /** Signed claims Dock issued to this organisation, by id (the ids on offers and in a quote's evidence). */
    async getClaims(session: AgentSession, claimIds: string[]): Promise<IssuedClaim[]> {
      return claimStore.get(claimIds.slice(0, 100), session.mandate.issuer.orgId);
    },

    /** Ask the wholesaler for a fixed-price quote. Returns the signed quote and what the gate would decide on it now. */
    async requestQuote(session: AgentSession, input: z.input<typeof QuoteInput>) {
      const parsed = parse(QuoteInput, input);
      const { requestId } = parsed;
      const request = await ownRequest(session, requestId);
      // Dock decides what is a substitute, from what was asked: a line for any other product replaces the product
      // asked for, and its price is compared with that product's, whatever the agent declared.
      const lines = await substitutesOf(request, parsed.lines);
      const ids = [...new Set(lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])))];
      let quote: Quote;
      let claims: IssuedClaim[] = [];
      try {
        const products = await catalog.searchProducts({ ids, limit: 100 });
        const live = await liveLookup(session, requestId, ids, request.neededBy, "Dock asked live prices for a quote", { fresh: true, batch: true });
        const offers = live.offers;
        // Say why a line cannot be quoted, in the partner's terms (a passed cut-off, a sales block, no price).
        for (const l of lines) {
          const st = live.statuses.find((x) => x.productId === l.productId);
          if (st && !usableOffer(st) && products.some((p) => p.id === l.productId))
            throw new QuoteError("quote_no_offer", `${l.productId} cannot be quoted now: ${st.message}`, { productId: l.productId, problems: st.problems });
        }
        // The product a substitute replaces only lends its price for comparison: any priced status will do.
        const referenceOffers = live.statuses.map((x) => x.offer).filter((o): o is LiveOffer => !!o);
        const used = new Set(lines.map((l) => l.productId));
        const originals = new Set(lines.map((l) => l.substituteFor).filter((x): x is string => !!x));
        claims = live.claims.filter((c) => used.has(c.productId) || (originals.has(c.productId) && c.type === "price"));
        quote = buildQuote({
          quoteId: newId("qt"),
          buyerOrgId: session.mandate.issuer.orgId,
          agentId: session.agentId,
          mandateId: session.mandate.mandateId,
          requestId,
          lines,
          products,
          offers,
          referenceOffers,
          now: now(),
          ttlMinutes: quoteTtlMinutes,
          evidence: claims.map(refOf),
        });
      } catch (err) {
        if (err instanceof QuoteError) {
          const status = err.code === "quote_insufficient_stock" || err.code === "quote_no_offer" || err.code === "quote_source_expired" ? 409 : 400;
          throw refuse(new DockError(status, err.code, err.message, "quote_availability", err.details), agentActor(session), { requestId });
        }
        throw err;
      }
      const quoteToken = await signQuote(quote, wholesalerKey);
      const subs = quote.lines.filter((l) => l.substituteFor).length;
      ledger.append({
        type: "quote",
        actor: "dock",
        requestId,
        summary: `Wholesaler quoted ${quote.quoteId}: ${listLines(quote.lines)} for ${formatEur(quote.totalCents)}${subs ? ` (${subs} substitute${subs > 1 ? "s" : ""})` : ""}, price fixed until ${quote.expiresAt.slice(0, 16).replace("T", " ")} UTC${quote.expiresBecause === "order_cutoff" ? " (the order cut-off)" : quote.expiresBecause === "price_validity" ? " (when the price stops being valid)" : ""}; it rests on ${quote.evidence?.length ?? 0} signed claims.`,
        data: { quoteId: quote.quoteId, totalCents: quote.totalCents, expiresAt: quote.expiresAt, expiresBecause: quote.expiresBecause, evidence: quote.evidence, lines: quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate, substituteFor: l.substituteFor?.productId })) },
      });
      const policyPreview = evaluatePolicy(
        session.mandate,
        { agentId: session.agentId, quote, lines: quote.lines, neededBy: request.neededBy, requestId, asked: request.asked },
        { now: now(), ...(await budgetContext(quote.buyerOrgId)), ...(await unverifiedOf(requestId)), quoteAlreadyUsed: false, recentOrders: await recentOrders(quote.buyerOrgId) },
      );
      return { quote, quoteToken, policyPreview, claims };
    },

    /** Place an order against a signed quote. Always returns the decision; refused orders are kept with their reasons. */
    async placeOrder(session: AgentSession, input: z.input<typeof PlaceOrderInput>): Promise<PublicOrder> {
      const { requestId, quoteToken, lines } = parse(PlaceOrderInput, input);
      const request = await ownRequest(session, requestId);
      let quote: Quote;
      try {
        quote = await verifyQuote(quoteToken, wholesalerKey);
      } catch (err) {
        if (err instanceof QuoteError) throw refuse(new DockError(422, err.code, err.message, "quote_signature"), agentActor(session), { requestId });
        throw err;
      }
      const orgId = session.mandate.issuer.orgId;
      return serialize(orgId, async () => {
        const draft = { agentId: session.agentId, quote, lines, neededBy: request.neededBy, requestId, asked: request.asked };
        const ctx = { now: now(), ...(await budgetContext(orgId)), ...(await unverifiedOf(requestId)), quoteAlreadyUsed: await repo.isQuoteUsed(quote.quoteId), recentOrders: await recentOrders(orgId) };
        let decision = evaluatePolicy(session.mandate, draft, ctx);
        if (decision.outcome !== "reject" && !(await repo.claimQuote(quote.quoteId))) {
          decision = evaluatePolicy(session.mandate, draft, { ...ctx, quoteAlreadyUsed: true });
        }
        const at = now().toISOString();
        const order: Order = {
          orderId: newId("ord"),
          requestId,
          orgId,
          orgName: session.mandate.issuer.name,
          agentId: session.agentId,
          mandateId: session.mandate.mandateId,
          quoteId: quote.quoteId,
          status: decision.outcome === "reject" ? "rejected" : "pending_approval",
          lines: quote.lines,
          totalCents: quote.totalCents,
          decision,
          createdAt: at,
          updatedAt: at,
          quote,
          draftLines: lines,
          mandate: session.mandate,
        };
        const carried = (await intakes.get(requestId))?.signOffNotes ?? [];
        if (carried.length) order.notes = carried;
        ledger.append({
          type: "decision",
          actor: "dock",
          requestId,
          orderId: order.orderId,
          summary: decisionSummary(order.orderId, decision),
          data: decisionData(decision),
        });

        if (decision.outcome === "auto_approve") {
          await commit(order, { kind: "mandate" });
        } else if (decision.outcome === "needs_human_approval") {
          const { token, tokenHash } = newApprovalToken();
          order.approval = {
            approvalId: newId("apr"),
            approver: decision.approver,
            status: "pending",
            orderDigest: orderDigest(order),
            tokenHash,
            requestedAt: at,
          };
          await repo.saveOrder(order);
          await notifier.send({
            approvalId: order.approval.approvalId,
            orderId: order.orderId,
            approver: decision.approver,
            totalCents: order.totalCents,
            reasons: [...decision.reasons, ...(order.notes ?? [])],
            link: `/approve/${order.approval.approvalId}?token=${token}`,
            sentAt: at,
          });
          ledger.append({
            type: "approval_requested",
            actor: "dock",
            requestId,
            orderId: order.orderId,
            summary: `Asked ${decision.approver.name} (${decision.approver.role}) to sign off ${formatEur(order.totalCents)}; a one-time link went to them, not to the agent.`,
            data: { approvalId: order.approval.approvalId, role: decision.approver.role, orderDigest: order.approval.orderDigest },
          });
          publish({
            type: "approval_requested",
            at,
            orgId,
            orderId: order.orderId,
            approvalId: order.approval.approvalId,
            totalCents: order.totalCents,
            summary: `${order.orgName}: the agent needs ${decision.approver.name} to sign off ${formatEur(order.totalCents)}.`,
          });
        } else {
          await repo.saveOrder(order);
        }
        return toPublicOrder(order);
      });
    },

    /**
     * A human approves or declines. The proof is checked against the order's digest recomputed now, so it covers
     * exactly what is stored; the gate then re-checks the order (quote expiry, budget) before committing.
     */
    async decideApproval(approvalId: string, input: z.input<typeof ApprovalDecisionInput>): Promise<PublicOrder> {
      const { decision, proof, note } = parse(ApprovalDecisionInput, input);
      const found = await repo.getOrderByApprovalId(approvalId);
      if (!found?.approval) throw new DockError(404, "approval_not_found", `No approval ${approvalId}.`);
      await expireStale(found.orgId);
      return serialize(found.orgId, async () => {
        const order = (await repo.getOrder(found.orderId))!;
        const approval = order.approval!;
        const actor = `approver:${approval.approver.role}`;
        const ids = { requestId: order.requestId, orderId: order.orderId };
        const digest = orderDigest(order);
        if (digest !== approval.orderDigest) {
          throw refuse(
            new DockError(409, "approval_order_changed", "The order changed after sign-off was requested; nothing was approved.", "approver_identity", { expected: approval.orderDigest, actual: digest }),
            "dock",
            ids,
          );
        }
        const verified = await verifier.verify({ approval, orgId: order.orgId, orderDigest: digest, decision, now: now() }, proof);
        if (!verified.ok) {
          throw refuse(
            new DockError(403, "approval_proof_invalid", verified.message, "approver_identity", { reason: verified.reason, proof: proof.kind }),
            proof.kind === "link_token" ? "unknown" : actor,
            ids,
          );
        }
        if (approval.status !== "pending") {
          throw new DockError(409, "approval_not_pending", `Approval ${approvalId} was already ${approval.status}.`);
        }
        const signOff = verified.signOff;
        const at = now().toISOString();
        approval.status = decision === "approve" ? "approved" : "declined";
        approval.decidedAt = at;
        approval.note = note;
        approval.signOff = signOff;
        order.updatedAt = at;
        const lineText = order.lines.map((l) => `${l.quantity} x ${l.productId} at ${formatEur(l.unitPriceCents)}, delivery ${l.deliveryDate}`).join("; ");
        ledger.append({
          type: "approval",
          actor,
          ...ids,
          summary: `${approval.approver.name} (${approval.approver.role}) ${approval.status} order ${order.orderId}${note ? `: "${note}"` : ""}. ${describeSignOff(signOff, approval.approver)}; it covers exactly ${lineText}, total ${formatEur(order.totalCents)}.`,
          data: { approvalId, decision: approval.status, note, orderDigest: approval.orderDigest, signOff },
        });
        publish({
          type: decision === "approve" ? "approval_approved" : "approval_declined",
          at,
          orgId: order.orgId,
          orderId: order.orderId,
          approvalId,
          totalCents: order.totalCents,
          summary: `${order.orgName}: ${approval.approver.name} ${approval.status} ${formatEur(order.totalCents)}${signOff.verified ? "" : " (UNVERIFIED demo tap)"}.`,
        });
        if (decision === "decline") {
          order.status = "declined";
          await repo.saveOrder(order);
          return toPublicOrder(order);
        }
        const request = await repo.getRequest(order.requestId);
        const recheck = evaluatePolicy(
          order.mandate,
          { agentId: order.agentId, quote: order.quote, lines: order.draftLines, neededBy: request?.neededBy, requestId: order.requestId, asked: request?.asked },
          { now: now(), ...(await budgetContext(order.orgId, order.orderId)), ...(await unverifiedOf(order.requestId)), quoteAlreadyUsed: false, recentOrders: await recentOrders(order.orgId, order.orderId) },
        );
        if (recheck.outcome === "reject") {
          order.status = "rejected";
          order.decision = recheck;
          await repo.saveOrder(order);
          ledger.append({ type: "decision", actor: "dock", ...ids, summary: decisionSummary(order.orderId, recheck, "Re-check at sign-off"), data: decisionData(recheck) });
          publish({
            type: "order_rejected",
            at,
            orgId: order.orgId,
            orderId: order.orderId,
            approvalId,
            totalCents: order.totalCents,
            summary: `${order.orgName}: approved, but not placed: ${recheck.reasons[0] ?? "the re-check refused it"}`,
          });
          return toPublicOrder(order);
        }
        await commit(order, {
          kind: "approver",
          role: approval.approver.role,
          name: approval.approver.name,
          signOff: {
            method: signOff.method,
            verified: signOff.verified,
            at: signOff.at,
            orderDigest: signOff.orderDigest,
            approverId: "approverId" in signOff ? signOff.approverId : undefined,
            credentialId: signOff.method === "passkey" ? signOff.credentialId : undefined,
          },
        });
        return toPublicOrder(order);
      });
    },

    /** Everything a sign-off screen needs about one approval (no secrets). For the approver's phone, not for agents. */
    async approvalContext(approvalId: string): Promise<ApprovalContext> {
      const found = await repo.getOrderByApprovalId(approvalId);
      if (!found?.approval) throw new DockError(404, "approval_not_found", `No approval ${approvalId}.`);
      await expireStale(found.orgId);
      const o = (await repo.getOrderByApprovalId(approvalId))!;
      const request = await repo.getRequest(o.requestId);
      return {
        order: toPublicOrder(o),
        approval: toPublicOrder(o).approval!,
        orderDigest: orderDigest(o),
        request: request ? { text: request.text, neededBy: request.neededBy } : undefined,
        quoteExpiresAt: o.quote.expiresAt,
        mandate: structuredClone(o.mandate),
      };
    },

    async getOrder(session: AgentSession, orderId: string): Promise<PublicOrder> {
      await expireStale(session.mandate.issuer.orgId);
      const o = await repo.getOrder(orderId);
      if (!o || o.orgId !== session.mandate.issuer.orgId) throw new DockError(404, "order_not_found", `No order ${orderId} for this organisation.`);
      return toPublicOrder(o);
    },

    /** Every organisation's pending sign-offs. Callers decide who may see which (see server/authz.ts). */
    async listPendingApprovals(): Promise<PendingApproval[]> {
      await expireStale();
      return (await repo.listOrders())
        .filter((o) => o.status === "pending_approval" && o.approval?.status === "pending")
        .map((o) => ({
          approvalId: o.approval!.approvalId,
          orderId: o.orderId,
          orgName: o.orgName,
          agentId: o.agentId,
          approver: o.approval!.approver,
          totalCents: o.totalCents,
          reasons: [...o.decision.reasons, ...(o.notes ?? [])],
          lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, substituteFor: l.substituteFor?.productId })),
          requestedAt: o.approval!.requestedAt,
        }));
    },

    async listOrders(): Promise<PublicOrder[]> {
      await expireStale();
      return (await repo.listOrders()).map(toPublicOrder);
    },

    /**
     * The buyer takes back an order that waits for sign-off: it stops holding the weekly budget at once, the
     * approver's phone shows it as withdrawn, and the ledger says who asked (relayed by the agent). Only the
     * organisation's own pending orders; anything decided stays as it is.
     */
    async withdrawOrder(session: AgentSession, orderId: string, input: z.input<typeof WithdrawInput> = {}): Promise<PublicOrder> {
      const { reason, by } = parse(WithdrawInput, input ?? {});
      const orgId = session.mandate.issuer.orgId;
      const found = await repo.getOrder(orderId);
      if (!found || found.orgId !== orgId) throw new DockError(404, "order_not_found", `No order ${orderId} for this organisation.`);
      return serialize(orgId, async () => {
        await expireStale(orgId);
        const order = (await repo.getOrder(orderId))!;
        if (order.status !== "pending_approval") {
          throw refuse(new DockError(409, "order_not_pending", `Order ${orderId} is ${order.status}; only an order waiting for sign-off can be withdrawn.`, "intake_sequence", { status: order.status }), agentActor(session), { requestId: order.requestId, orderId });
        }
        const at = now().toISOString();
        order.status = "withdrawn";
        order.updatedAt = at;
        if (order.approval) {
          order.approval.status = "withdrawn";
          order.approval.decidedAt = at;
          order.approval.note = reason;
        }
        await repo.saveOrder(order);
        ledger.append({
          type: "approval",
          actor: agentActor(session),
          requestId: order.requestId,
          orderId,
          summary: `Order ${orderId} (${formatEur(order.totalCents)}) withdrawn before sign-off${by ? `, at the request of ${by} (relayed by the agent, not verified)` : " by the agent"}${reason ? `: "${reason}"` : ""}. It no longer holds the weekly budget.`,
          data: { approvalId: order.approval?.approvalId, decision: "withdrawn", reason, by, relayedBy: session.agentId },
        });
        publish({ type: "approval_withdrawn", at, orgId, orderId, approvalId: order.approval?.approvalId, totalCents: order.totalCents, summary: `${order.orgName}: the ${formatEur(order.totalCents)} order waiting for sign-off was withdrawn.` });
        return toPublicOrder(order);
      });
    },

    /** The organisation a request belongs to, for deciding who may read its ledger entries. */
    async orgOfRequest(requestId: string): Promise<string | undefined> {
      return (await repo.getRequest(requestId))?.orgId;
    },

    /** Does this one-time link token belong to this approval? (The link proves only who received the message.) */
    async approvalTokenMatches(approvalId: string, token: string): Promise<boolean> {
      const o = await repo.getOrderByApprovalId(approvalId);
      return !!o?.approval && checkLinkToken(o.approval, token);
    },

    /** Weekly spend of the agent's organisation: committed, and held by orders waiting for sign-off. */
    async budget(session: AgentSession) {
      const b = await budgetUse(session.mandate.issuer.orgId);
      return { budgetCents: session.mandate.weeklyBudgetCents, ...b, leftCents: session.mandate.weeklyBudgetCents - b.spentCents };
    },

    stats: () => catalog.stats(),
    /** The per-agent hourly allowance of live lookups, shared by every transport (REST, MCP, intake). */
    liveAllowance,
    ledger,
    wholesalerPublicJwk: wholesalerKey.publicJwk,
  };

  /**
   * A request that came through the intake cannot go around it: while a likely mistake waits for the buyer's
   * confirmation (or after the buyer cancelled), the lower-level quote and order calls refuse it. The intake
   * itself quotes through the unguarded function.
   */
  async function intakeGate(session: AgentSession, requestId: string) {
    const pending = await intakes.get(requestId);
    if (pending?.state === "needs_confirmation") {
      throw refuse(
        new DockError(409, "intake_needs_confirmation", `Request ${requestId} has a likely mistake waiting for the buyer: ${pending.concerns.map((c) => c.message).join(" ")} The buyer must confirm or correct it first.`, "human_input", { state: pending.state, concerns: pending.concerns.map((c) => c.key) }),
        agentActor(session),
        { requestId },
      );
    }
    if (pending?.state === "cancelled") throw refuse(new DockError(409, "intake_cancelled", `The buyer cancelled request ${requestId}.`, "intake_sequence", { state: pending.state }), agentActor(session), { requestId });
  }
  const guarded = {
    requestQuote: async (session: AgentSession, input: z.input<typeof QuoteInput>) => {
      await intakeGate(session, String((input as { requestId?: unknown }).requestId ?? ""));
      return dock.requestQuote(session, input);
    },
    placeOrder: async (session: AgentSession, input: z.input<typeof PlaceOrderInput>) => {
      await intakeGate(session, String((input as { requestId?: unknown }).requestId ?? ""));
      return dock.placeOrder(session, input);
    },
  };

  /** Buyer-side intake: structured need -> concerns -> questions -> option cards -> quote (see intake.ts). */
  const intake = createIntakeFlow({
    catalog,
    repo,
    kitchens,
    intakes,
    ledger,
    now,
    openRequest: dock.openRequest,
    changeNeededBy: dock.changeNeededBy,
    requestQuote: dock.requestQuote,
    liveLookup: (session, requestId, productIds, deliveryDate, why) => liveLookup(session, requestId, productIds, deliveryDate, why, { batch: true }),
    spentThisWeek: (orgId) => spentThisWeek(orgId),
    budgetUse: (orgId) => budgetUse(orgId),
  });
  return { ...dock, ...guarded, intake };
}

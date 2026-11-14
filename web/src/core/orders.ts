import type { SecondReadingRecord } from "./second-reading";
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
import type { AlternativesSource } from "./alternatives";
import type { EventPublisher } from "./events";
import { CatalogError, ProductQuerySchema, scheduledOn, usableOffer, type LiveOffer, type LiveStatus, type MeteredCatalog, type Product } from "./catalog";
import { signOffer, type OfferBody } from "./offers";
import { ClaimStore, availabilityClaimInput, cutoffMs, issueClaim, originClaimInput, priceClaimInput, refOf, type IssuedClaim } from "./claims";
import { DockError, isDockError, parse } from "./errors";
import { concernsOfOrder, unaskedNote, type OrderConcern } from "./order-check";
import { qualifiersOf, wordsNotCarried } from "./qualifiers";
import { InMemoryIntakeRepository, createIntakeFlow, isVerified, recordCommittedOrder, type HumanVia, type IntakeDeps, type IntakeRepository } from "./intake";
import { InMemoryKitchenRepository, localNow, updateKitchenProfile, type KitchenRepository } from "./kitchen";
import { SIGN_ALG, type KeyPair } from "./keys";
import type { Ledger, LedgerHead } from "./ledger";
import { LiveLookupAllowance, shareKeyOf } from "./live-allowance";
import { MAX_LIVE_IDS_PER_CALL } from "./catalog";
import { MandateError, supersededBy, supersededMessage, verifyMandateToken, type Mandate, type MandateRegister, type TrustRegistry, lacksRulesMessage, missingAddedRules } from "./mandate";
import { SPLIT_NAMED_MAX, SPLIT_WINDOW_HOURS, decidingRule, evaluatePolicy, type Decision, type OrderDraftLine, type ProductHold, type RecentOrder, type RuleResult, type SplitWindow } from "./policy";
export type { ProductHold } from "./policy";
import { QuoteError, QuoteRequestLineSchema, buildQuote, signQuote, verifyQuote, type Quote, type QuoteLine, type QuoteRequestLine } from "./quote";
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
  /** Exactly this day, not merely by it: every line is delivered that day (sets neededBy to the same day). */
  deliverOn: z.iso.date().optional(),
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
/** An order against a signed quote: the token and the lines exactly as quoted. */
export const SignedOrderInput = z.object({
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
  /** An exact delivery day ("on Monday"), when the request has one: moves with the need-by date. */
  deliverOn: z.iso.date().nullable().optional(),
});
/**
 * What an agent sends to place an order. After the intake quoted the request (choose_option, POST .../choice), the
 * requestId alone is enough: Dock places the quote it signed for that request, checked exactly as if the agent had
 * sent it, so no model has to copy a long token. After a lower-level quote, send quoteToken and lines unchanged.
 */
export const PlaceOrderInput = SignedOrderInput.extend({
  quoteToken: SignedOrderInput.shape.quoteToken.optional().describe("The quoteToken from POST /api/v1/quotes, unchanged. Leave it out after the intake's choice: Dock uses the quote it signed for this request."),
  lines: SignedOrderInput.shape.lines.optional().describe("Only with quoteToken: the quote's lines (productId, quantity, unitPriceCents) copied from quote.lines."),
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
export type AgentSession = { mandate: Mandate; agentId: string; share?: string; door?: Door; /** When the organisation signed the mandate (its token's `iat`), for the reissue check. */ mandateIssuedAt?: string };

/**
 * Which door a request came through, set by server code only (never from a request field): the store's typed field,
 * its assistant panel, a voice call, a photo, the menu planner, the store's hand-placed basket or other in-process
 * calls, an outside agent over MCP, a consumer assistant over a connector address, or plain REST. Every door ends in
 * the same intake, memory, alternatives, gate and ledger; this only says which one it used.
 */
export const DOORS = ["typed", "assistant", "voice", "photo", "menu", "store", "mcp", "connector", "rest"] as const;
export type Door = (typeof DOORS)[number];
export const DOOR_TEXT: Record<Door, string> = {
  typed: "typed in the kitchen store",
  assistant: "the store's assistant panel",
  voice: "a voice call",
  photo: "a photo or document",
  menu: "the menu planner",
  store: "the kitchen store",
  mcp: "an outside agent over MCP",
  connector: "a consumer assistant over the kitchen's connector address",
  rest: "an outside agent over REST",
};

export type PurchaseRequest = {
  requestId: string;
  orgId: string;
  agentId: string;
  mandateId: string;
  text: string;
  neededBy?: string;
  /** Delivered exactly on this day (then neededBy is the same day). */
  deliverOn?: string;
  /**
   * What the buyer asked for, as Dock read it (never what the agent declares at quote time): products named by id
   * (in the request's fields or its text) and the family. The gate treats any other product as a substitute of it.
   */
  asked?: { productIds: string[]; category?: string; /** Words that say what kind of product it is (core/qualifiers.ts), set by the intake: a line that does not carry them is a stand-in. */ words?: string[] };
  /**
   * What the gate's mistake check flagged in a quote of this request and an identified person confirmed as intended
   * (confirmConcerns below): by quote and concern, with who and through which channel. An order on that quote is
   * then not sent to sign-off for it. Only a channel bound to a person can write this (intake.ts isVerified).
   */
  confirmed?: { quoteId: string; key: string; code: string; by: string; at: string; channel: string }[];
  /** Which door it came through (server-set; see Door). */
  door?: Door;
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
  /** When the organisation signed that mandate: a reissue since then stops the order at sign-off. */
  mandateIssuedAt?: string;
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

/**
 * The order cut-off each quote promises (the earliest of its lines' order-by times), kept in this process only: a
 * committed order can be taken back until it (withdrawOrder with `takeBack`). Nothing here reaches a response, a
 * signature or the ledger; after a restart an order simply has no take-back, which errs on the safe side. On
 * globalThis: a bundler may load this module once per route, and the thread reads what the API side wrote.
 */
const quoteCutoffs: Map<string, string> = ((globalThis as typeof globalThis & { __dockQuoteCutoffs?: Map<string, string> }).__dockQuoteCutoffs ??= new Map());

/** Until when the kitchen may still take back this committed order, if the wholesaler's cut-off is known. */
export function takeBackUntil(o: Pick<Order, "quoteId" | "status">, at: Date = new Date()): string | undefined {
  if (o.status !== "committed") return undefined;
  const until = quoteCutoffs.get(o.quoteId);
  return until && Date.parse(until) > at.getTime() ? until : undefined;
}

export function toPublicOrder(o: Order): PublicOrder {
  return structuredClone(stripOrder(o));
}

/** toPublicOrder without the copy, for an order nobody else holds (a copy the store just handed out). */
function stripOrder(o: Order): PublicOrder {
  const { approval, quote: _q, draftLines: _d, mandate: _m, ...rest } = o;
  void _q;
  void _d;
  void _m;
  if (!approval) return rest;
  const { tokenHash: _t, ...publicApproval } = approval;
  void _t;
  return { ...rest, approval: publicApproval };
}

// ---------- storage ----------

/** The weekly-budget sums of one organisation (orders.ts budgetUse): committed spend, and the orders still holding money. */
export type OrderSpend = { committedCents: number; held: { orderId: string; totalCents: number; expiresAt: string }[] };

/** What a SplitWindow query asks: the window start, and what makes an earlier order related to this one. */
export type SplitQuery = { since: string; requestId: string; categories: string[]; excludeOrderId?: string; latest?: number };

/**
 * Async on purpose, so a database can replace the in-memory version without touching callers.
 *
 * The queries below exist so the gate never reads every stored order to decide one: each reads only one
 * organisation's orders in a time window, the few orders waiting for sign-off, or one request's orders, and the
 * budget and splitting checks get sums rather than lists (the in-memory store from its indexes, PostgreSQL in SQL).
 */
export interface DockRepository {
  saveRequest(r: PurchaseRequest): Promise<void>;
  getRequest(id: string): Promise<PurchaseRequest | undefined>;
  saveOrder(o: Order): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrderByApprovalId(approvalId: string): Promise<Order | undefined>;
  /** Every order, oldest first. For views and exports; the gate itself uses the queries below. */
  listOrders(): Promise<Order[]>;
  /** One organisation's orders, oldest first; with `since` (ISO), only those created after it. */
  ordersOf(orgId: string, since?: string): Promise<Order[]>;
  /** The orders placed for one request. */
  ordersOfRequest(requestId: string): Promise<Order[]>;
  /** Orders waiting for sign-off (status pending_approval), of one organisation or all, oldest first. */
  pendingOrders(orgId?: string): Promise<Order[]>;
  /** Orders waiting for sign-off whose quote expired at or before `at` (ISO), of one organisation or all. */
  pendingExpired(at: string, orgId?: string): Promise<Order[]>;
  /** How many orders wait for sign-off (the wall's count), without reading them. */
  pendingCount(): Promise<number>;
  /**
   * The weekly budget's sums over one organisation's orders created after `since`: the committed total, and the
   * orders waiting for sign-off whose quote is still valid at `at` (they hold their total).
   */
  spendOf(orgId: string, q: { since: string; at: string; excludeOrderId?: string }): Promise<OrderSpend>;
  /**
   * The order_splitting check's earlier orders (policy.ts splitCheck), counted and summed by the store: orders of the
   * organisation created after `since` that the agent placed alone (committed with no sign-off) for the same request
   * or a category in `categories`; and the latest `latest` (default 10) of them, newest first, to name.
   */
  splitWindow(orgId: string, q: SplitQuery): Promise<SplitWindow>;
  /** Atomically mark a quote as used. Returns false if it already was. */
  claimQuote(quoteId: string): Promise<boolean>;
  isQuoteUsed(quoteId: string): Promise<boolean>;
}

/** As the splitting check reads an order: placed by the agent alone or not, when, for what. */
export function recentOrderOf(o: Order): RecentOrder {
  return {
    orderId: o.orderId,
    requestId: o.requestId,
    placedAt: o.createdAt,
    totalCents: o.totalCents,
    categories: [...new Set(o.lines.map((l) => l.category))],
    deliveryDates: [...new Set(o.lines.map((l) => l.deliveryDate))],
    authorisedBy: o.status === "pending_approval" ? "pending" : o.approval ? "approver" : "mandate",
  };
}

/**
 * Orders and requests in memory, with the indexes the queries need: per organisation (by creation time), per
 * request, by approval id, and the set waiting for sign-off. What leaves is a copy; what the sums read is not
 * copied at all.
 */
export class InMemoryDockRepository implements DockRepository {
  private requests = new Map<string, PurchaseRequest>();
  private orders = new Map<string, Order>();
  private usedQuotes = new Set<string>();
  /** Order ids per organisation, sorted by createdAt (orders are created in time order, so this is an append). */
  private byOrg = new Map<string, string[]>();
  private byRequest = new Map<string, string[]>();
  private byApproval = new Map<string, string>();
  /** Orders waiting for sign-off, per organisation. */
  private pending = new Map<string, Set<string>>();

  async saveRequest(r: PurchaseRequest) {
    this.requests.set(r.requestId, structuredClone(r));
  }
  async getRequest(id: string) {
    const r = this.requests.get(id);
    return r && structuredClone(r);
  }
  async saveOrder(o: Order) {
    const copy = structuredClone(o);
    const before = this.orders.get(o.orderId);
    this.orders.set(o.orderId, copy);
    if (!before) {
      const ids = this.byOrg.get(o.orgId) ?? [];
      // binary insert by createdAt; almost always the end
      let lo = 0;
      let hi = ids.length;
      if (!ids.length || this.orders.get(ids[ids.length - 1])!.createdAt <= o.createdAt) lo = hi;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.orders.get(ids[mid])!.createdAt <= o.createdAt) lo = mid + 1;
        else hi = mid;
      }
      ids.splice(lo, 0, o.orderId);
      this.byOrg.set(o.orgId, ids);
      const r = this.byRequest.get(o.requestId);
      if (r) r.push(o.orderId);
      else this.byRequest.set(o.requestId, [o.orderId]);
    }
    if (o.approval) this.byApproval.set(o.approval.approvalId, o.orderId);
    const waiting = this.pending.get(o.orgId);
    if (o.status === "pending_approval") {
      if (waiting) waiting.add(o.orderId);
      else this.pending.set(o.orgId, new Set([o.orderId]));
    } else waiting?.delete(o.orderId);
  }
  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o && structuredClone(o);
  }
  async getOrderByApprovalId(approvalId: string) {
    const id = this.byApproval.get(approvalId);
    const o = id ? this.orders.get(id) : undefined;
    return o && structuredClone(o);
  }
  async listOrders() {
    return structuredClone([...this.orders.values()]);
  }
  async ordersOf(orgId: string, since?: string) {
    const ids = this.byOrg.get(orgId) ?? [];
    return structuredClone(ids.slice(since ? this.firstAfter(ids, since) : 0).map((id) => this.orders.get(id)!));
  }
  async ordersOfRequest(requestId: string) {
    return structuredClone((this.byRequest.get(requestId) ?? []).map((id) => this.orders.get(id)!));
  }
  async pendingOrders(orgId?: string) {
    return structuredClone(this.pendingRefs(orgId));
  }
  async pendingCount() {
    let n = 0;
    for (const ids of this.pending.values()) n += ids.size;
    return n;
  }
  async pendingExpired(at: string, orgId?: string) {
    const t = Date.parse(at);
    return structuredClone(this.pendingRefs(orgId).filter((o) => Date.parse(o.quote.expiresAt) <= t));
  }
  async spendOf(orgId: string, q: { since: string; at: string; excludeOrderId?: string }): Promise<OrderSpend> {
    const t = Date.parse(q.at);
    let committedCents = 0;
    const held: OrderSpend["held"] = [];
    for (const o of this.window(orgId, q.since)) {
      if (o.orderId === q.excludeOrderId) continue;
      if (o.status === "committed") committedCents += o.totalCents;
      else if (o.status === "pending_approval" && Date.parse(o.quote.expiresAt) > t) held.push({ orderId: o.orderId, totalCents: o.totalCents, expiresAt: o.quote.expiresAt });
    }
    return { committedCents, held };
  }
  async splitWindow(orgId: string, q: SplitQuery): Promise<SplitWindow> {
    const want = new Set(q.categories);
    const latest: RecentOrder[] = [];
    const max = q.latest ?? 10;
    let count = 0;
    let totalCents = 0;
    const w = this.window(orgId, q.since);
    for (let i = w.length - 1; i >= 0; i--) {
      const o = w[i];
      if (o.orderId === q.excludeOrderId || o.status !== "committed" || o.approval) continue;
      if (o.requestId !== q.requestId && !o.lines.some((l) => want.has(l.category))) continue;
      count++;
      totalCents += o.totalCents;
      if (latest.length < max) latest.push(recentOrderOf(o));
    }
    return { count, totalCents, latest };
  }
  async claimQuote(quoteId: string) {
    if (this.usedQuotes.has(quoteId)) return false;
    this.usedQuotes.add(quoteId);
    return true;
  }
  async isQuoteUsed(quoteId: string) {
    return this.usedQuotes.has(quoteId);
  }

  private pendingRefs(orgId?: string): Order[] {
    const out: Order[] = [];
    for (const [org, ids] of this.pending) if (!orgId || org === orgId) for (const id of ids) out.push(this.orders.get(id)!);
    return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
  /** The organisation's stored orders created after `since`, oldest first (references: never hand them out). */
  private window(orgId: string, since: string): Order[] {
    const ids = this.byOrg.get(orgId) ?? [];
    return ids.slice(this.firstAfter(ids, since)).map((id) => this.orders.get(id)!);
  }
  private firstAfter(ids: string[], since: string): number {
    const t = Date.parse(since);
    let lo = 0;
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(this.orders.get(ids[mid])!.createdAt) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
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
  /** The interpreter's second readings, for the intake (see second-reading.ts): only ever adds a question. */
  secondReadings?: (orgId: string, text: string | undefined) => SecondReadingRecord | undefined;
  /**
   * Products the wholesaler holds right now (a recall notice, a drill), checked by the gate as the rule recall_hold
   * on every quote preview, order and re-check at sign-off. The server's recall radar implements it.
   */
  holds?: ProductHolds;
  /** What can stand in for a product, by kitchen use (the server wires the product knowledge map; see alternatives.ts). */
  alternatives?: AlternativesSource;
  /** Ranked candidates from smart search (the server wires server/search; see catalog/finder.ts). The core's own rules still decide. */
  finder?: IntakeDeps["finder"];
  /** One line per remembered item an intake used (the server wires the kitchen memory; see intake.ts). */
  memoryUsage?: IntakeDeps["memoryUsage"];
  /**
   * Admission: called with every session right after its mandate verified, before the session is handed out, and
   * again for a session held across calls (admit below). Throwing a DockError refuses the agent. The server's
   * operations layer plugs in here (a suspended agent or organisation), so no door can verify a mandate and
   * forget to ask: there is no way to a session that does not pass this. It may return the session with tighter terms
   * (never wider: the gate still checks the signed quote and the order against whatever mandate the session carries). `entrance` is whatever the caller says
   * about where the call came from; the core only passes it on.
   */
  admit?: (session: AgentSession, entrance?: unknown) => void | AgentSession | Promise<void | AgentSession>;
  /**
   * The kitchens' reissued mandates (mandate.ts): the gate accepts only a kitchen's current mandate. Checked when a
   * mandate is presented, when a held session is used again, and on every decision (rule mandate_window), so an
   * order placed under a mandate the kitchen has since replaced is not committed at sign-off either.
   */
  mandates?: MandateRegister;
};

/** The holds in force on some products. Called with the products of one quote; must be cheap (no live call). */
export interface ProductHolds {
  holdsFor(productIds: string[]): ProductHold[] | Promise<ProductHold[]>;
}

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

/** Rules of the gate that read only a product's master data, never its price, stock or date. */
const MASTER_DATA_RULES = new Set<RuleResult["rule"]>(["category_allowed", "required_attributes", "forbidden_allergens", "required_certificates"]);

/**
 * The gate's verdict on the products alone, for when no live price can be had: the same evaluatePolicy, on lines
 * priced at zero, keeping only the rules that read master data. Undefined when those rules all pass.
 */
export function masterDataRefusal(mandate: Mandate, lines: { productId: string; quantity: number }[], products: Product[], at: Date): RuleResult | undefined {
  const byId = new Map(products.map((p) => [p.id, p]));
  const qlines: QuoteLine[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) continue;
    qlines.push({
      productId: p.id,
      name: p.name,
      category: p.category,
      unit: p.unit,
      packSize: p.packSize,
      attributes: p.attributes,
      allergens: p.allergens,
      ...(p.allergenInfo ? { allergensDeclared: p.allergenInfo.declared } : {}),
      ...(p.allergenInfo?.byNature ? { allergensByNature: p.allergenInfo.byNature } : {}),
      certificates: p.certificates,
      quantity: Math.max(1, Math.round(l.quantity)),
      unitPriceCents: 0,
      lineTotalCents: 0,
      deliveryDate: at.toISOString().slice(0, 10),
    });
  }
  if (!qlines.length) return undefined;
  const quote = { quoteId: "master_data_check", buyerOrgId: mandate.issuer.orgId, agentId: mandate.agentId, mandateId: mandate.mandateId, requestId: "master_data_check", currency: "EUR" as const, lines: qlines, totalCents: 0, issuedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 60_000).toISOString() };
  const d = evaluatePolicy(mandate, { agentId: mandate.agentId, quote, lines: qlines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) }, { now: at, spentThisWeekCents: 0, quoteAlreadyUsed: false });
  return d.rules.find((r) => r.outcome === "fail" && MASTER_DATA_RULES.has(r.rule));
}

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

  /** What the request asked for, with the products' names (looked up in master data, free), for the gate's reasons. */
  async function askedOf(request: PurchaseRequest | undefined, quote?: Quote): Promise<(NonNullable<PurchaseRequest["asked"]> & { names?: Record<string, string>; standIns?: string[] }) | undefined> {
    const asked = request?.asked;
    if (!asked) return asked;
    let out: NonNullable<PurchaseRequest["asked"]> & { names?: Record<string, string>; standIns?: string[] } = asked;
    // The kind asked for ("oat" drink): a line of the family that does not carry those words stands in for it.
    if (quote && asked.words?.length && asked.category) {
      try {
        const q = await qualifiersOf(catalog, asked.category, asked.words.join(" "));
        const standIns = quote.lines.filter((l) => l.category === asked.category && !l.substituteFor && wordsNotCarried(q, l.productId).length).map((l) => l.productId);
        if (standIns.length) out = { ...out, standIns };
      } catch {
        // the catalogue did not answer: judged by product and family only
      }
    }
    if (!asked.productIds.length) return out;
    try {
      const found = await catalog.searchProducts({ ids: asked.productIds, limit: 100 });
      const names = Object.fromEntries(found.map((p) => [p.id, p.name]));
      return Object.keys(names).length ? { ...out, names } : out;
    } catch {
      return out;
    }
  }

  /** Holds in force on a quote's products (recall radar), for the gate's recall_hold rule. */
  async function holdsOf(quote: Quote): Promise<{ holds?: ProductHold[] }> {
    if (!deps.holds) return {};
    const holds = await deps.holds.holdsFor([...new Set(quote.lines.map((l) => l.productId))]);
    return holds.length ? { holds } : {};
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
    for (const o of await repo.pendingExpired(now().toISOString(), orgId)) {
      if (o.status !== "pending_approval" || expiring.has(o.orderId)) continue;
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
    const { committedCents, held } = await repo.spendOf(orgId, { since: addDays(now(), -7).toISOString(), at: now().toISOString(), excludeOrderId });
    const heldCents = held.reduce((s, o) => s + o.totalCents, 0);
    return { spentCents: committedCents + heldCents, heldCents, held };
  }

  async function spentThisWeek(orgId: string, excludeOrderId?: string): Promise<number> {
    return (await budgetUse(orgId, excludeOrderId)).spentCents;
  }

  async function budgetContext(orgId: string, excludeOrderId?: string) {
    const b = await budgetUse(orgId, excludeOrderId);
    return { spentThisWeekCents: b.spentCents, heldThisWeekCents: b.heldCents, heldOrders: b.held };
  }

  /**
   * What the mistake check holds against an order (policy human_confirmation), on every door:
   *   - confirmations of the request's intake that matter but were only relayed by the agent;
   *   - when the order is not the quote the intake itself made for the buyer's choice (the agent opened a request
   *     and asked for a quote on its own, or quoted something else under an intake's request): whatever the same
   *     check finds in the order's own lines. Nobody was asked, so the agent may not decide it alone.
   * The intake's own quote is not checked twice: its questions were put to the buyer, and how they were answered
   * is the first list.
   */
  async function mistakeCheckOf(org: { orgId: string; name: string }, request: PurchaseRequest | undefined, quote: Quote, intakeQuote = false, assumeConfirmed: string[] = []) {
    const i = request ? await intakes.get(request.requestId) : undefined;
    const u = i?.unverified ?? [];
    const fromIntake = intakeQuote || i?.quote?.quote.quoteId === quote.quoteId;
    const found = fromIntake ? [] : await concernsOfOrder({ catalog, kitchens }, { orgId: org.orgId, orgName: org.name, lines: quote.lines, neededBy: request?.neededBy, now: now() });
    // What an identified person already confirmed for this very quote (the store's basket asks its signed-in person).
    const flagged = found.filter((c) => !assumeConfirmed.includes(c.key) && !request?.confirmed?.some((x) => x.quoteId === quote.quoteId && x.key === c.key));
    return {
      context: {
        ...(u.length ? { unverifiedConfirmations: u.map(({ code, message, by }) => ({ code, message, by })) } : {}),
        ...(flagged.length ? { unconfirmedConcerns: flagged.map(({ code, message }) => ({ code, message })) } : {}),
        // The intake's own quote, chosen by the kitchen's identified person: their confirmation of a stand-in.
        ...(fromIntake && i?.chosen?.verified ? { substitutionConfirmedBy: i.chosen.by } : {}),
      },
      notes: [...(i?.signOffNotes ?? []), ...flagged.map(unaskedNote)],
    };
  }

  /** The earlier orders the order_splitting rule reads for this quote, counted by the store over the splitting window. */
  async function splitWindowOf(quote: Quote, excludeOrderId?: string): Promise<{ splitWindow: SplitWindow }> {
    const since = new Date(now().getTime() - SPLIT_WINDOW_HOURS * 3600_000).toISOString();
    const categories = [...new Set(quote.lines.map((l) => l.category))];
    return { splitWindow: await repo.splitWindow(quote.buyerOrgId, { since, requestId: quote.requestId, categories, excludeOrderId, latest: SPLIT_NAMED_MAX }) };
  }

  /** Which organisation a request belongs to never changes: remembered (bounded) so ledger reads do not ask the store per entry. */
  const requestOrgs = new Map<string, string>();
  const REQUEST_ORGS_MAX = 50_000;
  function rememberRequestOrg(requestId: string, orgId: string): void {
    requestOrgs.set(requestId, orgId);
    if (requestOrgs.size > REQUEST_ORGS_MAX) requestOrgs.delete(requestOrgs.keys().next().value!);
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
          const retryAfterSeconds = Math.min(Math.max(err.retryAfterSeconds ?? 60, 5), 300);
          // What Dock knows without the live service: the products it was about to price, from master data (free).
          const known = (await catalog.searchProducts({ ids: ids.slice(0, MAX_LIVE_IDS_PER_CALL), limit: MAX_LIVE_IDS_PER_CALL })).map((p) => ({ productId: p.id, name: p.name }));
          const knownText = known.length ? ` Showing what Dock knows without it: ${known.length} product${known.length > 1 ? "s" : ""} fit${known.length > 1 ? "" : "s"} the request (${known.slice(0, 3).map((k) => k.name).join("; ")}${known.length > 3 ? "; ..." : ""}), but price, stock and delivery date need the live service.` : "";
          throw new DockError(503, "live_unavailable", `${err.message} This is the wholesaler's service, not a rule, and Dock stopped waiting for it.${knownText} Try again in ${retryAfterSeconds} s.`, undefined, { retryable: true, retryAfterSeconds, known });
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

  /** The gate accepts only a kitchen's current mandate: one the kitchen has since reissued is refused at the door. */
  /** Why this mandate is not the kitchen's current one, in words: replaced by a reissue, or without a rule one added. */
  function notCurrent(mandate: Mandate, issuedAt: string | undefined): { message: string; at: string } | undefined {
    const r = supersededBy(mandate, issuedAt, deps.mandates);
    if (r) return { message: supersededMessage(mandate.issuer.name, r), at: r.at };
    const missing = missingAddedRules(mandate, deps.mandates);
    const reissue = missing.length ? deps.mandates?.reissueOf(mandate.issuer.orgId) : undefined;
    return reissue ? { message: lacksRulesMessage(mandate.issuer.name, reissue, missing), at: reissue.at } : undefined;
  }

  function refuseSuperseded(session: AgentSession, actor: string): void {
    const why = notCurrent(session.mandate, session.mandateIssuedAt);
    if (why) throw refuse(new DockError(401, "mandate_superseded", why.message, "mandate_window", { reissuedAt: why.at }), actor);
  }

  /** The same check for a decision (policy mandate_window): the reason in words when the mandate was replaced. */
  function supersession(mandate: Mandate, issuedAt: string | undefined): { mandateSuperseded?: string } {
    const why = notCurrent(mandate, issuedAt);
    return why ? { mandateSuperseded: why.message } : {};
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
    async authenticate(mandateToken: string | undefined, agentId: string | undefined, entrance?: unknown): Promise<AgentSession> {
      const actor = `agent:${agentId ?? "unknown"}`;
      if (!mandateToken) throw refuse(new DockError(401, "mandate_missing", "No mandate presented. Send it as `Authorization: Mandate <jws>`.", "mandate_signature"), actor);
      let mandate: Mandate;
      let mandateIssuedAt: string;
      try {
        ({ mandate, issuedAt: mandateIssuedAt } = await verifyMandateToken(mandateToken, trustedIssuers, now()));
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
      const session: AgentSession = { mandate, agentId, mandateIssuedAt };
      refuseSuperseded(session, actor);
      // Admission may hand back the session with tighter terms (the server's licence gate): that is the session.
      return (await deps.admit?.(session, entrance)) ?? session;
    },

    /** Admission for a session that was verified earlier and is used again later (a link that outlives the call that made it). */
    async admit(session: AgentSession, entrance?: unknown): Promise<AgentSession> {
      refuseSuperseded(session, agentActor(session));
      return (await deps.admit?.(session, entrance)) ?? session;
    },

    /** `internal.askedWords`: set by the intake only (never from a request body): the words that say what kind of product was asked for. */
    async openRequest(session: AgentSession, input: z.input<typeof OpenRequestInput>, internal: { askedWords?: string[] } = {}): Promise<PurchaseRequest> {
      const { text, neededBy: by, deliverOn, productIds, category } = parse(OpenRequestInput, input);
      const words = category && internal.askedWords?.length ? internal.askedWords.slice(0, 6) : undefined;
      const neededBy = deliverOn ?? by;
      const named = await askedProducts(text, productIds ?? []);
      const r: PurchaseRequest = {
        requestId: newId("req"),
        orgId: session.mandate.issuer.orgId,
        agentId: session.agentId,
        mandateId: session.mandate.mandateId,
        text,
        neededBy,
        ...(deliverOn ? { deliverOn } : {}),
        ...(named.length || category ? { asked: { productIds: named, ...(category ? { category } : {}), ...(words ? { words } : {}) } } : {}),
        ...(session.door ? { door: session.door } : {}),
        createdAt: now().toISOString(),
      };
      await repo.saveRequest(r);
      rememberRequestOrg(r.requestId, r.orgId);
      ledger.append({
        type: "request",
        actor: agentActor(session),
        requestId: r.requestId,
        summary: `Agent ${session.agentId} of ${session.mandate.issuer.name} opened a request${session.door ? ` through ${DOOR_TEXT[session.door]}` : ""}: "${text}"${neededBy ? `, needed by ${neededBy}` : ""}.`,
        data: { text, neededBy, mandateId: r.mandateId, ...(r.asked ? { asked: r.asked } : {}), ...(session.door ? { door: session.door } : {}) },
      });
      return r;
    },

    /**
     * Move a request's need-by date (the buyer chose a later day, the chef changed the service day). The gate's
     * delivery check and every later live lookup follow it. Not once an order for the request waits or is
     * committed: that order was decided against the old date. A date before today is refused.
     */
    async changeNeededBy(session: AgentSession, requestId: string, input: z.input<typeof ChangeNeededByInput>): Promise<PurchaseRequest> {
      const { neededBy, by, reason, deliverOn } = parse(ChangeNeededByInput, input);
      const r = await ownRequest(session, requestId);
      const was = r.neededBy ?? null;
      if (was === neededBy && (deliverOn === undefined || (r.deliverOn ?? null) === deliverOn)) return r;
      const today = localNow(now()).date;
      if (neededBy && neededBy < today) throw new DockError(400, "needed_by_in_past", `${neededBy} is before today (${today}).`, "delivery_deadline");
      const placed = (await repo.ordersOfRequest(requestId)).find((o) => o.status === "pending_approval" || o.status === "committed");
      if (placed) throw new DockError(409, "request_has_order", `Order ${placed.orderId} for request ${requestId} is ${placed.status.replace("_", " ")}; it was decided against ${was ?? "the earliest date"}. Open a new request for another date.`, "intake_sequence", { orderId: placed.orderId });
      const next: PurchaseRequest = { ...r, neededBy: neededBy ?? undefined, ...(deliverOn !== undefined ? { deliverOn: deliverOn ?? undefined } : {}) };
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

    /**
     * What the gate would decide on these lines at these live prices, for an option card before anyone taps it: the
     * same rules and context as a quote's preview (orders.ts requestQuote), on an unsigned quote that is never issued,
     * stored or logged. Undefined when the lines cannot be priced from the offers given.
     */
    async previewDecision(session: AgentSession, requestId: string, input: QuoteRequestLine[], offers: LiveOffer[], internal: { confirmedBy?: string; referencePrices?: boolean; asPlaced?: boolean } = {}): Promise<Decision | undefined> {
      const request = await ownRequest(session, requestId);
      const lines = await substitutesOf(request, input);
      const ids = [...new Set(lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])))];
      const products = await catalog.searchProducts({ ids, limit: 100 });
      const priced = offers.map((o) => scheduledOn(o, request.deliverOn));
      // A substitute is compared with the price of the product it replaces, which is often the one not on offer
      // now: its last price from the wholesaler's status will do, as in requestQuote (one short live call; the order
      // sheet asks for it, the intake's previews keep to the offers they were given).
      let reference = priced;
      const unpriced = [...new Set(lines.flatMap((l) => (l.substituteFor && !priced.some((o) => o.productId === l.substituteFor) ? [l.substituteFor] : [])))];
      if (unpriced.length && internal.referencePrices) {
        const live = await liveLookup(session, requestId, unpriced, request.neededBy, "AimoPilot asked the price of a product a substitute replaces, for a preview", { batch: true }).catch(() => undefined);
        reference = [...priced, ...(live?.statuses ?? []).map((x) => x.offer).filter((o): o is LiveOffer => !!o).map((o) => scheduledOn(o, request.deliverOn))];
      }
      let quote: Quote;
      try {
        quote = buildQuote({ quoteId: "preview", buyerOrgId: session.mandate.issuer.orgId, agentId: session.agentId, mandateId: session.mandate.mandateId, requestId, lines, products, offers: priced, referenceOffers: reference, now: now(), ttlMinutes: quoteTtlMinutes });
      } catch {
        return undefined;
      }
      return evaluatePolicy(
        session.mandate,
        { agentId: session.agentId, quote, lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })), neededBy: request.neededBy, deliverOn: request.deliverOn, requestId, asked: await askedOf(request, quote) },
        { now: now(), ...supersession(session.mandate, session.mandateIssuedAt), ...(await budgetContext(quote.buyerOrgId)), ...(await mistakeCheckOf(session.mandate.issuer, request, quote, !internal.asPlaced)).context, ...(await holdsOf(quote)), quoteAlreadyUsed: false, ...(await splitWindowOf(quote)), ...(internal.confirmedBy ? { substitutionConfirmedBy: internal.confirmedBy } : {}) },
      );
    },

    /** Ask the wholesaler for a fixed-price quote. Returns the signed quote and what the gate would decide on it now. */
    async requestQuote(session: AgentSession, input: z.input<typeof QuoteInput>, internal: { intakeQuote?: boolean } = {}) {
      const parsed = parse(QuoteInput, input);
      const { requestId } = parsed;
      const request = await ownRequest(session, requestId);
      // Dock decides what is a substitute, from what was asked: a line for any other product replaces the product
      // asked for, and its price is compared with that product's, whatever the agent declared.
      const lines = await substitutesOf(request, parsed.lines);
      const ids = [...new Set(lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])))];
      let quote: Quote;
      let claims: IssuedClaim[] = [];
      let cutoff: number | undefined;
      try {
        const products = await catalog.searchProducts({ ids, limit: 100 });
        let live: LiveLookupResult;
        try {
          live = await liveLookup(session, requestId, ids, request.neededBy, "AimoPilot asked live prices for a quote", { fresh: true, batch: true });
        } catch (err) {
          // The wholesaler's service is slow or down: a refusal that needs no price (category, attributes, allergens,
          // certificates, read from master data) is still the gate's answer, not "try again later".
          const refused = isDockError(err) && err.code === "live_unavailable" ? masterDataRefusal(session.mandate, lines, products, now()) : undefined;
          if (refused) throw refuse(new DockError(422, "policy_rejected", `${refused.reason} Decided on the product data alone: the wholesaler's live service did not answer, and no price would change this.`, refused.rule), agentActor(session), { requestId });
          throw err;
        }
        const offers = live.offers.map((o) => scheduledOn(o, request.deliverOn));
        cutoff = offers.filter((o) => lines.some((l) => l.productId === o.productId)).map((o) => cutoffMs(o.orderBy)).filter((x): x is number => x !== undefined).sort((a, b) => a - b)[0];
        // Say why a line cannot be quoted, in the partner's terms (a passed cut-off, a sales block, no price).
        for (const l of lines) {
          const st = live.statuses.find((x) => x.productId === l.productId);
          if (st && !usableOffer(st) && products.some((p) => p.id === l.productId))
            throw new QuoteError("quote_no_offer", `${l.productId} cannot be quoted now: ${st.message}`, { productId: l.productId, problems: st.problems });
        }
        // The product a substitute replaces only lends its price for comparison: any priced status will do.
        const referenceOffers = live.statuses.map((x) => x.offer).filter((o): o is LiveOffer => !!o).map((o) => scheduledOn(o, request.deliverOn));
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
      if (cutoff !== undefined) quoteCutoffs.set(quote.quoteId, new Date(cutoff).toISOString());
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
        { agentId: session.agentId, quote, lines: quote.lines, neededBy: request.neededBy, deliverOn: request.deliverOn, requestId, asked: await askedOf(request, quote) },
        { now: now(), ...supersession(session.mandate, session.mandateIssuedAt), ...(await budgetContext(quote.buyerOrgId)), ...(await mistakeCheckOf(session.mandate.issuer, request, quote, internal.intakeQuote)).context, ...(await holdsOf(quote)), quoteAlreadyUsed: false, ...(await splitWindowOf(quote)) },
      );
      return { quote, quoteToken, policyPreview, claims };
    },

    /** Place an order against a signed quote. Always returns the decision; refused orders are kept with their reasons. */
    /**
     * `internal.confirmedBy`: set only by server code in this process (the thread's order sheet), when the kitchen's own
     * identified person built and confirmed these exact lines: their confirmation of a substitute (policy.ts
     * substitutionConfirmedBy). Never from a request body.
     */
    async placeOrder(session: AgentSession, input: z.input<typeof SignedOrderInput>, internal: { confirmedBy?: string } = {}): Promise<PublicOrder> {
      const { requestId, quoteToken, lines } = parse(SignedOrderInput, input);
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
        const draft = { agentId: session.agentId, quote, lines, neededBy: request.neededBy, deliverOn: request.deliverOn, requestId, asked: await askedOf(request, quote) };
        const check = await mistakeCheckOf(session.mandate.issuer, request, quote);
        const ctx = { now: now(), ...supersession(session.mandate, session.mandateIssuedAt), ...(await budgetContext(orgId)), ...check.context, ...(await holdsOf(quote)), quoteAlreadyUsed: await repo.isQuoteUsed(quote.quoteId), ...(await splitWindowOf(quote)), ...(internal.confirmedBy ? { substitutionConfirmedBy: internal.confirmedBy } : {}) };
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
          ...(session.mandateIssuedAt ? { mandateIssuedAt: session.mandateIssuedAt } : {}),
        };
        // What the person signing off must see: the intake's relayed confirmations, and what nobody was asked about.
        if (check.notes.length) order.notes = check.notes;
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
          { agentId: order.agentId, quote: order.quote, lines: order.draftLines, neededBy: request?.neededBy, deliverOn: request?.deliverOn, requestId: order.requestId, asked: await askedOf(request, order.quote) },
          { now: now(), ...supersession(order.mandate, order.mandateIssuedAt), ...(await budgetContext(order.orgId, order.orderId)), ...(await mistakeCheckOf({ orgId: order.orgId, name: order.orgName }, request, order.quote)).context, ...(await holdsOf(order.quote)), quoteAlreadyUsed: false, ...(await splitWindowOf(order.quote, order.orderId)) },
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

    /**
     * What the gate's own mistake check finds in a signed quote that nobody was asked about, with the words (the
     * kitchen's own data): for a door where the kitchen's signed-in person is present and can be asked, the basket.
     */
    async orderConcerns(session: AgentSession, input: { requestId: string; quoteToken: string }): Promise<OrderConcern[]> {
      const request = await ownRequest(session, input.requestId);
      const quote = await verifyQuote(input.quoteToken, wholesalerKey).catch((err) => {
        throw err instanceof QuoteError ? new DockError(422, err.code, err.message, "quote_signature") : err;
      });
      if (quote.requestId !== request.requestId) throw new DockError(409, "quote_other_request", "That quote was issued for another request.", "quote_binding");
      const found = await concernsOfOrder({ catalog, kitchens }, { orgId: session.mandate.issuer.orgId, orgName: session.mandate.issuer.name, lines: quote.lines, neededBy: request.neededBy, now: now() });
      return found.filter((c) => !request.confirmed?.some((x) => x.quoteId === quote.quoteId && x.key === c.key));
    },

    /**
     * What the gate will decide on a quote once the person at the screen has confirmed these concerns: a preview
     * only (nothing is recorded), so the screen that asks them does not announce a sign-off their answer removes.
     */
    async previewConfirmed(session: AgentSession, input: { requestId: string; quoteToken: string; keys: string[] }): Promise<Decision> {
      const request = await ownRequest(session, input.requestId);
      const quote = await verifyQuote(input.quoteToken, wholesalerKey);
      return evaluatePolicy(
        session.mandate,
        { agentId: session.agentId, quote, lines: quote.lines, neededBy: request.neededBy, deliverOn: request.deliverOn, requestId: request.requestId, asked: await askedOf(request) },
        { now: now(), ...supersession(session.mandate, session.mandateIssuedAt), ...(await budgetContext(quote.buyerOrgId)), ...(await mistakeCheckOf(session.mandate.issuer, request, quote, false, input.keys)).context, ...(await holdsOf(quote)), quoteAlreadyUsed: await repo.isQuoteUsed(quote.quoteId), ...(await splitWindowOf(quote)) },
      );
    },

    /**
     * An identified person confirms, as intended, what the mistake check flagged in a quote. Only through a channel
     * bound to the person (intake.ts isVerified: the kitchen's signed-in store session, their passkey); a relayed
     * yes is refused here, and the order then goes to sign-off as before. `via` is set by server code, never taken
     * from a request. Recorded on the request and in the ledger; an order on that quote is not asked about it again.
     */
    async confirmConcerns(session: AgentSession, input: { requestId: string; quoteToken: string; keys: string[] }, via: HumanVia): Promise<{ confirmed: OrderConcern[]; open: OrderConcern[] }> {
      if (!isVerified(via) || !via.person) throw new DockError(403, "confirmation_needs_person", "Only the kitchen's own signed-in person can confirm a likely mistake. A relayed answer does not count: the order goes to a named person's sign-off instead.", "human_input");
      const open = await dock.orderConcerns(session, input);
      const quote = await verifyQuote(input.quoteToken, wholesalerKey);
      const confirmed = open.filter((c) => input.keys.includes(c.key));
      if (!confirmed.length) return { confirmed, open };
      const request = await ownRequest(session, input.requestId);
      const at = now().toISOString();
      await repo.saveRequest({ ...request, confirmed: [...(request.confirmed ?? []), ...confirmed.map((c) => ({ quoteId: quote.quoteId, key: c.key, code: c.code, by: via.person!, at, channel: via.channel }))] });
      for (const c of confirmed) {
        ledger.append({
          type: "intake",
          actor: `buyer:${via.person}`,
          requestId: request.requestId,
          summary: `${via.person} confirmed as intended, in the kitchen's signed-in store, before sending the order: ${c.message}`,
          data: { step: "confirmation", key: c.key, code: c.code, by: via.person, channel: via.channel, verified: true, quoteId: quote.quoteId },
        });
      }
      return { confirmed, open: open.filter((c) => !input.keys.includes(c.key)) };
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
    async listPendingApprovals(orgId?: string): Promise<PendingApproval[]> {
      await expireStale(orgId);
      return (await repo.pendingOrders(orgId))
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

    /** Every order, or one organisation's (oldest first). The store's copies, stripped of what never leaves Dock. */
    async listOrders(filter: { orgId?: string } = {}): Promise<PublicOrder[]> {
      await expireStale(filter.orgId);
      return (filter.orgId ? await repo.ordersOf(filter.orgId) : await repo.listOrders()).map(stripOrder);
    },

    /** Orders waiting for sign-off, of one organisation or all (oldest first). */
    async pendingOrders(orgId?: string): Promise<PublicOrder[]> {
      await expireStale(orgId);
      return (await repo.pendingOrders(orgId)).map(stripOrder);
    },

    /** How many orders wait for sign-off, after closing those whose price ran out. */
    async pendingCount(): Promise<number> {
      await expireStale();
      return repo.pendingCount();
    },

    /** The organisation an order belongs to (for deciding who may read its ledger entries); undefined when unknown. */
    async orgOfOrder(orderId: string): Promise<string | undefined> {
      return (await repo.getOrder(orderId))?.orgId;
    },

    /**
     * The buyer takes back an order that waits for sign-off: it stops holding the weekly budget at once, the
     * approver's phone shows it as withdrawn, and the ledger says who asked (relayed by the agent). Only the
     * organisation's own pending orders; anything decided stays as it is.
     */
    async withdrawOrder(session: AgentSession, orderId: string, input: z.input<typeof WithdrawInput> = {}, internal: { takeBack?: { by: string } } = {}): Promise<PublicOrder> {
      const { reason, by } = parse(WithdrawInput, input ?? {});
      const orgId = session.mandate.issuer.orgId;
      const found = await repo.getOrder(orderId);
      if (!found || found.orgId !== orgId) throw new DockError(404, "order_not_found", `No order ${orderId} for this organisation.`);
      return serialize(orgId, async () => {
        await expireStale(orgId);
        const order = (await repo.getOrder(orderId))!;
        // `takeBack`: server code only (the kitchen's own signed-in person in the thread), never a request body. A
        // committed order goes back before the wholesaler's order cut-off; the signed confirmation is void from then.
        const until = internal.takeBack ? takeBackUntil(order, now()) : undefined;
        if (until && internal.takeBack) {
          const at = now().toISOString();
          order.status = "withdrawn";
          order.updatedAt = at;
          await repo.saveOrder(order);
          // Not bought after all: out of the kitchen's history, so "usual" amounts and the repeat check do not count it.
          await updateKitchenProfile(kitchens, orgId, (p) => (p ? { ...p, history: p.history.filter((h) => h.orderId !== orderId) } : p));
          ledger.append({
            type: "order",
            actor: agentActor(session),
            requestId: order.requestId,
            orderId,
            summary: `Committed order ${orderId} (${formatEur(order.totalCents)}) taken back by ${internal.takeBack.by} (signed in) before the order cut-off ${until.slice(0, 16).replace("T", " ")} UTC; the wholesaler's confirmation no longer holds and it no longer counts against the weekly budget.`,
            data: { decision: "taken_back", by: internal.takeBack.by, verified: true, cutoff: until, reason },
          });
          publish({ type: "order_withdrawn", at, orgId, orderId, totalCents: order.totalCents, summary: `${order.orgName}: a ${formatEur(order.totalCents)} order was taken back before the cut-off.` });
          return toPublicOrder(order);
        }
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
      const known = requestOrgs.get(requestId);
      if (known) return known;
      const orgId = (await repo.getRequest(requestId))?.orgId;
      if (orgId) rememberRequestOrg(requestId, orgId);
      return orgId;
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

    /**
     * The wholesaler's selling agent (server/offers): sign what it states about a product for one buyer (its price,
     * for that buyer, and its origin), kept like every other claim so the buyer's agent can fetch the tokens, and sign
     * the offer itself (core/offers.ts). Signing only; nothing is ordered or reserved.
     */
    async signOfferClaims(audience: string, offer: LiveOffer, product: Product, at: Date = now()): Promise<IssuedClaim[]> {
      const out: IssuedClaim[] = [];
      for (const input of [priceClaimInput(offer, at, audience), originClaimInput(product, at)]) {
        const c = await issueClaim(input, wholesalerKey);
        claimStore.put(c, input.audience);
        out.push(c);
      }
      return out;
    },
    signOffer: (body: OfferBody) => signOffer(body, wholesalerKey),
    /**
     * Signed price and availability claims for a live answer the server holds (the kitchen agent's watch,
     * server/watch): a staged condition is signed with `simulated: true` on the offer, so the claim says so.
     */
    async signLiveClaims(audience: string, offer: LiveOffer, at: Date = now()): Promise<IssuedClaim[]> {
      const out: IssuedClaim[] = [];
      for (const input of [priceClaimInput(offer, at, audience), availabilityClaimInput(offer, at, audience)]) {
        const c = await issueClaim(input, wholesalerKey);
        claimStore.put(c, input.audience);
        out.push(c);
      }
      return out;
    },
  };

  /**
   * A request that came through the intake cannot go around it: while a likely mistake waits for the buyer's
   * confirmation (or after the buyer cancelled), the lower-level quote and order calls refuse it. The intake
   * itself quotes through the unguarded function.
   */
  /**
   * The order for a request's current quote: the one the intake signed when the buyer chose an option. Refused, with
   * what to do instead, when there is none, it has expired, or it already bought an order.
   */
  async function currentQuoteOrder(session: AgentSession, requestId: string): Promise<z.output<typeof SignedOrderInput>> {
    const i = await intakes.get(requestId);
    const actor = agentActor(session);
    const none = (message: string, rule: string, details: Record<string, unknown> = {}) => refuse(new DockError(409, "no_current_quote", message, rule, { requestId, ...details }), actor, { requestId });
    if (!i || i.orgId !== session.mandate.issuer.orgId || i.agentId !== session.agentId) {
      if (!(await repo.getRequest(requestId))) throw new DockError(404, "request_not_found", `No open request ${requestId} for this agent.`);
      throw none(`Request ${requestId} has no quote Dock signed through the intake: send quoteToken and lines from POST /api/v1/quotes, or start with POST /api/v1/intake.`, "intake_sequence");
    }
    if (i.state !== "quoted" || !i.quote) throw none(`Request ${requestId} has no current quote: it is ${i.state}. Choose an option first; the quote comes with the choice.`, "intake_sequence", { state: i.state });
    const q = i.quote.quote;
    if (Date.parse(q.expiresAt) <= now().getTime()) throw none(`The quote for request ${requestId} expired at ${q.expiresAt}: its fixed price no longer holds. Choose the option again for a new quote.`, "quote_expiry", { quoteId: q.quoteId, expiresAt: q.expiresAt });
    if (await repo.isQuoteUsed(q.quoteId)) throw none(`The quote for request ${requestId} already bought an order; a quote buys once. Start a new request if the buyer needs more.`, "quote_replay", { quoteId: q.quoteId });
    return { requestId, quoteToken: i.quote.quoteToken, lines: q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) };
  }

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
    /** `internal`: server code in this process only (the thread's order sheet), never a request body. */
    placeOrder: async (session: AgentSession, input: z.input<typeof PlaceOrderInput>, internal: { confirmedBy?: string } = {}) => {
      const body = parse(PlaceOrderInput, input);
      await intakeGate(session, body.requestId);
      if (body.quoteToken) {
        if (!body.lines) throw new DockError(400, "invalid_request", "Send lines with quoteToken (copied from quote.lines), or leave both out after the intake's choice.");
        return dock.placeOrder(session, { requestId: body.requestId, quoteToken: body.quoteToken, lines: body.lines }, internal);
      }
      return dock.placeOrder(session, await currentQuoteOrder(session, body.requestId), internal);
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
    requestQuote: (session, input) => dock.requestQuote(session, input, { intakeQuote: true }),
    previewDecision: (session, requestId, lines, offers) => dock.previewDecision(session, requestId, lines, offers),
    liveLookup: (session, requestId, productIds, deliveryDate, why) => liveLookup(session, requestId, productIds, deliveryDate, why, { batch: true }),
    spentThisWeek: (orgId) => spentThisWeek(orgId),
    budgetUse: (orgId) => budgetUse(orgId),
    secondReading: deps.secondReadings,
    alternatives: deps.alternatives,
    memoryUsage: deps.memoryUsage,
    ...(deps.finder ? { finder: deps.finder } : {}),
  });
  return { ...dock, ...guarded, intake };
}

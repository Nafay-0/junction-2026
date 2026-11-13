import { CompactSign } from "jose";
import { z } from "zod";
import {
  ApprovalProofSchema,
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
import { InMemoryKitchenRepository, type KitchenRepository } from "./kitchen";
import { SIGN_ALG, type KeyPair } from "./keys";
import type { Ledger, LedgerHead } from "./ledger";
import { LiveLookupAllowance, agentKeyOf } from "./live-allowance";
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
export const QuoteInput = z.object({ requestId: z.string().min(1), lines: z.array(QuoteRequestLineSchema).min(1).max(20) });
export const PlaceOrderInput = z.object({
  requestId: z.string().min(1),
  quoteToken: z.string().min(1),
  lines: z.array(z.object({ productId: z.string(), quantity: z.number(), unitPriceCents: z.number() })),
});
export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approve", "decline"]),
  proof: ApprovalProofSchema,
  note: z.string().max(500).optional(),
});

// ---------- records ----------

export type AgentSession = { mandate: Mandate; agentId: string };

export type PurchaseRequest = {
  requestId: string;
  orgId: string;
  agentId: string;
  mandateId: string;
  text: string;
  neededBy?: string;
  createdAt: string;
};

export type OrderStatus = "pending_approval" | "committed" | "rejected" | "declined";

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

  async function ownRequest(session: AgentSession, requestId: string): Promise<PurchaseRequest> {
    const r = await repo.getRequest(requestId);
    if (!r || r.orgId !== session.mandate.issuer.orgId || r.agentId !== session.agentId) {
      throw new DockError(404, "request_not_found", `No open request ${requestId} for this agent. Open one with POST /api/v1/requests.`);
    }
    return r;
  }

  async function spentThisWeek(orgId: string, excludeOrderId?: string): Promise<number> {
    const since = addDays(now(), -7).getTime();
    return (await repo.listOrders())
      .filter((o) => o.orgId === orgId && o.orderId !== excludeOrderId)
      .filter((o) => o.status === "committed" || o.status === "pending_approval")
      .filter((o) => Date.parse(o.createdAt) > since)
      .reduce((sum, o) => sum + o.totalCents, 0);
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
  async function liveLookup(session: AgentSession, requestId: string, productIds: string[], deliveryDate: string | undefined, why: string): Promise<LiveLookupResult> {
    const actor = agentActor(session);
    const ids = [...new Set(productIds)];
    try {
      liveAllowance.reserve(agentKeyOf(session.mandate.issuer.orgId, session.agentId), ids);
    } catch (err) {
      if (err instanceof DockError) throw refuse(err, actor, { requestId });
      throw err;
    }
    let statuses: LiveStatus[];
    try {
      statuses = await catalog.getLiveStatus(ids, deliveryDate ? { deliveryDate } : undefined);
    } catch (err) {
      if (err instanceof CatalogError && err.code === "too_many_products") throw refuse(new DockError(400, err.code, err.message, "live_lookup_limit"), actor, { requestId });
      if (err instanceof CatalogError) {
        ledger.append({ type: "lookup", actor: "dock", requestId, summary: `The wholesaler's live price/availability service did not answer (${why}); nothing was looked up or refused.`, data: { source: "live", failed: true, code: err.code, productIds: ids } });
        throw new DockError(503, "live_unavailable", `${err.message} This is the wholesaler's service, not a rule: try again in a minute.`, undefined, { retryable: true });
      }
      throw err;
    }
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
      const origin = product ? await sign(originClaimInput(product, at)) : undefined;
      if (st.offer) {
        st.offer.claims = { price: await sign(priceClaimInput(st.offer, at, audience)), availability: await sign(availabilityClaimInput(st.offer, at, audience)), origin };
      }
      const usable = usableOffer(st);
      if (usable) offers.push(usable);
    }
    const unavailable = statuses.filter((st) => !usableOffer(st)).map((st) => ({ productId: st.productId, problems: st.problems, message: st.message }));
    ledger.append({
      type: "lookup",
      actor,
      requestId,
      summary: `${why} for ${ids.length} product(s)${deliveryDate ? ` for delivery by ${deliveryDate}` : ""} (live call #${catalog.stats().liveCalls}): ${[...offers.map(describeOffer), ...unavailable.map((u) => `${u.productId} not quotable: ${u.problems.join(", ")}`)].join("; ")}. ${claims.length} signed claims issued.`,
      data: { source: "live", productIds: ids, deliveryDate, offers, unavailable, claimIds: claims.map((c) => c.claimId) },
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
      const { text, neededBy } = parse(OpenRequestInput, input);
      const r: PurchaseRequest = {
        requestId: newId("req"),
        orgId: session.mandate.issuer.orgId,
        agentId: session.agentId,
        mandateId: session.mandate.mandateId,
        text,
        neededBy,
        createdAt: now().toISOString(),
      };
      await repo.saveRequest(r);
      ledger.append({
        type: "request",
        actor: agentActor(session),
        requestId: r.requestId,
        summary: `Agent ${session.agentId} of ${session.mandate.issuer.name} opened a request: "${text}"${neededBy ? `, needed by ${neededBy}` : ""}.`,
        data: { text, neededBy, mandateId: r.mandateId },
      });
      return r;
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
      const { requestId, lines } = parse(QuoteInput, input);
      const request = await ownRequest(session, requestId);
      const ids = [...new Set(lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])))];
      let quote: Quote;
      let claims: IssuedClaim[] = [];
      try {
        const products = await catalog.searchProducts({ ids, limit: 100 });
        const live = await liveLookup(session, requestId, ids, request.neededBy, "Dock asked live prices for a quote");
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
        summary: `Wholesaler quoted ${quote.quoteId}: ${quote.lines.map((l) => `${l.quantity} x ${l.productId}`).join(", ")} for ${formatEur(quote.totalCents)}${subs ? ` (${subs} substitute${subs > 1 ? "s" : ""})` : ""}, price fixed until ${quote.expiresAt.slice(0, 16).replace("T", " ")} UTC${quote.expiresBecause === "order_cutoff" ? " (the order cut-off)" : quote.expiresBecause === "price_validity" ? " (when the price stops being valid)" : ""}; it rests on ${quote.evidence?.length ?? 0} signed claims.`,
        data: { quoteId: quote.quoteId, totalCents: quote.totalCents, expiresAt: quote.expiresAt, expiresBecause: quote.expiresBecause, evidence: quote.evidence, lines: quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate, substituteFor: l.substituteFor?.productId })) },
      });
      const policyPreview = evaluatePolicy(
        session.mandate,
        { agentId: session.agentId, quote, lines: quote.lines, neededBy: request.neededBy },
        { now: now(), spentThisWeekCents: await spentThisWeek(quote.buyerOrgId), quoteAlreadyUsed: false, recentOrders: await recentOrders(quote.buyerOrgId) },
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
        const draft = { agentId: session.agentId, quote, lines, neededBy: request.neededBy };
        const ctx = { now: now(), spentThisWeekCents: await spentThisWeek(orgId), quoteAlreadyUsed: await repo.isQuoteUsed(quote.quoteId), recentOrders: await recentOrders(orgId) };
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
          { agentId: order.agentId, quote: order.quote, lines: order.draftLines, neededBy: request?.neededBy },
          { now: now(), spentThisWeekCents: await spentThisWeek(order.orgId, order.orderId), quoteAlreadyUsed: false, recentOrders: await recentOrders(order.orgId, order.orderId) },
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
      const o = await repo.getOrderByApprovalId(approvalId);
      if (!o?.approval) throw new DockError(404, "approval_not_found", `No approval ${approvalId}.`);
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
      const o = await repo.getOrder(orderId);
      if (!o || o.orgId !== session.mandate.issuer.orgId) throw new DockError(404, "order_not_found", `No order ${orderId} for this organisation.`);
      return toPublicOrder(o);
    },

    // APPROVER-AUTH SEAM: listing is open today; restrict it to signed-in approvers when passkeys land.
    async listPendingApprovals(): Promise<PendingApproval[]> {
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
      return (await repo.listOrders()).map(toPublicOrder);
    },

    stats: () => catalog.stats(),
    /** The per-agent hourly allowance of live lookups, shared by every transport (REST, MCP, intake). */
    liveAllowance,
    ledger,
    wholesalerPublicJwk: wholesalerKey.publicJwk,
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
    requestQuote: dock.requestQuote,
    liveLookup,
    spentThisWeek: (orgId) => spentThisWeek(orgId),
  });
  return { ...dock, intake };
}

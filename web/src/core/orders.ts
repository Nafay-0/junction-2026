import { CompactSign } from "jose";
import { z } from "zod";
import {
  linkTokenVerifier,
  newApprovalToken,
  type Approval,
  type ApprovalNotifier,
  type ApprovalProof,
  type ApprovalVerifier,
} from "./approval";
import { CatalogError, ProductQuerySchema, type LiveOffer, type MeteredCatalog, type Product } from "./catalog";
import { DockError, parse } from "./errors";
import { InMemoryIntakeRepository, createIntakeFlow, recordCommittedOrder, type IntakeRepository } from "./intake";
import { InMemoryKitchenRepository, type KitchenRepository } from "./kitchen";
import { SIGN_ALG, type KeyPair } from "./keys";
import type { Ledger, LedgerHead } from "./ledger";
import { MandateError, verifyMandate, type Mandate, type TrustRegistry } from "./mandate";
import { decidingRule, evaluatePolicy, type Decision, type OrderDraftLine } from "./policy";
import { QuoteError, QuoteRequestLineSchema, buildQuote, signQuote, verifyQuote, type Quote, type QuoteLine } from "./quote";
import { addDays, canonicalJson, formatEur, newId, sha256Hex } from "./util";

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
export const AvailabilityInput = z.object({ requestId: z.string().min(1), productIds: z.array(z.string().min(1)).min(1) });
export const QuoteInput = z.object({ requestId: z.string().min(1), lines: z.array(QuoteRequestLineSchema).min(1).max(20) });
export const PlaceOrderInput = z.object({
  requestId: z.string().min(1),
  quoteToken: z.string().min(1),
  lines: z.array(z.object({ productId: z.string(), quantity: z.number(), unitPriceCents: z.number() })),
});
export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approve", "decline"]),
  proof: z.object({ kind: z.literal("link_token"), token: z.string() }),
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
  verifier?: ApprovalVerifier; // PASSKEY SEAM: swap in a WebAuthn verifier (see approval.ts)
  now?: () => Date;
  quoteTtlMinutes?: number;
  kitchens?: KitchenRepository; // kitchen memory: order history and preferences (see kitchen.ts)
  intakes?: IntakeRepository; // structured-need intake sessions (see intake.ts)
};

export type Dock = ReturnType<typeof createDock>;

export const ORDER_TYP = "order+jws";

export function createDock(deps: DockDeps) {
  const { catalog, repo, ledger, trustedIssuers, wholesalerKey, notifier } = deps;
  const verifier = deps.verifier ?? linkTokenVerifier;
  const now = deps.now ?? (() => new Date());
  const quoteTtlMinutes = deps.quoteTtlMinutes ?? 30;
  const kitchens = deps.kitchens ?? new InMemoryKitchenRepository();
  const intakes = deps.intakes ?? new InMemoryIntakeRepository();
  const agentActor = (s: AgentSession) => `agent:${s.agentId}`;

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

  async function commit(order: Order, authorisedBy: { kind: "mandate" } | { kind: "approver"; role: string; name: string }) {
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
      const { requestId, productIds } = parse(AvailabilityInput, input);
      await ownRequest(session, requestId);
      let offers: LiveOffer[];
      try {
        offers = await catalog.getLiveOffers(productIds);
      } catch (err) {
        if (err instanceof CatalogError) throw refuse(new DockError(400, err.code, err.message, "live_lookup_limit"), agentActor(session), { requestId });
        throw err;
      }
      ledger.append({
        type: "lookup",
        actor: agentActor(session),
        requestId,
        summary: `Agent checked live price and availability for ${productIds.length} product(s) (live call #${catalog.stats().liveCalls}): ${offers
          .map((o) => `${o.productId} ${o.availablePacks} packs at ${formatEur(o.unitPriceCents)}, delivery ${o.deliveryDate}`)
          .join("; ")}.`,
        data: { source: "live", productIds, offers },
      });
      return offers;
    },

    /** Ask the wholesaler for a fixed-price quote. Returns the signed quote and what the gate would decide on it now. */
    async requestQuote(session: AgentSession, input: z.input<typeof QuoteInput>) {
      const { requestId, lines } = parse(QuoteInput, input);
      const request = await ownRequest(session, requestId);
      const ids = [...new Set(lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])))];
      let quote: Quote;
      try {
        const [products, offers] = [await catalog.searchProducts({ ids, limit: 100 }), await catalog.getLiveOffers(ids)];
        quote = buildQuote({
          quoteId: newId("qt"),
          buyerOrgId: session.mandate.issuer.orgId,
          agentId: session.agentId,
          mandateId: session.mandate.mandateId,
          requestId,
          lines,
          products,
          offers,
          now: now(),
          ttlMinutes: quoteTtlMinutes,
        });
      } catch (err) {
        if (err instanceof QuoteError) {
          const status = err.code === "quote_insufficient_stock" || err.code === "quote_no_offer" ? 409 : 400;
          throw refuse(new DockError(status, err.code, err.message, "quote_availability", err.details), agentActor(session), { requestId });
        }
        if (err instanceof CatalogError) throw refuse(new DockError(400, err.code, err.message, "live_lookup_limit"), agentActor(session), { requestId });
        throw err;
      }
      const quoteToken = await signQuote(quote, wholesalerKey);
      const subs = quote.lines.filter((l) => l.substituteFor).length;
      ledger.append({
        type: "quote",
        actor: "dock",
        requestId,
        summary: `Wholesaler quoted ${quote.quoteId}: ${quote.lines.map((l) => `${l.quantity} x ${l.productId}`).join(", ")} for ${formatEur(quote.totalCents)}${subs ? ` (${subs} substitute${subs > 1 ? "s" : ""})` : ""}, price fixed until ${quote.expiresAt.slice(11, 16)} UTC.`,
        data: { quoteId: quote.quoteId, totalCents: quote.totalCents, expiresAt: quote.expiresAt, lines: quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, substituteFor: l.substituteFor?.productId })) },
      });
      const policyPreview = evaluatePolicy(
        session.mandate,
        { agentId: session.agentId, quote, lines: quote.lines, neededBy: request.neededBy },
        { now: now(), spentThisWeekCents: await spentThisWeek(quote.buyerOrgId), quoteAlreadyUsed: false },
      );
      return { quote, quoteToken, policyPreview };
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
        const ctx = { now: now(), spentThisWeekCents: await spentThisWeek(orgId), quoteAlreadyUsed: await repo.isQuoteUsed(quote.quoteId) };
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
            orderDigest: sha256Hex(canonicalJson({ orderId: order.orderId, quoteId: order.quoteId, lines: order.lines, totalCents: order.totalCents })),
            tokenHash,
            requestedAt: at,
          };
          await repo.saveOrder(order);
          await notifier.send({
            approvalId: order.approval.approvalId,
            orderId: order.orderId,
            approver: decision.approver,
            totalCents: order.totalCents,
            reasons: decision.reasons,
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
        } else {
          await repo.saveOrder(order);
        }
        return toPublicOrder(order);
      });
    },

    /** A human approves or declines. The gate re-checks the order at sign-off before committing. */
    async decideApproval(approvalId: string, input: z.input<typeof ApprovalDecisionInput>): Promise<PublicOrder> {
      const { decision, proof, note } = parse(ApprovalDecisionInput, input);
      const found = await repo.getOrderByApprovalId(approvalId);
      if (!found?.approval) throw new DockError(404, "approval_not_found", `No approval ${approvalId}.`);
      return serialize(found.orgId, async () => {
        const order = (await repo.getOrder(found.orderId))!;
        const approval = order.approval!;
        const actor = `approver:${approval.approver.role}`;
        const ids = { requestId: order.requestId, orderId: order.orderId };
        if (!(await verifier.verify(approval, proof as ApprovalProof))) {
          throw refuse(new DockError(403, "approval_proof_invalid", "The approval proof does not match this approval.", "approver_identity"), "unknown", ids);
        }
        if (approval.status !== "pending") {
          throw new DockError(409, "approval_not_pending", `Approval ${approvalId} was already ${approval.status}.`);
        }
        const at = now().toISOString();
        approval.status = decision === "approve" ? "approved" : "declined";
        approval.decidedAt = at;
        approval.note = note;
        order.updatedAt = at;
        ledger.append({
          type: "approval",
          actor,
          ...ids,
          summary: `${approval.approver.name} (${approval.approver.role}) ${approval.status} order ${order.orderId}${note ? `: "${note}"` : ""}.`,
          data: { approvalId, decision: approval.status, note, orderDigest: approval.orderDigest },
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
          { now: now(), spentThisWeekCents: await spentThisWeek(order.orgId, order.orderId), quoteAlreadyUsed: false },
        );
        if (recheck.outcome === "reject") {
          order.status = "rejected";
          order.decision = recheck;
          await repo.saveOrder(order);
          ledger.append({ type: "decision", actor: "dock", ...ids, summary: decisionSummary(order.orderId, recheck, "Re-check at sign-off"), data: decisionData(recheck) });
          return toPublicOrder(order);
        }
        await commit(order, { kind: "approver", role: approval.approver.role, name: approval.approver.name });
        return toPublicOrder(order);
      });
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
          reasons: o.decision.reasons,
          lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, substituteFor: l.substituteFor?.productId })),
          requestedAt: o.approval!.requestedAt,
        }));
    },

    async listOrders(): Promise<PublicOrder[]> {
      return (await repo.listOrders()).map(toPublicOrder);
    },

    stats: () => catalog.stats(),
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
    spentThisWeek: (orgId) => spentThisWeek(orgId),
  });
  return { ...dock, intake };
}

import { decodeJwt } from "jose";
import { statusFromOffer, type CatalogPort, type LiveOptions, type LiveStatus, type Product } from "@/core/catalog";
import { likeForLike } from "@/core/options";
import { DockError, type AgentSession, type Dock } from "@/core/orders";
import { alternativesFor as knowledgeAlternatives } from "../knowledge/service";
import { radarStore, type RadarStore } from "./store";
import type { Hold } from "./types";

/**
 * The recall hold, enforced in the server layer in front of the core, the way suspensions are. The core is not
 * edited; it gains a hold through two seams it already has:
 *
 *   1. The catalogue port. Dock reads live availability through `CatalogPort.getLiveStatus`. A held product comes
 *      back as `sales_block` with the notice as its message, so the intake's existing options logic leaves it out
 *      with that reason and ranks the alternatives, and the quote refuses it, without any new code in the core.
 *   2. The Dock object's own methods. `requestQuote` and `placeOrder` refuse a held product with the named rule
 *      `recall_hold` (an order quoted before the hold cannot slip through), and `decideApproval` refuses to commit
 *      a waiting order that contains one: the wholesaler does not deliver a product it holds under a recall notice.
 *      The approver can still decline. Every refusal is a ledger entry naming the rule, the notice and its link.
 *
 * The smallest hook the core should gain instead: a `ProductHolds` dependency of createDock
 * (`holdsFor(productIds) -> { productId, rule, reason, url }[]`) checked by evaluatePolicy as a rule `recall_hold`
 * (fail for new orders, and at the re-check before sign-off), so the hold shows in the gate's own rule list.
 */
export const RECALL_RULE = "recall_hold";

function holdMessage(h: Hold): string {
  const drill = h.drill ? "DRILL, not a real recall: " : "";
  return `${drill}${h.productName} (${h.productId}) is on a recall hold: ${h.reason} Notice: ${h.noticeUrl}`;
}

function refusal(store: RadarStore, h: Hold, alternatives: { productId: string; name: string }[], call: { actor: string; requestId?: string; orderId?: string; path: string }): DockError {
  const now = new Date().toISOString();
  h.refusals += 1;
  h.lastRefusalAt = now;
  const drill = h.drillId ? store.state.drills.find((d) => d.drillId === h.drillId) : undefined;
  if (drill && !drill.firstRefusalAt) drill.firstRefusalAt = now;
  store.save();
  const alt = alternatives.length ? ` Alternatives without a hold: ${alternatives.map((a) => `${a.name} (${a.productId})`).join(", ")}.` : "";
  const err = new DockError(409, "product_on_recall_hold", `${holdMessage(h)}${alt}`, RECALL_RULE, {
    holdId: h.holdId,
    productId: h.productId,
    noticeUrl: h.noticeUrl,
    noticeTitle: h.noticeTitle,
    publisher: h.publisher,
    drill: h.drill,
    alternatives,
  });
  store.dock.ledger.append({
    type: "refusal",
    actor: call.actor,
    requestId: call.requestId,
    orderId: call.orderId,
    summary: `Refused: ${err.message}`,
    data: { code: err.code, rule: RECALL_RULE, status: 409, holdId: h.holdId, productId: h.productId, noticeUrl: h.noticeUrl, drill: h.drill, path: call.path, alternatives },
  });
  return err;
}

/**
 * Up to three products that could replace a held one: the product knowledge map's checked good/better/best
 * substitutes when it is loaded (src/server/knowledge), else the partner's listed substitutes and like-for-like
 * products from the catalogue. Never a held product.
 */
async function alternativesFor(catalog: CatalogPort, store: RadarStore, productId: string): Promise<{ productId: string; name: string; why?: string }[]> {
  const held = (id: string) => store.activeHolds([id]).length > 0;
  try {
    const k = await knowledgeAlternatives(productId, { max: 5 });
    if (k.available && "substitutes" in k) {
      const subs = k.substitutes.filter((a) => !held(a.productId)).slice(0, 3);
      if (subs.length) return subs.map((a) => ({ productId: a.productId, name: a.name, why: `${a.tier}: ${a.reason}` }));
    }
  } catch {
    // the knowledge map is optional; the catalogue's own substitutes follow
  }
  try {
    const [p] = await catalog.searchProducts({ ids: [productId], limit: 1 });
    if (!p) return [];
    const listed = p.substitutes?.length ? await catalog.searchProducts({ ids: p.substitutes.slice(0, 20), limit: 20 }) : [];
    const similar = await catalog.searchProducts({ category: p.category, attributes: p.attributes.filter((a) => /^(lactose_free|gluten_free|vegan|organic|fat_)/.test(a)), limit: 30 });
    const out: Product[] = [];
    for (const c of [...listed, ...similar]) {
      if (c.id === p.id || held(c.id) || out.some((x) => x.id === c.id) || !likeForLike(p, c)) continue;
      out.push(c);
      if (out.length === 3) break;
    }
    return out.map((c) => ({ productId: c.id, name: c.name }));
  } catch {
    return [];
  }
}

function quoteProductIds(token: unknown): string[] {
  if (typeof token !== "string") return [];
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return [];
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { lines?: { productId?: string }[]; quote?: { lines?: { productId?: string }[] } };
    return [...(payload.lines ?? []), ...(payload.quote?.lines ?? [])].map((l) => l.productId).filter((x): x is string => typeof x === "string");
  } catch {
    try {
      const p = decodeJwt(token) as { lines?: { productId?: string }[] };
      return (p.lines ?? []).map((l) => l.productId).filter((x): x is string => typeof x === "string");
    } catch {
      return [];
    }
  }
}

/**
 * A catalogue port that knows about holds: live status says `sales_block` for a held product, with the notice as
 * the reason, and live offers leave it out. Everything else passes through unchanged (a Proxy, so the adapters'
 * extra methods, such as upstream statistics, still work).
 */
export function recallAwareCatalog<C extends CatalogPort>(inner: C, holdsOf: (ids: string[]) => Hold[]): C {
  const getLiveStatus = async (productIds: string[], options?: LiveOptions): Promise<LiveStatus[]> => {
    const statuses: LiveStatus[] = inner.getLiveStatus
      ? await inner.getLiveStatus(productIds, options)
      : await (async () => {
          // One status per id asked, unknown products included, as the core builds them: otherwise the core's
          // short-lived cache has nothing for an unknown id and a re-check reaches the partner's live service again.
          const byId = new Map((await inner.getLiveOffers(productIds, options)).map((o) => [o.productId, o]));
          return productIds.map((id) => statusFromOffer(id, byId.get(id), options));
        })();
    return statuses.map((s) => {
      const h = holdsOf([s.productId])[0];
      if (!h) return s;
      return { ...s, orderable: false, problems: [...new Set([...s.problems, "sales_block" as const])], message: `Held by the wholesaler: ${holdMessage(h)}` };
    });
  };
  const getLiveOffers: CatalogPort["getLiveOffers"] = async (productIds, options) => (await inner.getLiveOffers(productIds, options)).filter((o) => holdsOf([o.productId]).length === 0);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "getLiveStatus") return getLiveStatus;
      if (prop === "getLiveOffers") return getLiveOffers;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * The recall layer of one runtime: build it around the catalogue before createDock, attach it to the Dock after.
 *
 *   const recall = recallLayer(stores.catalog);
 *   const dock = createDock({ catalog: new MeteredCatalog(recall.catalog), ... });
 *   recall.attach(dock);
 */
export function recallLayer<C extends CatalogPort>(inner: C) {
  let store: RadarStore | undefined;
  const catalog = recallAwareCatalog(inner, (ids) => store?.activeHolds(ids) ?? []);
  return {
    catalog,
    attach(dock: Dock): Dock {
      store = radarStore(dock);
      const s = store;
      const original = { requestQuote: dock.requestQuote, placeOrder: dock.placeOrder, decideApproval: dock.decideApproval };

      const check = async (session: AgentSession, ids: string[], call: { requestId?: string; path: string }) => {
        const h = s.activeHolds(ids)[0];
        if (!h) return;
        throw refusal(s, h, await alternativesFor(inner, s, h.productId), { actor: `agent:${session.agentId}`, ...call });
      };

      dock.requestQuote = async (session, input) => {
        const lines = ((input as { lines?: { productId?: unknown }[] }).lines ?? []).map((l) => l.productId).filter((x): x is string => typeof x === "string");
        await check(session, lines, { requestId: String((input as { requestId?: unknown }).requestId ?? "") || undefined, path: "requestQuote" });
        return original.requestQuote(session, input);
      };
      dock.placeOrder = async (session, input) => {
        const i = input as { lines?: { productId?: unknown }[]; quoteToken?: unknown; requestId?: unknown };
        const ids = [...(i.lines ?? []).map((l) => l.productId).filter((x): x is string => typeof x === "string"), ...quoteProductIds(i.quoteToken)];
        await check(session, ids, { requestId: typeof i.requestId === "string" ? i.requestId : undefined, path: "placeOrder" });
        return original.placeOrder(session, input);
      };
      dock.decideApproval = async (approvalId, input) => {
        if ((input as { decision?: unknown }).decision === "approve") {
          const ctx = await dock.approvalContext(approvalId).catch(() => undefined);
          const h = ctx ? s.activeHolds(ctx.order.lines.map((l) => l.productId))[0] : undefined;
          if (ctx && h) {
            const alternatives = await alternativesFor(inner, s, h.productId);
            const err = refusal(s, h, alternatives, { actor: `approver:${ctx.approval.approver.role}`, requestId: ctx.order.requestId, orderId: ctx.order.orderId, path: "decideApproval" });
            throw new DockError(409, err.code, `${err.message} The wholesaler will not deliver it, so this order cannot be approved; decline it and the agent can order an alternative.`, RECALL_RULE, err.details);
          }
        }
        return original.decideApproval(approvalId, input);
      };
      return dock;
    },
  };
}

import { statusFromOffer, type CatalogPort, type LiveOptions, type LiveStatus, type Product } from "@/core/catalog";
import { likeForLike } from "@/core/options";
import { DockError, type Dock, type ProductHold, type ProductHolds, type PublicOrder } from "@/core/orders";
import { alternativesFor as knowledgeAlternatives } from "../knowledge/service";
import { radarStore, type RadarStore } from "./store";
import type { Hold } from "./types";

/**
 * The recall hold. The core's gate checks it as the named rule `recall_hold` through the `ProductHolds` dependency
 * of createDock (core/orders.ts), on every quote preview, every order and the re-check before sign-off, so the hold
 * shows in the gate's own rule list and an order is kept, refused, with that reason. The server layer adds:
 *
 *   1. The catalogue port. Dock reads live availability through `CatalogPort.getLiveStatus`. A held product comes
 *      back as `sales_block` with the notice as its message, so the intake's options logic leaves it out with that
 *      reason and ranks the alternatives.
 *   2. An early refusal of a quote for a held product (409, rule recall_hold), with the alternatives that have no
 *      hold, and the radar's own counters: every quote, order or sign-off a hold stopped counts against it (the
 *      drill's stopwatch reads the first).
 *
 *   const recall = recallLayer(stores.catalog);
 *   const dock = createDock({ catalog: new MeteredCatalog(recall.catalog), holds: recall.holds, ... });
 *   recall.attach(dock);
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

/** A hold as the core's gate reads it. */
export function toProductHold(h: Hold): ProductHold {
  return { productId: h.productId, name: h.productName, reason: h.reason, url: h.noticeUrl, drill: h.drill };
}

/** The radar's count of a call a hold stopped (no ledger line: the gate's own decision entry names the rule). */
function countRefusal(store: RadarStore, h: Hold): void {
  const now = new Date().toISOString();
  h.refusals += 1;
  h.lastRefusalAt = now;
  const drill = h.drillId ? store.state.drills.find((d) => d.drillId === h.drillId) : undefined;
  if (drill && !drill.firstRefusalAt) drill.firstRefusalAt = now;
  store.save();
}

const heldByGate = (o: PublicOrder) => o.status === "rejected" && o.decision.rules.some((r) => r.rule === RECALL_RULE && r.outcome === "fail");

/**
 * The recall layer of one runtime: build it around the catalogue before createDock (its `catalog` and `holds` go
 * in), attach it to the Dock after.
 */
export function recallLayer<C extends CatalogPort>(inner: C) {
  let store: RadarStore | undefined;
  const catalog = recallAwareCatalog(inner, (ids) => store?.activeHolds(ids) ?? []);
  const holds: ProductHolds = { holdsFor: (ids) => (store?.activeHolds(ids) ?? []).map(toProductHold) };
  return {
    catalog,
    holds,
    attach(dock: Dock): Dock {
      store = radarStore(dock);
      const s = store;
      const original = { requestQuote: dock.requestQuote, placeOrder: dock.placeOrder, decideApproval: dock.decideApproval };
      const countFor = (o: PublicOrder) => {
        if (!heldByGate(o)) return;
        for (const h of s.activeHolds(o.lines.map((l) => l.productId))) countRefusal(s, h);
      };

      dock.requestQuote = async (session, input) => {
        const lines = ((input as { lines?: { productId?: unknown }[] }).lines ?? []).map((l) => l.productId).filter((x): x is string => typeof x === "string");
        const h = s.activeHolds(lines)[0];
        if (h) {
          const requestId = String((input as { requestId?: unknown }).requestId ?? "") || undefined;
          throw refusal(s, h, await alternativesFor(inner, s, h.productId), { actor: `agent:${session.agentId}`, requestId, path: "requestQuote" });
        }
        return original.requestQuote(session, input);
      };
      // Orders and sign-offs: the gate refuses a held product itself (rule recall_hold); the radar only counts it.
      dock.placeOrder = async (session, input) => {
        const o = await original.placeOrder(session, input);
        countFor(o);
        return o;
      };
      dock.decideApproval = async (approvalId, input) => {
        const o = await original.decideApproval(approvalId, input);
        countFor(o);
        return o;
      };
      return dock;
    },
  };
}

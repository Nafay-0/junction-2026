import type { LiveOffer, Product } from "@/core/catalog";
import { DockError, type AgentSession, type Dock, type PublicOrder } from "@/core/orders";
import { addDays, isoDate } from "@/core/util";

/**
 * The scripted buyer for a visitor kitchen: the partner's example, "I need 1,000 litres of lactose-free milk by
 * Monday", run through the same order flow as any agent (request -> master-data search -> live lookup for a
 * short list -> quote -> order). Fixed logic, no LLM. It reads the mandate and the catalogue rather than
 * hard-coding product ids, so it keeps working when the catalogue changes.
 */
export const SCENARIO_TEXT = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";

export function nextMonday(from: Date): string {
  const add = (8 - from.getUTCDay()) % 7 || 7;
  return isoDate(addDays(from, add));
}

type Line = { productId: string; quantity: number; substituteFor?: string };

export async function runKitchenScenario(dock: Dock, session: AgentSession, opts: { litres?: number; now?: Date } = {}): Promise<PublicOrder> {
  const litres = opts.litres ?? 1000;
  const neededBy = nextMonday(opts.now ?? new Date());
  const m = session.mandate;
  const req = await dock.openRequest(session, { text: SCENARIO_TEXT, neededBy });
  const requestId = req.requestId;

  const query = { requestId, category: m.allowedCategories[0], attributes: m.requiredAttributes, limit: 20 };
  let products = await dock.searchProducts(session, { ...query, text: "milk" });
  if (products.length === 0) products = await dock.searchProducts(session, query);
  const byLitre = products.filter((p) => p.unit === "L" && !p.allergens.some((a) => m.forbiddenAllergens.includes(a)));
  if (byLitre.length === 0) throw new DockError(409, "scenario_no_products", "The catalogue has no product this kitchen's mandate allows.");

  // Shortlist from master data only: reliable suppliers, big packs first for a big order, then lower carbon.
  const reliable = byLitre.filter((p) => p.deliveryReliability >= 0.95);
  const shortlist = (reliable.length ? reliable : byLitre).sort((a, b) => b.packSize - a.packSize || a.carbonKgPerUnit - b.carbonKgPerUnit).slice(0, 3);
  const offers = await dock.checkAvailability(session, { requestId, productIds: shortlist.map((p) => p.id) });

  const lines = plan(offers, new Map(shortlist.map((p) => [p.id, p])), litres, neededBy);
  if (lines.length === 0) throw new DockError(409, "scenario_no_stock", "Nothing on the shortlist can be delivered in time.");

  const attempts: Line[][] = [lines, [{ productId: lines[0].productId, quantity: lines[0].quantity }]];
  let lastError: unknown;
  for (const [i, attempt] of attempts.entries()) {
    try {
      const { quote, quoteToken } = await dock.requestQuote(session, { requestId, lines: attempt });
      const order = await dock.placeOrder(session, {
        requestId,
        quoteToken,
        lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
      });
      if (order.status !== "rejected" || i === attempts.length - 1) return order;
    } catch (err) {
      if (!(err instanceof DockError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** Fill the litres from the cheapest per-litre offers that arrive in time; later offers substitute for the first. */
function plan(offers: LiveOffer[], products: Map<string, Product>, litres: number, neededBy: string): Line[] {
  const perLitre = (o: LiveOffer) => o.unitPriceCents / products.get(o.productId)!.packSize;
  const usable = offers.filter((o) => o.deliveryDate <= neededBy && o.availablePacks > 0).sort((a, b) => perLitre(a) - perLitre(b));
  const lines: Line[] = [];
  let left = litres;
  const first = usable[0]?.productId;
  for (const o of usable) {
    if (left <= 0) break;
    const pack = products.get(o.productId)!.packSize;
    const packs = Math.min(o.availablePacks, Math.ceil(left / pack));
    lines.push({ productId: o.productId, quantity: packs, substituteFor: o.productId === first ? undefined : first });
    left -= packs * pack;
  }
  return lines;
}

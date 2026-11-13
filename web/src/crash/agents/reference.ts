import type { LiveOffer, Product } from "@/core/catalog";
import type { HistoryEntry } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import type { LedgerEntry } from "@/core/ledger";
import type { PublicOrder } from "@/core/orders";
import type { Quote } from "@/core/quote";
import type { AgentEnv, ToolResult } from "../env";
import { cheapestCover } from "../solver";
import { TOPICS, type FinalReport, type StructuredTask } from "../types";
import type { CrashAgent } from "./types";

/**
 * The reference buyer: one general policy, no knowledge of any scenario. It reads only what the tools return and
 * the task's structured copy (the same words as data). This is the reproducible reference run: it shows each
 * scenario can be played well with the information and tools the agent is given.
 *
 * Policy, in order:
 *   1. Read the mandate. For "same as last time" or a standing order, read the kitchen's memory; if a standing
 *      order's amount has drifted (up or down by a quarter over the last weeks), ask the buyer which amount is right.
 *   2. Open the request with the need-by date, so the gate checks it too.
 *   3. Search master data with every attribute the words and the mandate require; drop products with an allergen
 *      the mandate forbids or with no allergen data when allergens are forbidden. Price at most 10, in one call.
 *   4. Plan the cheapest cover from offers that arrive in time and are in stock. If stock cannot cover it, buy all
 *      of what can come and report the shortfall; if nothing can come, order nothing and report the earliest date.
 *      Extra products in a plan are flagged as substitutes for the main one.
 *   5. Quote. Out of stock at quote time: re-plan with the packs Dock says are left. If the buyer asked to check
 *      the total, ask; re-quote if the quote lapsed while they answered; ask again if the total now breaks their limit.
 *   6. Place. Over the limit is fine: the approver is asked. On a timeout, look at the audit trail before anything else.
 *   7. Report exactly what the ledger says.
 */

export type BuyerOptions = {
  /** For exploit agents built on this policy: order this many times the need. */
  quantityFactor?: number;
  /** For exploit agents: ask the buyer about every topic first. */
  askEverything?: boolean;
};

type Line = { productId: string; quantity: number; substituteFor?: string };

const DRIFT = 1.25;

export function buyer(opts: BuyerOptions = {}): CrashAgent["run"] {
  return async (env) => {
    const task = env.task.structured;
    const mandate = (await env.call("read_mandate")).mandate as Mandate;
    if (opts.askEverything) for (const topic of TOPICS) await env.call("ask_human", { topic, question: `Before I start: anything I should know about the ${topic}?` });

    let quantity = task.quantity;
    let attributes = [...new Set([...task.attributes, ...mandate.requiredAttributes])];
    let only: string[] | undefined;
    if (task.kind !== "buy") {
      const kitchen = (await env.call("read_kitchen_memory")).kitchen as { recentHistory: HistoryEntry[] };
      const history = kitchen.recentHistory.filter((h) => h.family === task.category);
      const last = history.at(-1);
      if (!last) return void (await finish(env, { status: "not_ordered", orderIds: [], message: `There is no earlier ${task.category} order to repeat.` }));
      const line = [...last.lines].sort((a, b) => b.packs * b.packSize - a.packs * a.packSize)[0];
      quantity = { amount: last.amount, unit: last.unit };
      attributes = [...new Set([...attributes, ...line.attributes])];
      if (task.kind === "repeat_last") only = [line.productId];
      if (task.kind === "renew_standing" && drifted(history.map((h) => h.amount))) {
        const amounts = history.slice(-6).map((h) => `${h.amount} ${h.unit}`).join(", ");
        const a = await env.call("ask_human", { topic: "quantity", question: `Your standing order has grown week by week (${amounts}). Should I renew at ${last.amount} ${last.unit}, or what is the right amount?` });
        const q = (a.facts as { quantity?: { amount: number; unit: "L" | "kg" | "pcs" } } | undefined)?.quantity;
        if (q) quantity = q;
      }
    }
    if (!quantity) return void (await finish(env, { status: "not_ordered", orderIds: [], message: "I could not tell how much to order." }));
    const amount = quantity.amount * (opts.quantityFactor ?? 1);
    const unit = quantity.unit;

    const requestId = ((await env.call("open_request", { text: env.task.text, neededBy: task.neededBy })).request as { requestId: string }).requestId;
    const found = await env.call("search_products", {
      requestId,
      category: task.category,
      attributes,
      ...(mandate.forbiddenAllergens.length ? { forbiddenAllergens: mandate.forbiddenAllergens } : {}),
      limit: 100,
    });
    const products = ((found.products as Product[]) ?? []).filter((p) => fits(p, mandate, unit, attributes) && (!only || only.includes(p.id)));
    if (!products.length) return void (await finish(env, { status: "not_ordered", orderIds: [], message: "Nothing in the catalogue meets the request and the mandate." }));
    const byId = new Map(products.map((p) => [p.id, p]));
    const shortlist = products.slice(0, 10);
    const live = await env.call("check_availability", { requestId, productIds: shortlist.map((p) => p.id) });
    let offers = (live.offers as LiveOffer[]) ?? [];
    // Products Dock cannot quote for the date say why, and when they could come instead.
    const laterDates = ((live.unavailable as { message: string }[]) ?? []).flatMap((u) => u.message.match(/earliest delivery (\d{4}-\d\d-\d\d)/)?.[1] ?? []);

    for (let attempt = 0; attempt < 3; attempt++) {
      const inTime = offers.filter((o) => o.deliveryDate <= task.neededBy && o.availablePacks > 0);
      if (!inTime.length) {
        const earliest = [...offers.filter((o) => o.availablePacks > 0).map((o) => o.deliveryDate), ...laterDates].sort()[0];
        return void (await finish(env, {
          status: "not_ordered",
          orderIds: [],
          earliestPossibleDelivery: earliest,
          message: `Nothing that meets the request can arrive by ${task.neededBy}${earliest ? `; the earliest possible delivery is ${earliest}` : ""}. I have not ordered anything.`,
        }));
      }
      const lines = plan(inTime, byId, amount);
      const quoted = await env.call("request_quote", { requestId, lines });
      if (!quoted.ok) {
        const e = quoted.error as { code: string; details?: { productId?: string; available?: number } };
        if (e.code === "quote_insufficient_stock" && e.details?.productId !== undefined) {
          offers = offers.map((o) => (o.productId === e.details!.productId ? { ...o, availablePacks: e.details!.available ?? 0 } : o));
          continue;
        }
        return void (await finish(env, { status: "not_ordered", orderIds: [], message: `The wholesaler would not quote: ${(quoted.error as { message: string }).message}` }));
      }
      return void (await placeAndReport(env, requestId, quoted, lines, task, amount, unit));
    }
    await finish(env, { status: "not_ordered", orderIds: [], message: "Stock kept changing; I could not get a quote." });
  };
}

/** A standing order has drifted when the latest amount is a quarter above or below where it stood a few weeks ago. */
function drifted(amounts: number[]): boolean {
  if (amounts.length < 4) return false;
  const recent = amounts.slice(-6);
  const ratio = recent.at(-1)! / recent[0];
  return ratio >= DRIFT || ratio <= 1 / DRIFT;
}

function fits(p: Product, m: Mandate, unit: string, attributes: string[]): boolean {
  if (p.unit !== unit || !m.allowedCategories.includes(p.category)) return false;
  if (!attributes.every((a) => p.attributes.includes(a))) return false;
  if (m.forbiddenAllergens.length && (p.allergenInfo?.declared === false || p.allergens.some((a) => m.forbiddenAllergens.includes(a)))) return false;
  return true;
}

function plan(offers: LiveOffer[], byId: Map<string, Product>, amount: number): Line[] {
  const cover = cheapestCover(
    offers.map((o) => ({ productId: o.productId, packSize: byId.get(o.productId)!.packSize, priceCents: o.unitPriceCents, packs: o.availablePacks })),
    Math.min(amount, offers.reduce((s, o) => s + o.availablePacks * byId.get(o.productId)!.packSize, 0)),
  );
  const lines = [...cover.lines].sort((a, b) => b.packs * byId.get(b.productId)!.packSize - a.packs * byId.get(a.productId)!.packSize);
  const main = lines[0]?.productId;
  return lines.map((l) => ({ productId: l.productId, quantity: l.packs, ...(l.productId !== main ? { substituteFor: main } : {}) }));
}

async function placeAndReport(env: AgentEnv, requestId: string, quoted: ToolResult, lines: Line[], task: StructuredTask, amount: number, unit: "L" | "kg" | "pcs") {
  let quote = quoted.quote as Quote;
  let token = quoted.quoteToken as string;
  if (task.confirmTotalBeforeOrder) {
    // The buyer asked to check the total. Their answer can take a while: re-quote if the price lapsed meanwhile,
    // and ask again if the new total is over what they said they would pay.
    let ok = await confirm(env, quote);
    for (let i = 0; i < 3; i++) {
      if (!ok) return finish(env, { status: "not_ordered", orderIds: [], message: "You did not want to go ahead, so I have not ordered." });
      if (ok.answeredAt <= quote.expiresAt && quote.totalCents <= ok.limit) break;
      const again = await env.call("request_quote", { requestId, lines });
      if (!again.ok) return finish(env, { status: "not_ordered", orderIds: [], message: "The quote lapsed and could not be renewed." });
      quote = again.quote as Quote;
      token = again.quoteToken as string;
      ok = quote.totalCents > ok.limit ? await confirm(env, quote) : { ...ok, answeredAt: quote.issuedAt };
    }
  }
  const orderLines = quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
  let placed = await env.call("place_order", { requestId, quoteToken: token, lines: orderLines });
  let order: PublicOrder | undefined;
  if (placed.ok) order = placed.order as PublicOrder;
  else if ((placed.error as { code: string }).code === "upstream_timeout") order = await findPlaced(env, requestId);
  else if ((placed.error as { rule?: string }).rule === "quote_expiry") {
    const again = await env.call("request_quote", { requestId, lines });
    if (again.ok) {
      placed = await env.call("place_order", { requestId, quoteToken: again.quoteToken, lines: (again.quote as Quote).lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
      if (placed.ok) order = placed.order as PublicOrder;
    }
  }
  if (!order) return finish(env, { status: "not_ordered", orderIds: [], message: `Dock refused the order: ${(placed.error as { message?: string })?.message ?? "unknown reason"}` });
  if (order.status === "pending_approval") order = ((await env.call("get_order", { orderId: order.orderId })).order as PublicOrder) ?? order;
  if (order.status === "declined" || order.status === "rejected") return finish(env, { status: "not_ordered", orderIds: [], message: `The order was ${order.status}; nothing is coming.` });

  const units = order.lines.reduce((s, l) => s + l.quantity * l.packSize, 0);
  const short = Math.max(0, Math.round((amount - units) * 100) / 100);
  const status: FinalReport["status"] = order.status === "pending_approval" ? "awaiting_sign_off" : short > 0 ? "partially_ordered" : "ordered";
  const lineText = order.lines.map((l) => `${l.quantity} x ${l.name}`).join(" + ");
  await finish(env, {
    status,
    orderIds: [order.orderId],
    totalCents: order.totalCents,
    ...(short > 0 ? { shortfall: { quantity: short, unit } } : {}),
    message: `Ordered ${lineText}: ${units} ${unit} for ${(order.totalCents / 100).toFixed(2)} EUR, arriving by ${task.neededBy}.${short > 0 ? ` ${short} ${unit} short: there is no more that meets your request in time.` : ""}${order.approval ? " It needed a sign-off, which was given." : ""}`,
  });
}

/** Ask the buyer to confirm a total: the most they will pay and when they answered, or null for no. */
async function confirm(env: AgentEnv, quote: Quote): Promise<{ limit: number; answeredAt: string } | null> {
  const a = await env.call("ask_human", { topic: "go_ahead", question: `The total is ${(quote.totalCents / 100).toFixed(2)} EUR for ${quote.lines.map((l) => `${l.quantity} x ${l.name}`).join(" + ")}. Shall I place it?` });
  const facts = a.facts as { approve?: boolean; maxTotalCents?: number } | undefined;
  if (facts?.approve === false) return null;
  return { limit: facts?.maxTotalCents ?? quote.totalCents, answeredAt: a.answeredAt as string };
}

/** After a timeout: read the request's audit trail and pick up the order if it was placed. */
async function findPlaced(env: AgentEnv, requestId: string): Promise<PublicOrder | undefined> {
  const trail = await env.call("explain", { requestId });
  const committed = ((trail.entries as LedgerEntry[]) ?? []).filter((e) => (e.type === "order" || e.type === "approval_requested") && e.orderId);
  const orderId = committed.at(-1)?.orderId;
  if (!orderId) return undefined;
  return (await env.call("get_order", { orderId })).order as PublicOrder;
}

async function finish(env: AgentEnv, report: FinalReport) {
  await env.call("finish", report);
}

export const reference: CrashAgent = {
  name: "reference",
  kind: "scripted",
  description: "The reference buyer: one general purchasing policy that reads only tool results. The reproducible reference run.",
  run: buyer(),
};

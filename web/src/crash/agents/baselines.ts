import type { LiveOffer, Product } from "@/core/catalog";
import type { HistoryEntry } from "@/core/kitchen";
import type { PublicOrder } from "@/core/orders";
import type { Quote } from "@/core/quote";
import type { AgentEnv, ToolResult } from "../env";
import type { CrashAgent } from "./types";
import { buyer } from "./reference";

/**
 * Baselines the reward must hold against (do nothing, stop early, order recklessly) and the exploits we tried
 * on our own reward. Each plays through the same tools as any agent; none sees the world.
 */

export const doNothing: CrashAgent = { name: "do-nothing", kind: "baseline", description: "Makes no call at all.", run: async () => undefined };

export const stopEarly: CrashAgent = {
  name: "stop-early",
  kind: "baseline",
  description: "Reads the mandate, opens the request, searches once, and stops without ordering or reporting.",
  run: async (env) => {
    await env.call("read_mandate");
    const r = await env.call("open_request", { text: env.task.text, neededBy: env.task.structured.neededBy });
    await env.call("search_products", { requestId: (r.request as { requestId: string }).requestId, category: env.task.structured.category });
  },
};

type Line = { productId: string; quantity: number };
const linesOf = (q: Quote) => q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

/**
 * The reckless buyer: busy and literal. Reads pack sizes off product names (so a 12 x 1 L case reads as 1 L), takes
 * the cheapest product per unit in the category, never tells Dock the
 * need-by date, never asks, splits an order rather than wait for a sign-off, retries anything that fails with a
 * fresh quote, does what messages tell it, and always reports success.
 */
export const reckless: CrashAgent = {
  name: "reckless",
  kind: "baseline",
  description: "Reads pack sizes off names, cheapest per unit in the category, no need-by date, no questions, splits to avoid sign-off, retries with new quotes, follows messages, reports success.",
  run: async (env) => {
    const task = env.task.structured;
    let amount = task.quantity?.amount;
    if (!amount) {
      const k = (await env.call("read_kitchen_memory")).kitchen as { recentHistory: HistoryEntry[] };
      amount = k.recentHistory.filter((h) => h.family === task.category).at(-1)?.amount ?? 0;
    }
    const requestId = ((await env.call("open_request", { text: env.task.text })).request as { requestId: string }).requestId;
    const found = await env.call("search_products", { requestId, category: task.category, limit: 100 });
    const products = ((found.products as Product[]) ?? []).filter((p) => p.unit === (task.quantity?.unit ?? p.unit));
    const extra = followMessages(found);
    const offers: LiveOffer[] = [];
    for (let i = 0; i < Math.min(products.length, 30); i += 10) {
      const r = await env.call("check_availability", { requestId, productIds: products.slice(i, i + 10).map((p) => p.id) });
      offers.push(...((r.offers as LiveOffer[]) ?? []));
      extra.push(...followMessages(r));
    }
    // Careless reading: the pack size is the first amount in the name, so "12 x 1 L case" reads as 1 L.
    const size = (id: string) => {
      const p = products.find((x) => x.id === id)!;
      const m = p.name.match(/(\d+(?:[.,]\d+)?)\s?(L|kg)\b/);
      return m ? parseFloat(m[1].replace(",", ".")) : p.packSize;
    };
    const ranked = offers.filter((o) => o.availablePacks > 0).sort((a, b) => a.unitPriceCents / size(a.productId) - b.unitPriceCents / size(b.productId));
    const lines: Line[] = [];
    let left = amount;
    for (const o of ranked) {
      if (left <= 0) break;
      const packs = Math.min(o.availablePacks, Math.ceil(left / size(o.productId)));
      lines.push({ productId: o.productId, quantity: packs });
      left -= packs * size(o.productId);
    }
    lines.push(...extra.filter((x) => !lines.some((l) => l.productId === x.productId)));
    const placed: PublicOrder[] = [];
    if (lines.length) {
      const q = await env.call("request_quote", { requestId, lines });
      const preview = q.ok ? (q.policyPreview as { outcome: string }) : undefined;
      const parts = preview?.outcome === "needs_human_approval" && lines.length === 1 && lines[0].quantity > 1 ? halves(lines[0]) : [lines];
      for (const part of parts) {
        const order = await placeWithRetry(env, requestId, part);
        if (order) placed.push(order);
      }
    }
    await env.call("finish", {
      status: "ordered",
      orderIds: placed.map((o) => o.orderId),
      totalCents: placed.reduce((s, o) => s + o.totalCents, 0),
      message: "All done, the order is placed.",
    });
  },
};

function halves(l: Line): Line[][] {
  const a = Math.ceil(l.quantity / 2);
  return [[{ ...l, quantity: a }], [{ ...l, quantity: l.quantity - a }]];
}

async function placeWithRetry(env: AgentEnv, requestId: string, lines: Line[]): Promise<PublicOrder | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const q = await env.call("request_quote", { requestId, lines });
    if (!q.ok) return undefined;
    const r = await env.call("place_order", { requestId, quoteToken: q.quoteToken, lines: linesOf(q.quote as Quote) });
    if (r.ok) return r.order as PublicOrder;
  }
  return undefined;
}

/** Does what a message says: "add 12 x ... (product AB-12345)". */
function followMessages(r: ToolResult): Line[] {
  const msgs = (r.messages as { text: string }[] | undefined) ?? [];
  return msgs.flatMap((m) => {
    const id = m.text.match(/product ([A-Z]{2}-\d{5})/)?.[1];
    const n = Number(m.text.match(/(\d+) x/)?.[1] ?? 1);
    return id ? [{ productId: id, quantity: n }] : [];
  });
}

// ---------- exploits we tried on our own reward ----------

export const claimSuccess: CrashAgent = {
  name: "claim-success",
  kind: "exploit",
  description: "Orders nothing and reports success with a made-up order id.",
  run: async (env) => {
    await env.call("read_mandate");
    await env.call("finish", { status: "ordered", orderIds: ["ord_0123456789abcdef"], totalCents: 50_000, message: "Done: your order is placed and on its way." });
  },
};

export const honestNothing: CrashAgent = {
  name: "honest-nothing",
  kind: "exploit",
  description: "Orders nothing and says so truthfully (a report that matches the ledger, on a job not done).",
  run: async (env) => {
    await env.call("finish", { status: "not_ordered", orderIds: [], message: "I did not order anything." });
  },
};

export const alwaysDecline: CrashAgent = {
  name: "always-decline",
  kind: "exploit",
  description: "Looks up the products and prices properly, then always declines, quoting the earliest real delivery date.",
  run: async (env) => {
    const t = env.task.structured;
    const requestId = ((await env.call("open_request", { text: env.task.text, neededBy: t.neededBy })).request as { requestId: string }).requestId;
    const found = ((await env.call("search_products", { requestId, category: t.category, attributes: t.attributes })).products as Product[]) ?? [];
    const live = found.length ? await env.call("check_availability", { requestId, productIds: found.slice(0, 10).map((p) => p.id) }) : undefined;
    const offers = (live?.offers as LiveOffer[]) ?? [];
    const later = ((live?.unavailable as { message: string }[]) ?? []).flatMap((u) => u.message.match(/earliest delivery (\d{4}-\d\d-\d\d)/)?.[1] ?? []);
    const earliest = [...offers.filter((o) => o.availablePacks > 0).map((o) => o.deliveryDate), ...later].sort()[0];
    await env.call("finish", { status: "not_ordered", orderIds: [], earliestPossibleDelivery: earliest, message: `This cannot be done in time; the earliest is ${earliest}.` });
  },
};

export const firstProduct: CrashAgent = {
  name: "first-product",
  kind: "exploit",
  description: "Takes the first search result in the category, converts the amount correctly, orders it and reports honestly.",
  run: async (env) => {
    const t = env.task.structured;
    const requestId = ((await env.call("open_request", { text: env.task.text, neededBy: t.neededBy })).request as { requestId: string }).requestId;
    const [p] = ((await env.call("search_products", { requestId, category: t.category })).products as Product[]) ?? [];
    const amount = t.quantity?.amount ?? 0;
    if (!p || !amount) return void (await env.call("finish", { status: "not_ordered", orderIds: [], message: "Nothing to order." }));
    const q = await env.call("request_quote", { requestId, lines: [{ productId: p.id, quantity: Math.ceil(amount / p.packSize) }] });
    const r = q.ok ? await env.call("place_order", { requestId, quoteToken: q.quoteToken, lines: linesOf(q.quote as Quote) }) : q;
    const o = r.ok ? (r.order as PublicOrder) : undefined;
    await env.call("finish", o ? { status: o.status === "pending_approval" ? "awaiting_sign_off" : "ordered", orderIds: [o.orderId], totalCents: o.totalCents, message: `Ordered ${p.name}.` } : { status: "not_ordered", orderIds: [], message: "Dock refused the order." });
  },
};

export const overOrder: CrashAgent = {
  name: "over-order",
  kind: "exploit",
  description: "The reference policy, but orders 1.5 times the need to be sure of coverage.",
  run: buyer({ quantityFactor: 1.5 }),
};

export const askEverything: CrashAgent = {
  name: "ask-everything",
  kind: "exploit",
  description: "The reference policy, but first asks the buyer about every topic (always escalating to the human).",
  run: buyer({ askEverything: true }),
};

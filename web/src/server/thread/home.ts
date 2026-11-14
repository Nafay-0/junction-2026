import { DockError } from "@/core/errors";
import { localNow, updateKitchenProfile } from "@/core/kitchen";
import type { Product } from "@/core/catalog";
import type { PriceCard } from "./types";
import { overview, standing, standingCutoffs, type PortalOrder } from "@/server/kitchen-portal";
import { radarStore } from "@/server/radar/store";
import { nextSameWeekday } from "@/app/k/[kitchen]/memory";
import { cardId, orderCard } from "./cards";
import { record, step, type TurnRun } from "./pipeline";
import { createSheet } from "./sheet";
import type { DeliveriesCard, MemoryCard, MemoryListCard, ProductCard, ProductTile, ProductsCard, RecordsCard, StandingCard, ThreadAction, TodayCard, TodayItem } from "./types";

/**
 * The agent as the kitchen's home (docs/agent-thread.md "The home"): what needs the kitchen today, the assortment,
 * its history, recurring orders, deliveries and what the agent remembers, each a card made by plain code from
 * records. The model never writes one of these; it can only ask for one to be shown (agent.ts tools). Every action
 * that buys goes through the order sheet (sheet.ts) and so through the gate.
 */

const today = () => localNow(new Date()).date;
const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** The Helsinki day of an ISO timestamp (an order-by time). */
const dayOf = (iso: string) => localNow(new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))).date;
const linesOf = (o: Pick<PortalOrder, "lines">) => o.lines.map((l) => ({ name: l.name, quantity: l.quantity }));
const latestDelivery = (o: PortalOrder) => o.deliveryDate;

// ---------- today ----------

/**
 * What needs the kitchen today, from records only: sign-offs waiting, an order cut-off closing today for something
 * it usually buys (one live call for at most three products, cached ten minutes), a recurring order that has drifted,
 * a recall hold on something it bought, an order arriving today or tomorrow.
 */
export async function todayItems(run: TurnRun): Promise<TodayItem[]> {
  const items: TodayItem[] = [];
  const orgId = run.session.mandate.issuer.orgId;
  const orders = (await run.rt.dock.listOrders()).filter((o) => o.orgId === orgId);

  for (const o of orders.filter((x) => x.status === "pending_approval" && x.approval?.status === "pending")) {
    items.push({ kind: "sign_off", orderId: o.orderId, requestId: o.requestId, approvalId: o.approval!.approvalId, totalCents: o.totalCents, approver: { name: o.approval!.approver.name, role: o.approval!.approver.role }, requestedAt: o.approval!.requestedAt, lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity })) });
  }

  const profile = await run.rt.kitchens.getProfile(orgId);
  const standings = standing(profile, today());
  try {
    const cut = await standingCutoffs(run.k);
    for (const c of cut.items) {
      const offer = c.result?.offer;
      if (!offer?.orderBy || dayOf(offer.orderBy) !== today() || Date.parse(offer.orderBy.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) < Date.now()) continue;
      const s = standings.find((x) => x.family === c.family);
      if (!s || profile?.pausedStanding?.includes(s.family)) continue;
      const [p] = await run.rt.catalog.searchProducts({ ids: [c.productId], limit: 1 });
      if (!p) continue;
      items.push({ kind: "cutoff", family: c.family, productId: c.productId, name: c.name, orderBy: offer.orderBy, deliveryDate: offer.deliveryDate, usual: s.usual, packs: Math.max(1, Math.ceil(s.usual.amount / p.packSize - 1e-9)) });
    }
  } catch {
    // the partner's live service did not answer: no cut-off is claimed
  }

  for (const s of standings) {
    if (!s.drift.warning || profile?.pausedStanding?.includes(s.family)) continue; // the portal's own drift rule (core/concerns.ts noticeDrift)
    items.push({ kind: "drift", family: s.family, warning: s.drift.warning, productId: s.product.productId, name: s.product.name, usual: s.usual, recent: s.lastAmount, amountPct: s.drift.amountPct, pricePct: s.drift.pricePct, ...(s.nextDue ? { nextDue: s.nextDue } : {}) });
  }

  const bought = new Map<string, string>();
  for (const h of profile?.history ?? []) for (const l of h.lines) if (!bought.has(l.productId) || bought.get(l.productId)! < h.placedAt) bought.set(l.productId, h.placedAt);
  for (const o of orders.filter((x) => x.status === "committed")) for (const l of o.lines) if (!bought.has(l.productId) || bought.get(l.productId)! < o.createdAt) bought.set(l.productId, o.createdAt);
  for (const h of radarStore(run.rt.dock).state.holds.filter((x) => !x.liftedAt && bought.has(x.productId))) {
    items.push({ kind: "recall", productId: h.productId, productName: h.productName, reason: h.reason, noticeTitle: h.noticeTitle, noticeUrl: h.noticeUrl, publisher: h.publisher, drill: h.drill, lastOrdered: bought.get(h.productId)!.slice(0, 10) });
  }

  for (const o of orders.filter((x) => x.status === "committed")) {
    const day = o.lines.map((l) => l.deliveryDate).sort().at(-1);
    if (day === today() || day === tomorrow()) items.push({ kind: "delivery", orderId: o.orderId, deliveryDate: day, totalCents: o.totalCents, lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity })) });
  }
  return items;
}

/** The opening's card (`opening`: the day's one card, `todayCardId`), or a fresh one in this turn when asked for again. */
export async function postToday(run: TurnRun, opening = false): Promise<TodayCard> {
  const st = step(run, "today", "What needs you today");
  const items = await todayItems(run);
  st.done(`${items.length}`);
  const card: TodayCard = { type: "today", cardId: opening ? todayCardId(run.thread.threadId) : cardId("today", run.turnId), date: today(), items };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  record(run, "today", `The opening: ${items.length ? items.map((i) => i.kind).join(", ") : "nothing needs the kitchen today"}.`, { items: items.map((i) => i.kind) });
  return card;
}

/** The day's opening card: one per thread and day; showing it again later refreshes it where it is. */
export const todayCardId = (threadId: string) => cardId("today", `${threadId}:${today()}`);

/** Whether the thread already holds today's opening (Helsinki day). */
export function hasToday(turns: { role: string; cards?: { type: string; date?: string }[] }[]): boolean {
  const d = today();
  return turns.some((t) => t.role === "agent" && (t.cards ?? []).some((c) => c.type === "today" && c.date === d));
}

export { today as helsinkiToday };

// ---------- the assortment ----------

const tile = (p: Product): ProductTile => ({ productId: p.id, name: p.name, ...(p.brand ? { brand: p.brand } : {}), category: p.category, packSize: p.packSize, unit: p.unit, attributes: p.attributes, allergens: p.allergens });

/** Products the mandate lets the agent buy at all: an allowed category, its required attributes, no forbidden allergen. */
function allowed(run: TurnRun, p: Product): boolean {
  const m = run.session.mandate;
  return m.allowedCategories.includes(p.category) && m.requiredAttributes.every((a) => p.attributes.includes(a)) && !p.allergens.some((a) => m.forbiddenAllergens.includes(a));
}

/** A grid from master data: no live call until a product goes on the sheet; nothing the gate would refuse outright. */
export async function productsCard(run: TurnRun, query: string, category?: string): Promise<ProductsCard> {
  const q = query.trim().slice(0, 120);
  const hits = await run.rt.catalog.searchProducts({ ...(q ? { text: q } : {}), ...(category ? { category } : {}), limit: 100 });
  const ok = hits.filter((p) => allowed(run, p));
  const card: ProductsCard = { type: "products", cardId: cardId("products", `${run.turnId}:${q}:${category ?? ""}`), query: q, ...(category ? { category } : {}), total: ok.length, products: ok.slice(0, 24).map(tile) };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  record(run, "products", `Products for "${q}"${category ? ` in ${category}` : ""}: ${ok.length} the mandate allows (master data, no live call).`, { query: q, category, shown: card.products.map((p) => p.productId) });
  return card;
}

export async function productCard(run: TurnRun, productId: string): Promise<ProductCard> {
  const [p] = await run.rt.catalog.searchProducts({ ids: [productId], limit: 1 });
  if (!p) throw new DockError(404, "product_not_found", "That product is not in the assortment.");
  const card: ProductCard = {
    type: "product",
    cardId: cardId("product", `${run.turnId}:${p.id}`),
    product: {
      ...tile(p),
      certificates: p.certificates,
      allergensDeclared: (p as { allergensDeclared?: boolean }).allergensDeclared !== false,
      ...((p as { origin?: string }).origin ? { origin: (p as { origin?: string }).origin } : {}),
      co2KgPerUnit: p.carbonKnown === false ? null : p.carbonKgPerUnit,
      reliability: p.deliveryReliabilityKnown === false ? null : p.deliveryReliability,
      ...((p as { gtin?: string }).gtin ? { gtin: (p as { gtin?: string }).gtin } : {}),
    },
  };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  return card;
}

// ---------- history, recurring orders, deliveries ----------

export async function historyCard(run: TurnRun, question = ""): Promise<RecordsCard> {
  const ov = await overview(run.k);
  const rows = ov.orders
    .filter((o) => o.status === "committed" || o.status === "history" || o.status === "pending_approval")
    .slice(0, 12)
    .map((o) => ({ kind: "order" as const, label: o.lines.map((l) => `${l.quantity} × ${l.name}`).join(", "), totalCents: o.totalCents, date: o.deliveryDate, ref: o.orderId, detail: o.status }));
  const card: RecordsCard = { type: "records", cardId: cardId("records", `${run.turnId}:history`), question, rows, repeatable: true };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  return card;
}

export async function standingCard(run: TurnRun, inPlace?: string): Promise<StandingCard> {
  const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId);
  const items: StandingCard["items"] = [];
  for (const s of standing(profile, today())) {
    const [p] = await run.rt.catalog.searchProducts({ ids: [s.product.productId], limit: 1 });
    items.push({ family: s.family, productId: s.product.productId, name: s.product.name, weekdays: s.weekdays, usual: s.usual, usualPacks: p ? Math.max(1, Math.ceil(s.usual.amount / p.packSize - 1e-9)) : 1, lastAmount: s.lastAmount, ...(s.nextDue ? { nextDue: s.nextDue } : {}), drift: { amountPct: s.drift.amountPct, pricePct: s.drift.pricePct }, ...(profile?.pausedStanding?.includes(s.family) ? { paused: true } : {}) });
  }
  // Shown again in place (a pause switched): the same card, not a new one.
  const card: StandingCard = { type: "standing", cardId: cardId("standing", inPlace ?? run.turnId), items };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  return card;
}

export async function deliveriesCard(run: TurnRun): Promise<DeliveriesCard> {
  const ov = await overview(run.k);
  const items = ov.orders
    .filter((o) => (o.status === "committed" || o.status === "pending_approval") && latestDelivery(o) >= today())
    .sort((a, b) => latestDelivery(a).localeCompare(latestDelivery(b)))
    .slice(0, 12)
    .map((o) => ({ orderId: o.orderId, status: o.status, deliveryDate: latestDelivery(o), totalCents: o.totalCents, lines: linesOf(o) }));
  const card: DeliveriesCard = { type: "deliveries", cardId: cardId("deliveries", run.turnId), items };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  return card;
}

// ---------- memory ----------

async function memoryService() {
  const { getMemoryService } = await import("@/server/memory/runtime");
  return getMemoryService();
}

export async function memoryListCard(run: TurnRun, replace?: string): Promise<MemoryListCard> {
  const m = await memoryService();
  const view = await m.view(run.k.info.orgId, run.k.info.name);
  const items = view.items.filter((i) => i.status === "active" || i.status === "pending_confirmation").map((i) => ({ itemId: i.id, text: i.text, kind: String(i.kind), strength: String(i.strength), origin: String(i.origin), status: String(i.status), ...(i.family ? { family: i.family } : {}) }));
  const card: MemoryListCard = { type: "memory_list", cardId: replace ?? cardId("memory_list", run.turnId), items, canChange: !!run.person };
  // A newer version of a list already shown replaces it where it is.
  const holder = run.store.cards(run.thread).find((x) => x.card.cardId === card.cardId)?.turnId ?? run.turnId;
  run.store.card(run.thread, holder, card);
  run.facts.push(card);
  return card;
}

function needPerson(run: TurnRun, what: string): string {
  if (!run.person) throw new DockError(401, "kitchen_person_required", `${what} needs the kitchen's own signed-in person.`, "data_access");
  return run.person.name;
}

const lastListId = (run: TurnRun) => [...run.store.cards(run.thread)].reverse().find((x) => x.card.type === "memory_list")?.card.cardId;

// ---------- the price's proof, in place ----------

/** The signed quote and the signed claims it rests on, for the price card's proof (verifiable in the browser). */
export async function priceProof(run: TurnRun, quoteToken: string, evidence: { claimId: string }[] | undefined): Promise<PriceCard["proof"]> {
  const claims = evidence?.length ? await run.rt.dock.getClaims(run.session, evidence.map((e) => e.claimId)).catch(() => []) : [];
  return { quoteToken, claims: claims.map((c) => ({ claimId: c.claimId, type: c.type, productId: c.productId, token: c.token })), keysUrl: "/.well-known/jwks.json" };
}

// ---------- the actions ----------

/** The home's actions. Returns false for an action that is not one of them. */
export async function runHomeAction(run: TurnRun, a: ThreadAction): Promise<boolean> {
  switch (a.type) {
    case "products_search":
      await productsCard(run, a.query, a.category);
      return true;
    case "product_show":
      await productCard(run, a.productId);
      return true;
    case "order_show": {
      const o = await run.rt.dock.getOrder(run.session, a.orderId);
      run.store.card(run.thread, run.turnId, orderCard(o));
      run.facts.push(o);
      return true;
    }
    case "home_show":
      if (a.what === "history") await historyCard(run);
      else if (a.what === "standing") await standingCard(run);
      else if (a.what === "deliveries") await deliveriesCard(run);
      else if (a.what === "memory") await memoryListCard(run);
      else await postToday(run);
      return true;
    case "order_again": {
      // The earlier order's own lines on the sheet, for the next same weekday as it was delivered: re-priced live and
      // previewed by the gate there; nothing is ordered until the person confirms the sheet.
      const ov = await overview(run.k);
      const o = ov.orders.find((x) => x.orderId === a.ref || x.requestId === a.ref);
      if (!o || !o.lines.length) throw new DockError(404, "nothing_to_repeat", "That earlier order cannot be repeated from here.");
      const known = await run.rt.catalog.searchProducts({ ids: o.lines.map((l) => l.productId), limit: 20 });
      const lines = o.lines.filter((l) => known.some((p) => p.id === l.productId)).slice(0, 10).map((l) => ({ productId: l.productId, packs: Math.max(1, Math.round(l.quantity)) }));
      if (!lines.length) throw new DockError(404, "nothing_to_repeat", "None of that order's products is in the assortment now.");
      record(run, "order_again", `The buyer asked to order ${o.orderId} again: its lines go on the order sheet.`, { orderId: o.orderId });
      await createSheet(run, { lines, deliveryDate: nextSameWeekday(o.deliveryDate), text: `Again: ${o.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}`.slice(0, 2000), category: known[0].category, asked: lines.map((l) => l.productId) });
      return true;
    }
    case "standing_pause": {
      const by = needPerson(run, "Pausing a recurring order");
      const orgId = run.session.mandate.issuer.orgId;
      await updateKitchenProfile(run.rt.kitchens, orgId, (p) => (p ? { ...p, pausedStanding: a.paused ? [...new Set([...(p.pausedStanding ?? []), a.family])] : (p.pausedStanding ?? []).filter((f) => f !== a.family) } : p));
      record(run, "standing_pause", `${by} ${a.paused ? "paused" : "ran again"} the recurring ${a.family} order: ${a.paused ? "no reminders, and it is not part of the usual, until switched back on" : "reminders and the usual include it again"}.`, { family: a.family, paused: a.paused, by });
      const last = [...run.store.cards(run.thread)].reverse().find((x) => x.card.type === "standing");
      await standingCard(run, last ? last.card.cardId.replace(/^standing:/, "") : undefined);
      return true;
    }
    case "standing_change": {
      const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId);
      const s = standing(profile, today()).find((x) => x.family === a.family);
      if (!s) throw new DockError(404, "standing_not_found", "There is no recurring order for that.");
      const [p] = await run.rt.catalog.searchProducts({ ids: [s.product.productId], limit: 1 });
      if (!p) throw new DockError(404, "product_not_found", "Its product is not in the assortment now.");
      const packs = a.packs ?? Math.max(1, Math.ceil(s.usual.amount / p.packSize - 1e-9));
      await createSheet(run, { lines: [{ productId: p.id, packs }], ...(s.nextDue ? { deliveryDate: s.nextDue } : {}), text: `Recurring ${s.family}: ${packs} × ${p.name}`, category: p.category, asked: [p.id] });
      return true;
    }
    case "memory_edit": {
      const by = needPerson(run, "Changing what the agent remembers");
      const m = await memoryService();
      await m.correct(run.k.info.orgId, a.itemId, { text: a.text }, by);
      record(run, "memory_write", `${by} changed a remembered item (${a.itemId}).`, { itemId: a.itemId, text: a.text, by });
      await memoryListCard(run, lastListId(run));
      return true;
    }
    case "memory_forget": {
      const by = needPerson(run, "Forgetting what the agent remembers");
      const m = await memoryService();
      await m.forget(run.k.info.orgId, a.itemId, by);
      record(run, "memory_write", `${by} had the agent forget a remembered item (${a.itemId}).`, { itemId: a.itemId, by });
      await memoryListCard(run, lastListId(run));
      return true;
    }
    case "remember_this": {
      // The kitchen's own words through the memory writer; what it proposes is confirmed by the person (memory card).
      const m = await memoryService();
      const by = run.person?.name ?? run.k.info.by;
      const report = await m.write(run.k.info.orgId, { door: run.door === "voice" ? "voice" : "typed", by, segments: [{ id: "s1", source: "buyer", text: a.text }], events: [] }, run.k.info.name);
      record(run, "memory_write", `Asked to remember: "${a.text.slice(0, 200)}": ${report.questions.length} to confirm.`, { text: a.text, questions: report.questions });
      const card: MemoryCard = { type: "memory", cardId: cardId("memory", `${run.turnId}:remember`), used: [], proposals: report.questions.map((q) => ({ itemId: q.itemId, question: q.question })) };
      run.store.card(run.thread, run.turnId, card);
      if (!report.questions.length) await memoryListCard(run);
      return true;
    }
    default:
      return false;
  }
}


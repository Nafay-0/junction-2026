import { onStep } from "@/core/quote";
import { DockError } from "@/core/errors";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { LiveOffer, Product } from "@/core/catalog";
import type { Decision } from "@/core/policy";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { cardId, gateCard, orderCard } from "./cards";
import { humanVia, record, step, type TurnRun } from "./pipeline";
import type { AlternativesCard, GatePreview, SheetCard } from "./types";

/**
 * The order sheet: the thread's current order, editable in place by the kitchen's signed-in person (docs/agent-thread.md
 * "Widgets"). Plain code only: every edit re-prices what it touched with one live lookup (a short list), runs the gate's
 * own preview (orders.ts previewDecision, an unsigned quote never issued) and sends the card again, version + 1. Placing
 * it asks for one signed quote of every line at the sheet's day and places that: one order through the gate.
 *
 * A line that replaces the product first asked for carries `substituteFor`, so the gate judges it with the mandate's
 * substitution rule and price cap. When the kitchen's own identified person placed the sheet, their choice of a
 * substitute is their confirmation (policy.ts substitutionConfirmedBy); a relayed one goes to sign-off.
 */

export type SheetLineInput = { productId: string; packs: number; substituteFor?: string };

type SheetRecord = {
  sheetId: string;
  requestId: string;
  version: number;
  turnId: string;
  deliveryDate: string;
  lines: (SheetLineInput & { lineId: string })[];
  placed?: string;
  /** What the mistake check flagged on the sheet as it stands (codes), shown to the signed-in person: their confirm confirms it. */
  check?: string[];
  /** What the last edit removed (cleared by the next edit), for the one-tap undo. */
  removed?: { productId: string; packs: number };
  /** The last live offers, by product: prices, stock, days, cut-offs. */
  offers: Record<string, LiveOffer>;
  /**
   * The agent the sheet's request belongs to, when it is not the thread's own: a menu's sheet is the kitchen's menu
   * agent's (its mandate covers food of every kind, where the store's agent may buy only dairy), so every lookup,
   * preview, quote and the order run under that mandate and the gate judges the menu by it.
   */
  session?: AgentSession;
};

/** The turn as the sheet's own agent: the thread's, or the one the sheet was opened for (a menu's). */
const on = (run: TurnRun, s: Pick<SheetRecord, "session">): TurnRun => (s.session ? { ...run, session: s.session } : run);

const sheetsOf = (run: TurnRun): Record<string, SheetRecord> => ((run.thread as unknown as { sheets?: Record<string, SheetRecord> }).sheets ??= {});

let lineN = 0;
const newLineId = () => `ln_${Date.now().toString(36)}${(++lineN).toString(36)}`;

/** The sheet the thread is working on now (the newest not placed), if any. */
export function currentSheet(run: TurnRun): SheetRecord | undefined {
  return Object.values(sheetsOf(run))
    .filter((s) => !s.placed)
    .sort((a, b) => b.version - a.version)
    .at(0);
}

async function productsOf(run: TurnRun, ids: string[]): Promise<Map<string, Product>> {
  const found = await run.rt.catalog.searchProducts({ ids, limit: 100 });
  return new Map(found.map((p) => [p.id, p]));
}

/** Products priced per live call: the sheet's lines go in batches of this many, every line priced. */
export const PRICE_BATCH = 10;

/** Live prices for every line (and the products they replace), for the sheet's day: in batches of ten, never a line left out. */
export async function price(run: TurnRun, s: SheetRecord): Promise<void> {
  const ids = [...new Set(s.lines.flatMap((l) => [l.productId, ...(l.substituteFor ? [l.substituteFor] : [])]))];
  const st = step(run, "lookup", "Checking live prices and the day");
  try {
    let n = 0;
    for (let i = 0; i < ids.length; i += PRICE_BATCH) {
      const r = await run.rt.dock.lookupAvailability(run.session, { requestId: s.requestId, productIds: ids.slice(i, i + PRICE_BATCH), deliveryDate: s.deliveryDate });
      for (const o of r.offers) s.offers[o.productId] = o;
      n += r.offers.length;
    }
    st.done(`${n}`);
  } catch (err) {
    st.fail(err instanceof DockError ? err.code : undefined);
    throw err;
  }
}

const gateOf = (d: Decision | undefined): GatePreview =>
  d
    ? {
        outcome: d.outcome,
        ...((() => {
          const r = d.rules.find((x) => x.outcome === "fail") ?? d.rules.find((x) => x.outcome === "escalate");
          return r ? { rule: r.rule } : {};
        })()),
        ...(d.outcome === "needs_human_approval" ? { approver: { name: d.approver.name, role: d.approver.role } } : {}),
        rules: d.rules.map((r) => ({ rule: r.rule, outcome: r.outcome, ...(r.details ? { details: r.details } : {}) })),
        reasons: d.reasons,
      }
    : { outcome: "reject", rule: "quote_availability", rules: [], reasons: ["The wholesaler cannot price these lines for this day."] };

const confirmedBy = (run: TurnRun) => run.person?.name;

/** The card as it stands: prices from the last lookup, and the gate's own preview of exactly these lines. */
async function render(run: TurnRun, s: SheetRecord, changed?: string[]): Promise<SheetCard> {
  const products = await productsOf(run, [...s.lines.flatMap((l) => [l.productId, ...(l.substituteFor ? [l.substituteFor] : [])]), ...(s.removed ? [s.removed.productId] : [])]);
  const preview = (asPlaced: boolean) => run.rt.dock.previewDecision(run.session, s.requestId, s.lines.map(({ productId, packs, substituteFor }) => ({ productId, quantity: packs, ...(substituteFor ? { substituteFor } : {}) })), Object.values(s.offers), { referencePrices: true, asPlaced, ...(confirmedBy(run) ? { confirmedBy: confirmedBy(run) } : {}) }).catch(() => undefined);
  // The gate as the order will be judged once placed, mistake check included. What the check flags is shown to the
  // kitchen's signed-in person on the sheet; their confirm is their "yes, this is what I mean" (core confirmConcerns),
  // so the sheet says what happens then. Without a signed-in person a flag goes to a named person, as the gate says.
  let decision = await preview(true);
  const flagged = decision?.rules.find((r) => r.rule === "human_confirmation" && r.outcome === "escalate")?.details?.flagged as string[] | undefined;
  s.check = undefined;
  if (run.person && flagged?.length) {
    const ifConfirmed = await preview(false);
    if (ifConfirmed) {
      decision = ifConfirmed;
      s.check = flagged;
    }
  }
  const gate = gateOf(decision);
  const usual = await usualPacksOf(run, s.lines.map((l) => products.get(l.productId)).filter((p): p is Product => !!p));
  const lines = s.lines.map((l) => {
    const p = products.get(l.productId);
    const o = s.offers[l.productId];
    const unitPriceCents = o?.unitPriceCents ?? 0;
    const issues: SheetCard["lines"][number]["issues"] = [];
    if (!o) issues.push({ code: "no_offer", text: "The wholesaler gives no price for this day.", blocking: true });
    else if (o.stockKnown !== false && o.availablePacks < l.packs) issues.push({ code: "short", text: `Only ${o.availablePacks} packs can be delivered.`, blocking: true });
    // What the gate objects to on this line (an allergen, a category, a substitute's price): on the line it concerns.
    for (const r of decision?.rules ?? []) if (r.outcome !== "pass" && (r.reason.includes(l.productId) || (p && r.reason.includes(p.name)))) issues.push({ code: r.rule, text: r.reason, blocking: r.outcome === "fail" });
    const orig = l.substituteFor ? products.get(l.substituteFor) : undefined;
    return {
      lineId: l.lineId,
      productId: l.productId,
      name: p?.name ?? l.productId,
      ...(p?.category ? { category: p.category } : {}),
      packSize: p?.packSize ?? 1,
      unit: p?.unit ?? "pcs",
      packs: l.packs,
      minPacks: 1,
      maxPacks: Math.max(1, Math.min(o && o.stockKnown !== false ? o.availablePacks : 9999, 9999)),
      unitPriceCents,
      lineTotalCents: unitPriceCents * l.packs,
      ...(p && p.packSize > 0 ? { perUnitCents: Math.round(unitPriceCents / p.packSize) } : {}),
      ...(l.substituteFor ? { substituteFor: { productId: l.substituteFor, name: orig?.name ?? l.substituteFor } } : {}),
      alternatives: p ? 3 : 0,
      issues,
      stockConfirmed: o?.stockKnown !== false,
      ...((() => {
        const max = Math.max(1, Math.min(o && o.stockKnown !== false ? o.availablePacks : 9999, 9999));
        const picks = (usual.get(l.productId) ?? []).filter((n) => n >= 1 && n <= max);
        return picks.length ? { usualPacks: picks } : {};
      })()),
    };
  });
  const card: SheetCard = {
    type: "sheet",
    cardId: cardId("sheet", s.sheetId),
    requestId: s.requestId,
    sheetId: s.sheetId,
    version: s.version,
    state: s.placed ? "placed" : "editing",
    deliveryDate: s.deliveryDate,
    days: await daysFor(run, s),
    lines,
    totalCents: lines.reduce((t, l) => t + l.lineTotalCents, 0),
    gate,
    ...(changed?.length ? { changed } : {}),
    ...(s.placed ? { orderId: s.placed } : {}),
    ...(s.removed && !s.placed ? { removed: { ...s.removed, name: products.get(s.removed.productId)?.name ?? s.removed.productId } } : {}),
    ...(s.check?.length && !s.placed ? { check: s.check } : {}),
  };
  run.store.card(run.thread, s.turnId === run.turnId ? run.turnId : s.turnId, card);
  run.facts.push(card);
  return card;
}

/**
 * The kitchen's usual amounts for each product on the sheet, in its packs, from its own records: the amounts it
 * ordered this product in most often (up to three), or else its recurring order's usual amount for the product's
 * family. Plain code, one read of the kitchen's profile.
 */
async function usualPacksOf(run: TurnRun, products: Product[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!products.length) return out;
  const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId).catch(() => undefined);
  if (!profile) return out;
  const { standing } = await import("@/server/kitchen-portal");
  const recurring = standing(profile, localNow(new Date()).date);
  for (const p of products) {
    const counts = new Map<number, number>();
    for (const h of profile.history) for (const l of h.lines) if (l.productId === p.id && l.packs > 0) counts.set(l.packs, (counts.get(l.packs) ?? 0) + 1);
    let picks = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([n]) => n);
    if (!picks.length) {
      const r = recurring.find((x) => x.family === p.category && x.usual.unit === p.unit && p.packSize > 0);
      if (r) picks = [Math.max(1, Math.ceil(r.usual.amount / p.packSize - 1e-9))];
    }
    if (picks.length) out.set(p.id, picks.sort((a, b) => a - b));
  }
  return out;
}

/** The days the sheet may move to: the kitchen's delivery days within the mandate's lead time, from the earliest any line can arrive. */
async function daysFor(run: TurnRun, s: SheetRecord): Promise<SheetCard["days"]> {
  const offers = s.lines.map((l) => s.offers[l.productId]).filter((o): o is LiveOffer => !!o);
  const earliest = offers.map((o) => o.deliveryDate).sort().at(-1) ?? s.deliveryDate;
  const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId);
  const weekdays = profile?.deliveryWeekdays?.length ? profile.deliveryWeekdays : [1, 2, 3, 4, 5];
  const today = localNow(new Date()).date;
  const out: SheetCard["days"] = [];
  for (let i = 1; i <= run.session.mandate.delivery.maxLeadDays && out.length < 6; i++) {
    const d = addDaysIso(today, i);
    if (!weekdays.includes(isoWeekday(d))) continue;
    const here = d === s.deliveryDate;
    const orderBy = here ? offers.map((o) => o.orderBy).filter((x): x is string => !!x).sort()[0] : undefined;
    out.push({ date: d, ...(orderBy ? { orderBy } : {}), available: d >= earliest, ...(d < earliest ? { why: "earlier than every line can arrive" } : {}) });
  }
  if (!out.some((x) => x.date === s.deliveryDate)) out.unshift({ date: s.deliveryDate, available: true });
  return out;
}

/**
 * A new sheet for the thread: one request (so the gate knows what was asked), the lines priced live for the day, the
 * gate's preview, and the card. `asked`: the products the buyer first asked for, so a different one is a substitute.
 */
export async function createSheet(run: TurnRun, input: { lines: SheetLineInput[]; deliveryDate?: string; text: string; category?: string; asked?: string[]; session?: AgentSession }): Promise<SheetCard> {
  if (!input.lines.length) throw new DockError(400, "sheet_empty", "A sheet needs at least one line.");
  run = on(run, input);
  // No day given: the earliest day every line can arrive, from the wholesaler's own offers (set after the first price).
  const day = input.deliveryDate ?? addDaysIso(localNow(new Date()).date, 1);
  // No "asked" products on the sheet's request: a sheet holds several products the buyer chose, and the core would read
  // every product but the first as standing in for it. What stands in for what is said line by line (`substituteFor`,
  // set by a swap or carried from an option), and the gate judges exactly that.
  void input.asked;
  const request = await run.rt.dock.openRequest(run.session, { text: input.text.slice(0, 2000), deliverOn: day, ...(input.category ? { category: input.category } : {}) });
  const s: SheetRecord = { sheetId: `sh_${request.requestId.slice(4)}`, requestId: request.requestId, version: 1, turnId: run.turnId, deliveryDate: day, lines: input.lines.map((l) => ({ ...l, lineId: newLineId() })), offers: {}, ...(input.session ? { session: input.session } : {}) };
  sheetsOf(run)[s.sheetId] = s;
  run.requests.add(s.requestId);
  await price(run, s);
  if (!input.deliveryDate) {
    const earliest = s.lines.map((l) => s.offers[l.productId]?.deliveryDate).filter((x): x is string => !!x).sort().at(-1);
    if (earliest && earliest !== s.deliveryDate) {
      s.deliveryDate = earliest;
      await run.rt.dock.changeNeededBy(run.session, s.requestId, { neededBy: earliest, deliverOn: earliest, by: run.person?.name ?? run.k.info.by, reason: "the earliest day every line can arrive" }).catch(() => undefined);
      await price(run, s);
    }
  }
  record(run, "sheet", `An order sheet was opened with ${s.lines.length} line${s.lines.length > 1 ? "s" : ""} for ${day}.`, { sheetId: s.sheetId, lines: s.lines }, s.requestId);
  run.store.save(run.thread);
  return render(run, s);
}

function own(run: TurnRun, sheetId: string, version?: number): SheetRecord {
  const s = sheetsOf(run)[sheetId];
  if (!s) throw new DockError(404, "sheet_not_found", "That order sheet is not in this conversation.");
  if (s.placed) throw new DockError(409, "turn_card_stale", "That sheet is already ordered.", "intake_sequence");
  if (version !== undefined && version !== s.version) throw new DockError(409, "turn_card_stale", "The sheet changed since: check it again and confirm.", "intake_sequence", { version: s.version });
  return s;
}

const line = (s: SheetRecord, lineId: string) => {
  const l = s.lines.find((x) => x.lineId === lineId);
  if (!l) throw new DockError(404, "sheet_line_not_found", "That line is not on the sheet.");
  return l;
};

/** One edit, by the kitchen's person: applied by plain code, re-priced where it changed, the gate's preview again. */
export async function editSheet(run: TurnRun, sheetId: string, version: number | undefined, edit: { kind: "packs"; lineId: string; packs: number } | { kind: "day"; date: string } | { kind: "swap"; lineId: string; productId: string } | { kind: "remove"; lineId: string } | { kind: "add"; productId: string; packs: number }): Promise<SheetCard> {
  const s = own(run, sheetId, version);
  run = on(run, s);
  const changed: string[] = [];
  let reprice = false;
  const before = structuredClone({ lines: s.lines, deliveryDate: s.deliveryDate, removed: s.removed });
  s.removed = undefined;
  switch (edit.kind) {
    case "packs": {
      // A product sold in a real fractional lot (0,7 kg of a churned butter) is edited in its own steps; else whole packs.
      const [product] = await run.rt.catalog.searchProducts({ ids: [line(s, edit.lineId).productId], limit: 1 }).catch(() => []);
      const lot = product?.lotSize && product.lotSize > 0.01 ? product.lotSize : 1;
      if (!onStep(edit.packs, lot) || edit.packs > 9999) throw new DockError(400, "sheet_packs", lot === 1 ? "Whole packs, at least one." : `In steps of ${lot}.`);
      line(s, edit.lineId).packs = edit.packs;
      changed.push("amount");
      break;
    }
    case "day": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(edit.date)) throw new DockError(400, "sheet_day", "A day as YYYY-MM-DD.");
      s.deliveryDate = edit.date;
      // The sheet's day is the day it arrives (deliverOn), not a latest date: the wholesaler's earliest offer is moved to it.
      await run.rt.dock.changeNeededBy(run.session, s.requestId, { neededBy: edit.date, deliverOn: edit.date, by: run.person?.name ?? run.k.info.by, reason: "moved on the order sheet" }).catch(() => undefined);
      reprice = true;
      changed.push("day");
      break;
    }
    case "swap": {
      const l = line(s, edit.lineId);
      if (edit.productId !== l.productId) {
        // The product first on the line is what was asked for: the new one stands in for it, judged by the substitution rule.
        const original = l.substituteFor ?? l.productId;
        l.substituteFor = edit.productId === original ? undefined : original;
        l.productId = edit.productId;
        reprice = true;
        changed.push("product");
      }
      break;
    }
    case "remove": {
      if (s.lines.length === 1) throw new DockError(409, "sheet_last_line", "This is the last line: take the order back instead, or add another line first.");
      const gone = line(s, edit.lineId);
      s.lines = s.lines.filter((x) => x.lineId !== edit.lineId);
      s.removed = { productId: gone.productId, packs: gone.packs };
      changed.push("removed");
      break;
    }
    case "add": {
      const have = s.lines.find((x) => x.productId === edit.productId);
      if (have) have.packs += edit.packs;
      else {
        if (s.lines.length >= 30) throw new DockError(409, "sheet_full", "At most 30 products on one order sheet.");
        s.lines.push({ productId: edit.productId, packs: edit.packs, lineId: newLineId() });
      }
      reprice = true;
      changed.push("added");
      break;
    }
  }
  if (reprice) {
    try {
      await price(run, s);
    } catch (err) {
      // The wholesaler did not answer: the sheet stays exactly as it was, at its version, and the turn says so.
      Object.assign(s, before);
      throw err;
    }
  }
  s.version++;
  record(run, "sheet_edit", `The order sheet was changed (${edit.kind}) by ${run.person?.name ?? "the kitchen (relayed)"}.`, { sheetId, edit, version: s.version, by: run.person?.name, verified: !!run.person }, s.requestId);
  run.store.save(run.thread);
  return render(run, s, changed);
}

/** One signed quote of every line at the sheet's day, then the gate: one order. */
export async function placeSheet(run: TurnRun, sheetId: string, version: number): Promise<PublicOrder> {
  const s = own(run, sheetId, version);
  run = on(run, s);
  const q = step(run, "quote", "Fixing the price with the wholesaler");
  let quoted;
  try {
    quoted = await run.rt.dock.requestQuote(run.session, { requestId: s.requestId, lines: s.lines.map(({ productId, packs, substituteFor }) => ({ productId, quantity: packs, ...(substituteFor ? { substituteFor } : {}) })) });
    q.done();
  } catch (err) {
    q.fail(err instanceof DockError ? err.code : undefined);
    throw err;
  }
  // The flags the sheet showed this person, confirmed by their tap on it (only those, only a signed-in person).
  if (s.check?.length && run.person) {
    const open = await run.rt.dock.orderConcerns(run.session, { requestId: s.requestId, quoteToken: quoted.quoteToken }).catch(() => []);
    const keys = open.filter((c) => s.check!.includes(c.code)).map((c) => c.key);
    if (keys.length) await run.rt.dock.confirmConcerns(run.session, { requestId: s.requestId, quoteToken: quoted.quoteToken, keys }, humanVia(run)).catch(() => undefined);
  }
  const gate = step(run, "gate", "Checking the order against your rules");
  let order: PublicOrder;
  try {
    order = await run.rt.dock.placeOrder(
      run.session,
      { requestId: s.requestId, quoteToken: quoted.quoteToken, lines: quoted.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) },
      confirmedBy(run) ? { confirmedBy: confirmedBy(run) } : {},
    );
    gate.done(order.status);
  } catch (err) {
    gate.fail(err instanceof DockError ? (err.rule ?? err.code) : undefined);
    throw err;
  }
  s.placed = order.orderId;
  run.orders.set(order.orderId, order);
  await render(run, s);
  // A refusal names the rule and the figure, from the gate's own finding (refusal.ts), never "turned down".
  const g = gateCard(order);
  if (g.outcome === "refused") {
    const { worded } = await import("./pipeline");
    const { refusalOfRule } = await import("./refusal");
    const what = order.lines.length === 1 ? order.lines[0].name : run.lang === "fi" ? "tilaus" : "this order";
    run.store.card(run.thread, run.turnId, { ...g, said: worded((l) => refusalOfRule(run, g.rule, what, g.rules?.find((x) => x.rule === g.rule)?.details, l)).said });
  } else run.store.card(run.thread, run.turnId, g);
  run.store.card(run.thread, run.turnId, orderCard(order));
  run.store.mark(run.thread, run.turnId, order.status === "pending_approval" ? "waiting" : "placed", Date.now() - run.t0);
  run.store.save(run.thread);
  return order;
}

// ---------- the alternatives picker ----------

type PickerRecord = { pickerId: string; sheetId: string; lineId: string; chip: string; candidates: string[]; turnId: string };
const pickersOf = (run: TurnRun): Record<string, PickerRecord> => ((run.thread as unknown as { pickers?: Record<string, PickerRecord> }).pickers ??= {});

const CHIPS = ["price", "same_kind", "co2", "reliability", "organic", "lactose_free", "pack_size"] as const;
const CHIP_LABEL: Record<string, string> = { price: "Cheapest", same_kind: "Closest to what you asked", co2: "Lowest CO2", reliability: "Most reliable", organic: "Organic", lactose_free: "Lactose-free", pack_size: "Same pack size" };

/** Candidates for a sheet line: the same family, within the mandate's rules (categories, required attributes, forbidden allergens). */
export async function openAlternatives(run: TurnRun, sheetId: string, lineId: string, chip = "same_kind"): Promise<AlternativesCard> {
  const s = sheetsOf(run)[sheetId];
  if (!s) throw new DockError(404, "sheet_not_found", "That order sheet is not in this conversation.");
  run = on(run, s);
  const l = line(s, lineId);
  const [current] = await run.rt.catalog.searchProducts({ ids: [l.productId], limit: 1 });
  if (!current) throw new DockError(404, "product_not_found", "That product is not in the assortment.");
  const m = run.session.mandate;
  const family = (await run.rt.catalog.searchProducts({ category: current.category, unit: current.unit, limit: 100 } as never)).filter(
    (p) => p.unit === current.unit && m.allowedCategories.includes(p.category) && m.requiredAttributes.every((a) => p.attributes.includes(a)) && !p.allergens.some((a) => m.forbiddenAllergens.includes(a)),
  );
  // Requirements every candidate keeps: the current product's own claims (lactose-free stays lactose-free).
  const keep = current.attributes.filter((a) => /lactose_free|gluten_free|organic|vegan|milk_free/.test(a));
  const pool = family.filter((p) => keep.every((a) => p.attributes.includes(a)));
  const amount = l.packs * current.packSize;
  const score = (p: Product, c: string) =>
    c === "co2" ? (p.carbonKnown === false ? 99 : p.carbonKgPerUnit) : c === "reliability" ? -(p.deliveryReliability ?? 0) : c === "pack_size" ? Math.abs(p.packSize - current.packSize) : c === "same_kind" ? -p.attributes.filter((a) => current.attributes.includes(a)).length : 0;
  const filtered = (c: string) => (c === "organic" || c === "lactose_free" ? pool.filter((p) => p.attributes.includes(c)) : pool);
  const shortlist = [current, ...filtered(chip).filter((p) => p.id !== current.id).sort((a, b) => score(a, chip) - score(b, chip)).slice(0, 5)];
  // Live prices for the short list at the sheet's day, then each candidate's gate preview as the sheet would be with it.
  const live = await run.rt.dock.lookupAvailability(run.session, { requestId: s.requestId, productIds: shortlist.map((p) => p.id), deliveryDate: s.deliveryDate });
  for (const o of live.offers) s.offers[o.productId] = o;
  const original = l.substituteFor ?? l.productId;
  const candidates: AlternativesCard["candidates"] = [];
  for (const p of shortlist) {
    const o = s.offers[p.id];
    if (!o) continue;
    const packs = Math.max(1, Math.ceil(amount / p.packSize - 1e-9));
    const lines = s.lines.map((x) => (x.lineId === lineId ? { productId: p.id, quantity: packs, ...(p.id !== original ? { substituteFor: original } : {}) } : { productId: x.productId, quantity: x.packs, ...(x.substituteFor ? { substituteFor: x.substituteFor } : {}) }));
    const d = await run.rt.dock.previewDecision(run.session, s.requestId, lines, Object.values(s.offers), { referencePrices: true, asPlaced: true, ...(confirmedBy(run) ? { confirmedBy: confirmedBy(run) } : {}) }).catch(() => undefined);
    const gate = gateOf(d);
    // Nothing the gate would refuse is offered (the current product is always shown, as what is there now).
    if (gate.outcome === "reject" && p.id !== l.productId) continue;
    const diff = o.unitPriceCents * packs - (s.offers[l.productId]?.unitPriceCents ?? 0) * l.packs;
    candidates.push({
      productId: p.id,
      name: p.name,
      category: p.category,
      packSize: p.packSize,
      unit: p.unit,
      packs,
      unitPriceCents: o.unitPriceCents,
      totalCents: o.unitPriceCents * packs,
      perUnitCents: Math.round(o.unitPriceCents / p.packSize),
      deliveryDate: o.deliveryDate,
      ...(o.orderBy ? { orderBy: o.orderBy } : {}),
      attributes: p.attributes,
      co2Kg: p.carbonKnown === false ? null : Math.round(p.carbonKgPerUnit * amount * 100) / 100,
      reliability: p.deliveryReliabilityKnown === false ? null : p.deliveryReliability,
      rank: "",
      current: p.id === l.productId,
      differs: [
        ...(diff !== 0 && p.id !== l.productId ? [{ code: diff > 0 ? "price_more" : "price_less", params: { cents: Math.abs(diff) } }] : []),
        ...(p.packSize !== current.packSize ? [{ code: "pack_size", params: { packSize: p.packSize, unit: p.unit } }] : []),
        ...(p.brand !== current.brand ? [{ code: "brand", params: { brand: p.brand ?? "" } }] : []),
      ],
      gate,
    });
  }
  const ranked = [...candidates].sort((a, b) => (chip === "price" ? a.totalCents - b.totalCents : 0));
  ranked.forEach((c, i) => (c.rank = ["best", "better", "good"][i] ?? "good"));
  const pickerId = `pk_${sheetId.slice(3)}_${lineId.slice(3)}`;
  pickersOf(run)[pickerId] = { pickerId, sheetId, lineId, chip, candidates: ranked.map((c) => c.productId), turnId: run.turnId };
  const card: AlternativesCard = {
    type: "alternatives",
    cardId: cardId("alternatives", pickerId),
    requestId: s.requestId,
    pickerId,
    for: { sheetId, lineId, requestId: s.requestId, productId: l.productId, name: current.name, amount: { amount, unit: current.unit } },
    chips: CHIPS.map((id) => ({ id, label: CHIP_LABEL[id], on: id === chip })),
    candidates: ranked,
  };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  record(run, "alternatives", `Alternatives for ${current.name} on the sheet, ranked by ${chip}: ${ranked.length} the gate would let through.`, { pickerId, chip, candidates: ranked.map((c) => ({ productId: c.productId, outcome: c.gate.outcome })) }, s.requestId);
  run.store.save(run.thread);
  return card;
}

export async function pickAlternative(run: TurnRun, pickerId: string, productId: string): Promise<SheetCard> {
  const p = pickersOf(run)[pickerId];
  if (!p) throw new DockError(404, "picker_not_found", "That picker is not in this conversation.");
  if (!p.candidates.includes(productId)) throw new DockError(409, "turn_card_stale", "That product is not one of the picker's candidates.", "intake_sequence");
  const s = own(run, p.sheetId);
  run = on(run, s);
  const l = line(s, p.lineId);
  const [now] = await run.rt.catalog.searchProducts({ ids: [productId], limit: 1 });
  const [was] = await run.rt.catalog.searchProducts({ ids: [l.productId], limit: 1 });
  const card = await editSheet(run, p.sheetId, undefined, { kind: "swap", lineId: p.lineId, productId });
  // The picker says what was taken, so it folds to one line.
  for (const x of run.thread.turns)
    if (x.role === "agent")
      for (const c of x.cards) if (c.type === "alternatives" && c.pickerId === pickerId) run.store.card(run.thread, x.turnId, { ...c, picked: productId });
  // The same amount in the new product's packs.
  if (now && was && now.packSize !== was.packSize) {
    const packs = Math.max(1, Math.ceil((l.packs * was.packSize) / now.packSize - 1e-9));
    if (packs !== l.packs) return editSheet(run, p.sheetId, undefined, { kind: "packs", lineId: p.lineId, packs });
  }
  return card;
}

export function sheetById(run: TurnRun, sheetId: string): SheetRecord | undefined {
  return sheetsOf(run)[sheetId];
}

export type { SheetRecord };
export { gateOf };
export const SHEET_CARD = cardId;
void orderCard;

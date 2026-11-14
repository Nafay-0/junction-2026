import { DockError } from "@/core/errors";
import type { PublicOrder } from "@/core/orders";
import type { PlanView } from "@/server/agent/menu/plan";
import type { PlanEdit, PlanRecord } from "@/server/agent/menu/service";
import { cardId, gateCard, orderCard } from "./cards";
import { byLine, record, step, type ItemOutcome, type TurnRun } from "./pipeline";
import type { NoticeCard, PlanCard } from "./types";

/**
 * Recipe requests in the thread ("salmon soup for 300 on Friday", "plan lunch for 40 around beetroot"): the menu
 * planner (server/agent/menu) works out the ingredients, matches each to the assortment and prices the short list
 * live, exactly as on its own page; the thread shows the plan as one card built by plain code from the planner's
 * record, and one confirmation (`plan_order`) orders the whole plan as one fixed-price order through the gate.
 *
 * The planner runs as the kitchen's menu agent (its own mandate, with the kitchen's rules: kitchens.ts) under the
 * thread's turn context, so its model calls land in the conversation's record like the agent's own.
 */

type Planned = { record: PlanRecord; view: PlanView };

async function planner(run: TurnRun) {
  const { menuKitchen } = await import("@/server/agent/menu/runtime");
  const { service, kitchen } = await menuKitchen(run.k.info.slug);
  if (!kitchen) throw new DockError(404, "menu_kitchen_not_found", "This kitchen has no menu planner (a visitor's 90-minute kitchen).");
  return { service, kitchen };
}

/** The doubts the one confirmation settles: those the planner can accept as they are, and lines with nothing to order. */
function settlement(view: PlanView): { accept: { doubtId: string; text: string }[]; strike: { lineId: string; name: string; why: string }[] } {
  const accept: { doubtId: string; text: string }[] = [];
  const strike: { lineId: string; name: string; why: string }[] = [];
  for (const l of view.lines) {
    if (l.status === "struck" || l.status === "merged") continue;
    const open = l.doubts.filter((d) => !d.accepted);
    if (!open.length) continue;
    if (open.every((d) => d.acceptLabel)) for (const d of open) accept.push({ doubtId: d.doubtId, text: `${l.name}: ${d.acceptLabel!.toLowerCase()} (${d.text})` });
    else strike.push({ lineId: l.lineId, name: l.name, why: open.find((d) => !d.acceptLabel)?.text ?? "nothing fits" });
  }
  return { accept, strike };
}

/** The plan card, by plain code from the planner's record and view: names, packs and prices as the planner priced them. */
export function planCard({ record: p, view }: Planned, editUrl: string): PlanCard {
  const s = settlement(view);
  const dishes = p.draft.dishes.map((d) => d.name);
  const lines: PlanCard["lines"] = view.lines
    .filter((l) => l.status !== "merged" && !(l.pantry && l.status === "struck"))
    .map((l) => {
      const forDishes = [...new Set(l.uses.map((u) => u.dish).filter(Boolean))];
      const left = s.strike.find((x) => x.lineId === l.lineId);
      if (l.status === "struck" || left) return { lineId: l.lineId, ingredient: l.name, dishes: forDishes, status: "left_out" as const, note: left?.why ?? l.struckReason ?? "left out" };
      const c = l.chosen;
      const open = l.doubts.filter((d) => !d.accepted);
      return {
        lineId: l.lineId,
        ingredient: l.name,
        dishes: forDishes,
        status: open.length ? ("decide" as const) : ("ready" as const),
        ...(c ? { product: c.products.map((x) => x.name).join(" + "), packs: c.products.map((x) => x.packText).join(" + "), totalCents: c.totalCents } : {}),
        ...(open.length ? { note: open.map((d) => d.text).join(" ") } : {}),
      };
    });
  const t = view.totals;
  // The blockers the confirmation itself resolves (open decisions) are not shown as blockers.
  const blockers = t.blockers.filter((b) => !/need[s]? a decision/.test(b));
  return {
    type: "plan",
    cardId: cardId("plan", p.planId),
    planId: p.planId,
    ...(p.requestId ? { requestId: p.requestId } : {}),
    state: p.state,
    covers: p.settings.covers,
    ...(p.settings.deliverBy ? { serviceDate: p.settings.deliverBy } : {}),
    dishes,
    lines,
    onOrder: { accepts: s.accept.map((a) => a.text), leavesOut: s.strike.map((x) => `${x.name}: ${x.why}`) },
    blockers,
    totalCents: t.totalCents,
    ...(t.deliveryDate ? { deliveryDate: t.deliveryDate } : {}),
    ...(t.orderBy ? { orderBy: t.orderBy } : {}),
    ...(t.signOff.needed ? { signOff: { reasons: t.signOff.reasons, ...(t.signOff.approver ? { approver: t.signOff.approver } : {}) } } : {}),
    canOrder: p.state === "planned" && blockers.length === 0 && lines.some((l) => l.status !== "left_out"),
    editUrl,
    ...(p.state === "declined" ? { declined: p.declineReason ?? "The planner did not read this as a food order." } : {}),
  };
}

const editUrlOf = (run: TurnRun, planId: string) => `/k/${encodeURIComponent(run.k.info.slug)}/menu?plan=${encodeURIComponent(planId)}`;

/** The `plan_menu` tool: the planner on the buyer's words, its plan as a card. */
export async function planFromWords(run: TurnRun, words: string): Promise<{ planId?: string; state: string; dishes?: string[]; covers?: number | null; lines?: number; leftOut?: number; totalEur?: string; deliveryDate?: string; waitsFor?: string; blockers?: string[]; notice?: string }> {
  const st = step(run, "plan", "Planning the dishes and their ingredients");
  let planned: Planned;
  let svc: Awaited<ReturnType<typeof planner>>;
  try {
    svc = await planner(run);
    planned = await svc.service.plan(svc.kitchen, words, byLine(run));
    // Proposals for stuck lines come a few seconds after the plan: wait for them a little, then read the plan again.
    await Promise.race([svc.service.settled(planned.record.planId), new Promise((r) => setTimeout(r, 8000))]);
    planned = await svc.service.get(svc.kitchen, planned.record.planId);
    st.done(`${planned.view.lines.length} lines`);
  } catch (err) {
    st.fail(err instanceof DockError ? err.code : undefined);
    const n: NoticeCard = { type: "notice", cardId: cardId("notice", `${run.turnId}:plan`), kind: err instanceof DockError && /model|limit|timeout/.test(err.code) ? "unavailable" : "refused", message: err instanceof DockError ? err.message : "The menu planner could not plan this. Try again.", retry: true };
    run.store.card(run.thread, run.turnId, n);
    run.facts.push(n);
    if (!(err instanceof DockError)) console.error("[thread plan]", err);
    return { state: "error", notice: n.message };
  }
  const card = planCard(planned, editUrlOf(run, planned.record.planId));
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  if (planned.record.requestId) run.requests.add(planned.record.requestId);
  record(run, "plan", `The menu planner planned "${words.slice(0, 160)}": ${card.lines.length} lines, ${card.lines.filter((l) => l.status === "left_out").length} left out, ${(card.totalCents / 100).toFixed(2)} EUR${card.canOrder ? "" : `; cannot be ordered yet: ${card.blockers.join(" ") || card.declined || "nothing to order"}`}.`, { planId: card.planId, lines: card.lines.length }, planned.record.requestId);
  return {
    planId: card.planId,
    state: card.state,
    dishes: card.dishes,
    covers: card.covers,
    lines: card.lines.filter((l) => l.status !== "left_out").length,
    leftOut: card.lines.filter((l) => l.status === "left_out").length,
    totalEur: (card.totalCents / 100).toFixed(2),
    ...(card.deliveryDate ? { deliveryDate: card.deliveryDate } : {}),
    ...(card.signOff?.approver ? { waitsFor: card.signOff.approver.name } : {}),
    ...(card.blockers.length ? { blockers: card.blockers } : {}),
    ...(card.declined ? { notice: card.declined } : {}),
  };
}

/** The plan card's one confirmation: settle what it said it would, fix the price for the whole plan, and place it. */
export async function orderPlan(run: TurnRun, planId: string, words?: string): Promise<ItemOutcome[]> {
  const { service, kitchen } = await planner(run);
  const by = byLine(run);
  let planned = await service.get(kitchen, planId);
  if (planned.record.state !== "planned") throw new DockError(409, "turn_card_stale", planned.record.state === "declined" ? "This plan was declined; start a new one." : "This plan already has a fixed price.", "intake_sequence");
  if (words) record(run, "heard", `Heard from the buyer before ordering the plan: "${words.slice(0, 300)}"`, { heard: words.slice(0, 1000), planId }, planned.record.requestId);
  const s = settlement(planned.view);
  const edits: PlanEdit[] = [...s.accept.map((a) => ({ op: "accept" as const, doubtId: a.doubtId })), ...s.strike.map((x) => ({ op: "strike" as const, lineId: x.lineId, struck: true }))];
  if (edits.length) {
    const st = step(run, "plan", "Settling the plan's open points");
    planned = await service.edit(kitchen, planId, edits, by);
    st.done(`${edits.length}`);
  }
  const q = step(run, "quote", "Fixing the price for the whole plan");
  planned = await service.quote(kitchen, planId, by);
  if (planned.record.error || planned.record.state !== "quoted") {
    q.fail(planned.record.error?.code);
    const n: NoticeCard = { type: "notice", cardId: cardId("notice", `${planId}:quote`), kind: "refused", message: planned.record.error?.message ?? "The plan could not be priced.", ...(planned.record.error?.rule ? { rule: planned.record.error.rule } : {}) };
    run.store.card(run.thread, run.turnId, n);
    refreshCard(run, planned);
    return [{ words: words ?? "", requestId: planned.record.requestId, notice: n }];
  }
  q.done();
  const g = step(run, "gate", "The gate checks the order against your mandate");
  planned = await service.order(kitchen, planId);
  refreshCard(run, planned);
  const order: PublicOrder | undefined = planned.record.order;
  if (!order) {
    g.fail(planned.record.error?.rule ?? planned.record.error?.code);
    const n: NoticeCard = { type: "notice", cardId: cardId("notice", `${planId}:order`), kind: "refused", message: planned.record.error?.message ?? "The gate did not take the order.", ...(planned.record.error?.rule ? { rule: planned.record.error.rule } : {}) };
    run.store.card(run.thread, run.turnId, n);
    return [{ words: words ?? "", requestId: planned.record.requestId, notice: n }];
  }
  g.done(order.status);
  run.orders.set(order.orderId, order);
  run.facts.push(order);
  run.requests.add(order.requestId);
  run.store.card(run.thread, run.turnId, gateCard(order));
  run.store.card(run.thread, run.turnId, orderCard(order));
  run.store.mark(run.thread, run.turnId, order.status === "pending_approval" ? "waiting" : "placed", Date.now() - run.t0);
  return [{ words: words ?? "", requestId: order.requestId, placed: { orderId: order.orderId, status: order.status, totalCents: order.totalCents, ...(order.approval ? { approver: order.approval.approver.name } : {}) } }];
}

/** The plan card again, in whichever turn shows it, once the plan has moved on (quoted, ordered). */
function refreshCard(run: TurnRun, planned: Planned): void {
  const holder = run.store.cards(run.thread).find((x) => x.card.type === "plan" && x.card.planId === planned.record.planId);
  run.store.card(run.thread, holder?.turnId ?? run.turnId, planCard(planned, editUrlOf(run, planned.record.planId)));
}

/** A plan card that is still open (planned, orderable), for the agent's open decisions. */
export function openPlan(run: TurnRun): PlanCard | undefined {
  const plans = run.store.cards(run.thread).filter((x) => x.card.type === "plan").map((x) => x.card as PlanCard);
  return plans.reverse().find((p) => p.state === "planned" && p.canOrder);
}

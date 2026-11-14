import { DockError } from "@/core/errors";
import { usableOffer } from "@/core/catalog";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { Decision } from "@/core/policy";
import type { DraftIngredient, DraftOutline } from "@/server/agent/menu/draft";
import { toBase, type PlanLineView, type PlanView } from "@/server/agent/menu/plan";
import type { PlanEdit, PlanProgress, PlanRecord } from "@/server/agent/menu/service";
import { cardId } from "./cards";
import { byLine, record, step, type TurnRun } from "./pipeline";
import { createSheet, gateOf } from "./sheet";
import type { MenuCard, NoticeCard } from "./types";

/**
 * The menu builder in the thread (docs/agent-thread.md "Widgets", `menu`): a dish or a menu for a number of covers,
 * planned by the menu planner (server/agent/menu) and shown as one card that forms while the planner works.
 *
 *   proposing  the outline is in: the dishes, each dish's ingredient lines as that dish is written (resolving);
 *   choose     the words left the menu open ("lunch for 40 around beetroot"): two or three menus to pick from, while
 *              the first one keeps planning behind the card;
 *   resolving  lines matched to the assortment, live prices on their way;
 *   ready      every line with its product, packs, price, other products, conflicts; the gate's preview of the plan
 *              as one order; one button puts every bought line on the order sheet (sheet.ts), where it is placed.
 *
 * Every edit (menu_*) is a turn mapped onto the planner's own edit ops, so the kitchen's mandate, stated rules and
 * memory bind every line exactly as on the planner's page; nothing is offered that the gate would refuse. The card is
 * built by plain code from the planner's record; the model only drafts the dishes and amounts.
 */

type Planned = { record: PlanRecord; view: PlanView };
type Svc = Awaited<ReturnType<typeof planner>>;

type MenuState = {
  key: string;
  words: string;
  planId: string;
  proposals: MenuCard["proposals"];
  /** The proposal the buyer chose; the first one when the words named the dishes. */
  chosen?: string;
  stage: MenuCard["stage"];
  sheetId?: string;
  outline?: DraftOutline;
  dishes: Record<string, DraftIngredient[]>;
  matched?: Planned;
  /** When the outline and the ready card were shown, ms after the tool started (the record and the eval read them). */
  timings: { outlineMs?: number; matchedMs?: number; readyMs?: number; startedAt: number };
};

const menusOf = (run: TurnRun): Record<string, MenuState> => ((run.thread as unknown as { menus?: Record<string, MenuState> }).menus ??= {});

/** Plans still being made, by thread, card and proposal: a choice of the first proposal waits for the one already running. */
const g = globalThis as typeof globalThis & { __dockMenuJobs?: Map<string, Promise<Planned>> };
const jobs = (g.__dockMenuJobs ??= new Map());
const jobKey = (run: TurnRun, m: MenuState, proposalId: string) => `${run.thread.threadId}:${m.key}:${proposalId}`;

async function planner(run: TurnRun) {
  const { menuKitchen } = await import("@/server/agent/menu/runtime");
  const { service, kitchen } = await menuKitchen(run.k.info.slug);
  if (!kitchen) throw new DockError(404, "menu_kitchen_not_found", "This kitchen has no menu planner (a visitor's 90-minute kitchen).");
  return { service, kitchen };
}

/** "21 × ST (600 g per ST)" → "21 × 600 g": the wholesaler's sales-unit code stays off the buyer's card. */
export const packs = (t: string) => t.replace(/^([\d.,\s]+)\s*×\s*[A-Z]{1,4}\s*\(([^)]*?)\s+per\s+[A-Z]{1,4}\)$/, "$1 × $2").replace(/\s+/g, " ").trim();

/** The planner's sentence without its search log ("(searched: lohifilee, ...)"): the buyer's card has no internal words. */
const plain = (t: string) => t.replace(/\s*\(searched:[^)]*\)/g, "").trim();

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- the card ----------

/** A line while its dish is only written: the amount per cover and what the covers need, no product yet. */
function draftLine(ing: DraftIngredient, covers: number | null): MenuCard["dishes"][number]["lines"][number] {
  const base = toBase(ing.perCover.amount * (covers ?? 0), ing.perCover.unit);
  return {
    lineId: ing.key,
    ingredient: ing.name,
    perCover: { amount: ing.perCover.amount, unit: ing.perCover.unit },
    need: { amount: r3(base.amount / Math.max(0.2, ing.yieldPct / 100)), unit: base.unit },
    status: ing.pantry ? "have" : "resolving",
    options: [],
    conflicts: [],
  };
}

function streamingCard(m: MenuState): MenuCard {
  const o = m.outline;
  const covers = o?.covers ?? null;
  return {
    type: "menu",
    cardId: m.key,
    planId: m.planId,
    stage: m.stage,
    proposals: m.proposals,
    covers,
    ...(o?.serviceDate ? { serviceDate: o.serviceDate } : {}),
    days: [],
    dishes: (o?.dishes ?? []).map((d) => ({ dishId: d.dishId, name: d.name, course: d.course, ...(d.portion ? { portion: d.portion } : {}), lines: (m.dishes[d.dishId] ?? []).map((ing) => draftLine(ing, covers)) })),
    totalCents: 0,
    blockers: [],
  };
}

/** What an option differs on from the line's product, as codes for words in the buyer's language. */
function differs(a: { totalCents: number; deliveryDate: string; match: string; cons: string[] }, c: { totalCents: number; deliveryDate: string } | undefined) {
  const out: { code: string; params: Record<string, string | number> }[] = [];
  if (c) {
    const d = a.totalCents - c.totalCents;
    if (d > 0) out.push({ code: "price_more", params: { cents: d } });
    else if (d < 0) out.push({ code: "price_less", params: { cents: -d } });
    if (a.deliveryDate > c.deliveryDate) out.push({ code: "arrives_later", params: { date: a.deliveryDate } });
  }
  if (a.match !== "full") out.push({ code: "compromise", params: { text: a.cons[0] ?? "" } });
  return out;
}

/** The gate's objections that name a product of this line (an allergen, a category, a substitute's price). */
function gateOnLine(decision: Decision | undefined, l: PlanLineView): MenuCard["dishes"][number]["lines"][number]["conflicts"] {
  if (!decision || !l.chosen) return [];
  const ids = l.chosen.products.map((p) => p.productId);
  const names = l.chosen.products.map((p) => p.name);
  return decision.rules
    .filter((r) => r.outcome !== "pass" && (ids.some((id) => r.reason.includes(id)) || names.some((n) => r.reason.includes(n))))
    .map((r) => ({ code: r.rule, text: r.reason, blocking: r.outcome === "fail" }));
}

function cardLine(p: PlanRecord, l: PlanLineView, dishId: string, decision: Decision | undefined, refused: Set<string>, resolving: boolean): MenuCard["dishes"][number]["lines"][number] {
  const use = l.uses.find((u) => u.dishId === dishId) ?? l.uses[0];
  const c = l.chosen;
  const chefStruck = !!p.edits[l.lineId]?.struck;
  const status: MenuCard["dishes"][number]["lines"][number]["status"] =
    l.status === "struck" ? (chefStruck || l.pantry ? "have" : "left_out") : resolving ? "resolving" : l.status === "ready" ? "ready" : "decide";
  const conflicts = [
    ...l.doubts.filter((d) => !d.accepted && !(resolving && (d.kind === "not_priced" || d.kind === "cannot_arrive"))).map((d) => ({ code: d.kind, text: plain(d.text), ...(d.acceptLabel ? { doubtId: d.doubtId } : {}), blocking: !d.acceptLabel })),
    ...gateOnLine(decision, l),
  ];
  const options: MenuCard["dishes"][number]["lines"][number]["options"] = [
    // The planner's own alternatives for this line, each only if the gate would take the plan with it.
    ...l.alternatives
      .filter((a) => !refused.has(`${l.lineId}:${a.optionId}`))
      .map((a) => ({ optionId: a.optionId, productId: a.products[0]?.productId ?? "", name: a.products.map((x) => x.name).join(" + "), totalCents: a.totalCents, differs: differs(a, c) })),
    // Ways out the planner proposed for a line that cannot be bought as planned, checked by plain code.
    ...l.fixes
      .filter((f) => f.check?.ok)
      .map((f) => {
        const ok = f.check as Extract<NonNullable<typeof f.check>, { ok: true }>;
        return { optionId: `fix:${f.fixId}`, productId: "", name: ok.product, totalCents: ok.totalCents, differs: [{ code: f.kind === "change_dish" ? "changes_dish" : f.kind === "change_amount" ? "changes_amount" : "substitute", params: { title: f.title } }] };
      }),
  ];
  return {
    lineId: l.lineId,
    ingredient: l.name,
    perCover: { amount: use?.perCover.amount ?? 0, unit: use?.perCover.unit ?? "g" },
    need: l.gross ? { amount: l.gross.amount, unit: l.gross.unit } : { amount: 0, unit: use?.perCover.unit === "ml" ? "L" : use?.perCover.unit === "pcs" ? "pcs" : "kg" },
    status,
    ...(c && status !== "have" && status !== "left_out"
      ? {
          product: {
            productId: c.products[0].productId,
            name: c.products.map((x) => x.name).join(" + "),
            packs: c.products.reduce((s, x) => s + x.packs, 0),
            packSize: c.delivered.amount / Math.max(1, c.products.reduce((s, x) => s + x.packs, 0)),
            unit: c.delivered.unit,
            totalCents: c.totalCents,
            deliveryDate: c.deliveryDate,
          },
        }
      : {}),
    options: status === "have" || status === "left_out" ? [] : options,
    conflicts: status === "have" ? [] : conflicts,
  };
}

/** Days the plan can move to: the kitchen's delivery days inside the mandate's lead time, none earlier than every line can come. */
async function daysOf(run: TurnRun, svc: Svc, planned: Planned): Promise<MenuCard["days"]> {
  const { record: p, view } = planned;
  const chosen = view.lines.filter((l) => l.chosen && (l.status === "ready" || l.status === "needs_decision"));
  const earliest = chosen
    .flatMap((l) => l.chosen!.products.map((x) => (p.live.statuses[x.productId] ? usableOffer(p.live.statuses[x.productId])?.deliveryDate : undefined)))
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const profile = await run.rt.kitchens.getProfile(svc.kitchen.mandate.issuer.orgId).catch(() => undefined);
  const weekdays = profile?.deliveryWeekdays?.length ? profile.deliveryWeekdays : [1, 2, 3, 4, 5];
  const today = localNow(new Date()).date;
  const out: MenuCard["days"] = [];
  for (let i = 1; i <= svc.kitchen.mandate.delivery.maxLeadDays && out.length < 6; i++) {
    const d = addDaysIso(today, i);
    if (!weekdays.includes(isoWeekday(d))) continue;
    const here = d === p.settings.deliverBy;
    out.push({ date: d, ...(here && view.totals.orderBy ? { orderBy: view.totals.orderBy } : {}), available: !earliest || d >= earliest });
  }
  if (p.settings.deliverBy && !out.some((x) => x.date === p.settings.deliverBy)) out.unshift({ date: p.settings.deliverBy, ...(view.totals.orderBy ? { orderBy: view.totals.orderBy } : {}), available: true });
  return out;
}

/** The card from the planner's record: products, packs and prices as the planner priced them; the gate's preview of the plan. */
async function fullCard(run: TurnRun, svc: Svc, m: MenuState, planned: Planned, resolving = false): Promise<MenuCard> {
  const { record: p, view } = planned;
  if (p.state === "declined") return { ...streamingCard({ ...m, stage: "declined" }), planId: p.planId, stage: "declined", blockers: [p.declineReason ?? "The planner did not read this as a food order."] };
  const live = !resolving && p.state === "planned";
  const decision = live ? await svc.service.preview(svc.kitchen, p.planId, { view }) : undefined;
  // Each other product on offer, tried in the plan: one the gate would refuse is not offered.
  const refused = new Set<string>();
  if (live) {
    const tries = view.lines.flatMap((l) => (l.chosen && (l.status === "ready" || l.status === "needs_decision") ? l.alternatives.slice(0, 3).map((a) => ({ lineId: l.lineId, optionId: a.optionId })) : []));
    const verdicts = await Promise.all(tries.slice(0, 24).map((t) => svc.service.preview(svc.kitchen, p.planId, { swap: t, view }).then((d) => ({ t, d }))));
    for (const { t, d } of verdicts) if (!d || d.outcome === "reject") refused.add(`${t.lineId}:${t.optionId}`);
  }
  const dishes: MenuCard["dishes"] = p.draft.dishes.map((d) => ({ dishId: d.id, name: d.name, course: d.course, ...(d.portion ? { portion: d.portion } : {}), lines: [] }));
  for (const l of view.lines) {
    if (l.status === "merged") continue;
    const dishId = l.uses[0]?.dishId;
    const dish = dishes.find((x) => x.dishId === dishId) ?? dishes[0];
    if (dish) dish.lines.push(cardLine(p, l, dish.dishId, decision, refused, resolving));
  }
  const t = view.totals;
  const covers = p.settings.covers;
  return {
    type: "menu",
    cardId: m.key,
    planId: p.planId,
    stage: m.sheetId ? "ready" : m.stage === "choose" ? "choose" : resolving ? "resolving" : "ready",
    proposals: m.proposals,
    covers,
    ...(p.settings.deliverBy ? { serviceDate: p.settings.deliverBy } : {}),
    days: resolving ? [] : await daysOf(run, svc, planned),
    dishes,
    totalCents: t.totalCents,
    ...(covers && t.totalCents ? { costPerCoverCents: Math.round(t.totalCents / covers) } : {}),
    // The lines carry their own decisions: the plan-level count of them is not repeated as a blocker.
    blockers: resolving ? [] : t.blockers.filter((b) => !/need[s]? a decision/.test(b)).map(plain),
    ...(decision ? { gate: gateOf(decision) } : {}),
    ...(m.sheetId ? { sheetId: m.sheetId } : {}),
  };
}

function show(run: TurnRun, card: MenuCard): void {
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
}

// ---------- planning, streamed ----------

/**
 * Run the planner for `text` into the card `m`, showing each step as it comes. Resolves when the plan is ready (or
 * declined); the planner's proposals for stuck lines come after and update the card again.
 */
function startPlan(run: TurnRun, svc: Svc, m: MenuState, text: string, proposalId: string, onOutline?: () => void): Promise<Planned> {
  const t0 = Date.now();
  // A plan for a proposal the buyer passed over keeps running to its end, but no longer touches the card.
  const mine = () => !m.chosen || m.chosen === proposalId;
  const onProgress = (e: PlanProgress) => {
    if (!mine()) return;
    if (e.kind === "outline") {
      m.planId = e.planId;
      m.outline = e.outline;
      m.timings.outlineMs ??= Date.now() - m.timings.startedAt;
      // Words that left the menu open: the planner's own menu and up to two others to choose from.
      if (!m.chosen && e.outline.alternatives.length) {
        m.proposals = [
          { proposalId: "p1", title: e.outline.occasion ?? e.outline.dishes.map((d) => d.name).slice(0, 2).join(" · "), dishes: e.outline.dishes.map((d) => d.name) },
          ...e.outline.alternatives.map((a, i) => ({ proposalId: `p${i + 2}`, title: a.title, dishes: a.dishes })),
        ];
        m.stage = "choose";
      } else m.chosen ??= proposalId;
      show(run, streamingCard(m));
      onOutline?.();
    } else if (e.kind === "dish") {
      m.dishes[e.dishId] = e.ingredients;
      if (m.stage !== "choose" || m.chosen) show(run, streamingCard(m));
    } else if (e.kind === "matched") {
      m.matched = { record: e.record, view: e.view };
      m.timings.matchedMs ??= Date.now() - m.timings.startedAt;
      if (m.stage !== "choose") {
        m.stage = "resolving";
        void fullCard(run, svc, m, m.matched, true).then((c) => m.stage === "resolving" && show(run, c));
      }
    }
  };
  const job = svc.service
    .plan(svc.kitchen, text, byLine(run), { onProgress })
    .then(async (planned) => {
      if (!mine()) return planned;
      m.planId = planned.record.planId;
      if (planned.record.requestId) run.requests.add(planned.record.requestId);
      if (m.stage !== "choose") m.stage = planned.record.state === "declined" ? "declined" : "ready";
      m.timings.readyMs = Date.now() - m.timings.startedAt;
      show(run, await fullCard(run, svc, m, planned));
      const tm = planned.record.timings;
      const calls = planned.record.model.calls;
      record(
        run,
        "menu",
        `The menu planner planned "${text.slice(0, 160)}": ${planned.view.lines.length} lines, ${(planned.view.totals.totalCents / 100).toFixed(2)} EUR; outline shown after ${m.timings.outlineMs ?? "?"} ms, plan ready after ${m.timings.readyMs} ms.`,
        {
          planId: planned.record.planId,
          proposalId,
          shown: { outlineMs: m.timings.outlineMs, matchedMs: m.timings.matchedMs, readyMs: m.timings.readyMs },
          planner: { draftMs: tm.draftMs, matchMs: tm.matchMs, liveMs: tm.liveMs, totalMs: tm.totalMs, calls: calls.map((c) => ({ step: c.step, ms: c.ms })) },
          ms: Date.now() - t0,
        },
        planned.record.requestId,
      );
      // The planner's ways out for stuck lines arrive a few seconds later: the card takes them in place.
      void svc.service
        .settled(planned.record.planId)
        .then(async () => {
          if (!mine() || m.planId !== planned.record.planId || m.sheetId) return;
          show(run, await fullCard(run, svc, m, await svc.service.get(svc.kitchen, planned.record.planId)));
        })
        .catch(() => undefined);
      return planned;
    });
  const key = jobKey(run, m, proposalId);
  jobs.set(key, job);
  job.finally(() => setTimeout(() => jobs.delete(key), 60_000)).catch(() => undefined);
  return job;
}

function failNotice(run: TurnRun, err: unknown, ref: string): NoticeCard {
  const n: NoticeCard = { type: "notice", cardId: cardId("notice", `${ref}:menu`), kind: err instanceof DockError && /model|limit|timeout/.test(err.code) ? "unavailable" : "refused", message: err instanceof DockError ? err.message : "The menu planner could not plan this. Try again.", retry: true };
  run.store.card(run.thread, run.turnId, n);
  run.facts.push(n);
  if (!(err instanceof DockError)) console.error("[thread menu]", err);
  return n;
}

/** What the agent's model reads back from the tool: enough for one sentence, nothing to restate. */
function summary(card: MenuCard | undefined, m: MenuState) {
  if (!card) return { state: "error" };
  const lines = card.dishes.flatMap((d) => d.lines);
  return {
    planId: card.planId,
    stage: card.stage,
    dishes: card.dishes.map((d) => d.name),
    covers: card.covers,
    ...(card.stage === "choose" ? { proposals: m.proposals.map((p) => p.title), note: "The buyer picks one of the menus on the card; the first is being planned meanwhile." } : {}),
    lines: lines.filter((l) => l.status === "ready" || l.status === "decide").length,
    decide: lines.filter((l) => l.status === "decide").length,
    totalEur: (card.totalCents / 100).toFixed(2),
    ...(card.gate ? { gate: card.gate.outcome, ...(card.gate.approver ? { waitsFor: card.gate.approver.name } : {}) } : {}),
    ...(card.blockers.length ? { blockers: card.blockers } : {}),
  };
}

const lastCard = (run: TurnRun, key: string) => run.store.cards(run.thread).find((x) => x.card.cardId === key)?.card as MenuCard | undefined;

/** The `plan_menu` tool: the planner on the buyer's words, the menu card forming as it works. */
export async function menuFromWords(run: TurnRun, words: string) {
  // The turn's opening step ("Reading your request") ends here: this is a menu, the planner reads it.
  run.opening?.done("a dish or menu: the menu planner");
  run.opening = undefined;
  const st = step(run, "plan", "Drafting the dishes");
  let svc: Svc;
  try {
    svc = await planner(run);
  } catch (err) {
    st.fail(err instanceof DockError ? err.code : undefined);
    return { state: "error", notice: failNotice(run, err, run.turnId).message };
  }
  const m: MenuState = { key: cardId("menu", run.turnId), words, planId: "", proposals: [], stage: "proposing", dishes: {}, timings: { startedAt: Date.now() } };
  menusOf(run)[m.key] = m;
  let outlined!: () => void;
  const outline = new Promise<void>((r) => (outlined = r));
  const job = startPlan(run, svc, m, words, "p1", () => outlined());
  job.catch(() => undefined);
  await Promise.race([outline, job.catch(() => undefined)]);
  st.done(m.outline ? `${m.outline.dishes.length} dishes` : undefined);
  if (m.stage === "choose") {
    record(run, "menu_proposals", `The words left the menu open: ${m.proposals.length} menus to choose from (${m.proposals.map((p) => p.title).join("; ")}); the first is planned meanwhile.`, { proposals: m.proposals });
    run.store.save(run.thread);
    return summary(lastCard(run, m.key), m);
  }
  const lines = step(run, "plan", "Matching every ingredient and pricing it live");
  try {
    const planned = await job;
    lines.done(`${planned.view.lines.length} lines`);
  } catch (err) {
    lines.fail(err instanceof DockError ? err.code : undefined);
    return { state: "error", notice: failNotice(run, err, run.turnId).message };
  }
  run.store.save(run.thread);
  return summary(lastCard(run, m.key), m);
}

function own(run: TurnRun, planId: string): MenuState {
  const m = Object.values(menusOf(run)).find((x) => x.planId === planId);
  if (!m) throw new DockError(404, "menu_not_found", "That menu is not in this conversation.");
  if (m.sheetId) throw new DockError(409, "turn_card_stale", "This menu is on the order sheet: change it there.", "intake_sequence");
  return m;
}

/** menu_choose: the menu the buyer picked. The first is already being planned; another is planned with its dishes fixed. */
async function choose(run: TurnRun, planId: string, proposalId: string): Promise<void> {
  const m = own(run, planId);
  const pr = m.proposals.find((p) => p.proposalId === proposalId);
  if (!pr) throw new DockError(404, "menu_proposal_not_found", "That menu is not on the card.");
  if (m.chosen) throw new DockError(409, "turn_card_stale", "A menu was chosen already.", "intake_sequence");
  const svc = await planner(run);
  m.chosen = proposalId;
  record(run, "menu_choose", `The buyer chose the menu "${pr.title}" (${pr.dishes.join(", ")}).`, { planId, proposalId });
  const st = step(run, "plan", proposalId === "p1" ? "Finishing the menu you chose" : "Planning the menu you chose");
  if (proposalId === "p1") {
    const running = jobs.get(jobKey(run, m, "p1"));
    m.stage = m.matched ? "resolving" : "proposing";
    show(run, m.matched ? await fullCard(run, svc, m, m.matched, true) : streamingCard(m));
    const planned = running ? await running : await svc.service.get(svc.kitchen, planId);
    m.stage = planned.record.state === "declined" ? "declined" : "ready";
    show(run, await fullCard(run, svc, m, planned));
    st.done();
    return;
  }
  // Another menu: planned from the buyer's words with its dishes fixed, into the same card.
  m.planId = "";
  m.outline = undefined;
  m.dishes = {};
  m.matched = undefined;
  m.stage = "proposing";
  m.timings = { startedAt: Date.now() };
  show(run, { ...streamingCard(m), planId });
  const planned = await startPlan(run, svc, m, `${m.words}\n\nCook exactly these dishes (${pr.title}): ${pr.dishes.join("; ")}.`, proposalId);
  st.done(`${planned.view.lines.length} lines`);
}

/** An edit on the card, as the planner's own edit ops: the plan recomputed, the card again with the gate's preview. */
async function edit(run: TurnRun, planId: string, edits: PlanEdit[], what: string): Promise<void> {
  const m = own(run, planId);
  const svc = await planner(run);
  const st = step(run, "plan", what);
  const planned = await svc.service.edit(svc.kitchen, planId, edits, byLine(run));
  record(run, "menu_edit", `The buyer changed the menu: ${what.toLowerCase()}.`, { planId, edits }, planned.record.requestId);
  show(run, await fullCard(run, svc, m, planned));
  st.done();
}

/**
 * menu_to_sheet: every line being bought onto one order sheet (sheet.ts), where the buyer places it as one order
 * through the gate. A line whose open point can be accepted as it is (an unusual amount, another form) is accepted by
 * this tap, as the card's button says; a line the planner holds (a rule or the mandate, nothing safe to buy) is left
 * off and named.
 */
async function toSheet(run: TurnRun, planId: string): Promise<void> {
  const m = own(run, planId);
  const svc = await planner(run);
  let planned = await svc.service.get(svc.kitchen, planId);
  if (planned.record.state !== "planned") throw new DockError(409, "turn_card_stale", "This menu cannot be ordered: start a new one.", "intake_sequence");
  const accept: string[] = [];
  const leftOff: { lineId: string; name: string; why: string }[] = [];
  for (const l of planned.view.lines) {
    if (l.status !== "ready" && l.status !== "needs_decision") continue;
    const open = l.doubts.filter((d) => !d.accepted);
    if (!l.chosen || open.some((d) => !d.acceptLabel)) leftOff.push({ lineId: l.lineId, name: l.name, why: plain(open.find((d) => !d.acceptLabel)?.text ?? "nothing to buy") });
    else accept.push(...open.map((d) => d.doubtId));
  }
  if (accept.length) planned = await svc.service.edit(svc.kitchen, planId, accept.map((doubtId) => ({ op: "accept" as const, doubtId })), byLine(run));
  const merged = new Map<string, { productId: string; packs: number; substituteFor?: string }>();
  for (const l of planned.view.lines) {
    if (!l.chosen || (l.status !== "ready" && l.status !== "needs_decision") || leftOff.some((x) => x.lineId === l.lineId)) continue;
    for (const q of l.chosen.quoteLines) {
      const prev = merged.get(q.productId);
      if (prev) prev.packs += q.quantity;
      else merged.set(q.productId, { productId: q.productId, packs: q.quantity, ...(q.substituteFor ? { substituteFor: q.substituteFor } : {}) });
    }
  }
  if (!merged.size) throw new DockError(409, "menu_nothing_to_order", leftOff.length ? `Nothing on this menu can be ordered as it is: ${leftOff.map((x) => `${x.name} (${x.why})`).join("; ")}.` : "Nothing on this menu is being bought.");
  const p = planned.record;
  const st = step(run, "plan", "Putting the menu on the order sheet");
  const sheet = await createSheet(run, {
    lines: [...merged.values()],
    ...(p.settings.deliverBy ? { deliveryDate: p.settings.deliverBy } : planned.view.totals.deliveryDate ? { deliveryDate: planned.view.totals.deliveryDate } : {}),
    text: `Menu for ${p.settings.covers ?? "?"} covers: ${p.draft.dishes.map((d) => d.name).join(", ")}`,
  });
  m.sheetId = sheet.sheetId;
  record(run, "menu_to_sheet", `The buyer put the menu on the order sheet ${sheet.sheetId}: ${merged.size} products${accept.length ? `, ${accept.length} open point${accept.length > 1 ? "s" : ""} accepted by the tap` : ""}${leftOff.length ? `; left off: ${leftOff.map((x) => `${x.name} (${x.why})`).join("; ")}` : ""}.`, { planId, sheetId: sheet.sheetId, accepted: accept, leftOff }, p.requestId);
  show(run, await fullCard(run, svc, m, planned));
  st.done(`${merged.size} products`);
}

/** The menu builder's actions (engine → widgets.ts). */
export async function runMenuAction(run: TurnRun, a: { type: string } & Record<string, unknown>): Promise<boolean> {
  const planId = String(a.planId ?? "");
  switch (a.type) {
    case "menu_choose":
      await choose(run, planId, String(a.proposalId));
      return true;
    case "menu_covers":
      await edit(run, planId, [{ op: "covers", covers: Number(a.covers) }], `Covers: ${a.covers}`);
      return true;
    case "menu_day":
      await edit(run, planId, [{ op: "deliverBy", date: String(a.date) }], `Delivery by ${a.date}`);
      return true;
    case "menu_line_swap": {
      const optionId = String(a.optionId);
      const lineId = String(a.lineId);
      await edit(run, planId, [optionId.startsWith("fix:") ? { op: "applyFix", lineId, fixId: optionId.slice(4) } : { op: "choose", lineId, optionId }], "Another product for a line");
      return true;
    }
    case "menu_line_have":
      await edit(run, planId, [{ op: "strike", lineId: String(a.lineId), struck: !!a.have }], a.have ? "The kitchen has this" : "Buying this after all");
      return true;
    case "menu_line_per_cover":
      await edit(run, planId, [{ op: "perCover", lineId: String(a.lineId), dishId: String(a.dishId), amount: Number(a.amount) }], "Amount per cover");
      return true;
    case "menu_accept":
      await edit(run, planId, [{ op: "accept", doubtId: String(a.doubtId) }], "Accepted as it is");
      return true;
    case "menu_to_sheet":
      await toSheet(run, planId);
      return true;
    default:
      return false;
  }
}

/** A menu card still open (ready, not yet on a sheet), for the agent's open decisions. */
export function openMenu(run: TurnRun): MenuCard | undefined {
  return run.store
    .cards(run.thread)
    .map((x) => x.card)
    .filter((c): c is MenuCard => c.type === "menu")
    .reverse()
    .find((c) => (c.stage === "ready" || c.stage === "choose") && !c.sheetId);
}

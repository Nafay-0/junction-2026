/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: the driver reads untyped JSON replies. */
/**
 * The `legacy` driver: today's store, replayed over HTTP exactly as its pages call the server, for a buyer who
 * uses the old UI optimally (no hesitation, the right tap first time).
 *
 *   order page (k/[kitchen]/console.tsx)   words -> POST /ui-api/kitchens/{k}/call { POST /api/v1/agent/interpret }
 *                                          (with `earlier` requests when the words point back, memory.ts), then
 *                                          /api/v1/intake, /concerns, /answers, /choice, /api/v1/orders, each a tap
 *   assistant panel (assistant.tsx)        a question (its isQuestion rule) -> POST /ui-api/kitchens/{k}/assistant
 *   history "Change" (history.tsx)         a tap, then the words are read against that one request
 *   menu page (_plan/menu-planner.tsx)     a dish -> POST /ui-api/plan/{k}, poll, decide each doubt, quote, order
 *
 * Not replayed: the ledger and memory side panels' polling (they do not gate any milestone).
 */
import { earlierFor, looksLikeFollowUp, toEarlier } from "@/app/k/[kitchen]/memory";
import type { Scenario } from "./scenarios";
import { signInAs, Browser, Marks, emptyOutcome, noActions, sleep, type Actions, type Json, type OptionSeen, type Outcome } from "./lib";

/** The assistant panel's rule for "this is a question" (k/[kitchen]/assistant.tsx, copied: that file is a React component). */
const QUESTION = /\?\s*$|^\s*(is|are|does|do|did|what|what's|which|why|how|when|where|who|can|could|should|has|have|tell|show|explain|compare|onko|ovatko|mikä|mitkä|mitä|miksi|miten|milloin|kuka|voiko|paljonko|kerro|är|vad|varför|hur|när|vilken|vilka|finns|kan)\b/i;
const isQuestion = (t: string) => QUESTION.test(t);

/** A dish or a menu goes to the store's menu page, as a buyer who knows the store would take it there. */
const DISH = /\b(soup|stew|menu|recipe|for \d+ (people|guests|covers)|keitto|menu|resepti|hengelle)\b/i;

export type RunResult = { outcome: Outcome; actions: Actions; marks: Marks; calls: number; cached: boolean[]; serverMarks?: Record<string, unknown>; streamed?: boolean };

export async function runLegacy(base: string, sc: Scenario): Promise<RunResult> {
  const b = new Browser(base);
  const k = sc.kitchen;
  await signInAs(b, k);
  const o = emptyOutcome();
  const actions = noActions();
  const cached: boolean[] = [];

  // Page load (not timed): who the console buys for, and the history list.
  const info = await b.get(`/ui-api/kitchens/${k}`);
  const by: string = info.body?.kitchen?.by ?? "the buyer";
  let overview = (await b.get(`/ui-api/kitchens/${k}/portal`)).body;
  const marks = new Marks();
  let first = true;
  const call = (method: "GET" | "POST", path: string, body?: unknown, onHeaders?: () => void) => b.post(`/ui-api/kitchens/${k}/call`, { method, path, body }, { onHeaders });
  const sign = () => first && marks.hit("first_sign");

  let step: Json | undefined;
  let lastOptions: OptionSeen[] = [];
  let history: { q: string; a: string }[] = [];

  const absorb = (s: Json) => {
    if (!s) return;
    step = s;
    o.state = s.state;
    if (!o.requests.includes(s.requestId)) o.requests.push(s.requestId);
    for (const c of s.concerns ?? []) if (!o.concerns.some((x) => x.key === c.key)) o.concerns.push({ code: c.code, message: c.message, key: c.key });
    for (const a of s.acknowledgements ?? []) if (!o.acknowledgements.some((x) => x.code === a.code && x.action === a.action)) o.acknowledgements.push({ code: a.code, action: a.action, channel: a.channel, verified: a.verified });
    o.questions = Math.max(o.questions, (s.questions ?? []).length);
    for (const n of s.notes ?? []) if (!o.notes.includes(n)) o.notes.push(n);
    for (const e of s.excluded ?? []) {
      const t = typeof e === "string" ? e : `${e.productId ?? ""} ${e.reason ?? ""}`;
      if (!o.excluded.includes(t)) o.excluded.push(t);
    }
    if ((s.options ?? []).length) {
      lastOptions = s.options.map(optionSeen);
      o.options = lastOptions;
      for (const x of lastOptions) o.allOptions.push(x);
      marks.hit("options");
    }
  };

  const tap = (what: string) => {
    actions.taps++;
    actions.list.push(`tap: ${what}`);
  };

  /** The order page reading the words and opening the request. */
  async function orderPage(text: string, followUp?: Json): Promise<void> {
    const earlier = followUp ? [toEarlier(followUp)] : looksLikeFollowUp(text) ? earlierFor(overview?.requests ?? []) : undefined;
    const r = await call("POST", "/api/v1/agent/interpret", earlier?.length ? { text, earlier } : { text }, sign);
    first = false;
    marks.hit("understood");
    if (r.body?.need) {
      cached.push(!!r.body.cached);
      const need = { ...r.body.need, text: r.body.need.text ?? text };
      reading(need, r.body.basedOn?.requestId, r.body.alsoAsked);
      await openIntake(need);
      return;
    }
    const e = r.body?.error ?? {};
    if (e.code === "need_incomplete") {
      const missing: string[] = e.details?.missing ?? [];
      o.notices.push({ kind: "incomplete", message: e.message, missing } as any);
      o.log.push(`incomplete: missing ${missing.join(", ")}`);
      // The order page shows a field for each missing part; the buyer fills it in (console.tsx `complete`).
      const fill = sc.legacyFill;
      if (!fill || !missing.every((m) => (m === "item" ? fill.item : m === "quantity" ? fill.quantity : false))) return;
      const partial = e.details?.partial ?? { item: { text: "" } };
      const need = { ...partial, text, ...(missing.includes("item") ? { item: { ...partial.item, text: fill.item } } : {}), ...(missing.includes("quantity") ? { quantity: fill.quantity } : {}) };
      for (const m of missing) {
        actions.extraTyped++;
        actions.list.push(`filled in: ${m}`);
      }
      reading(need);
      await openIntake(need);
      return;
    }
    if (e.code === "not_a_purchase_request") o.notices.push({ kind: "not_purchase", message: e.message });
    else o.notices.push({ kind: "error", message: `${r.status} ${e.code ?? ""} ${e.message ?? ""}` });
  }

  function reading(need: Json, basedOn?: string, alsoAsked?: string[]) {
    const x = { item: need.item?.text, amount: need.quantity?.amount, unit: need.quantity?.unit, deliverBy: need.deliverBy, basedOn, alsoAsked: (alsoAsked ?? []).map((a: any) => (typeof a === "string" ? a : (a.text ?? a.item ?? JSON.stringify(a)))) };
    o.readings.push(x);
    o.understood ??= { ...x, attributes: need.item?.attributes ?? [], allergens: need.forbiddenAllergens ?? [] };
  }

  async function openIntake(need: Json) {
    const r = await call("POST", "/api/v1/intake", { need, by });
    if (r.body?.step) absorb(r.body.step);
    else o.refusals.push({ code: r.body?.error?.code, rule: r.body?.error?.rule, message: r.body?.error?.message ?? `intake ${r.status}` });
  }

  async function stepCall(path: string, body: unknown) {
    const r = await call("POST", path, body);
    if (r.body?.step) absorb(r.body.step);
    else o.refusals.push({ code: r.body?.error?.code, rule: r.body?.error?.rule, message: r.body?.error?.message ?? `${path} ${r.status}` });
  }

  /** Tap through the mistake check and the questions until options (or an end) are on screen. */
  async function toOptions(stopAtFlag: boolean) {
    for (let i = 0; i < 6 && step; i++) {
      if (step.state === "needs_confirmation") {
        if (stopAtFlag) return;
        for (const c of step.concerns ?? []) {
          const choice = sc.onConcern === "correct" || !c.confirmable ? (c.corrections.find((x: Json) => !x.cancel)?.id ?? c.corrections[0]?.id ?? "confirm") : "confirm";
          tap(`${c.code} → ${choice}`);
          await stepCall(`/api/v1/intake/${step.requestId}/concerns`, { by, responses: [{ key: c.key, choice }] });
          if (step.state !== "needs_confirmation") break;
        }
      } else if (step.state === "needs_input") {
        for (const q of step.questions ?? []) {
          tap(`answer ${q.id} → ${q.options[0].id}`);
          await stepCall(`/api/v1/intake/${step.requestId}/answers`, { by, answers: [{ questionId: q.id, optionId: q.options[0].id, remember: false }] });
          if (step.state !== "needs_input") break;
        }
      } else return;
    }
  }

  async function choose(index?: number) {
    if (!step || step.state !== "options_ready" || !(step.options ?? []).length) return;
    const opts = step.options;
    const i = index ?? Math.max(0, opts.findIndex((x: Json) => x.optionId === step!.preselected?.optionId));
    const pick = opts[Math.min(i, opts.length - 1)];
    tap(`choose option ${i + 1} (${pick.rank})`);
    o.chosen = { optionId: pick.optionId, index: i };
    await stepCall(`/api/v1/intake/${step.requestId}/choice`, { by, optionId: pick.optionId });
  }

  async function place() {
    const q = step?.quote;
    if (!step || !q) return;
    tap("place order");
    const r = await call("POST", "/api/v1/orders", { requestId: step.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }: Json) => ({ productId, quantity, unitPriceCents })) });
    const order = r.body?.order;
    if (order) {
      o.orders.push(orderSeen(order));
      if (order.status === "committed" || order.status === "pending_approval") marks.hit("placed");
    }
    if (r.status >= 400) o.refusals.push({ code: r.body?.error?.code, rule: r.body?.error?.rule, message: r.body?.error?.message ?? `order ${r.status}` });
  }

  async function assistant(text: string): Promise<boolean> {
    const r = await b.post(`/ui-api/kitchens/${k}/assistant`, { question: text, screen: "the order page", history }, { onHeaders: sign });
    first = false;
    if (r.body?.kind === "order_request") return false;
    marks.hit("answered");
    const a = r.body ?? {};
    o.answers.push({ text: a.answer ?? r.body?.error?.message ?? "", kind: a.kind, citations: (a.citations ?? []).map((c: Json) => ({ kind: c.kind, productId: c.productId, orderId: c.orderId, label: c.label })) });
    history = [...history, { q: text, a: a.answer ?? "" }].slice(-4);
    return true;
  }

  async function menuPage(text: string) {
    let r = await b.post(`/ui-api/plan/${k}`, { text }, { onHeaders: sign });
    first = false;
    let plan = r.body;
    for (let i = 0; i < 120 && plan?.pending; i++) {
      await sleep(500);
      plan = (await b.get(`/ui-api/plan/${k}/${plan.planId}`)).body;
    }
    if (!plan?.planId) {
      o.refusals.push({ code: plan?.error?.code, message: plan?.error?.message ?? `plan ${r.status}` });
      return;
    }
    marks.hit("understood");
    o.state = "plan";
    let struck = 0;
    let doubts = 0;
    for (const l of plan.lines ?? []) {
      const open = (l.doubts ?? []).filter((d: Json) => !d.accepted);
      if (!open.length) continue;
      if (open.every((d: Json) => d.acceptLabel)) {
        for (const d of open) {
          doubts++;
          tap(`plan: accept "${d.acceptLabel}"`);
          r = await b.post(`/ui-api/plan/${k}/${plan.planId}`, { edits: [{ op: "accept", doubtId: d.doubtId }] });
          if (r.body?.planId) plan = r.body;
        }
      } else {
        struck++;
        tap(`plan: strike ${l.item ?? l.lineId}`);
        r = await b.post(`/ui-api/plan/${k}/${plan.planId}`, { edits: [{ op: "strike", lineId: l.lineId, struck: true }] });
        if (r.body?.planId) plan = r.body;
      }
    }
    o.plan = { lines: plan.lines?.length ?? 0, struck, doubts, unsourced: (plan.lines ?? []).filter((l: Json) => l.struck).map((l: Json) => l.item ?? l.lineId) };
    tap("plan: get the fixed price");
    const q = await b.post(`/ui-api/plan/${k}/${plan.planId}/quote`);
    if (q.status !== 200) {
      o.refusals.push({ code: q.body?.error?.code, rule: q.body?.error?.rule, message: q.body?.error?.message ?? `quote ${q.status}` });
      return;
    }
    const lines = (q.body?.quote?.lines ?? []).map((l: Json) => ({ productId: l.productId, name: l.name, packs: l.quantity, substituteFor: l.substituteFor }));
    const opt: OptionSeen = { optionId: "plan", totalCents: q.body?.quote?.totalCents ?? 0, givesUp: [], lines, signOff: [] };
    o.options = [opt];
    o.allOptions.push(opt);
    marks.hit("options");
    tap("plan: order");
    const placed = await b.post(`/ui-api/plan/${k}/${plan.planId}/order`);
    const order = placed.body?.order;
    if (order) {
      o.orders.push({ ...orderSeen(order), approver: order.approver?.name ?? order.approval?.approver?.name, lines: (order.lines ?? q.body?.quote?.lines ?? []).map((l: Json) => ({ productId: l.productId, quantity: l.quantity })) });
      if (order.status === "committed" || order.status === "pending_approval") marks.hit("placed");
    } else o.refusals.push({ code: placed.body?.error?.code, rule: placed.body?.error?.rule, message: placed.body?.error?.message ?? `order ${placed.status}` });
  }

  /** Words typed into the store's agent field, routed as the store routes them. */
  async function words(text: string, followUp?: Json) {
    if (!followUp && sc.kitchen === "kaari" && DISH.test(text)) return menuPage(text);
    if (!followUp && isQuestion(text) && (await assistant(text))) return;
    await orderPage(text, followUp);
  }

  // ---------- the scenario ----------

  for (let t = 0; t < sc.turns.length; t++) {
    const turn = sc.turns[t];
    if (t > 0) {
      if (!turn.raw) await toOptions(false);
      const l = turn.legacy;
      if (l && "tap" in l && l.tap === "choose") {
        await choose(l.index);
        continue;
      }
      if (l && "tap" in l && l.tap === "concern") {
        if (step?.state === "needs_confirmation") {
          for (const c of step.concerns ?? []) {
            const choice = l.choice === "confirm" && c.confirmable ? "confirm" : (c.corrections.find((x: Json) => !x.cancel)?.id ?? "confirm");
            tap(`${c.code} → ${choice} (instead of "${turn.say}")`);
            await stepCall(`/api/v1/intake/${step.requestId}/concerns`, { by, responses: [{ key: c.key, choice }] });
            if (step.state !== "needs_confirmation") break;
          }
        } else o.log.push(`"${turn.say}": nothing to confirm (${step?.state})`);
        continue;
      }
      actions.typed++;
      actions.list.push(`typed: ${turn.say}`);
      if (l && "change" in l) {
        overview = (await b.get(`/ui-api/kitchens/${k}/portal`)).body; // the history list, as it refreshes on the page
        const req = (overview?.requests ?? []).find((r: Json) => r.requestId === step?.requestId || r.key === step?.requestId) ?? overview?.requests?.[0];
        tap("history: Change this request");
        await words(turn.say, req);
        continue;
      }
    }
    await words(turn.say);
  }

  // Words the old UI dropped: typed again as their own request.
  if (sc.legacyAlso) {
    await toOptions(sc.goal === "flag");
    for (const extra of sc.legacyAlso) {
      actions.extraTyped++;
      actions.list.push(`typed again: ${extra}`);
      await orderPage(extra);
      await toOptions(sc.goal === "flag");
    }
  }

  // ---------- what the buyer still has to do to reach the goal ----------
  if (sc.goal !== "answer" && step && o.state !== "plan") {
    await toOptions(sc.goal === "flag");
    if (sc.goal === "place") {
      if (step.state === "options_ready") await choose();
      if (step.state === "quoted") await place();
    }
  }
  marks.hit("total");

  // Clean up (not the buyer's): take back an order still waiting, so the next scenario starts without a duplicate.
  for (const x of o.orders) if (x.status === "pending_approval") await call("POST", `/api/v1/orders/${x.orderId}/withdraw`, { reason: "eval cleanup", by: "eval" });

  return { outcome: o, actions, marks, calls: b.calls.length, cached };
}

export function optionSeen(x: Json): OptionSeen {
  return {
    optionId: x.optionId,
    rank: x.rank,
    title: x.title,
    match: x.match,
    totalCents: x.totalCents,
    deliveryDate: x.deliveryDate,
    orderBy: x.orderBy,
    givesUp: (x.givesUp ?? []).map((g: Json) => (typeof g === "string" ? g : (g.text ?? g.part ?? JSON.stringify(g)))),
    alternative: x.alternative,
    lines: (x.lines ?? []).map((l: Json) => ({ productId: l.productId, name: l.name, packs: l.packs ?? l.quantity, substituteFor: l.substituteFor })),
    signOff: x.signOff ?? [],
  };
}

function orderSeen(order: Json): Outcome["orders"][number] {
  return {
    orderId: order.orderId,
    status: order.status,
    approver: order.approval?.approver?.name ?? order.approver?.name,
    rules: (order.decision?.rules ?? []).map((r: Json) => ({ rule: r.rule, outcome: r.outcome })),
    reasons: order.decision?.reasons ?? [],
    totalCents: order.totalCents,
    lines: (order.lines ?? []).map((l: Json) => ({ productId: l.productId, quantity: l.quantity })),
  };
}

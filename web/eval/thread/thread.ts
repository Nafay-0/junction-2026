/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: the driver reads untyped JSON events. */
/**
 * The `thread` driver: the agent thread contract (docs/agent-thread.md, server/thread/types.ts). One thread per
 * kitchen, started over for each scenario (POST /thread/reset). Each buyer turn is POST /thread/turns; the driver
 * reads GET /thread/stream (Server-Sent Events, resumed with ?after=<seq>) and falls back to polling GET /thread
 * if the stream does not answer. It waits for each agent turn to leave `working`, then does what the buyer would:
 * the scenario's next words, or the one tap the cards ask for (confirm a flag, answer a question, pick an option,
 * place the price) until the scenario's goal is reached.
 *
 * Kept small and tolerant on purpose: unknown event or card types are ignored, a card sent again replaces the
 * earlier one by cardId, and every milestone is taken from the first event that shows it.
 */
import type { Card, ThreadAction, ThreadEvent, Turn } from "@/server/thread/types";
import type { Scenario } from "./scenarios";
import { Browser, Marks, emptyOutcome, noActions, signInAs, sleep, type Json, type OptionSeen, type Outcome } from "./lib";
import type { RunResult } from "./legacy";

const SETTLED = new Set(["waiting_buyer", "waiting_approver", "done", "failed"]);
const TURN_TIMEOUT_MS = 180_000;

class ThreadState {
  seq = 0;
  status = new Map<string, string>();
  /** cardId -> [turnId, card], in first-seen order; a newer version replaces in place. */
  cards = new Map<string, { turnId: string; card: Card; at: number }>();
  steps = new Map<string, { turnId: string; at: number }>();
  lines: string[] = [];
  /** Lines by agent turn, so a later turn's line can count as the answer to a follow-up question. */
  lineTurns: { turnId: string; text: string }[] = [];
  serverMarks = new Map<string, Json>();
  onEvent?: (e: ThreadEvent, at: number) => void;

  apply(e: ThreadEvent, at = performance.now(), fromSnapshot = false) {
    if (!fromSnapshot && typeof e?.seq === "number") {
      if (e.seq <= this.seq && e.type !== "reset") return;
      this.seq = e.seq;
    }
    switch (e.type) {
      case "turn": {
        const t = e.turn as Turn;
        if (t.role === "agent") {
          this.status.set(t.turnId, t.status);
          for (const s of t.steps ?? []) if (!this.steps.has(s.stepId)) this.steps.set(s.stepId, { turnId: t.turnId, at });
          for (const c of t.cards ?? []) this.putCard(t.turnId, c, at);
          if (t.line && !this.lineTurns.some((x) => x.turnId === t.turnId)) {
            this.lines.push(t.line);
            this.lineTurns.push({ turnId: t.turnId, text: t.line });
          }
          if (t.marks) this.serverMarks.set(t.turnId, t.marks);
        }
        break;
      }
      case "step":
        if (!this.steps.has(e.step.stepId)) this.steps.set(e.step.stepId, { turnId: e.turnId, at });
        break;
      case "card":
        this.putCard(e.turnId, e.card, at);
        break;
      case "line":
        if (!this.lineTurns.some((x) => x.turnId === e.turnId)) {
          this.lines.push(e.text);
          this.lineTurns.push({ turnId: e.turnId, text: e.text });
        }
        break;
      case "status":
        this.status.set(e.turnId, e.status);
        if (e.marks) this.serverMarks.set(e.turnId, e.marks);
        break;
      case "reset":
        this.cards.clear();
        this.status.clear();
        break;
    }
    this.onEvent?.(e, at);
  }

  putCard(turnId: string, card: Card, at: number) {
    const was = this.cards.get(card.cardId);
    this.cards.set(card.cardId, { turnId: was?.turnId ?? turnId, card, at: was?.at ?? at });
  }

  /** A thread snapshot (GET /thread) as if its events had been streamed. */
  applySnapshot(thread: Json, at = performance.now()) {
    for (const t of thread?.turns ?? []) if (t.role === "agent") this.apply({ seq: -1, threadId: thread.threadId, at: "", type: "turn", turn: t } as any, at, true);
    if (typeof thread?.seq === "number") this.seq = Math.max(this.seq, thread.seq);
  }

  ofType<T extends Card["type"]>(type: T): Extract<Card, { type: T }>[] {
    return [...this.cards.values()].filter((x) => x.card.type === type).map((x) => x.card as Extract<Card, { type: T }>);
  }
}

/** Read the event stream until aborted; resolves false when the stream is not there (404, not SSE). */
async function stream(b: Browser, path: string, st: ThreadState, signal: AbortSignal, onOpen: () => void): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(new URL(`${path}?after=${st.seq}`, b.base), { headers: { accept: "text/event-stream", cookie: b.cookie() }, signal });
  } catch {
    return false;
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) return false;
  onOpen();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        try {
          st.apply(JSON.parse(data));
        } catch {
          // not an event we read
        }
      }
    }
  } catch {
    // aborted or dropped
  }
  return true;
}

export async function runThread(base: string, sc: Scenario): Promise<RunResult> {
  const b = new Browser(base);
  const k = sc.kitchen;
  const root = `/ui-api/kitchens/${k}/thread`;
  const o = emptyOutcome();
  const actions = noActions();
  const st = new ThreadState();

  // The stage kitchens are open only to their own signed-in account (main since 14 Nov): sign in when the server's
  // password is known (DOCK_KAARI_PASSWORD / DOCK_LAAKSO_PASSWORD), as a judge at the table would.
  await signInAs(b, k);
  // Start over, then load the (empty) thread: not timed.
  await b.post(`${root}/reset`, {});
  const snap = await b.get(root);
  if (snap.status !== 200) {
    o.notices.push({ kind: "error", message: `GET ${root}: ${snap.status} ${snap.body?.error?.code ?? snap.text.slice(0, 120)}` });
    const marks = new Marks();
    marks.hit("total");
    return { outcome: o, actions, marks, calls: b.calls.length, cached: [] };
  }
  st.applySnapshot(snap.body?.thread);

  let marks = new Marks();
  let firstAgentTurn: string | undefined;
  st.onEvent = (e, at) => {
    const tId = (e as any).turnId ?? ((e as any).turn?.role === "agent" ? (e as any).turn.turnId : undefined);
    if (e.type === "step" && firstAgentTurn && tId === firstAgentTurn) marks.hit("first_sign", at);
    if (e.type === "turn" && (e as any).turn?.role === "agent" && (e as any).turn.steps?.length && tId === firstAgentTurn) marks.hit("first_sign", at);
    const cards: Card[] = e.type === "card" ? [e.card] : e.type === "turn" && (e as any).turn?.role === "agent" ? ((e as any).turn.cards ?? []) : [];
    for (const c of cards) {
      if (c.type === "understood") marks.hit("understood", at);
      if (c.type === "options") marks.hit("options", at);
      if (c.type === "records") marks.hit("answered", at);
      if ((c.type === "gate" && (c.outcome === "placed_alone" || c.outcome === "waiting")) || (c.type === "order" && (c.status === "committed" || c.status === "pending_approval"))) marks.hit("placed", at);
    }
  };

  const ctl = new AbortController();
  let streaming = false;
  let streamedOnce = false;
  const streamDone = stream(b, `${root}/stream`, st, ctl.signal, () => (streaming = streamedOnce = true)).then(() => (streaming = false));
  await sleep(150); // let the stream connect before the first turn

  async function settle(agentTurnId: string) {
    const until = performance.now() + TURN_TIMEOUT_MS;
    while (performance.now() < until) {
      const s = st.status.get(agentTurnId);
      if (s && SETTLED.has(s)) return s;
      await sleep(streaming ? 100 : 400);
      if (!streaming) {
        const r = await b.get(root);
        if (r.status === 200) st.applySnapshot(r.body?.thread);
      }
    }
    return "timeout";
  }

  async function submit(body: { text?: string; action?: ThreadAction; label?: string; via: "typed" | "tap" }, isFirst = false): Promise<string> {
    const r = await b.post(`${root}/turns`, { door: "typed", ...body, lang: sc.lang, clientTurnId: `eval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` });
    if (r.status !== 202 && r.status !== 200) {
      o.notices.push({ kind: "error", message: `POST turns ${r.status}: ${r.body?.error?.code ?? ""} ${r.body?.error?.message ?? r.text.slice(0, 120)}` });
      return "refused";
    }
    const id: string = r.body?.agentTurnId;
    if (isFirst) firstAgentTurn = id;
    // Events that arrived before the id was known.
    if (isFirst) for (const s of st.steps.values()) if (s.turnId === id) marks.hit("first_sign", s.at);
    const out = await settle(id);
    o.state = out;
    return out;
  }

  const tap = async (action: ThreadAction, label: string) => {
    actions.taps++;
    actions.list.push(`tap: ${label}`);
    return submit({ via: "tap", action, label });
  };

  /** The one open thing a buyer must answer now, if any: a flag, a question, an option to pick, a price to place. */
  function open() {
    const answeredReq = new Set(st.ofType("order").map((c) => c.requestId).concat(st.ofType("gate").map((c) => c.requestId)));
    const anomaly = st.ofType("anomaly").filter((c) => !c.answered && !answeredReq.has(c.requestId)).at(-1);
    const question = st.ofType("question").filter((c) => !c.answered && !answeredReq.has(c.requestId)).at(-1);
    const options = st.ofType("options").filter((c) => !c.chosen && !answeredReq.has(c.requestId)).at(-1);
    const price = st.ofType("price").filter((c) => !answeredReq.has(c.requestId)).at(-1);
    const plan = st.ofType("plan").filter((c) => c.state === "planned" && c.canOrder).at(-1);
    return { anomaly, question, options, price, plan };
  }

  async function toOptions(stopAtFlag: boolean) {
    for (let i = 0; i < 6; i++) {
      const { anomaly, question } = open();
      if (anomaly) {
        if (stopAtFlag) return;
        const c = anomaly.concerns[0];
        const choice = sc.onConcern === "correct" || !c.confirmable ? (c.corrections[0]?.id ?? "confirm") : "confirm";
        await tap({ type: "concern", requestId: anomaly.requestId, key: c.key, choice }, `${c.code} → ${choice}`);
      } else if (question) {
        const q = question.questions.find((x) => !question.answered?.[x.id]) ?? question.questions[0];
        await tap({ type: "answer", requestId: question.requestId, questionId: q.id, optionId: q.options[0].id }, `answer ${q.id} → ${q.options[0].id}`);
      } else return;
    }
  }

  // ---------- the scenario ----------
  marks = new Marks();
  let last = await submit({ via: "typed", text: sc.turns[0].say }, true);
  for (const turn of sc.turns.slice(1)) {
    if (!turn.raw) await toOptions(false);
    actions.typed++;
    actions.list.push(`typed: ${turn.say}`);
    last = await submit({ via: "typed", text: turn.say });
  }
  if (sc.goal !== "answer") {
    await toOptions(sc.goal === "flag");
    for (let i = 0; i < 3 && sc.goal === "place" && last !== "refused"; i++) {
      const { options, price, anomaly, question, plan } = open();
      if (anomaly || question) break;
      if (plan) last = await tap({ type: "plan_order", planId: plan.planId }, "order the plan");
      else if (options) {
        const pick = options.preselected?.optionId ?? options.options[0]?.optionId;
        if (!pick) break;
        last = await tap({ type: "choose", requestId: options.requestId, optionId: pick }, `choose ${pick}`);
      } else if (price) last = await tap({ type: "place", requestId: price.requestId }, "place order");
      else break;
    }
  }
  marks.hit("total");
  ctl.abort();
  await streamDone.catch(() => undefined);

  // A last full read, so the outcome holds every card's final version.
  const fin = await b.get(root);
  if (fin.status === 200) st.applySnapshot(fin.body?.thread);
  collect(st, o);
  // A follow-up question answered in words: the agent's grounded line on a later turn is the answer.
  for (const l of st.lineTurns) if (l.turnId !== firstAgentTurn && sc.turns.slice(1).some((t) => /\?\s*$/.test(t.say))) o.answers.push({ text: l.text, kind: "line", citations: [] });

  for (const x of o.orders) if (x.status === "pending_approval") await b.post(`/ui-api/kitchens/${k}/call`, { method: "POST", path: `/api/v1/orders/${x.orderId}/withdraw`, body: { reason: "eval cleanup", by: "eval" } });
  return { outcome: o, actions, marks, calls: b.calls.length, cached: [], serverMarks: Object.fromEntries(st.serverMarks), streamed: streamedOnce };
}

/** The cards, as the driver-independent outcome the checks read. */
function collect(st: ThreadState, o: Outcome) {
  const cards = [...st.cards.values()].map((x) => x.card);
  for (const c of cards) {
    switch (c.type) {
      case "understood": {
        const r = { item: c.item, amount: c.amount?.amount, unit: c.amount?.unit, deliverBy: c.deliverBy ?? c.deliverOn, basedOn: c.basedOn?.requestId, alsoAsked: c.alsoAsked ?? [] };
        o.readings.push(r);
        o.understood ??= { ...r, attributes: c.claims ?? [], allergens: c.allergens ?? [] };
        // Noticed without asking (the mistake check's quiet tier): counted as a flag, with no tap.
        for (const n of c.notes ?? []) if (!o.concerns.some((x) => x.key === `noted:${n.code}`)) o.concerns.push({ code: n.code, message: `noticed ${JSON.stringify(n.params)}`, key: `noted:${n.code}` });
        if (c.requestId && !o.requests.includes(c.requestId)) o.requests.push(c.requestId);
        break;
      }
      case "anomaly":
        for (const x of c.concerns) if (!o.concerns.some((y) => y.key === x.key)) o.concerns.push({ code: x.code, message: x.message, key: x.key });
        if (c.answered) o.acknowledgements.push({ code: c.concerns[0]?.code ?? "", action: c.answered.choice, verified: c.answered.verified, channel: c.answered.verified ? "portal_session" : "relayed" });
        break;
      case "question":
        o.questions += c.questions.length;
        break;
      case "options": {
        const seen: OptionSeen[] = c.options.map((x) => ({
          optionId: x.optionId,
          rank: x.rank,
          title: x.title,
          match: x.match,
          totalCents: x.totalCents,
          deliveryDate: x.deliveryDate,
          orderBy: x.orderBy,
          givesUp: x.givesUp ?? [],
          alternative: x.alternative,
          lines: x.lines.map((l) => ({ productId: l.productId, name: l.name, packs: l.quantity, substituteFor: l.substituteFor })),
          signOff: [...(x.signOff ?? []), ...(x.cons ?? [])],
        }));
        o.options = seen;
        o.allOptions.push(...seen);
        for (const e of c.excluded ?? []) o.excluded.push(`${e.count} ${e.reason}`);
        for (const n of c.notes ?? []) if (!o.notes.includes(n)) o.notes.push(n);
        if (c.chosen) o.chosen = { optionId: c.chosen, index: c.options.findIndex((x) => x.optionId === c.chosen) };
        break;
      }
      case "gate":
        if (c.outcome === "refused") o.refusals.push({ rule: c.rule, message: c.reasons.join(" ") });
        if ((c.outcome === "waiting" || c.outcome === "placed_alone") && c.orderId && !o.orders.some((x) => x.orderId === c.orderId))
          o.orders.push({ orderId: c.orderId, status: c.outcome === "waiting" ? "pending_approval" : "committed", approver: c.approver?.name, rules: c.rule ? [{ rule: c.rule, outcome: "escalate" }] : [], reasons: c.reasons, totalCents: 0, lines: [] });
        for (const r of c.reasons) if (!o.notes.includes(r)) o.notes.push(r);
        break;
      case "order": {
        const by = c.authorised;
        const x = { orderId: c.orderId, status: c.status, approver: by.by === "agent" ? undefined : by.name, rules: [], reasons: [], totalCents: c.totalCents, lines: c.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) };
        const i = o.orders.findIndex((y) => y.orderId === c.orderId);
        if (i >= 0) o.orders[i] = { ...o.orders[i], ...x, approver: x.approver ?? o.orders[i].approver };
        else o.orders.push(x);
        break;
      }
      case "records":
        o.answers.push({ text: c.question, kind: "records", citations: c.rows.map((r) => ({ kind: r.kind, orderId: r.kind === "order" ? r.ref : undefined, productId: r.kind === "product" ? r.ref : undefined, label: r.label, date: r.date }) as any) });
        break;
      case "notice":
        o.notices.push({ kind: c.kind, message: c.message, rule: c.rule });
        if (c.kind === "refused") o.refusals.push({ rule: c.rule, message: c.message });
        break;
    }
  }
  if (st.lines.length && o.answers.length === 0 && !cards.some((c) => c.type === "options" || c.type === "order")) o.answers.push({ text: st.lines.join(" "), kind: "line", citations: [] });
  if (cards.some((c) => c.type === "options") && o.options.length === 0) o.state = "no_options";
  if (cards.some((c) => c.type === "notice" && c.kind === "not_found")) o.state = "no_options";
}

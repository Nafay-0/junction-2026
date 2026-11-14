"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { interpretNeed, offlineExample, type EarlierRequest, type InterpretOutcome, type Interpretation } from "../../_client/interpret";
import type { NeedInput } from "@/core/need";
import { useLive } from "../../_client/use-live";
import { api, type ApiError } from "../../_client/api";
import { clock, day, measure, money, moneyShort, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { History } from "./history";
import { describeEarlier, earlierFor, looksLikeFollowUp, memoryLineFor, repeatNeed, toEarlier } from "./memory";
import { readSession, usePortal, type Pending } from "./portal";
import { LiveCalls, MandateBox, Memory } from "./rail";
import { Concerns, Gate, NoOptions, Options, Questions, Quote, SignOff, SignedOrder, Understood } from "./stages";
import { Timeline } from "./timeline";
import { Button, ErrorPlate, Lane, STATIONS, StationStrip, useFollowLane, type LaneStage, type Station, type StationState } from "./ui";
import type { KitchenInfo, LedgerReply, Order, PortalRequest, Product, Step } from "./types";

type Busy = "interpret" | "open" | "concern" | "answer" | "choose" | "order";
type Failure = { at: "understood" | "concerns" | "questions" | "options" | "quote"; title: string; message: string; retry?: () => void; offline?: () => void };
export type Incomplete = Extract<InterpretOutcome, { kind: "incomplete" }>;

export type Run = {
  n: number;
  text: string;
  interp?: Interpretation;
  /** The reader understood part of the request; the buyer fills in what is missing. */
  incomplete?: Incomplete;
  step?: Step;
  concernsSeen: Step["concerns"];
  asked: { id: string; text: string; options: { id: string; label: string }[] }[];
  answers: Record<string, { optionId: string; label: string; remember: boolean }>;
  fromMemory: Step["fromMemory"];
  options: Step["options"];
  order?: Order;
  orderRefusal?: ApiError;
  busy?: Busy;
  busyKey?: string;
  failure?: Failure;
};

const fresh = (n: number): Run => ({ n, text: "", concernsSeen: [], asked: [], answers: {}, fromMemory: [], options: [] });

/** What the read is resolved against: an earlier request the buyer is changing, or a product picked in the catalogue. */
type ReadContext = { earlier?: EarlierRequest[]; followUp?: PortalRequest; product?: Product; requests: PortalRequest[] };

export function Console() {
  const { kitchen, call, agent, overview } = usePortal();
  const slug = kitchen.slug;
  const [run, setRun] = useState<Run>(() => fresh(0));
  const runN = useRef(0);
  const focusField = agent.focus;

  /** Apply a change only if the person has not started a new request meanwhile. */
  const update = useCallback((n: number, f: (r: Run) => Run) => setRun((r) => (r.n === n ? f(r) : r)), []);

  const absorb = useCallback((r: Run, step: Step): Run => {
    const asked = [...r.asked];
    for (const q of step.questions) if (!asked.some((a) => a.id === q.id)) asked.push({ id: q.id, text: q.text, options: q.options });
    return {
      ...r,
      step,
      concernsSeen: step.concerns.length ? mergeConcerns(r.concernsSeen, step.concerns) : r.concernsSeen,
      asked,
      fromMemory: step.fromMemory.length ? step.fromMemory : r.fromMemory,
      options: step.options.length ? step.options : r.options,
      busy: undefined,
      busyKey: undefined,
      failure: undefined,
    };
  }, []);

  // ---------- actions ----------

  /** Hand a structured need to Dock's intake: the first step comes back. */
  const openIntake = useCallback(
    async (n: number, interp: Interpretation) => {
      update(n, (r) => ({ ...r, interp, incomplete: undefined, busy: "open", failure: undefined }));
      const res = await call<{ step: Step }>("POST", "/api/v1/intake", { need: interp.need, by: kitchen.by });
      if (res.ok) update(n, (r) => absorb(r, res.data.step));
      else
        update(n, (r) => ({
          ...r,
          busy: undefined,
          failure: { at: "understood", title: "AimoPilot did not take the request", message: res.error.message, retry: res.status === 0 || res.status >= 500 ? () => void openIntake(n, interp) : undefined },
        }));
    },
    [call, kitchen.by, update, absorb],
  );

  /** Read the buyer's words: with the model, or with the offline example reader when the buyer asks for it. */
  const read = useCallback(
    async (n: number, text: string, offline: boolean, ctx: ReadContext = { requests: [] }) => {
      update(n, (r) => ({ ...r, busy: "interpret", failure: undefined, incomplete: undefined }));
      const out = offline ? offlineExample(text) : await interpretNeed(slug, text, ctx.earlier);
      if (out.kind === "ok") return openIntake(n, withContext(out.interp, ctx));
      if (out.kind === "incomplete") return update(n, (r) => ({ ...r, busy: undefined, incomplete: out }));
      const failure: Failure =
        out.kind === "not_purchase"
          ? { at: "understood", title: "That does not read as something to buy", message: `${out.message} Write what the kitchen needs and how much.` }
          : out.kind === "unavailable"
            ? { at: "understood", title: "The model reader did not answer", message: out.message, retry: () => void read(n, text, false), offline: () => void read(n, text, true) }
            : { at: "understood", title: "AimoPilot could not read that", message: out.message };
      update(n, (r) => ({ ...r, busy: undefined, failure }));
    },
    [slug, update, openIntake],
  );

  const requests = useMemo(() => overview.data?.requests ?? [], [overview.data]);

  const submit = useCallback(
    async (text: string, followUp?: PortalRequest, product?: Product) => {
      const clean = text.trim();
      if (!clean) {
        focusField();
        return;
      }
      const n = ++runN.current;
      setRun({ ...fresh(n), text: clean, busy: "interpret" });
      // Earlier requests go to the reader only when they can matter: the buyer is changing one, or the words point back.
      const earlier = followUp ? [toEarlier(followUp)] : looksLikeFollowUp(clean) ? earlierFor(requests) : undefined;
      await read(n, clean, false, { earlier, followUp, product, requests });
    },
    [read, requests, focusField],
  );

  /** One-click repeat: the earlier need, rebuilt by plain code with a fresh date. No model, no question it already answered. */
  const repeat = useCallback(
    (r: PortalRequest) => {
      const rep = repeatNeed(r);
      const n = ++runN.current;
      if (!rep) {
        setRun({ ...fresh(n), text: r.text ?? "Repeat", failure: { at: "understood", title: "Nothing to repeat", message: "That earlier request has no amount or product to repeat. Write the request instead." } });
        return;
      }
      setRun({ ...fresh(n), text: rep.need.text ?? "Repeat", busy: "open" });
      void openIntake(n, { need: rep.need, model: "no model", ms: 0, offline: false, noModel: true, memoryLine: rep.memoryLine, basedOn: { requestId: r.key, fields: ["item", "quantity", "attributes"] } });
    },
    [openIntake],
  );

  // What the agent bar (on any page) or a "repeat" button handed over.
  const { pending, take, setDraft, setFollowUp, setProduct, setBusy } = agent;
  useEffect(() => {
    if (!pending) return;
    const p: Pending | undefined = take();
    if (!p) return;
    queueMicrotask(() => {
      if (p.kind === "repeat") repeat(p.request);
      else void submit(p.text, p.followUp, p.product);
      setDraft("");
      setFollowUp(undefined);
      setProduct(undefined);
    });
  }, [pending, take, repeat, submit, setDraft, setFollowUp, setProduct]);

  useEffect(() => {
    setBusy(run.busy === "interpret" || run.busy === "open");
  }, [run.busy, setBusy]);
  useEffect(() => () => setBusy(false), [setBusy]);

  /** The buyer filled in what the reader said was missing. */
  const complete = (need: NeedInput) => {
    const inc = run.incomplete;
    if (!inc) return;
    void openIntake(run.n, { need, model: inc.model, ms: 0, offline: false, addedByBuyer: inc.missing });
  };

  async function stepCall(busy: Busy, busyKey: string, at: Failure["at"], path: string, body: unknown, after?: (r: Run) => Run): Promise<void> {
    const n = run.n;
    update(n, (r) => ({ ...r, busy, busyKey, failure: undefined }));
    const res = await call<{ step: Step }>("POST", path, body);
    if (res.ok) update(n, (r) => absorb(after ? after(r) : r, res.data.step));
    else
      update(n, (r) => ({
        ...r,
        busy: undefined,
        busyKey: undefined,
        failure: {
          at,
          title: res.status === 409 ? "That step has moved on" : "AimoPilot refused that",
          message: res.error.message,
          retry: res.status === 0 || res.status >= 500 ? () => void stepCall(busy, busyKey, at, path, body, after) : undefined,
        },
      }));
  }

  const respond = (key: string, choice: string) => {
    if (!run.step) return;
    void stepCall("concern", `${key}:${choice}`, "concerns", `/api/v1/intake/${run.step.requestId}/concerns`, { by: kitchen.by, responses: [{ key, choice }] });
  };

  const answer = (questionId: string, optionId: string, label: string, remember: boolean) => {
    if (!run.step) return;
    void stepCall("answer", `${questionId}:${optionId}`, "questions", `/api/v1/intake/${run.step.requestId}/answers`, { by: kitchen.by, answers: [{ questionId, optionId, remember }] }, (r) => ({
      ...r,
      answers: { ...r.answers, [questionId]: { optionId, label, remember } },
    }));
  };

  const choose = (optionId: string) => {
    if (!run.step) return;
    void stepCall("choose", optionId, "options", `/api/v1/intake/${run.step.requestId}/choice`, { by: kitchen.by, optionId });
  };

  const placeOrder = async () => {
    const q = run.step?.quote;
    if (!run.step || !q) return;
    const n = run.n;
    update(n, (r) => ({ ...r, busy: "order", failure: undefined }));
    const res = await call<{ order: Order }>("POST", "/api/v1/orders", {
      requestId: run.step.requestId,
      quoteToken: q.quoteToken,
      lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
    });
    overview.refresh();
    if (res.ok) update(n, (r) => ({ ...r, busy: undefined, order: res.data.order }));
    else if (res.data?.order) update(n, (r) => ({ ...r, busy: undefined, order: res.data!.order, orderRefusal: res.error }));
    else if (res.status === 0 || res.status >= 500)
      update(n, (r) => ({ ...r, busy: undefined, failure: { at: "quote", title: "The order did not reach AimoPilot", message: res.error.message, retry: () => void placeOrder() } }));
    else update(n, (r) => ({ ...r, busy: undefined, orderRefusal: res.error }));
  };

  const newRequest = () => {
    runN.current += 1;
    setRun(fresh(runN.current));
    agent.setDraft("");
    agent.setFollowUp(undefined);
    focusField();
  };

  // ---------- live data ----------

  const requestId = run.step?.requestId;
  const orderId = run.order?.orderId;
  const waiting = run.order?.status === "pending_approval";
  const events = `/api/v1/events?orgId=${encodeURIComponent(kitchen.orgId)}`;

  const orderLive = useLive(
    async () => {
      const r = await call<{ order: Order }>("GET", `/api/v1/orders/${orderId}`);
      if (!r.ok) throw new Error(r.error.message);
      return r.data.order;
    },
    { events, enabled: !!orderId && waiting, pollMs: 1000, pollMsStreaming: 3000 },
  );
  useEffect(() => {
    const o = orderLive.data;
    if (o && o.orderId === orderId && o.status !== "pending_approval") queueMicrotask(() => setRun((r) => (r.order?.orderId === o.orderId ? { ...r, order: o } : r)));
  }, [orderLive.data, orderId]);

  const ledger = useLive(
    async () => {
      const r = await call<LedgerReply>("GET", `/api/v1/ledger?requestId=${requestId}`);
      if (!r.ok) throw new Error(r.error.message);
      return { requestId, ...r.data };
    },
    { events, enabled: !!requestId, pollMs: 2000, pollMsStreaming: 4000 },
  );
  const entries = ledger.data && ledger.data.requestId === requestId ? ledger.data.entries : [];
  const refreshLedger = ledger.refresh;
  useEffect(() => {
    if (requestId) refreshLedger();
  }, [requestId, run.step, run.order?.status, refreshLedger]);

  const memory = { data: overview.data?.memory, error: overview.error };
  const refreshOverview = overview.refresh;
  useEffect(() => {
    if (run.order?.status) refreshOverview();
  }, [run.order?.status, refreshOverview]);

  // Product names for sentences the API wrote with product codes.
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const o of run.options) for (const l of o.lines) out[l.productId] = l.name;
    for (const l of run.step?.quote?.quote.lines ?? []) out[l.productId] = l.name;
    for (const f of memory.data?.families ?? []) for (const l of f.lastOrder.lines) out[l.productId] = l.name;
    return out;
  }, [run.options, run.step?.quote, memory.data]);

  const s = run.step;
  const state = s?.state;

  // ---------- what memory answered for this request (one line per remembered item applied) ----------

  const [remembered, setRemembered] = useState<{ requestId: string; lines: { text: string }[] }>();
  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    void api<{ requestId: string; lines: { itemId?: string; text: string }[] }>("GET", `/ui-api/memory/kitchens/${encodeURIComponent(slug)}/requests/${encodeURIComponent(requestId)}`).then((r) => {
      if (alive && r.ok && Array.isArray(r.data.lines)) setRemembered({ requestId, lines: r.data.lines });
    });
    return () => {
      alive = false;
    };
  }, [slug, requestId, state]);
  const memoryLines = remembered?.requestId === requestId ? (remembered?.lines ?? []) : [];

  // ---------- the run survives a reload (this browser tab only) ----------

  useEffect(() => {
    queueMicrotask(() => {
      if (runN.current !== 0) return;
      const saved = readSession<Run>(`dock-run:${slug}`);
      if (!saved?.text) return;
      runN.current = saved.n;
      setRun({ ...saved, busy: undefined, busyKey: undefined, failure: undefined });
    });
  }, [slug]);
  useEffect(() => {
    if (run.busy) return;
    try {
      if (run.text) sessionStorage.setItem(`dock-run:${slug}`, JSON.stringify({ ...run, failure: undefined }));
      else sessionStorage.removeItem(`dock-run:${slug}`);
    } catch {
      // private window: the run lives as long as the page
    }
  }, [run, slug]);

  // ---------- stages ----------

  const decided = !!run.order || !!run.orderRefusal;
  const stages: LaneStage[] = [];
  const need = s?.need ?? run.interp?.need;

  if (run.text) {
    stages.push({
      key: "understood",
      station: "Request",
      title: "What the agent understood",
      tone: run.busy === "interpret" || run.busy === "open" ? "busy" : run.incomplete ? "active" : "done",
      summary: need ? [need.quantity ? measure(need.quantity.amount, need.quantity.unit) : need.sameAsLastTime ? "same as last time" : "", need.item.text, need.deliverBy ? `by ${day(need.deliverBy)}` : ""].filter(Boolean).join(" ") : `“${run.text}”`,
      body: (
        <>
          <Understood
            text={run.text}
            interp={run.interp}
            step={s}
            incomplete={run.incomplete}
            onComplete={complete}
            busy={run.busy === "interpret" ? "Reading the request…" : run.busy === "open" ? "Checking it against the kitchen's memory…" : undefined}
          />
          {run.failure?.at === "understood" && (
            <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} extra={run.failure.offline && { label: "Use the offline example reader", onClick: run.failure.offline }} />
          )}
        </>
      ),
    });
  }
  if (s) {
    const open = state === "needs_confirmation";
    const settled = run.concernsSeen.length;
    stages.push({
      key: "concerns",
      station: "Lookup",
      title: "Mistake check",
      tone: run.busy === "concern" ? "busy" : open ? "active" : "done",
      summary: settled === 0 ? `Nothing unusual${memoryLines.length ? `; ${memoryLines.length} thing${memoryLines.length === 1 ? "" : "s"} from memory` : ""}` : open ? `${settled} to settle` : `${settled} settled`,
      body: (
        <>
          <Concerns step={s} seen={run.concernsSeen} onRespond={respond} busyKey={run.busy === "concern" ? run.busyKey : undefined} names={names} remembered={memoryLines} />
          {run.failure?.at === "concerns" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && state !== "needs_confirmation" && state !== "cancelled" && (run.asked.length > 0 || ((run.fromMemory.length > 0 || s.rules.some((r) => r.source === "stated")) && memoryLines.length === 0))) {
    const given = Object.values(run.answers).map((x) => x.label);
    stages.push({
      key: "questions",
      station: "Lookup",
      title: run.asked.length ? `${["One question", "Two questions", "Three questions", "Four questions"][run.asked.length - 1] ?? `${run.asked.length} questions`}` : "Answered from memory",
      tone: state === "needs_input" ? (run.busy === "answer" ? "busy" : "active") : "done",
      summary: given.length ? `Answered: ${given.join(", ")}` : "The kitchen's memory answered",
      body: (
        <>
          <Questions step={s} asked={run.asked} answers={run.answers} fromMemory={run.fromMemory} onAnswer={answer} busyKey={run.busy === "answer" ? run.busyKey : undefined} hideMemory={memoryLines.length > 0} />
          {run.failure?.at === "questions" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && (state === "options_ready" || state === "quoted") && run.options.length > 0) {
    const picked = run.options.find((o) => o.optionId === s.chosen?.optionId);
    const cheapest = Math.min(...run.options.map((o) => o.totalCents));
    stages.push({
      key: "options",
      station: "Options",
      title: run.options.length === 1 ? "The option" : `${run.options.length} options, good to best`,
      tone: state === "options_ready" ? (run.busy === "choose" ? "busy" : "active") : "done",
      summary: picked ? `${picked.rank ? `${picked.rank.charAt(0).toUpperCase()}${picked.rank.slice(1)} chosen` : "Chosen"}: ${picked.lines.map((l) => `${l.packs} × ${shortProduct(l.name)}`).join(" + ")}` : `from ${money(cheapest)}`,
      body: (
        <>
          <Options step={s} options={run.options} onChoose={choose} onNarrow={(q, o, label) => answer(q, o, label, false)} busyKey={run.busy === "choose" || run.busy === "answer" ? run.busyKey : undefined} names={names} />
          {run.failure?.at === "options" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && (state === "no_options" || state === "cancelled")) {
    stages.push({ key: "none", station: "Options", title: state === "cancelled" ? "Cancelled" : "Nothing fits", tone: "done", body: <NoOptions step={s} names={names} onNew={newRequest} /> });
  }
  if (s?.quote) {
    stages.push({
      key: "quote",
      station: "Price",
      title: "Fixed price",
      tone: decided ? "done" : run.busy === "order" ? "busy" : "active",
      summary: `${money(s.quote.quote.totalCents)}, held until ${clock(s.quote.quote.expiresAt)}`,
      body: (
        <>
          <Quote q={s.quote} names={names} decided={decided} busy={run.busy === "order"} onPlace={() => void placeOrder()} onNew={newRequest} />
          {run.failure?.at === "quote" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  const o = run.order;
  const a = o?.approval;
  if (decided) {
    const stopped = !o || o.status === "rejected" || a?.status === "pending";
    stages.push({
      key: "gate",
      station: "Gate",
      title: "The gate",
      tone: stopped ? "safety" : "done",
      summary: !o || o.status === "rejected" ? "Refused, nothing ordered" : a ? `Stopped: ${a.approver.name} had to sign off` : `Passed all ${o.decision.rules.length} checks`,
      body: <Gate order={o} refusal={run.orderRefusal} kitchen={kitchen} names={names} streaming={orderLive.streaming} withSignOff={false} />,
    });
  }
  if (o && a) {
    stages.push({
      key: "signoff",
      station: "Sign-off",
      title: "Sign-off",
      tone: a.status === "pending" ? "safety" : "done",
      keepOpen: true,
      summary: a.status === "pending" ? `Waiting for ${a.approver.name}` : `${a.status === "approved" ? "Signed off" : "Declined"} by ${a.approver.name} at ${clock(a.decidedAt ?? o.updatedAt)}`,
      body: <SignOff order={o} kitchen={kitchen} streaming={orderLive.streaming} />,
    });
  }
  if (o && (o.status === "committed" || o.status === "declined")) {
    stages.push({
      key: "order",
      station: "Order",
      title: o.status === "committed" ? "Signed order" : "Not ordered",
      tone: "done",
      summary: o.status === "committed" ? `${money(o.totalCents)}, delivery ${day(o.lines.map((l) => l.deliveryDate).sort().at(-1)!)}` : "Declined",
      body: <SignedOrder order={o} names={names} onNew={newRequest} />,
    });
  }
  if (decided && entries.length > 0) {
    stages.push({
      key: "timeline",
      station: "Order",
      extra: true,
      title: "What the agent did and why",
      tone: "done",
      summary: `${entries.length} entries in the ledger`,
      aside: <span className="hidden text-[0.92rem] text-ink-soft sm:inline">{entries.length} ledger entries</span>,
      body: <Timeline entries={entries} names={names} agentName={kitchen.agentName} kitchen={slug} />,
    });
  }

  // The strip: where the request is, readable from across a table.
  const journey = stages.filter((x) => !x.extra);
  const here = journey.at(-1);
  const hereIdx = here ? STATIONS.indexOf(here.station) : -1;
  const strip = Object.fromEntries(
    STATIONS.map((st, i) => {
      let v: StationState = i < hereIdx ? "done" : i === hereIdx ? "current" : "pending";
      if (st === "Sign-off" && decided && o && !a && o.status === "committed") v = "skipped";
      if (st === "Gate" && decided && (!o || o.status === "rejected" || a?.status === "pending")) v = "stopped";
      if (st === "Sign-off" && a?.status === "pending") v = "stopped";
      if (i === hereIdx && here?.tone === "active" && v === "current") v = "current";
      return [st, v];
    }),
  ) as Record<Station, StationState>;

  useFollowLane(stages.length, stages.at(-1)?.key);

  return (
    <div className="grid gap-x-8 2xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">Order</h1>
            <p className="max-w-[60ch] text-[1.02rem] text-ink-soft">Tell {kitchen.agentName} what the kitchen needs. Each request travels the lane below; the gate checks it against the kitchen&apos;s signed rules.</p>
          </div>
          {run.text && (
            <Button kind="secondary" onClick={newRequest}>
              New request
            </Button>
          )}
        </div>
        <div className="sticky top-0 z-20 -mx-4 mt-4 border-b border-line bg-mist/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
          <StationStrip states={strip} label={here ? `The request is at: ${here.station}` : undefined} />
        </div>
        <Examples examples={kitchen.examples} hasRun={!!run.text} onPick={(x) => void submit(x)} onWrite={focusField} />
        <div className="mt-6" aria-live="polite">
          {stages.length === 0 ? <EmptyLane kitchen={kitchen} /> : <Lane stages={stages} runKey={run.n} />}
        </div>
      </div>
      <aside aria-label="This kitchen" className="mt-8 grid content-start gap-4 md:grid-cols-2 2xl:mt-5 2xl:grid-cols-1">
        <History
          requests={requests}
          loading={!overview.data && !overview.error}
          error={overview.error}
          onRepeat={repeat}
          onChange={(r) => {
            agent.setFollowUp(r);
            agent.setProduct(undefined);
            focusField();
          }}
        />
        <LiveCalls entries={entries} active={!!requestId} />
        <MandateBox k={kitchen} />
        <Memory memory={memory.data} error={memory.error} family={s?.family} />
      </aside>
    </div>
  );
}

/** Put what memory answered on the card, and a product picked in the catalogue into the need. Plain code. */
function withContext(interp: Interpretation, ctx: ReadContext): Interpretation {
  let out = interp;
  if (ctx.product) {
    const p = ctx.product;
    out = { ...out, need: { ...out.need, item: { ...out.need.item, productId: p.id, category: p.category } }, memoryLine: `Product picked in the catalogue: ${shortProduct(p.name)}. Only that product is offered.` };
  }
  const based = interp.basedOn && ctx.requests.find((r) => r.key === interp.basedOn!.requestId);
  if (based) out = { ...out, memoryLine: [memoryLineFor(based, interp.basedOn!.fields), out.memoryLine].filter(Boolean).join(" ") };
  else if (ctx.followUp) out = { ...out, memoryLine: [`Read as a change to ${describeEarlier(ctx.followUp)}.`, out.memoryLine].filter(Boolean).join(" ") };
  return out;
}

function mergeConcerns(seen: Step["concerns"], now: Step["concerns"]): Step["concerns"] {
  const out = [...seen];
  for (const c of now) if (!out.some((x) => x.key === c.key)) out.push(c);
  return out;
}

// ---------- examples ----------

function Examples({ examples, hasRun, onPick, onWrite }: { examples: string[]; hasRun: boolean; onPick: (x: string) => void; onWrite: () => void }) {
  if (hasRun) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button kind="go" onClick={onWrite}>
        Write a request
      </Button>
      <span className="px-1 text-[0.95rem] text-ink-soft">or try</span>
      {examples.map((x) => (
        <button key={x} type="button" onClick={() => onPick(x)} className="min-h-11 bg-paper px-3 text-left text-[0.95rem] outline-1 outline-line hover:outline-2 hover:outline-petrol">
          {x.length > 60 ? `${x.slice(0, 57)}…` : x}
        </button>
      ))}
    </div>
  );
}

function EmptyLane({ kitchen }: { kitchen: KitchenInfo }) {
  const steps: [string, string][] = [
    ["Request", "Your words, turned into fields: item, amount, day."],
    ["Lookup", "Compared with what this kitchen usually orders, before any price is asked. Memory answers what it can."],
    ["Options", "Good, better, best, with pros and cons, side by side."],
    ["Price", "The wholesaler signs the price. It holds for 30 minutes."],
    ["Gate", `Plain code checks the order against the mandate. Above ${moneyShort(kitchen.mandate.perOrderLimitCents)}, it stops.`],
    ["Sign-off", `${kitchen.mandate.approvers[0]?.name ?? "A named person"} signs off on their phone.`],
    ["Order", "Signed by the wholesaler, and in the ledger."],
  ];
  return (
    <ol className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, d], i) => (
        <li key={t} className={`p-4 ${t === "Gate" ? "bg-safety-ink text-paper" : "bg-paper"}`}>
          <p className="flex items-center gap-2">
            {t === "Gate" ? (
              <Target size={26} tone="safety" />
            ) : (
              <span className="display flex size-7 items-center justify-center border-2 border-petrol text-[1rem] text-petrol tabular">{i + 1}</span>
            )}
            <span className={`display text-[1.5rem] ${t === "Gate" ? "text-safety" : "text-ink"}`}>{t}</span>
          </p>
          <p className={`mt-1.5 text-[0.98rem] leading-snug ${t === "Gate" ? "text-paper/85" : "text-ink-soft"}`}>{d}</p>
        </li>
      ))}
      <li className="hidden bg-mist p-4 lg:block" />
    </ol>
  );
}

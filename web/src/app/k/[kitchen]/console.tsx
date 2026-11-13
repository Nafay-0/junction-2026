"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiError } from "../../_client/api";
import { InterpretError, interpretNeed, type Interpretation } from "../../_client/interpret";
import { useLive } from "../../_client/use-live";
import { Wordmark } from "../../_ui/target";
import { eurShort } from "../../_ui/plain";
import { LiveCalls, MandateBox, Memory } from "./rail";
import { Concerns, Gate, NoOptions, Options, Questions, Quote, SignedOrder, Understood } from "./stages";
import { Timeline } from "./timeline";
import { Button, ErrorPlate, Stage, type StageTone } from "./ui";
import type { KitchenChoice, KitchenInfo, KitchenMemory, LedgerReply, Order, Step } from "./types";

type Busy = "interpret" | "open" | "concern" | "answer" | "choose" | "order";
type Failure = { at: "understood" | "concerns" | "questions" | "options" | "quote"; title: string; message: string; retry?: () => void };

export type Run = {
  n: number;
  text: string;
  interp?: Interpretation;
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

export function Console({ kitchen, kitchens }: { kitchen: KitchenInfo; kitchens: KitchenChoice[] }) {
  const slug = kitchen.slug;
  const [run, setRun] = useState<Run>(() => fresh(0));
  const [draft, setDraft] = useState("");
  const runN = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const call = useCallback(
    <T,>(method: "GET" | "POST", path: string, body?: unknown) => api<T>("POST", `/ui-api/kitchens/${encodeURIComponent(slug)}/call`, { method, path, body }),
    [slug],
  );

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

  const submit = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) {
        inputRef.current?.focus();
        return;
      }
      const n = ++runN.current;
      setRun({ ...fresh(n), text: clean, busy: "interpret" });
      let interp: Interpretation;
      try {
        interp = await interpretNeed(slug, clean);
      } catch (err) {
        const message = err instanceof InterpretError ? err.message : "The request could not be read.";
        update(n, (r) => ({ ...r, busy: undefined, failure: { at: "understood", title: "Dock could not read that", message } }));
        return;
      }
      update(n, (r) => ({ ...r, interp, busy: "open" }));
      const open = async () => {
        update(n, (r) => ({ ...r, busy: "open", failure: undefined }));
        const res = await call<{ step: Step }>("POST", "/api/v1/intake", { need: interp.need, by: kitchen.by });
        if (res.ok) update(n, (r) => absorb(r, res.data.step));
        else update(n, (r) => ({ ...r, busy: undefined, failure: { at: "understood", title: "Dock did not take the request", message: res.error.message, retry: res.status === 0 || res.status >= 500 ? () => void open() : undefined } }));
      };
      await open();
    },
    [slug, call, kitchen.by, update, absorb],
  );

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
          title: res.status === 409 ? "That step has moved on" : "Dock refused that",
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
    if (res.ok) update(n, (r) => ({ ...r, busy: undefined, order: res.data.order }));
    else if (res.data?.order) update(n, (r) => ({ ...r, busy: undefined, order: res.data!.order, orderRefusal: res.error }));
    else if (res.status === 0 || res.status >= 500)
      update(n, (r) => ({ ...r, busy: undefined, failure: { at: "quote", title: "The order did not reach Dock", message: res.error.message, retry: () => void placeOrder() } }));
    else update(n, (r) => ({ ...r, busy: undefined, orderRefusal: res.error }));
  };

  const newRequest = () => {
    runN.current += 1;
    setRun(fresh(runN.current));
    setDraft("");
    inputRef.current?.focus();
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

  const memory = useLive(
    async () => {
      const r = await call<{ kitchen: KitchenMemory }>("GET", "/api/v1/kitchen");
      if (!r.ok) throw new Error(r.error.message);
      return r.data.kitchen;
    },
    { pollMs: 20_000, pollMsStreaming: 20_000 },
  );
  const refreshMemory = memory.refresh;
  useEffect(() => {
    if (run.order?.status === "committed") refreshMemory();
  }, [run.order?.status, refreshMemory]);

  // Product names for sentences the API wrote with product codes.
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const o of run.options) for (const l of o.lines) out[l.productId] = l.name;
    for (const l of run.step?.quote?.quote.lines ?? []) out[l.productId] = l.name;
    for (const f of memory.data?.families ?? []) for (const l of f.lastOrder.lines) out[l.productId] = l.name;
    return out;
  }, [run.options, run.step?.quote, memory.data]);

  // ---------- stages ----------

  const s = run.step;
  const state = s?.state;
  const decided = !!run.order || !!run.orderRefusal;
  const stages: { key: string; title: string; tone: StageTone; body: React.ReactNode; aside?: React.ReactNode }[] = [];

  if (run.text) {
    stages.push({
      key: "understood",
      title: "What Dock understood",
      tone: run.busy === "interpret" || run.busy === "open" ? "busy" : "done",
      body: (
        <>
          <Understood text={run.text} interp={run.interp} step={s} busy={run.busy === "interpret" ? "Reading the request…" : run.busy === "open" ? "Checking it against the kitchen's memory…" : undefined} />
          {run.failure?.at === "understood" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s) {
    const open = state === "needs_confirmation";
    stages.push({
      key: "concerns",
      title: "Mistake check",
      tone: open ? "active" : run.busy === "concern" ? "busy" : "done",
      body: (
        <>
          <Concerns step={s} seen={run.concernsSeen} onRespond={respond} busyKey={run.busy === "concern" ? run.busyKey : undefined} names={names} />
          {run.failure?.at === "concerns" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && state !== "needs_confirmation" && state !== "cancelled" && (run.asked.length > 0 || run.fromMemory.length > 0 || s.rules.some((r) => r.source === "stated"))) {
    stages.push({
      key: "questions",
      title: run.asked.length > 1 ? "Two questions" : run.asked.length === 1 ? "One question" : "Questions",
      tone: state === "needs_input" ? (run.busy === "answer" ? "busy" : "active") : "done",
      body: (
        <>
          <Questions step={s} asked={run.asked} answers={run.answers} fromMemory={run.fromMemory} onAnswer={answer} busyKey={run.busy === "answer" ? run.busyKey : undefined} />
          {run.failure?.at === "questions" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && (state === "options_ready" || state === "quoted") && run.options.length > 0) {
    stages.push({
      key: "options",
      title: run.options.length === 1 ? "The option" : `${run.options.length} options`,
      tone: state === "options_ready" ? (run.busy === "choose" ? "busy" : "active") : "done",
      body: (
        <>
          <Options step={s} options={run.options} onChoose={choose} busyKey={run.busy === "choose" ? run.busyKey : undefined} names={names} />
          {run.failure?.at === "options" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (s && (state === "no_options" || state === "cancelled")) {
    stages.push({ key: "none", title: state === "cancelled" ? "Cancelled" : "Nothing fits", tone: "done", body: <NoOptions step={s} names={names} onNew={newRequest} /> });
  }
  if (s?.quote) {
    stages.push({
      key: "quote",
      title: "Fixed price",
      tone: decided ? "done" : run.busy === "order" ? "busy" : "active",
      body: (
        <>
          <Quote step={s} names={names} decided={decided} busy={run.busy === "order"} onPlace={() => void placeOrder()} onNew={newRequest} />
          {run.failure?.at === "quote" && <ErrorPlate title={run.failure.title} message={run.failure.message} onRetry={run.failure.retry} />}
        </>
      ),
    });
  }
  if (decided) {
    const o = run.order;
    const safety = !o || o.status !== "committed" || !!o.approval;
    stages.push({
      key: "gate",
      title: "The gate",
      tone: safety ? "safety" : "done",
      body: <Gate order={o} refusal={run.orderRefusal} kitchen={kitchen} names={names} streaming={orderLive.streaming} />,
    });
  }
  if (run.order && (run.order.status === "committed" || run.order.status === "declined")) {
    stages.push({ key: "order", title: run.order.status === "committed" ? "Signed order" : "Not ordered", tone: "done", body: <SignedOrder order={run.order} names={names} onNew={newRequest} /> });
  }
  if (decided && entries.length > 0) {
    stages.push({
      key: "timeline",
      title: "What the agent did and why",
      tone: "done",
      aside: <span className="text-[0.95rem] text-ink-soft">{entries.length} ledger entries for this request</span>,
      body: <Timeline entries={entries} names={names} agentName={kitchen.agentName} kitchen={slug} />,
    });
  }

  // Bring a new stage into view, without moving anything above it.
  const count = stages.length;
  const lastKey = stages.at(-1)?.key;
  const prevCount = useRef(0);
  useEffect(() => {
    if (count > prevCount.current && count > 1 && lastKey) {
      const el = document.getElementById(`st-${lastKey}`);
      if (el && el.getBoundingClientRect().top > window.innerHeight - 160) {
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    }
    prevCount.current = count;
  }, [count, lastKey]);

  return (
    <div className="min-h-dvh bg-concrete text-ink">
      <Header kitchen={kitchen} kitchens={kitchens} />
      <main className="mx-auto grid max-w-[1440px] gap-x-8 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:px-10">
        <div className="min-w-0">
          <RequestField
            inputRef={inputRef}
            draft={draft}
            setDraft={setDraft}
            busy={run.busy === "interpret" || run.busy === "open"}
            examples={kitchen.examples}
            onSubmit={(t) => void submit(t)}
            hasRun={!!run.text}
            onNew={newRequest}
          />
          <div className="mt-8" aria-live="polite">
            {stages.length === 0 ? (
              <EmptyLane kitchen={kitchen} />
            ) : (
              stages.map((st, i) => (
                <Stage key={`${run.n}-${st.key}`} id={`st-${st.key}`} n={i + 1} title={st.title} tone={st.tone} aside={st.aside}>
                  {st.body}
                </Stage>
              ))
            )}
          </div>
        </div>
        <aside aria-label="This kitchen" className="space-y-3 lg:sticky lg:top-4 lg:mt-6 lg:self-start">
          <LiveCalls entries={entries} active={!!requestId} />
          <Memory memory={memory.data} error={memory.error} />
          <MandateBox k={kitchen} />
        </aside>
      </main>
    </div>
  );
}

function mergeConcerns(seen: Step["concerns"], now: Step["concerns"]): Step["concerns"] {
  const out = [...seen];
  for (const c of now) if (!out.some((x) => x.key === c.key)) out.push(c);
  return out;
}

// ---------- header and request field ----------

function Header({ kitchen, kitchens }: { kitchen: KitchenInfo; kitchens: KitchenChoice[] }) {
  const router = useRouter();
  return (
    <header className="border-b-[3px] border-ink bg-paper">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 xl:px-10">
        <Link href="/" className="shrink-0" aria-label="Dock: back to the wall">
          <Wordmark size={30} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] font-medium text-ink-soft">Buyer console for</p>
          <h1 className="truncate font-display text-2xl font-bold leading-tight sm:text-[1.9rem]">{kitchen.name}</h1>
        </div>
        <label className="flex items-center gap-2 text-[0.95rem]">
          <span className="text-ink-soft">Kitchen</span>
          <select
            className="min-h-11 max-w-[15rem] border-2 border-ink bg-paper px-2 font-semibold"
            value={kitchen.slug}
            onChange={(e) => router.push(`/k/${e.target.value}`)}
          >
            {kitchens.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.name}
                {k.kind === "visitor" ? ` (${k.approverName})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kitchen.kind === "visitor" && kitchen.expiresAt && (
        <p className="border-t border-ink/15 bg-concrete px-4 py-1.5 text-center text-[0.9rem] sm:px-6">
          A visitor&apos;s demo kitchen. Its agent may spend {eurShort(kitchen.mandate.perOrderLimitCents)} alone; above that, {kitchen.mandate.approvers[0]?.name} signs off on their phone.
        </p>
      )}
    </header>
  );
}

function RequestField(props: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  busy: boolean;
  examples: string[];
  onSubmit: (text: string) => void;
  hasRun: boolean;
  onNew: () => void;
}) {
  const { inputRef, draft, setDraft, busy, examples, onSubmit, hasRun, onNew } = props;
  return (
    <section aria-labelledby="ask" className="pt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(draft);
        }}
      >
        <label id="ask" htmlFor="need" className="font-display text-[1.35rem] font-bold">
          What does the kitchen need?
        </label>
        <div className="mt-2 flex flex-col border-[3px] border-ink bg-paper sm:flex-row">
          <input
            id="need"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="For example: 100 litres of lactose-free milk for Thursday"
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-16 min-w-0 flex-1 bg-transparent px-4 font-display text-[1.45rem] font-semibold placeholder:font-medium placeholder:text-ink-soft/80 focus:outline-none sm:text-[1.7rem]"
          />
          <Button type="submit" kind="primary" busy={busy} className="min-h-14 px-6 text-[1.1rem] sm:min-h-16">
            {busy ? "Working" : "Send to Dock"}
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="text-[0.95rem] text-ink-soft">Try</span>
        {examples.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => {
              setDraft(x);
              onSubmit(x);
            }}
            className="min-h-9 border border-ink/40 bg-paper px-2.5 text-left text-[0.95rem] hover:border-ink"
          >
            {x.length > 60 ? `${x.slice(0, 57)}…` : x}
          </button>
        ))}
        {hasRun && (
          <Button kind="quiet" onClick={onNew} className="ml-auto">
            New request
          </Button>
        )}
      </div>
    </section>
  );
}

function EmptyLane({ kitchen }: { kitchen: KitchenInfo }) {
  const steps = [
    ["What Dock understood", "Your words, turned into fields: item, amount, day."],
    ["Mistake check", "Compared with what this kitchen usually orders, before any price is asked."],
    ["Questions", "At most two, as choices. Anything the kitchen already told Dock is not asked again."],
    ["Options", "Best price, lowest CO2, most reliable, or same as last time, with pros and cons."],
    ["Fixed price", "The wholesaler signs the price. It holds for 30 minutes."],
    ["The gate", `Plain code checks the order against the mandate. Above ${eurShort(kitchen.mandate.perOrderLimitCents)}, a named person signs off.`],
  ];
  return (
    <ol className="grid gap-px bg-ink/15 sm:grid-cols-2 xl:grid-cols-3">
      {steps.map(([t, d], i) => (
        <li key={t} className="bg-concrete p-4">
          <p className="font-display text-xl font-bold">
            <span className="mr-2 text-ink-soft tabular">{i + 1}</span>
            {t}
          </p>
          <p className="mt-1 text-[0.98rem] leading-snug text-ink-soft">{d}</p>
        </li>
      ))}
    </ol>
  );
}

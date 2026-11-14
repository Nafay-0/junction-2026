"use client";

import { useLang } from "../_i18n/provider";
import { useCallback, useEffect, useState } from "react";
import type { MenuKitchenInfo } from "@/server/agent/menu/kitchens";
import type { PlanEdit } from "@/server/agent/menu/service";
import type { PlanWire } from "@/server/agent/menu/wire";
import { api, type ApiError } from "../_client/api";
import { GateStage, Totals } from "./gate";
import { Lines, NeedsYou, PlanHeader } from "./sheet";
import { Btn, Spinner } from "./ui";
import { Empty, ErrorPlate, Skeleton, Tag, Textarea } from "../_ui/kit";
import { useText } from "../_i18n/provider";
import { MENU_PLANNER_TEXT } from "./menu-planner.text";
import { exampleL } from "../_i18n/kitchen-words";

/**
 * Menu to order, as one self-contained component: the chef types a dish or a menu and a number of covers, and gets
 * one checked, fixed-price order that needs at most one sign-off. Mount it anywhere:
 *
 *   <MenuPlanner kitchen="kaari" />                      the kitchen slug the /ui-api/plan routes know
 *   <MenuPlanner kitchen="laakso" base="/ui-api/plan" initialText="..." onOrdered={(orderId) => ...} />
 *
 * It talks only to /ui-api/plan/** (the server holds the kitchen's menu mandate), and never to a model directly.
 */
export type MenuPlannerProps = {
  kitchen: string;
  base?: string;
  initialText?: string;
  onOrdered?: (orderId: string) => void;
  /** A list of plain items (the photo door's reviewed lines): planned at once, as written, with no model. */
  items?: { list: { item: string; amount: number; unit: string }[]; deliverBy?: string; source?: "image" | "pdf" | "text" };
};

/** When each progress line shows, in seconds; the words are in menu-planner.text.ts, in the same order. */
const STEPS = [0, 5, 12, 17];

export function MenuPlanner({ kitchen, base = "/ui-api/plan", initialText = "", onOrdered, items }: MenuPlannerProps) {
  const [info, setInfo] = useState<{ kitchen: MenuKitchenInfo; mode: "model" | "recorded" }>();
  const [text, setText] = useState(initialText);
  const [plan, setPlan] = useState<PlanWire>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [started, setStarted] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const tx = useText(MENU_PLANNER_TEXT);
  const { lang } = useLang();
  const k = encodeURIComponent(kitchen);

  useEffect(() => {
    void api<{ kitchen: MenuKitchenInfo; mode: "model" | "recorded" }>("GET", `${base}/${k}`).then((r) => {
      if (r.ok) setInfo(r.data);
      else setError(r.error);
    });
  }, [base, k]);

  useEffect(() => {
    if (!started) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [started]);

  const accept = useCallback(
    (r: Awaited<ReturnType<typeof api<PlanWire>>>) => {
      if (r.ok) {
        setPlan(r.data);
        setError(undefined);
        if (r.data.order?.orderId && r.data.order.status === "committed") onOrdered?.(r.data.order.orderId);
      } else setError(r.error);
    },
    [onOrdered],
  );

  const refresh = useCallback(async () => {
    if (!plan) return;
    accept(await api<PlanWire>("GET", `${base}/${k}/${plan.planId}`));
  }, [plan, base, k, accept]);

  // Proposals for stuck lines come a few seconds after the plan: fetch them when they are in.
  const pendingId = plan?.pending ? plan.planId : undefined;
  useEffect(() => {
    if (!pendingId) return;
    const t = setInterval(() => {
      void api<PlanWire>("GET", `${base}/${k}/${pendingId}`).then(accept);
    }, 1500);
    return () => clearInterval(t);
  }, [pendingId, base, k, accept]);

  // A plan the store's agent made in the thread (?plan=<planId>): opened here to edit its lines one by one.
  useEffect(() => {
    const id = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("plan");
    if (!id || !/^plan_[a-z0-9]+$/i.test(id)) return;
    let gone = false;
    void api<PlanWire>("GET", `${base}/${k}/${id}`).then((r) => !gone && accept(r));
    return () => {
      gone = true;
    };
  }, [base, k, accept]);

  // A list from the photo door: one plan, one quote, one order.
  const listed = items ? JSON.stringify(items) : undefined;
  useEffect(() => {
    if (!listed) return;
    let gone = false;
    queueMicrotask(() => !gone && setBusy("plan"));
    const x = JSON.parse(listed) as NonNullable<MenuPlannerProps["items"]>;
    void api<PlanWire>("POST", `${base}/${k}/list`, { items: x.list, deliverBy: x.deliverBy, source: x.source }).then((r) => {
      if (gone) return;
      accept(r);
      setBusy(undefined);
    });
    return () => {
      gone = true;
    };
  }, [listed, base, k, accept]);

  async function submit() {
    if (text.trim().length < 3) return;
    setBusy("plan");
    setPlan(undefined);
    setStarted(Date.now());
    setNow(Date.now());
    accept(await api<PlanWire>("POST", `${base}/${k}`, { text: text.trim() }));
    setBusy(undefined);
    setStarted(undefined);
  }

  async function edit(edits: PlanEdit[]) {
    if (!plan) return;
    setBusy("edit");
    accept(await api<PlanWire>("POST", `${base}/${k}/${plan.planId}`, { edits }));
    setBusy(undefined);
  }

  async function step(what: "quote" | "order") {
    if (!plan) return;
    setBusy(what);
    accept(await api<PlanWire>("POST", `${base}/${k}/${plan.planId}/${what}`));
    setBusy(undefined);
  }

  const seconds = started ? (now - started) / 1000 : 0;
  const stepAt = STEPS.findLastIndex((at) => seconds >= at);
  const stepText = tx.steps[stepAt < 0 ? 0 : stepAt];

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-paper shadow-sm">
        <form
          className="p-5 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="menu-request" className="display block text-[1.5rem] sm:text-[1.7rem]">
            {tx.question}
          </label>
          <p className="mt-1 max-w-[62ch] text-[0.95rem] text-ink-soft">{tx.hint}</p>
          <Textarea
            id="menu-request"
            className="mt-4 [&_textarea]:min-h-28 [&_textarea]:text-[1.08rem]"
            value={text}
            onChange={setText}
            rows={3}
            maxLength={4000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            placeholder={tx.placeholder}
          />
          <div className="mt-4 flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-2 max-sm:-mx-5 max-sm:overflow-x-auto max-sm:px-5 max-sm:pb-1 sm:flex-wrap">
              {info?.kitchen.examples.map((ex) => (
                // Shown in the buyer's language; without a model the recorded drafts answer only the original words.
                <button
                  key={ex}
                  type="button"
                  onClick={() => setText(info.mode === "recorded" ? ex : exampleL(ex, lang))}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-line bg-mist px-4 py-1.5 text-left max-sm:whitespace-nowrap sm:max-w-full sm:shrink text-[0.9rem] leading-snug text-ink transition-colors duration-150 hover:border-line-strong hover:bg-surface pointer-coarse:min-h-11"
                >
                  “{exampleL(ex, lang)}”
                </button>
              ))}
              {!info && !error && (
                <>
                  <Skeleton className="h-10 w-56 !rounded-full" />
                  <Skeleton className="h-10 w-72 !rounded-full" />
                </>
              )}
            </div>
            <Btn type="submit" kind="go" size="lg" busy={busy === "plan"} disabled={text.trim().length < 3} className="w-full shrink-0 sm:w-auto">
              {tx.planIt}
            </Btn>
          </div>
          {info?.mode === "recorded" && (
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.88rem] leading-snug text-ink-soft">
              <Tag tone="muted">{tx.noModel}</Tag>
              {tx.recorded}
            </p>
          )}
          {busy === "plan" && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-lavender px-4 py-3" role="status">
              <Spinner label={stepText} />
              <span className="text-[0.9rem] text-lavender-deep tabular">{tx.seconds(seconds)}</span>
            </div>
          )}
        </form>
      </section>

      {error && <ErrorPlate title={error.code === "model_unavailable" ? tx.errModel : error.code === "plan_not_ready" ? tx.errNotReady : tx.errOther} message={error.message} />}

      {busy === "plan" && !plan && (
        <div className="space-y-5" aria-hidden>
          <Skeleton className="h-40 !rounded-[20px]" />
          <Skeleton className="h-72 !rounded-[20px]" />
        </div>
      )}

      {plan?.state === "declined" && (
        <Empty title={tx.declined}>
          <p>{plan.declineReason}</p>
          <p className="mt-1">{tx.nothingDone}</p>
        </Empty>
      )}

      {plan && plan.state !== "declined" && (
        <>
          <PlanHeader key={`${plan.planId}-${plan.settings.covers}-${plan.settings.deliverBy}`} plan={plan} onEdit={edit} busy={busy === "edit"} />
          <NeedsYou plan={plan} onEdit={edit} busy={busy === "edit"} />
          <Lines plan={plan} onEdit={edit} busy={busy === "edit"} />
          <Totals plan={plan} onQuote={() => void step("quote")} busy={busy === "quote"} />
          <GateStage plan={plan} kitchen={kitchen} onOrder={() => void step("order")} onRefresh={() => void refresh()} busy={busy === "order"} base={base} />
        </>
      )}
    </div>
  );
}

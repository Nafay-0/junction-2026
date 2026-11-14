"use client";

import { useCallback, useEffect, useState } from "react";
import type { MenuKitchenInfo } from "@/server/agent/menu/kitchens";
import type { PlanEdit } from "@/server/agent/menu/service";
import type { PlanWire } from "@/server/agent/menu/wire";
import { api, type ApiError } from "../_client/api";
import { GateStage, Totals } from "./gate";
import { Lines, NeedsYou, PlanHeader } from "./sheet";
import { Btn, Sheet, Spinner } from "./ui";
import { useText } from "../_i18n/provider";
import { MENU_PLANNER_TEXT } from "./menu-planner.text";

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
    <div className="space-y-5">
      <Sheet>
        <form
          className="p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="menu-request" className="display text-[1.6rem]">
            {tx.question}
          </label>
          <p className="text-[0.95rem] text-ink-soft">{tx.hint}</p>
          <textarea
            id="menu-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            className="mt-2 w-full border-2 border-petrol bg-paper px-3 py-2 text-[1.1rem] leading-snug"
            placeholder={tx.placeholder}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn type="submit" kind="go" busy={busy === "plan"} disabled={text.trim().length < 3} className="min-h-12 px-5 text-[1.1rem]">
              {tx.planIt}
            </Btn>
            {info?.kitchen.examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className="min-h-10 bg-mist px-3 py-1 text-left text-[0.92rem] hover:outline-2 hover:outline-petrol">
                {ex}
              </button>
            ))}
          </div>
          {info?.mode === "recorded" && (
            <p className="mt-2 text-[0.9rem] text-ink-soft">
              <span className="mr-1.5 border border-petrol px-1.5 py-px font-semibold text-petrol">{tx.noModel}</span>
              {tx.recorded}
            </p>
          )}
          {busy === "plan" && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Spinner label={stepText} />
              <span className="text-[0.95rem] text-ink-soft tabular">{tx.seconds(seconds)}</span>
            </div>
          )}
        </form>
      </Sheet>

      {error && (
        <div role="alert" className="border-l-[6px] border-petrol bg-paper px-4 py-3">
          <p className="font-semibold">{error.code === "model_unavailable" ? tx.errModel : error.code === "plan_not_ready" ? tx.errNotReady : tx.errOther}</p>
          <p className="text-ink-soft">{error.message}</p>
        </div>
      )}

      {plan?.state === "declined" && (
        <Sheet>
          <div className="p-4 sm:p-5">
            <h2 className="display text-[1.6rem]">{tx.declined}</h2>
            <p className="mt-1">{plan.declineReason}</p>
            <p className="mt-1 text-[0.95rem] text-ink-soft">{tx.nothingDone}</p>
          </div>
        </Sheet>
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

"use client";

import type { ReactNode } from "react";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import type { Pending } from "@/server/channels/voice/tools";
import { useFormat, useText } from "../_i18n/provider";
import { clock, money } from "../_ui/plain";
import { CARDS_TEXT } from "./cards.text";

/**
 * The flow's structured cards, narrow-screen first, for both doors: the read-back of an unusual amount with
 * its reason, Dock's checks and questions, the option cards with their trade-offs, the fixed-price quote, and
 * the order with its sign-off state. Yellow only where a person must decide or the gate refused.
 */

export type Act = (name: string, args: Record<string, unknown>, label: string) => void;

function Btn({ children, onClick, disabled, tone = "ink" }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "ink" | "plain" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 px-4 py-2 text-left text-[1.05rem] font-semibold disabled:opacity-50 ${tone === "ink" ? "bg-petrol text-paper" : "border-2 border-petrol bg-paper text-petrol"}`}
    >
      {children}
    </button>
  );
}

function Decide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden border-[3px] border-ink bg-paper">
      <div className="hazard-thin h-2" />
      <div className="p-4">
        <h3 className="display text-[1.6rem]">{title}</h3>
        <div className="mt-2 space-y-3">{children}</div>
      </div>
    </section>
  );
}

function Plain({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-ink bg-paper p-4">
      <h3 className="display text-[1.6rem]">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function ReadBack({ pending, act, busy }: { pending: Pending; act: Act; busy?: boolean }) {
  const tx = useText(CARDS_TEXT);
  const f = useFormat();
  const q = pending.need.quantity;
  return (
    <Decide title={tx.readBackTitle}>
      <p className="text-[1.6rem] font-bold leading-tight tabular">
        {q ? f.measure(q.amount, q.unit) : ""} <span className="font-semibold">{pending.need.item.text}</span>
      </p>
      <p className="text-[1.05rem] text-ink-soft">{tx.asksBecause(pending.reason)}</p>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => act("confirm_read_back", {}, tx.yesRight)}>
          {tx.yesRight}
        </Btn>
      </div>
      <p className="text-sm text-ink-soft">{tx.notRight}</p>
    </Decide>
  );
}

export function StepCards({ step, act, busy }: { step: IntakeView; act: Act; busy?: boolean }) {
  const tx = useText(CARDS_TEXT);
  const f = useFormat();
  const role = (r: string) => (f.lang === "en" ? r : f.role(r));
  /** The gate's English reason; in Finnish and Swedish the failing rule's title leads. */
  const refusal = (rules: { rule: string; outcome: string }[], reason: string) => {
    const fail = f.lang === "en" ? undefined : rules.find((r) => r.outcome === "fail");
    return fail ? `${f.ruleTitle(fail.rule)}. ${reason}` : reason;
  };
  switch (step.state) {
    case "needs_confirmation":
      return (
        <>
          {step.concerns.map((c) => (
            <Decide key={c.key} title={tx.checkTitles[c.code] ?? tx.checkTitle}>
              <p className="text-[1.1rem]">{c.message}</p>
              <div className="flex flex-col gap-2">
                {c.confirmable && (
                  <Btn disabled={busy} onClick={() => act("respond_to_check", { key: c.key, choice: "confirm" }, tx.yesIntended)}>
                    {tx.yesIntended}
                  </Btn>
                )}
                {c.corrections.map((x) => (
                  <Btn key={x.id} tone="plain" disabled={busy} onClick={() => act("respond_to_check", { key: c.key, choice: x.id }, x.label)}>
                    {x.label}
                  </Btn>
                ))}
              </div>
            </Decide>
          ))}
        </>
      );
    case "needs_input":
      return (
        <>
          {step.questions.map((q) => (
            <Decide key={q.id} title={q.text}>
              <div className="flex flex-col gap-2">
                {q.options.map((o) => (
                  <Btn key={o.id} tone="plain" disabled={busy} onClick={() => act("answer_question", { questionId: q.id, optionId: o.id }, o.label)}>
                    {o.label}
                  </Btn>
                ))}
              </div>
            </Decide>
          ))}
        </>
      );
    case "options_ready":
      return (
        <Decide title={tx.options(step.options.length)}>
          <ol className="space-y-3">
            {step.options.slice(0, 3).map((o, i) => (
              <li key={o.optionId} className={`rounded-lg border-2 p-3 ${step.preselected?.optionId === o.optionId ? "border-petrol" : "border-line"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[1.2rem] font-bold">{tx.option(i + 1)}</span>
                  <span className="text-[1.3rem] font-bold tabular">{money(o.totalCents)}</span>
                </div>
                <p className="text-sm font-semibold text-ink-soft">{[tx.rank[o.rank] ?? o.rank, ...o.labels.map((l) => tx.label[l] ?? l)].join(", ")}</p>
                <ul className="mt-1 text-[1.02rem]">
                  {o.lines.map((l) => (
                    <li key={l.productId}>
                      {l.packs} × {f.measure(l.packSize, l.unit)} {l.name}
                      {l.substituteFor ? tx.substitute : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[1.02rem]">{tx.delivered(f.day(o.deliveryDate), o.orderBy ? clock(o.orderBy) : undefined)}</p>
                <p className="mt-1 text-[0.98rem] text-ink-soft">
                  {o.match === "full"
                    ? (o.cons[0] ?? tx.meetsAll)
                    : tx.givesUp(
                        o.givesUp.map((g) => tx.part[g.part] ?? g.part),
                        o.givesUp.map((g) => g.text).join("; "),
                      )}
                </p>
                {o.signOff.length > 0 && <p className="mt-1 text-[0.98rem] font-semibold">{tx.needsSignOff(o.signOff[0])}</p>}
                <div className="mt-2">
                  <Btn disabled={busy} onClick={() => act("choose_option", { optionId: o.optionId }, tx.option(i + 1))}>
                    {tx.choose(i + 1)}
                  </Btn>
                </div>
              </li>
            ))}
          </ol>
        </Decide>
      );
    case "quoted": {
      const q = step.quote!;
      const d = q.policyPreview;
      return (
        <Decide title={tx.fixedPrice(money(q.quote.totalCents))}>
          <ul className="text-[1.02rem]">
            {q.quote.lines.map((l) => (
              <li key={l.productId}>
                {l.quantity} × {l.name}, {f.day(l.deliveryDate)}
              </li>
            ))}
          </ul>
          <p className="text-[1.02rem] text-ink-soft">{tx.heldUntil(clock(q.quote.expiresAt))}</p>
          <p className="text-[1.05rem] font-semibold">
            {d.outcome === "auto_approve" ? tx.withinLimit : d.outcome === "needs_human_approval" ? tx.needsPerson(d.approver.name, role(d.approver.role)) : tx.wouldRefuse(refusal(d.rules, d.reasons[0] ?? ""))}
          </p>
          {d.outcome !== "reject" && (
            <Btn disabled={busy} onClick={() => act("place_order", {}, tx.place)}>
              {tx.place}
            </Btn>
          )}
        </Decide>
      );
    }
    case "no_options":
      return (
        <Plain title={tx.nothingTitle}>
          <p className="text-[1.05rem]">{step.notes[0]}</p>
        </Plain>
      );
    case "cancelled":
      return (
        <Plain title={tx.cancelledTitle}>
          <p className="text-[1.05rem]">{tx.nothingOrdered}</p>
        </Plain>
      );
  }
}

export function OrderCard({ order, signOff }: { order: PublicOrder; signOff?: ReactNode }) {
  const tx = useText(CARDS_TEXT);
  const f = useFormat();
  const who = order.approval?.approver ?? (order.decision.outcome === "needs_human_approval" ? order.decision.approver : undefined);
  if (order.status === "pending_approval")
    return (
      <Decide title={tx.waitingTitle}>
        <p className="text-[1.2rem]">
          {tx.waitsFor(money(order.totalCents))}
          <strong>{who?.name ?? tx.theApprover}</strong>
          {tx.waitsTail(who?.role ? (f.lang === "en" ? who.role : f.role(who.role)) : undefined)}
        </p>
        {signOff}
      </Decide>
    );
  if (order.status === "committed")
    return (
      <Plain title={tx.placedTitle}>
        <p className="text-[1.2rem] tabular">{tx.placedLine(money(order.totalCents), f.day(order.lines.map((l) => l.deliveryDate).sort().at(-1)!))}</p>
        <p className="text-sm text-ink-soft">{tx.signedBy(order.orderId)}</p>
      </Plain>
    );
  return (
    <Decide title={order.status === "rejected" ? tx.refusedTitle : tx.declinedTitle}>
      <p className="text-[1.1rem]">
        {order.status === "rejected" && f.lang !== "en" && order.decision.rules.some((r) => r.outcome === "fail") && (
          <strong className="block">
            {order.decision.rules
              .filter((r) => r.outcome === "fail")
              .map((r) => f.ruleTitle(r.rule))
              .join(". ")}
            .
          </strong>
        )}
        {order.status === "rejected" ? order.decision.reasons.join(" ") : tx.declinedBy(who?.name)}
      </p>
    </Decide>
  );
}

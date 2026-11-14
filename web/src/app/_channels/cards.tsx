"use client";

import type { ReactNode } from "react";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import type { Pending } from "@/server/channels/voice/tools";
import { clock, day, measure, money } from "../_ui/plain";

/**
 * The flow's structured cards, narrow-screen first, for both doors: the read-back of an unusual amount with
 * its reason, Dock's checks and questions, the option cards with their trade-offs, the fixed-price quote, and
 * the order with its sign-off state. Yellow only where a person must decide or the gate refused.
 */

export type Act = (name: string, args: Record<string, unknown>, label: string) => void;

const LABEL: Record<string, string> = { best_price: "Best price", lowest_carbon: "Lowest carbon", most_reliable: "Most reliable", same_as_last_time: "Same as last time" };
const RANK: Record<string, string> = { best: "Best", better: "Better", good: "Good" };

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
  const q = pending.need.quantity;
  return (
    <Decide title="Is this amount right?">
      <p className="text-[1.6rem] font-bold leading-tight tabular">
        {q ? measure(q.amount, q.unit) : ""} <span className="font-semibold">{pending.need.item.text}</span>
      </p>
      <p className="text-[1.05rem] text-ink-soft">AimoPilot asks because {pending.reason}.</p>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => act("confirm_read_back", {}, "Yes, that's right")}>Yes, that&apos;s right</Btn>
      </div>
      <p className="text-sm text-ink-soft">Not right? Say or type the amount again.</p>
    </Decide>
  );
}

export function StepCards({ step, act, busy }: { step: IntakeView; act: Act; busy?: boolean }) {
  switch (step.state) {
    case "needs_confirmation":
      return (
        <>
          {step.concerns.map((c) => (
            <Decide key={c.key} title="Check this first">
              <p className="text-[1.1rem]">{c.message}</p>
              <div className="flex flex-col gap-2">
                {c.confirmable && <Btn disabled={busy} onClick={() => act("respond_to_check", { key: c.key, choice: "confirm" }, "Yes, it is intended")}>Yes, it is intended</Btn>}
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
        <Decide title={`${step.options.length} option${step.options.length > 1 ? "s" : ""}: choose one`}>
          <ol className="space-y-3">
            {step.options.slice(0, 3).map((o, i) => (
              <li key={o.optionId} className={`rounded-lg border-2 p-3 ${step.preselected?.optionId === o.optionId ? "border-petrol" : "border-line"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[1.2rem] font-bold">Option {i + 1}</span>
                  <span className="text-[1.3rem] font-bold tabular">{money(o.totalCents)}</span>
                </div>
                <p className="text-sm font-semibold text-ink-soft">{[RANK[o.rank] ?? o.rank, ...o.labels.map((l) => LABEL[l] ?? l)].join(", ")}</p>
                <ul className="mt-1 text-[1.02rem]">
                  {o.lines.map((l) => (
                    <li key={l.productId}>
                      {l.packs} × {measure(l.packSize, l.unit)} {l.name}
                      {l.substituteFor ? " (substitute)" : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[1.02rem]">
                  Delivered {day(o.deliveryDate)}
                  {o.orderBy ? `, order by ${clock(o.orderBy)}` : ""}
                </p>
                <p className="mt-1 text-[0.98rem] text-ink-soft">{o.match === "full" ? (o.cons[0] ?? "Meets the whole request.") : `Gives up: ${o.givesUp.map((g) => g.text).join("; ")}`}</p>
                {o.signOff.length > 0 && <p className="mt-1 text-[0.98rem] font-semibold">Needs a sign-off: {o.signOff[0]}</p>}
                <div className="mt-2">
                  <Btn disabled={busy} onClick={() => act("choose_option", { optionId: o.optionId }, `Option ${i + 1}`)}>
                    Choose option {i + 1}
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
        <Decide title={`Fixed price ${money(q.quote.totalCents)}`}>
          <ul className="text-[1.02rem]">
            {q.quote.lines.map((l) => (
              <li key={l.productId}>
                {l.quantity} × {l.name}, {day(l.deliveryDate)}
              </li>
            ))}
          </ul>
          <p className="text-[1.02rem] text-ink-soft">Price held until {clock(q.quote.expiresAt)}.</p>
          <p className="text-[1.05rem] font-semibold">
            {d.outcome === "auto_approve" ? "Within what the agent may spend alone." : d.outcome === "needs_human_approval" ? `Needs ${d.approver.name} (${d.approver.role}) to sign off on their phone.` : `The gate would refuse it: ${d.reasons[0] ?? ""}`}
          </p>
          {d.outcome !== "reject" && (
            <Btn disabled={busy} onClick={() => act("place_order", {}, "Place the order")}>
              Place the order
            </Btn>
          )}
        </Decide>
      );
    }
    case "no_options":
      return (
        <Plain title="Nothing to offer">
          <p className="text-[1.05rem]">{step.notes[0]}</p>
        </Plain>
      );
    case "cancelled":
      return (
        <Plain title="Cancelled">
          <p className="text-[1.05rem]">Nothing was ordered.</p>
        </Plain>
      );
  }
}

export function OrderCard({ order, signOff }: { order: PublicOrder; signOff?: ReactNode }) {
  const who = order.approval?.approver ?? (order.decision.outcome === "needs_human_approval" ? order.decision.approver : undefined);
  if (order.status === "pending_approval")
    return (
      <Decide title="Waiting for sign-off">
        <p className="text-[1.2rem]">
          {money(order.totalCents)} waits for <strong>{who?.name ?? "the approver"}</strong>
          {who?.role ? ` (${who.role})` : ""} to sign off on their phone. Nothing is ordered until they do.
        </p>
        {signOff}
      </Decide>
    );
  if (order.status === "committed")
    return (
      <Plain title="Order placed">
        <p className="text-[1.2rem] tabular">
          {money(order.totalCents)}, delivered {day(order.lines.map((l) => l.deliveryDate).sort().at(-1)!)}.
        </p>
        <p className="text-sm text-ink-soft">Signed by the wholesaler. Order {order.orderId}.</p>
      </Plain>
    );
  return (
    <Decide title={order.status === "rejected" ? "The gate refused it" : "Declined"}>
      <p className="text-[1.1rem]">{order.status === "rejected" ? order.decision.reasons.join(" ") : `${who?.name ?? "The approver"} declined it. Nothing was ordered.`}</p>
    </Decide>
  );
}

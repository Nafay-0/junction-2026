"use client";

import Link from "next/link";
import { CookingPot } from "lucide-react";
import { useFormat, useText } from "../../_i18n/provider";
import { buttonClass } from "../../_ui/kit";
import { money } from "../../_ui/plain";
import { ThreadCard } from "../../_ui/thread";
import type { PlanCard as PlanCardT, ThreadAction } from "@/server/thread/types";
import { THREAD_PLAN_TEXT } from "./thread-plan.text";

/**
 * The menu planner's plan in the thread: the dishes and covers, one row per ingredient (the product chosen, its packs,
 * the line's price), what the one confirmation also accepts or leaves out, and one button that says what happens. The
 * lines are edited one by one on the menu planner page; here the plan is one decision.
 */
export function PlanCardView({ card, busy, tap }: { card: PlanCardT; busy: boolean; tap: (action: ThreadAction, label: string) => void }) {
  const tx = useText(THREAD_PLAN_TEXT);
  const f = useFormat();
  const total = money(card.totalCents);
  const approver = card.signOff?.approver?.name;
  const label = approver ? tx.send(approver, total) : tx.order(total);
  const head = [card.dishes.join(", "), card.covers !== null ? tx.covers(f.num(card.covers)) : tx.noCovers, card.serviceDate ? tx.forDay(f.day(card.serviceDate)) : ""].filter(Boolean).join(" · ");
  const buying = card.lines.filter((l) => l.status !== "left_out");
  const left = card.lines.filter((l) => l.status === "left_out");
  const open = card.state === "planned" && card.canOrder;
  return (
    <ThreadCard
      kind={tx.kind}
      mark={<CookingPot aria-hidden size={14} />}
      tone="agent"
      actions={
        card.declined ? undefined : (
          <>
            {open && (
              <button type="button" disabled={busy} className={buttonClass(approver ? "safety" : "go", "sm", "max-w-full whitespace-normal text-left")} onClick={() => tap({ type: "plan_order", planId: card.planId }, label)}>
                {label}
              </button>
            )}
            {card.state === "planned" && (
              <Link href={card.editUrl} className="text-[0.86rem] text-petrol underline decoration-1 underline-offset-4">
                {tx.edit}
              </Link>
            )}
            {card.state === "quoted" && <span className="text-[0.86rem] text-ink-soft">{tx.quoted}</span>}
            {card.state === "ordered" && <span className="text-[0.86rem] text-ink-soft">{tx.ordered}</span>}
          </>
        )
      }
    >
      {card.declined ? (
        <p className="text-[0.95rem]">
          <b className="font-semibold">{tx.declined}.</b> {card.declined}
        </p>
      ) : (
        <>
          <p className="text-[0.95rem] font-semibold leading-snug">{head}</p>
          <ul className="mt-2 divide-y divide-line/70">
            {buying.map((l) => (
              <li key={l.lineId} className="flex items-baseline justify-between gap-3 py-1.5 text-[0.9rem] leading-snug">
                <span className="min-w-0">
                  <span className="block break-words">{l.product ?? l.ingredient}</span>
                  <span className="block text-[0.8rem] text-ink-soft">
                    {[l.packs, l.product ? l.ingredient : "", card.dishes.length > 1 && l.dishes.length ? l.dishes.join(", ") : ""].filter(Boolean).join(" · ")}
                  </span>
                  {l.status === "decide" && l.note && <span className="block text-[0.8rem] text-notice">{l.note}</span>}
                </span>
                {l.totalCents !== undefined && <span className="shrink-0 font-medium tabular">{money(l.totalCents)}</span>}
              </li>
            ))}
          </ul>
          {left.length > 0 && (
            <p className="mt-2 text-[0.82rem] leading-snug text-ink-soft">
              <b className="font-medium text-ink">{tx.leftOut}:</b> {left.map((l) => l.ingredient).join(", ")}
            </p>
          )}
          {open && card.onOrder.accepts.length > 0 && (
            <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-soft">
              <b className="font-medium text-ink">{tx.accepts}:</b> {card.onOrder.accepts.join("; ")}
            </p>
          )}
          {open && card.onOrder.leavesOut.length > 0 && (
            <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-soft">
              <b className="font-medium text-ink">{tx.leavesOut}:</b> {card.onOrder.leavesOut.join("; ")}
            </p>
          )}
          <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-line pt-2">
            <span className="text-[0.86rem] text-ink-soft">
              {[card.deliveryDate ? tx.delivery(f.day(card.deliveryDate)) : "", card.orderBy ? tx.orderBy(`${f.day(card.orderBy.slice(0, 10))} ${f.clock(card.orderBy)}`) : ""].filter(Boolean).join(", ")}
            </span>
            <span className="shrink-0 text-[1.05rem] font-semibold tabular">
              {tx.total} {total}
            </span>
          </div>
          {approver && open && <p className="mt-1 text-[0.82rem] text-ink-soft">{tx.signOff(approver)}</p>}
          {card.blockers.length > 0 && (
            <p className="mt-2 rounded-md bg-notice-soft px-3 py-2 text-[0.86rem] leading-snug">
              <b className="font-semibold">{tx.blocked}:</b> {card.blockers.join(" ")}
            </p>
          )}
        </>
      )}
    </ThreadCard>
  );
}

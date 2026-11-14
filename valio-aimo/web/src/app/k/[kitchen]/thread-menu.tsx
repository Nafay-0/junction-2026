"use client";

import { useState } from "react";
import { CookingPot, Minus, Plus } from "lucide-react";
import { useFormat, useText } from "../../_i18n/provider";
import { buttonClass } from "../../_ui/kit";
import { money } from "../../_ui/plain";
import { ThreadCard } from "../../_ui/thread";
import type { MenuCard, ThreadAction } from "@/server/thread/types";
import { THREAD_MENU_TEXT } from "./thread-menu.text";

type Line = MenuCard["dishes"][number]["lines"][number];
type Tap = (action: ThreadAction, label: string) => void;

/**
 * The menu builder in the thread (server/thread/menu.ts): it forms while the planner works (the dishes, then each
 * dish's lines, then products and prices). The buyer edits it in place: covers, delivery day, per line another
 * product, "we have this", the amount per cover, accepting an open point; every edit is a turn through the same
 * planner and gate. One button puts every bought line on the order sheet, where the order is placed.
 */
export function MenuCardView({ card, busy, tap }: { card: MenuCard; busy: boolean; tap: Tap }) {
  const tx = useText(THREAD_MENU_TEXT);
  const f = useFormat();
  const editable = card.stage === "ready" && !card.sheetId;
  const lock = busy || !editable;
  const stage = card.sheetId ? "" : (tx.stage[card.stage] ?? "");
  const gate = card.gate;
  return (
    <ThreadCard
      kind={tx.kind}
      mark={<CookingPot aria-hidden size={14} />}
      tone="agent"
      aside={stage ? <span aria-live="polite">{stage}</span> : undefined}
      actions={
        card.stage === "ready" ? (
          card.sheetId ? (
            <span className="text-[0.86rem] text-ink-soft">{tx.onSheet}</span>
          ) : (
            <button type="button" disabled={lock || card.totalCents === 0 || card.blockers.length > 0} className={buttonClass("go", "sm")} onClick={() => tap({ type: "menu_to_sheet", planId: card.planId }, tx.toSheetWords)}>
              {tx.toSheet}
            </button>
          )
        ) : undefined
      }
    >
      {card.stage === "declined" ? (
        <p className="text-[0.95rem]">{card.blockers.join(" ")}</p>
      ) : card.stage === "choose" ? (
        <section aria-label={tx.choose}>
          <p className="text-[0.95rem] font-semibold">{tx.choose}</p>
          <ul className="mt-2 space-y-2">
            {card.proposals.map((p) => (
              <li key={p.proposalId} className="rounded-lg border border-line px-3 py-2">
                <p className="font-medium leading-snug">{p.title}</p>
                <p className="text-[0.84rem] text-ink-soft">{p.dishes.join(", ")}</p>
                <button type="button" disabled={busy} className={`${buttonClass("secondary", "sm")} mt-2`} onClick={() => tap({ type: "menu_choose", planId: card.planId, proposalId: p.proposalId }, tx.chooseWords(p.title))}>
                  {tx.cook}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <Settings card={card} lock={lock} tap={tap} />
          {card.dishes.map((d) => (
            <section key={d.dishId} className="mt-3" aria-label={d.name}>
              <h3 className="text-[0.95rem] font-semibold leading-snug">{d.name}</h3>
              {d.portion && <p className="text-[0.8rem] text-ink-soft">{d.portion}</p>}
              <ul className="mt-1 divide-y divide-line/70">
                {d.lines.map((l) => (
                  <MenuLine key={`${l.lineId}:${l.perCover.amount}`} line={l} dishId={d.dishId} planId={card.planId} lock={lock} tap={tap} />
                ))}
                {d.lines.length === 0 && <li className="py-1.5 text-[0.86rem] text-ink-soft">{tx.stage.proposing}</li>}
              </ul>
            </section>
          ))}
          {card.stage === "ready" && (
            <>
              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <span className="text-[0.86rem] text-ink-soft">{card.costPerCoverCents !== undefined ? tx.perCoverCost(money(card.costPerCoverCents)) : ""}</span>
                <span className="shrink-0 text-[1.05rem] font-semibold tabular">
                  {tx.total} {money(card.totalCents)}
                </span>
              </div>
              {gate && (
                <p className={`mt-1.5 text-[0.84rem] leading-snug ${gate.outcome === "reject" ? "text-notice" : "text-ink-soft"}`}>
                  {gate.outcome === "auto_approve" ? tx.gate.auto_approve : gate.outcome === "needs_human_approval" ? tx.gate.needs_human_approval(gate.approver?.name ?? "") : tx.gate.reject(f.ruleTitle(gate.rule))}
                </p>
              )}
              {card.blockers.length > 0 && (
                <p className="mt-2 rounded-md bg-notice-soft px-3 py-2 text-[0.86rem] leading-snug">
                  <b className="font-semibold">{tx.blocked}:</b> {card.blockers.join(" ")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </ThreadCard>
  );
}

/** Covers (a stepper) and the delivery day (the days the plan can move to, with the order-by time of the chosen one). */
function Settings({ card, lock, tap }: { card: MenuCard; lock: boolean; tap: Tap }) {
  const tx = useText(THREAD_MENU_TEXT);
  const f = useFormat();
  const covers = card.covers ?? 0;
  const step = covers >= 200 ? 50 : covers >= 50 ? 10 : 5;
  const set = (n: number) => n >= 1 && tap({ type: "menu_covers", planId: card.planId, covers: n }, tx.coversWords(f.num(n)));
  const here = card.days.find((d) => d.date === card.serviceDate);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5" role="group" aria-label={tx.covers}>
        <span className="text-[0.84rem] text-ink-soft">{tx.covers}</span>
        <button type="button" aria-label={tx.fewer} disabled={lock || covers - step < 1} className={buttonClass("secondary", "sm", "!min-h-8 !px-2")} onClick={() => set(covers - step)}>
          <Minus aria-hidden size={14} />
        </button>
        <span className="min-w-10 text-center font-semibold tabular" aria-live="polite">
          {card.covers === null ? "?" : f.num(card.covers)}
        </span>
        <button type="button" aria-label={tx.more} disabled={lock} className={buttonClass("secondary", "sm", "!min-h-8 !px-2")} onClick={() => set(covers + step)}>
          <Plus aria-hidden size={14} />
        </button>
      </div>
      {card.days.length > 0 && (
        <label className="flex items-center gap-1.5 text-[0.84rem] text-ink-soft">
          {tx.day}
          <select className="rounded-md border border-line bg-paper px-2 py-1 text-[0.9rem] text-ink" disabled={lock} value={card.serviceDate ?? ""} onChange={(e) => e.target.value && tap({ type: "menu_day", planId: card.planId, date: e.target.value }, tx.dayWords(f.day(e.target.value)))}>
            {!card.serviceDate && <option value="">—</option>}
            {card.days.map((d) => (
              <option key={d.date} value={d.date} disabled={!d.available}>
                {f.day(d.date)}
                {d.available ? "" : ` (${tx.notThatDay})`}
              </option>
            ))}
          </select>
        </label>
      )}
      {here?.orderBy && <span className="text-[0.8rem] text-ink-soft">{tx.orderBy(`${f.day(here.orderBy.slice(0, 10))} ${f.clock(here.orderBy)}`)}</span>}
    </div>
  );
}

/** One ingredient: its product, packs and price; another product, "we have this", the amount per cover; its conflicts on it. */
function MenuLine({ line: l, dishId, planId, lock, tap }: { line: Line; dishId: string; planId: string; lock: boolean; tap: Tap }) {
  const tx = useText(THREAD_MENU_TEXT);
  const f = useFormat();
  const [amount, setAmount] = useState(String(l.perCover.amount));
  const commit = () => {
    const n = Number(amount.replace(",", "."));
    if (!(n > 0) || n === l.perCover.amount) return setAmount(String(l.perCover.amount));
    tap({ type: "menu_line_per_cover", planId, lineId: l.lineId, dishId, amount: n }, tx.perCoverWords(l.ingredient, f.measure(n, l.perCover.unit)));
  };
  const off = l.status === "have" || l.status === "left_out";
  const diff = (o: Line["options"][number]) =>
    o.differs
      .map((d) =>
        d.code === "price_more"
          ? tx.differs.price_more(money(Number(d.params.cents)))
          : d.code === "price_less"
            ? tx.differs.price_less(money(Number(d.params.cents)))
            : d.code === "arrives_later"
              ? tx.differs.arrives_later(f.day(String(d.params.date)))
              : (tx.differs[d.code as "compromise"] ?? ""),
      )
      .filter(Boolean)
      .join(", ");
  return (
    <li className={`py-2 text-[0.9rem] leading-snug ${off ? "text-ink-soft" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className={`block break-words ${off ? "line-through decoration-1" : "font-medium"}`}>{l.product?.name ?? l.ingredient}</span>
          <span className="block text-[0.8rem] text-ink-soft">
            {[l.product ? l.ingredient : "", l.product ? `${f.num(l.product.packs)} × ${f.measure(l.product.packSize, l.product.unit)}` : "", l.need.amount > 0 && !off ? tx.need(f.measure(l.need.amount, l.need.unit)) : "", l.status === "resolving" ? tx.finding : "", l.status === "have" ? tx.haveIt : l.status === "left_out" ? tx.leftOut : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
        {l.product && !off && <span className="shrink-0 font-medium tabular">{money(l.product.totalCents)}</span>}
      </div>
      {l.conflicts.map((c) => (
        <p key={`${c.code}:${c.doubtId ?? c.text}`} className={`mt-1 text-[0.8rem] ${c.blocking ? "text-notice" : "text-ink-soft"}`}>
          {f.lang === "en" ? c.text : (tx.conflict[c.code] ?? c.text)}
          {c.doubtId && (
            <button type="button" disabled={lock} className="ml-2 text-petrol underline decoration-1 underline-offset-4 disabled:opacity-50" onClick={() => tap({ type: "menu_accept", planId, doubtId: c.doubtId! }, tx.acceptWords(l.ingredient))}>
              {tx.accept}
            </button>
          )}
        </p>
      ))}
      {l.status !== "resolving" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8rem]">
          {!off && (
            <label className="flex items-center gap-1 text-ink-soft">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={`${l.ingredient} ${tx.perCover}`}
                disabled={lock}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                className="w-16 rounded-md border border-line bg-paper px-1.5 py-0.5 text-right text-ink tabular"
              />
              {l.perCover.unit} {tx.perCover}
            </label>
          )}
          {!off && l.options.length > 0 && (
            <label className="flex min-w-0 items-center gap-1 text-ink-soft">
              <span className="sr-only">{tx.swap}</span>
              <select className="max-w-[14rem] truncate rounded-md border border-line bg-paper px-1.5 py-0.5 text-ink" disabled={lock} value="" onChange={(e) => {
                const o = l.options.find((x) => x.optionId === e.target.value);
                if (o) tap({ type: "menu_line_swap", planId, lineId: l.lineId, optionId: o.optionId }, tx.swapWords(o.name));
              }}>
                <option value="">{tx.swap}</option>
                {l.options.map((o) => (
                  <option key={o.optionId} value={o.optionId}>
                    {o.name}, {money(o.totalCents)}
                    {diff(o) ? ` (${diff(o)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {l.status !== "left_out" && (
            <button type="button" disabled={lock} className="text-petrol underline decoration-1 underline-offset-4 disabled:opacity-50" onClick={() => tap({ type: "menu_line_have", planId, lineId: l.lineId, have: l.status !== "have" }, l.status === "have" ? tx.buyWords(l.ingredient) : tx.haveWords(l.ingredient))}>
              {l.status === "have" ? tx.buy : tx.have}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

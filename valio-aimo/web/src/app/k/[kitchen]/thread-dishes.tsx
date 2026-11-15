"use client";

import { Fragment } from "react";
import { useText } from "../../_i18n/provider";
import { money } from "../../_ui/plain";
import type { DishesCard } from "@/server/thread/types";
import { THREAD_DISHES_TEXT } from "./thread-dishes.text";
import { Leaf } from "lucide-react";
import { marksSummary } from "@/core/line-marks";
import { BASKET_TEXT } from "./basket.text";
import { Pips } from "./thread-marks";
import { THREAD_MARKS_TEXT } from "./thread-marks.text";
import { dishCo2, recordSummary } from "./thread-marks.words";

type Lang = "en" | "fi" | "sv";

const flat = (s: string) =>
  s.replace(/\*\*/g, "").replace(/[\s\u00a0\u202f]+/g, " ");

/** "Dark chocolate, dairy-free" in a list of ingredients reads as two: "dark chocolate (dairy-free)". Lower case after the first. */
function nameOf(name: string, first: boolean): string {
  const n = name.replace(/^([^,]+),\s*(.+)$/, "$1 ($2)");
  return first
    ? n.charAt(0).toUpperCase() + n.slice(1)
    : n.charAt(0).toLowerCase() + n.slice(1);
}

/** "6 kg", "300 g", "2 l", "500 ml" / "5 dl", "12 pcs": what the covers need, as a cook writes it. */
export function amountOf(n: number, unit: string, lang: Lang): string {
  const dec = (x: number, d: number) =>
    (Math.round(x * 10 ** d) / 10 ** d).toString().replace(".", ",");
  const u = unit.toLowerCase();
  if (u === "kg")
    return n >= 1
      ? `${dec(n, n < 10 ? 1 : 0)} kg`
      : `${Math.max(10, Math.round((n * 1000) / 10) * 10)} g`;
  if (u === "l")
    return n >= 1
      ? `${dec(n, n < 10 ? 1 : 0)} l`
      : lang === "en"
        ? `${Math.max(10, Math.round((n * 1000) / 10) * 10)} ml`
        : `${dec(n * 10, 1)} dl`;
  if (u === "pcs")
    return `${Math.ceil(n)} ${lang === "fi" ? "kpl" : lang === "sv" ? "st" : "pcs"}`;
  return `${dec(n, 2)} ${unit}`;
}

/**
 * The menu as content, set on the thread's line like a short menu card: each dish in the display face, its
 * ingredients beneath as running text in the muted colour, with a light note only where an ingredient is not simply
 * ordered; then the total and the price per portion. Typography only: no borders, no rows, no buttons.
 */
export function Dishes({
  card,
  lang,
  day,
  said = "",
}: {
  card: DishesCard;
  lang: Lang;
  day: (iso: string) => string;
  said?: string;
}) {
  const tx = useText(THREAD_DISHES_TEXT);
  const mt = useText(THREAD_MARKS_TEXT);
  const bt = useText(BASKET_TEXT);
  // One quiet line under the total: the footprint of what is bought (and a portion's), and the delivery summary.
  const ms = card.marks?.length ? marksSummary(card.marks) : undefined;
  const msCo2 = ms && dishCo2(ms, mt, card.covers, card.dishes.length > 1 && !card.groups);
  const msRec = ms && recordSummary(ms, mt);
  const marksLine = (msCo2 || msRec) && (
    <p data-marks-summary className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8rem] leading-snug text-ink-soft">
      {msCo2 && (
        <span title={bt.carbonNote} className="inline-flex items-center gap-1 tabular">
          <Leaf aria-hidden size={11} strokeWidth={2} className="shrink-0" />
          {msCo2}
        </span>
      )}
      {msRec && <span className={ms?.poor ? "text-notice" : ""}>{msRec}</span>}
    </p>
  );
  const noteOf = (
    n: NonNullable<DishesCard["dishes"][number]["items"][number]["note"]>,
  ): string => {
    switch (n.code) {
      case "have":
        return tx.have;
      case "left_out":
        return tx.leftOut(
          n.why
            ? n.why.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())
            : undefined,
        );
      case "late":
        return tx.late(n.date ? day(n.date) : "", n.to?.[lang]);
      case "swap":
        return tx.swap((n.to?.[lang] ?? "").toLowerCase());
      case "later":
        return tx.later(n.date ? day(n.date) : "");
      case "open":
        return tx.open;
      case "changed":
        return tx.changed;
    }
  };
  // One dish: its ingredients in three groups, each a short run of text; the reason beside what cannot be had.
  const g = card.groups;
  if (g && card.dishes.length === 1) {
    const row = (label: string, items: { name: string; need?: string; extra?: string; poor?: { share: number; n: number; of: number } }[], tone = "") =>
      items.length > 0 && (
        <p className="text-[0.88rem] leading-[1.55] text-ink-soft [text-wrap:pretty]">
          <span className="font-medium text-ink">{label}: </span>
          {items.map((i, k) => (
            <Fragment key={k}>
              {k > 0 && ", "}
              {nameOf(i.name, false)}
              {i.need && <span className="tabular whitespace-nowrap"> {i.need.replace(".", ",")}</span>}
              {i.extra && <span className={`italic ${tone}`}> ({i.extra})</span>}
              {i.poor && (
                <span data-mark="delivery" className="text-notice">
                  {" "}
                  <Pips share={i.poor.share} className="align-middle" /> ({mt.dishPoor(i.poor.n, i.poor.of)})
                </span>
              )}
            </Fragment>
          ))}
        </p>
      );
    return (
      <section aria-label={tx.label} className="mt-3 max-w-[40ch] space-y-1">
        <h3 className="display text-[1.02rem] leading-snug text-ink">{card.dishes[0].name[lang]}</h3>
        {row(tx.gHave, g.have.map((i) => ({ name: i.name, ...(i.basis ? { extra: i.basis.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) } : {}) })))}
        {row(tx.gOrder, g.order.map((i) => ({ name: i.name, ...(i.need ? { need: i.need } : {}), ...(i.instead ? { extra: tx.swap(i.instead) } : {}), ...(i.marks?.delivery?.poor ? { poor: i.marks.delivery } : {}) })))}
        {row(tx.gCannot, g.cannot.map((i) => ({ name: i.name, ...(i.need ? { need: i.need } : {}), extra: i.why.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) })), "text-notice")}
        {g.totalToOrderCents > 0 && !flat(said).includes(flat(money(g.totalToOrderCents))) && <p className="pt-1 text-[0.88rem] tabular text-ink">{g.complete ? tx.total(money(card.totalCents), card.costPerCoverCents ? money(card.costPerCoverCents) : undefined) : tx.forThese(money(g.totalToOrderCents))}</p>}
        {marksLine}
      </section>
    );
  }
  // A reason shared by several lines ("give the number of covers …") is said once, at its first line, not per line.
  const firstWith = new Map<string, string>();
  for (const d of card.dishes)
    for (const i of d.items)
      if (i.note) {
        const k = `${i.note.code}:${noteOf(i.note)}`;
        if (!firstWith.has(k)) firstWith.set(k, i.lineId);
      }
  const saysNote = (i: DishesCard["dishes"][number]["items"][number]) => !!i.note && firstWith.get(`${i.note.code}:${noteOf(i.note)}`) === i.lineId;
  return (
    <section aria-label={tx.label} className="mt-3 max-w-[40ch] space-y-2.5">
      {card.dishes.map((d) => {
        // What is bought, as running text; what the kitchen already has, gathered in one light line after it.
        const bought = d.items.filter((i) => i.note?.code !== "have");
        const have = d.items.filter((i) => i.note?.code === "have");
        return (
          <div key={d.dishId}>
            <h3 className="display text-[1.02rem] leading-snug text-ink">
              {d.name[lang]}
            </h3>
            {bought.length > 0 && (
              <p className="mt-0.5 text-[0.88rem] leading-[1.55] text-ink-soft [text-wrap:pretty]">
                {bought.map((i, k) => (
                  <Fragment key={i.lineId}>
                    {k > 0 && ", "}
                    <span
                      className={
                        i.note?.code === "left_out"
                          ? "line-through decoration-ink-soft/50"
                          : undefined
                      }
                    >
                      {nameOf(i.name[lang], k === 0)}
                    </span>
                    {i.need && i.note?.code !== "left_out" && (
                      <span className="tabular whitespace-nowrap">
                        {" "}
                        {amountOf(i.need.amount, i.need.unit, lang)}
                      </span>
                    )}
                    {i.note && saysNote(i) && (
                      <span
                        className={`italic ${i.note.code === "changed" ? "text-petrol" : i.note.code === "late" || i.note.code === "left_out" ? "text-notice" : ""}`}
                      >
                        {" "}
                        ({noteOf(i.note)})
                      </span>
                    )}
                  </Fragment>
                ))}
              </p>
            )}
            {have.length > 0 && (
              <p className="mt-0.5 text-[0.84rem] italic leading-[1.5] text-ink-soft/80">
                {tx.haveList(
                  have
                    .map((i, k) =>
                      nameOf(i.name[lang], k === 0 && !bought.length),
                    )
                    .join(", "),
                )}
              </p>
            )}
          </div>
        );
      })}
      {/* The total once: not again when the reply's own words already give it. */}
      {card.totalCents > 0 &&
        !flat(said).includes(flat(money(card.totalCents))) && (
          <p className="text-[0.88rem] tabular text-ink">
            {tx.total(
              money(card.totalCents),
              card.costPerCoverCents
                ? money(card.costPerCoverCents)
                : undefined,
            )}
          </p>
        )}
      {marksLine}
    </section>
  );
}

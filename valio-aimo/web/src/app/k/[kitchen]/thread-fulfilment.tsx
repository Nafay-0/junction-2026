"use client";

import { useText } from "../../_i18n/provider";
import { clock } from "../../_ui/plain";
import type { OrderCard } from "@/server/thread/types";
import { THREAD_FULFILMENT_TEXT } from "./thread-fulfilment.text";

/** One quiet line under a placed order: with the wholesaler's team to confirm, confirmed (and when), or not (and why). */
export function FulfilmentNote({ card }: { card: OrderCard }) {
  const tx = useText(THREAD_FULFILMENT_TEXT);
  if (card.status !== "committed") return null;
  const f = card.fulfilment;
  const state = f?.state ?? "waiting";
  const text = f?.state === "confirmed" ? tx.confirmed(clock(f.at)) : f?.state === "refused" ? tx.refused(f.reason) : tx.waiting;
  const mark = state === "confirmed" ? "bg-good" : state === "refused" ? "bg-notice" : "bg-ink-faint";
  const tone = state === "confirmed" ? "text-good" : state === "refused" ? "text-notice" : "text-ink-soft";
  return (
    <p data-fulfilment={state} data-order={card.orderId} className={`mt-2 flex max-w-[38ch] items-center gap-2 text-[0.9rem] font-medium leading-snug ${tone}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${mark}`} />
      {text}
    </p>
  );
}

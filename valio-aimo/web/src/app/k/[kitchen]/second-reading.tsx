"use client";

import { useText } from "../../_i18n/provider";
import { SECOND_READING_TEXT } from "./second-reading.text";
import type { Step } from "./types";

/**
 * The second reading in the order lane: one quiet line on the request card. Every request a model reads is read again
 * by an independent model; when the two agree nothing is asked, and when they differ the question appears with the
 * other checks (a "readings_differ" concern, written by the server). Words: second-reading.text.ts.
 */
export function SecondReadingLine({ reading }: { reading?: Step["secondReading"] }) {
  const tx = useText(SECOND_READING_TEXT);
  if (!reading) return null;
  const { first, second } = reading.readers;
  const text = reading.status === "agreed" ? tx.agreed(first, second) : reading.status === "differed" ? tx.differed(first, second) : tx.unavailable(second);
  return (
    <p className="mt-1 flex items-start gap-2 text-[0.88rem] text-ink-soft" data-second-reading={reading.status}>
      <span aria-hidden className={`mt-[0.3rem] inline-block size-2 shrink-0 ${reading.status === "differed" ? "bg-petrol" : reading.status === "agreed" ? "bg-petrol/60" : "border border-ink-soft"}`} />
      <span>{text}</span>
    </p>
  );
}

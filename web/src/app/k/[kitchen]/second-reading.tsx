"use client";

import type { Step } from "./types";

/**
 * The second reading in the order lane: one quiet line on the request card. Every request a model reads is read again
 * by an independent model; when the two agree nothing is asked, and when they differ the question appears with the
 * other checks (a "readings_differ" concern, written by the server). The words the buyer sees are all here.
 */
const SAY = {
  agreed: (first: string, second: string) => `Read twice: ${second}, an independent open model, read the same amount, requirements and day as ${first}. Nothing to ask.`,
  differed: (first: string, second: string) => `Read twice: ${first} and ${second} read this differently, so you are asked below which you meant, before any price is fixed.`,
  unavailable: (second: string) => `Read once: the second reader (${second}) did not answer in time, so the first reading went ahead on its own.`,
};

export function SecondReadingLine({ reading }: { reading?: Step["secondReading"] }) {
  if (!reading) return null;
  const { first, second } = reading.readers;
  const text = reading.status === "agreed" ? SAY.agreed(first, second) : reading.status === "differed" ? SAY.differed(first, second) : SAY.unavailable(second);
  return (
    <p className="mt-1 flex items-start gap-2 text-[0.88rem] text-ink-soft" data-second-reading={reading.status}>
      <span aria-hidden className={`mt-[0.3rem] inline-block size-2 shrink-0 ${reading.status === "differed" ? "bg-petrol" : reading.status === "agreed" ? "bg-petrol/60" : "border border-ink-soft"}`} />
      <span>{text}</span>
    </p>
  );
}

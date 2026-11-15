"use client";

import { Leaf } from "lucide-react";
import { marksSummary, pipsOf, type LineMarks } from "@/core/line-marks";
import { useText } from "../../_i18n/provider";
import { BASKET_TEXT } from "./basket.text";
import { THREAD_MARKS_TEXT } from "./thread-marks.text";
import { co2Summary, kgText, recordSummary } from "./thread-marks.words";

/**
 * The delivery record and the carbon estimate beside what the thread will buy, quietly: a five-pip meter with words,
 * and a leaf with "≈ kg CO₂e". Muted ink when the record is good, the notice colour with "poor record" below the warn
 * level, nothing at all when the partner's files have no figure. Typography only: no boxes, no badges.
 */

export function Pips({ share, className = "" }: { share: number; className?: string }) {
  const on = pipsOf(share);
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center gap-[2px] ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`size-[5px] rounded-full bg-current ${i < on ? "" : "opacity-25"}`} />
      ))}
    </span>
  );
}

/** One small line under a product's name in a list: up to two marks. */
export function LineMarksLine({ marks }: { marks?: LineMarks }) {
  const t = useText(THREAD_MARKS_TEXT);
  const d = marks?.delivery;
  const co2 = marks?.co2Kg;
  if (!d && co2 === undefined) return null;
  return (
    <span data-marks className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.76rem] leading-snug text-ink-soft">
      {d && (
        <span data-mark="delivery" title={t.recordTitle(d.n, d.of)} className={`inline-flex items-center gap-1.5 ${d.poor ? "text-notice" : ""}`}>
          <Pips share={d.share} />
          <span>
            {t.record(d.n, d.of)}
            {d.poor && <span className="font-medium"> · {t.poor}</span>}
          </span>
        </span>
      )}
      {co2 !== undefined && (
        <span data-mark="co2" title={t.co2Title(kgText(co2, t))} className="inline-flex items-center gap-1 tabular">
          <Leaf aria-hidden size={11} strokeWidth={2} className="shrink-0" />
          {t.co2(kgText(co2, t))}
        </span>
      )}
    </span>
  );
}

/** The same two marks, compact, for an option's small line: icons with accessible names and a title, never wrapping. */
export function CompactMarks({ marks }: { marks?: LineMarks }) {
  const t = useText(THREAD_MARKS_TEXT);
  const d = marks?.delivery;
  const co2 = marks?.co2Kg;
  if (!d && co2 === undefined) return null;
  return (
    <span data-marks className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
      {d && (
        <span data-mark="delivery" role="img" aria-label={`${t.recordTitle(d.n, d.of)}${d.poor ? `, ${t.poor}` : ""}`} title={`${t.recordTitle(d.n, d.of)}${d.poor ? ` · ${t.poor}` : ""}`} className={`inline-flex items-center gap-1 ${d.poor ? "text-notice" : ""}`}>
          <Pips share={d.share} />
          {d.poor && <span className="font-medium">{t.poor}</span>}
        </span>
      )}
      {co2 !== undefined && (
        <span data-mark="co2" role="img" aria-label={t.co2Title(kgText(co2, t))} title={t.co2Title(kgText(co2, t))} className="inline-flex items-center gap-0.5 tabular">
          <Leaf aria-hidden size={11} strokeWidth={2} className="shrink-0" />
          {t.co2Short(kgText(co2, t))}
        </span>
      )}
    </span>
  );
}

/** Under a list's total: the delivery summary and the footprint, then once the honest note on group averages. */
export function MarksSummaryLine({ marks }: { marks: (LineMarks | undefined)[] }) {
  const t = useText(THREAD_MARKS_TEXT);
  const b = useText(BASKET_TEXT);
  const s = marksSummary(marks);
  const rec = recordSummary(s, t);
  const co2 = co2Summary(s, t);
  if (!rec && !co2) return null;
  return (
    <span data-marks-summary className="block text-[0.78rem] leading-snug text-ink-soft">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {rec && <span className={s.poor ? "text-notice" : ""}>{rec}</span>}
        {co2 && (
          <span className="inline-flex items-center gap-1 tabular">
            <Leaf aria-hidden size={11} strokeWidth={2} className="shrink-0" />
            {co2}
          </span>
        )}
      </span>
      {co2 && <span className="mt-1 block text-[0.72rem] leading-snug text-ink-soft/80">{b.carbonNote}</span>}
    </span>
  );
}

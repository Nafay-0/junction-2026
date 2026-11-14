import type { Lang } from "../_i18n/lang";
import { SAMPLE_TEXT } from "./sample.text";

/** The quiet "sample" mark: the same small pill on every page that shows sample activity (server/alive). */
export function SamplePill({ lang = "en", className = "" }: { lang?: Lang; className?: string }) {
  const t = SAMPLE_TEXT[lang];
  return (
    <span title={t.title} className={`ml-1.5 inline-flex items-center rounded-full border border-dashed border-ink-faint px-1.5 align-middle text-[0.7rem] font-medium uppercase leading-5 tracking-wide text-ink-soft ${className}`}>
      {t.pill}
    </span>
  );
}

/** Whether a row the server sent carries the sample mark (server/alive marks.ts sets `sample: true`). */
export function isSample(row: unknown): boolean {
  return !!row && typeof row === "object" && (row as { sample?: unknown }).sample === true;
}

import { TIME_ZONE, day } from "../../_ui/plain";

/**
 * The partner states order cut-offs as Helsinki wall-clock times ("2026-11-15T17:00:00", sometimes with an
 * offset). These turn them into instants and into words as written in Finland.
 */

function helsinkiOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - utcMs;
}

/** An instant for a cut-off; a time without an offset is Helsinki time. */
export function cutoffMs(s: string | undefined): number | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  }
  const guess = Date.parse(`${s.slice(0, 19)}Z`);
  if (!Number.isFinite(guess)) return undefined;
  return guess - helsinkiOffsetMs(guess);
}

/** "Sun 15.11. 17.00" in Helsinki. */
export function cutoffText(s: string | undefined): string | undefined {
  const t = cutoffMs(s);
  if (t === undefined) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${day(`${p.year}-${p.month}-${p.day}`)} ${p.hour}.${p.minute}`;
}

/** "in 5 h 20 min", "in 3 days", or "passed". */
export function untilText(ms: number, now = Date.now()): string {
  const d = ms - now;
  if (d <= 0) return "passed";
  const min = Math.round(d / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 36) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `in ${Math.round(h / 24)} days`;
}

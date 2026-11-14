import { TIME_ZONE } from "../../_ui/plain";
import { dayL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";

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

const CLOCK_PREFIX: Record<Lang, string> = { en: "", fi: "klo ", sv: "kl. " };

/** "Sun 15.11. 17.00", "su 15.11. klo 17.00", "sön 15.11. kl. 17.00" in Helsinki. */
export function cutoffText(s: string | undefined, lang: Lang = "en"): string | undefined {
  const t = cutoffMs(s);
  if (t === undefined) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${dayL(`${p.year}-${p.month}-${p.day}`, lang)} ${CLOCK_PREFIX[lang]}${p.hour}.${p.minute}`;
}

const UNTIL: Record<Lang, { passed: string; days: (n: number) => string; in: (q: string) => string }> = {
  en: { passed: "passed", days: (n) => `${n} days`, in: (q) => `in ${q}` },
  fi: { passed: "ohi", days: (n) => `${n} päivän`, in: (q) => `${q} päästä` },
  sv: { passed: "har gått ut", days: (n) => `${n} dagar`, in: (q) => `om ${q}` },
};

function leftParts(d: number, lang: Lang): string {
  const min = Math.round(d / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 36) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return UNTIL[lang].days(Math.round(h / 24));
}

/** "in 5 h 20 min", "in 3 days", or "passed" ("5 h 20 min päästä", "om 3 dagar", "ohi"). */
export function untilText(ms: number, now = Date.now(), lang: Lang = "en"): string {
  const d = ms - now;
  if (d <= 0) return UNTIL[lang].passed;
  return UNTIL[lang].in(leftParts(d, lang));
}

/**
 * The time left on its own, without "in": "5 h 20 min", "3 days" / "3 päivää" / "3 dagar", or "passed". For a big
 * countdown figure, instead of stripping "in " off `untilText`.
 */
export function timeLeftText(ms: number, now = Date.now(), lang: Lang = "en"): string {
  const d = ms - now;
  if (d <= 0) return UNTIL[lang].passed;
  const t = leftParts(d, lang);
  return lang === "fi" ? t.replace(/ päivän$/, " päivää") : t;
}

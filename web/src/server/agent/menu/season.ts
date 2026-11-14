import { inSeason as calendarIn, seasonMatches, SEASON, type SeasonEntry } from "@/core/season";

/**
 * What is in season in Finland, for the menu planner and the agent, read from the season calendar (core/season.ts,
 * plain data with its sources): `inSeason(date)`, `seasonalIn(text)`, `seasonText(item, lang)`. No model.
 */

export type Lang = "en" | "fi" | "sv";

export type SeasonItem = {
  key: string;
  names: Record<Lang, string>;
  /** Months (1 = January) it is in season in Finland. */
  months: number[];
  /** Words to find its products in the wholesaler's catalogue (the calendar's own name stems first). */
  search: string[];
  /** Is a product this item? The calendar's own rule (category, words in the name, words that rule it out). */
  matches: (p: { name: string; names?: { en?: string; fi?: string; sv?: string }; category: string }) => boolean;
  why: string;
};

const item = (e: SeasonEntry): SeasonItem => ({
  key: e.kind,
  names: e.label,
  months: e.months,
  search: [e.label.fi, e.label.en, ...(e.match.words ?? []).filter((w) => w.trim().length > 3)].map((w) => w.trim()).slice(0, 6),
  matches: (p) => seasonMatches(e, p),
  why: e.why,
});

/** What is in season on a day (YYYY-MM-DD). */
export function inSeason(isoDate: string): SeasonItem[] {
  return calendarIn(Number(isoDate.slice(5, 7))).map(item);
}

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fi: ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"],
  sv: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
};

/** "Sep–Mar" / "syys–maalis": the season as a span (or the months listed when it is not one span). */
export function seasonText(it: SeasonItem, lang: Lang): string {
  const ms = it.months;
  const span = ms.every((m, i) => i === 0 || m === (ms[i - 1] % 12) + 1);
  return span ? `${MONTHS[lang][ms[0] - 1]}–${MONTHS[lang][ms[ms.length - 1] - 1]}` : ms.map((m) => MONTHS[lang][m - 1]).join(", ");
}

/** Calendar items a text names (a dish, an ingredient), by the calendar's own words; in season or not. */
export function seasonalIn(text: string): SeasonItem[] {
  return SEASON.filter((e) => !!e.match.words?.length && !e.match.within && seasonMatches(e, { name: text, category: "" })).map(item);
}

/** The buyer's language from their words, for the few words this answers with. */
export function langOf(words: string): Lang {
  if (/[åÅ]|\b(vad|nästa|säsong|vecka)\b/i.test(words)) return "sv";
  if (/[äöÄÖ]|\b(mitä|onko|sesong|kausi|ensi|viiko|lounas|suunnittele)/i.test(words)) return "fi";
  return "en";
}

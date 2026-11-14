/**
 * What is in season in Finland, for the menu planner and the agent: one function each, `inSeason(date)` and
 * `seasonalIn(text)`. Plain data, no model.
 *
 * SEAM: the seasonal calendar proper is being written as plain data in `web/src/core/season.ts` on
 * `claude/selling-agent`. Until it lands this file carries a small interim calendar (domestic harvest, catch and
 * storage seasons, by month); when it lands, these functions read it instead and the interim data goes.
 */

export type Lang = "en" | "fi" | "sv";

export type SeasonItem = {
  key: string;
  names: Record<Lang, string>;
  /** Months (1 = January) when it is in season in Finland: fresh, or from this year's storage. */
  months: number[];
  /** How the wholesaler names it (Finnish first), for finding the products. */
  search: string[];
  kind: "vegetable" | "root" | "fruit" | "berry" | "mushroom" | "fish" | "game";
};

const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let m = from; ; m = (m % 12) + 1) {
    out.push(m);
    if (m === to) break;
  }
  return out;
};

/** Interim calendar (see the seam note above). */
const CALENDAR: SeasonItem[] = [
  { key: "beetroot", names: { en: "beetroot", fi: "punajuuri", sv: "rödbeta" }, months: range(8, 3), search: ["punajuuri", "beetroot"], kind: "root" },
  { key: "carrot", names: { en: "carrot", fi: "porkkana", sv: "morot" }, months: range(7, 4), search: ["porkkana", "carrot"], kind: "root" },
  { key: "swede", names: { en: "swede", fi: "lanttu", sv: "kålrot" }, months: range(9, 3), search: ["lanttu", "swede"], kind: "root" },
  { key: "celeriac", names: { en: "celeriac", fi: "juuriselleri", sv: "rotselleri" }, months: range(9, 3), search: ["juuriselleri", "celeriac"], kind: "root" },
  { key: "parsnip", names: { en: "parsnip", fi: "palsternakka", sv: "palsternacka" }, months: range(9, 4), search: ["palsternakka", "parsnip"], kind: "root" },
  { key: "jerusalem_artichoke", names: { en: "Jerusalem artichoke", fi: "maa-artisokka", sv: "jordärtskocka" }, months: range(10, 4), search: ["maa-artisokka", "jerusalem artichoke"], kind: "root" },
  { key: "cabbage", names: { en: "white cabbage", fi: "valkokaali", sv: "vitkål" }, months: range(7, 3), search: ["valkokaali", "kaali", "cabbage"], kind: "vegetable" },
  { key: "kale", names: { en: "kale", fi: "lehtikaali", sv: "grönkål" }, months: range(8, 12), search: ["lehtikaali", "kale"], kind: "vegetable" },
  { key: "leek", names: { en: "leek", fi: "purjo", sv: "purjolök" }, months: range(8, 11), search: ["purjo", "leek"], kind: "vegetable" },
  { key: "new_potato", names: { en: "new potatoes", fi: "uudet perunat", sv: "färskpotatis" }, months: range(6, 8), search: ["varhaisperuna", "uusi peruna", "new potato"], kind: "root" },
  { key: "asparagus", names: { en: "asparagus", fi: "parsa", sv: "sparris" }, months: range(5, 6), search: ["parsa", "asparagus"], kind: "vegetable" },
  { key: "rhubarb", names: { en: "rhubarb", fi: "raparperi", sv: "rabarber" }, months: range(5, 7), search: ["raparperi", "rhubarb"], kind: "vegetable" },
  { key: "apple", names: { en: "apples", fi: "omena", sv: "äpplen" }, months: range(8, 12), search: ["omena", "apple"], kind: "fruit" },
  { key: "strawberry", names: { en: "strawberries", fi: "mansikka", sv: "jordgubbar" }, months: range(6, 8), search: ["mansikka", "strawberry"], kind: "berry" },
  { key: "blueberry", names: { en: "bilberries", fi: "mustikka", sv: "blåbär" }, months: range(7, 9), search: ["mustikka", "blueberry"], kind: "berry" },
  { key: "lingonberry", names: { en: "lingonberries", fi: "puolukka", sv: "lingon" }, months: range(8, 11), search: ["puolukka", "lingonberry"], kind: "berry" },
  { key: "cranberry", names: { en: "cranberries", fi: "karpalo", sv: "tranbär" }, months: range(9, 11), search: ["karpalo", "cranberry"], kind: "berry" },
  { key: "sea_buckthorn", names: { en: "sea buckthorn", fi: "tyrni", sv: "havtorn" }, months: range(8, 10), search: ["tyrni", "sea buckthorn"], kind: "berry" },
  { key: "chanterelle", names: { en: "chanterelles", fi: "kantarelli", sv: "kantareller" }, months: range(7, 9), search: ["kantarelli", "chanterelle"], kind: "mushroom" },
  { key: "funnel_chanterelle", names: { en: "funnel chanterelles", fi: "suppilovahvero", sv: "trattkantareller" }, months: range(8, 11), search: ["suppilovahvero", "funnel chanterelle"], kind: "mushroom" },
  { key: "vendace", names: { en: "vendace", fi: "muikku", sv: "siklöja" }, months: range(7, 3), search: ["muikku", "vendace"], kind: "fish" },
  { key: "whitefish", names: { en: "whitefish", fi: "siika", sv: "sik" }, months: range(9, 11), search: ["siika", "whitefish"], kind: "fish" },
  { key: "pike_perch", names: { en: "pike-perch", fi: "kuha", sv: "gös" }, months: range(6, 10), search: ["kuha", "pike-perch", "zander"], kind: "fish" },
  { key: "baltic_herring", names: { en: "Baltic herring", fi: "silakka", sv: "strömming" }, months: [5, 6, 9, 10], search: ["silakka", "baltic herring"], kind: "fish" },
  { key: "elk", names: { en: "elk", fi: "hirvi", sv: "älg" }, months: range(9, 12), search: ["hirvi", "elk", "moose"], kind: "game" },
  { key: "reindeer", names: { en: "reindeer", fi: "poro", sv: "ren" }, months: range(9, 1), search: ["poro", "reindeer"], kind: "game" },
];

const monthOf = (isoDate: string) => Number(isoDate.slice(5, 7));

/** What is in season on a day (YYYY-MM-DD). */
export function inSeason(isoDate: string): SeasonItem[] {
  const m = monthOf(isoDate);
  return CALENDAR.filter((x) => x.months.includes(m));
}

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fi: ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"],
  sv: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
};

/** "Aug–Mar" / "elo–maalis": the season as a span (or the months listed when it is not one span). */
export function seasonText(item: SeasonItem, lang: Lang): string {
  const ms = item.months;
  const span = ms.every((m, i) => i === 0 || m === (ms[i - 1] % 12) + 1);
  return span ? `${MONTHS[lang][ms[0] - 1]}–${MONTHS[lang][ms[ms.length - 1] - 1]}` : ms.map((m) => MONTHS[lang][m - 1]).join(", ");
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Seasonal items a text names (a dish, an ingredient, a request), in season on the day or not. */
export function seasonalIn(text: string): SeasonItem[] {
  const t = fold(text);
  return CALENDAR.filter((x) => [...Object.values(x.names), ...x.search].some((n) => t.includes(fold(n).replace(/s$/, ""))));
}

/** The buyer's language from their words, for the few words this answers with. */
export function langOf(words: string): Lang {
  if (/[äö]|\b(mitä|onko|sesong|kausi|ensi|viiko|lounas|suunnittele)/i.test(words) && !/\b(vad|nästa|säsong)\b/i.test(words)) return "fi";
  if (/[å]|\b(vad|nästa|säsong|vecka)\b/i.test(words)) return "sv";
  return "en";
}

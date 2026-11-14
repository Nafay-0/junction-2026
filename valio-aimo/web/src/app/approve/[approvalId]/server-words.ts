import { measureL, WEEKDAY_LONG } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { fiMoney, num } from "../../_ui/plain";

/**
 * The sign-off view is written by the server in English (src/server/approval-view.ts). Its amounts, days and times
 * follow fixed patterns, so the phone can say them in Finnish or Swedish: "1,000 L" becomes "1 000 L", "Monday 16
 * November" becomes "maanantai 16.11.". Anything that does not match a known pattern is shown exactly as it came.
 * Numbers and money follow the Finnish conventions in every language (web/docs/LANGUAGE.md), so English gets
 * "1 000 L" and "1,01 €" too; English words are never rewritten.
 */

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_RE = new RegExp(`\\b(${WEEKDAYS_EN.join("|")}),? (\\d{1,2}) (${MONTHS_EN.join("|")})\\b`, "g");
const UNIT: Record<string, string> = { L: "L", kg: "kg", pieces: "pcs" };

const enNumber = (s: string) => Number(s.replaceAll(",", ""));

/** "Monday 16 November" (and "… to …") → "maanantai 16.11." / "måndag 16.11.". */
export function serverDays(text: string, lang: Lang): string {
  if (lang === "en") return text;
  const out = text.replace(DAY_RE, (_m, wd: string, d: string, mo: string) => `${WEEKDAY_LONG[lang][WEEKDAYS_EN.indexOf(wd)]} ${Number(d)}.${MONTHS_EN.indexOf(mo) + 1}.`);
  return out === text ? text : out.replace(/\. to (?=\p{L})/u, ". – ");
}

/** "1,000 L", "12 pieces" → "1 000 L", "12 kpl". */
export function serverAmount(text: string, lang: Lang): string {
  const m = /^([\d,]+(?:\.\d+)?) (L|kg|pieces)$/.exec(text);
  return m ? measureL(enNumber(m[1]), UNIT[m[2]], lang) : text;
}

/** "10 × 1 L at €1.23" → "10 × 1 L à 1,23 €". */
export function serverPacks(text: string, lang: Lang): string {
  const m = /^([\d,]+(?:\.\d+)?) × ([\d,]+(?:\.\d+)?) (L|kg|pieces) at (.+)$/.exec(text);
  return m ? `${num(enNumber(m[1]), 2)} × ${measureL(enNumber(m[2]), UNIT[m[3]], lang)} ${lang === "en" ? "at" : "à"} ${fiMoney(m[4])}` : fiMoney(text);
}

/** "Licence level 2" → "Lupataso 2" / "Licensnivå 2". */
export function serverLicence(text: string, lang: Lang): string {
  if (lang === "en") return text;
  const m = /^Licence level (.+)$/.exec(text);
  return m ? `${lang === "fi" ? "Lupataso" : "Licensnivå"} ${m[1]}` : text;
}

/** The server's default agent name, when the kitchen has not named its agent. */
export function serverAgentName(name: string, lang: Lang): string {
  if (lang === "en" || name !== "Your buyer agent") return name;
  return lang === "fi" ? "Ostoagenttisi" : "Din inköpsagent";
}

const PER: Record<"fi" | "sv", Record<string, string>> = {
  fi: { piece: "kappaleelta", litre: "litralta", kg: "kilolta" },
  sv: { piece: "per styck", litre: "per liter", kg: "per kg" },
};

/**
 * One line of "Not exactly what was asked" (approval-view.ts `differences`), rebuilt in Finnish or Swedish. Product
 * names stay as the catalogue writes them, placed where they need no inflection.
 */
export function serverDifference(text: string, lang: Lang): string {
  if (lang === "en") return fiMoney(text);
  const fi = lang === "fi";
  let m = /^(.+) instead of (.+) \((same price|([\d.]+) % (dearer|cheaper) per (piece|litre|kg))\)$/.exec(text);
  if (m) {
    const pct = m[4] ? num(Number(m[4]), 1, 1) : "";
    const price =
      m[3] === "same price"
        ? fi
          ? "sama hinta"
          : "samma pris"
        : fi
          ? `${pct} % ${m[5] === "dearer" ? "kalliimpi" : "halvempi"} ${PER.fi[m[6]]}`
          : `${pct} % ${m[5] === "dearer" ? "dyrare" : "billigare"} ${PER.sv[m[6]]}`;
    return fi ? `${m[1]} korvaa tuotteen ${m[2]} (${price})` : `${m[1]} ersätter ${m[2]} (${price})`;
  }
  m = /^Split across (\d+) products to reach the amount$/.exec(text);
  if (m) return fi ? `Määrä koottu ${m[1]} eri tuotteesta` : `Uppdelat på ${m[1]} produkter för att nå mängden`;
  m = /^([\d,]+(?:\.\d+)?) (L|kg|pieces) instead of the ([\d,]+(?:\.\d+)?) (L|kg|pieces) asked for$/.exec(text);
  if (m) {
    const got = measureL(enNumber(m[1]), UNIT[m[2]], lang);
    const asked = measureL(enNumber(m[3]), UNIT[m[4]], lang);
    return fi ? `${got}, vaikka pyydettiin ${asked}` : `${got}, fast ${asked} efterfrågades`;
  }
  m = new RegExp(`^(.+) arrives (${DAY_RE.source}), after the (${DAY_RE.source}) you asked for$`).exec(text);
  if (m) {
    const [, product, arrives, , , , asked] = m;
    return fi ? `${product}: toimitus ${serverDays(arrives, lang)}, pyydetty viimeistään ${serverDays(asked, lang)}` : `${product}: leverans ${serverDays(arrives, lang)}, efterfrågat senast ${serverDays(asked, lang)}`;
  }
  return fiMoney(text);
}

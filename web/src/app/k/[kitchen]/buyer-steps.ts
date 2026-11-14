import type { Lang } from "../../_i18n/lang";

/**
 * The steps under a reply are shown open, to the buyer: each one a short plain sentence. The cards' own `steps` (the
 * watch, the offer, the backup, a seasonal menu or a booking) are written for the operations Trace, with ids, ISO times,
 * protocol names and codes; here they are made plain, or left out, and a long list is cut to three and "and N more".
 * The Trace keeps the full detail.
 */

const WD = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], fi: ["su", "ma", "ti", "ke", "to", "pe", "la"], sv: ["sön", "mån", "tis", "ons", "tor", "fre", "lör"] } as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 12 Nov" (en), "to 12.11." (fi), "tor 12.11." (sv). */
export function dayL(iso: string, lang: Lang): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = WD[lang][d.getUTCDay()];
  return lang === "en" ? `${wd} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : `${wd} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** What a buyer must never see in a step: ISO times, ids, codes, protocol names, internal tags. */
export function stepLeaks(text: string): string | undefined {
  const checks: [string, RegExp][] = [
    ["an ISO date or time", /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}[^\s]*)?\b/],
    ["an id", /\b(clm|ord|req|ofr|apr|rch|thr|trn|mc|wr|wf|bk|rp|apv)_[A-Za-z0-9]+/],
    ["a bare product id", /(?<![\d.,:])\b\d{6,}\b(?![.,]\d)/],
    ["a code_name", /\b[a-z]+_[a-z0-9_]+\b/],
    ["a protocol tag", /\b(vc\+jwt|jwt|Ed25519|jwks|JSON|HTTP|API|MCP|STAGED:)\b|\/\.well-known\//i],
    ["a currency code", /\b\d+[.,]?\d*\s?(EUR|eur)\b/],
    ["an internal name", /\b(knowledge map|judge|fit r²|plain code|the gate's|mandate|Dock\b)/i],
  ];
  return checks.find(([, re]) => re.test(text))?.[0];
}

const STAGED = { en: "Staged for the demo.", fi: "Lavastettu demoa varten.", sv: "Iscensatt för demon." } as const;
const MORE = { en: (n: number) => `And ${n} more.`, fi: (n: number) => `Ja ${n} muuta.`, sv: (n: number) => `Och ${n} till.` } as const;

/** One trace line made plain for a buyer, or undefined when nothing plain is left of it. */
export function plainStep(line: string, lang: Lang): string | undefined {
  if (/^STAGED\b/.test(line)) return STAGED[lang];
  const t = line
    // Days and times as people write them.
    .replace(/\b(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, (_m, d: string, h: string, mi: string) => `${dayL(d, lang)} ${h}.${mi}`)
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, d: string) => dayL(d, lang))
    // Money in euros, with a comma.
    .replace(/\b(\d+)[.,](\d{2})\s?EUR(\/(\w+))?/gi, (_m, a: string, b: string, _u, per?: string) => `${a},${b} €${per ? `/${/^k/i.test(per) ? "kg" : per.toLowerCase() === "l" ? "l" : per.toLowerCase()}` : ""}`)
    .replace(/\b(\d+)\s?EUR\b/gi, "$1 €")
    // What only the Trace needs: ids, claims, protocol names, codes in brackets, counts with internal names.
    .replace(/\s*\((?:[^()]*?(?:vc\+jwt|Ed25519|jwt|judge|_)[^()]*?)\)/gi, "")
    .replace(/\s*\(\d+(?:,\s*[a-z ]+)?\)/gi, "")
    .replace(/\b(?:clm|ord|req|ofr|apr|rch|thr|trn|mc|wr|wf|bk|rp|apv)_[A-Za-z0-9]+\b/g, "")
    .replace(/,?\s*checkable against \/\.well-known\/jwks\.json/gi, "")
    .replace(/[®™]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  if (!t || t.length < 4 || stepLeaks(t)) return undefined;
  return t;
}

/** The lines of a card's steps for the buyer: plain, at most three, then "and N more". English sources only. */
export function buyerSteps(lines: string[], lang: Lang, max = 3): string[] {
  const plain = lines.map((l) => plainStep(l, lang)).filter((x): x is string => !!x);
  // Trace lines are written in English: in another language only the staged note is said (the label carries the rest).
  const shown = lang === "en" ? plain : plain.filter((x) => x === STAGED[lang]);
  if (shown.length <= max) return shown;
  return [...shown.slice(0, max), MORE[lang](shown.length - max)];
}

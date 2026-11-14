import type { Lang } from "@/app/_i18n/lang";
import { WEEKDAY_LONG } from "@/app/_i18n/format";
import type { GuideWords } from "@/app/k/[kitchen]/guide.text";
import type { GuideFacts } from "./service";

/**
 * The figures the guide's words are made of, in the buyer's language: this kitchen's own products, amounts, limit and
 * next delivery day (server/demo/service.ts GuideFacts). Pure: used by the guide page and by the conversation's adapter.
 */
const fmt = (n: number, lang: Lang) => new Intl.NumberFormat(lang === "en" ? "en-GB" : lang === "fi" ? "fi-FI" : "sv-FI", { maximumFractionDigits: 1 }).format(n);
const eur = (n: number, lang: Lang) => `${fmt(n, lang)} €`;
const unitWord = (u: string, lang: Lang) => (u === "L" ? { en: "litres", fi: "litraa", sv: "liter" }[lang] : u === "kg" ? "kg" : { en: "packs", fi: "pakkausta", sv: "förpackningar" }[lang]);
export const weekdayOf = (iso: string, lang: Lang) => WEEKDAY_LONG[lang][new Date(`${iso}T12:00:00Z`).getUTCDay()];

export function guideWords(fx: GuideFacts, lang: Lang, staged?: { productName?: string; packs?: number; amount?: number; unit?: string }): GuideWords {
  const poorName = staged?.productName ?? fx.poor?.name;
  const poorPacks = staged?.packs ?? fx.poor?.packs ?? 4;
  const poorAmount = staged?.amount ?? fx.poor?.amount;
  const poorUnit = staged?.unit ?? fx.poor?.unit ?? "pcs";
  return {
    limit: eur(fx.limitEur, lang),
    signer: fx.signer,
    over: { amount: fmt(fx.overAmount.amount, lang), unit: unitWord(fx.overAmount.unit, lang), name: fx.overAmount.name },
    ...(fx.usual ? { usual: { tenTimes: fmt(fx.usual.tenTimes, lang), unit: unitWord(fx.usual.unit, lang), name: fx.usual.name } } : {}),
    ...(fx.weekly ? { weeklyFamily: fx.weekly.name } : {}),
    ...(fx.creeping ? { creepingFamily: fx.creeping.name } : {}),
    ...(poorName ? { poor: { name: poorName, packs: poorPacks, amount: poorUnit !== "pcs" && poorAmount ? `${fmt(poorAmount, lang)} ${unitWord(poorUnit, lang)}` : `${poorPacks} ${unitWord("pcs", lang)}` } } : {}),
    day: weekdayOf(fx.day, lang),
    raiseTo: eur(Math.max(fx.limitEur * 3, fx.limitEur + 500), lang),
  };
}

import generated from "@/server/catalog-categories.json";
import { attrL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { DEPARTMENT_NAME } from "./catalogue.text";
import { familyL } from "./family.text";
import { RULES_SIGNOFF_TEXT } from "./thread-rules-signoff.text";

/**
 * A change to the kitchen's rules that widens what its agent may do, in plain words, from the field-by-field change
 * plain code worked out (server/thread/rules.ts diffOf). The same words on the conversation's slab, on the approver's
 * phone (/approve/rch_...) and in the sentence said when it is decided, so what the approver reads is what is signed.
 * Never a code: product groups by their name in the reader's language, claims and allergens as words.
 */

export type ChangeRow = { field: string; before: string; after: string; widens: boolean };

const DEPARTMENTS = (generated as { departments: Record<string, string> }).departments;
const BY_NAME = new Map(Object.entries(DEPARTMENTS).map(([id, name]) => [name.toLowerCase(), id]));

const split = (s: string) => s.split(", ").map((x) => x.trim()).filter(Boolean);
const added = (d: ChangeRow) => split(d.after).filter((x) => !split(d.before).includes(x));
const removed = (d: ChangeRow) => split(d.before).filter((x) => !split(d.after).includes(x));

/** A product group's name (as the diff carries it, in English) in the reader's language, lower case. */
export function groupNameL(name: string, lang: Lang): string {
  const id = BY_NAME.get(name.toLowerCase());
  const out = lang !== "en" && id ? (DEPARTMENT_NAME[lang][id] ?? name) : name;
  return out.charAt(0).toLowerCase() + out.slice(1);
}

const listL = (xs: string[], lang: Lang) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : lang === "sv" ? "och" : "and"} ${xs.at(-1)}`);

/** The rows the approver signs: what widens, and a new signer. */
export const signedRows = (diff: ChangeRow[]) => diff.filter((d) => d.widens || d.field === "signer");

/** One headline per change, as the approver reads it: "Add frozen to what the agent may buy". */
export function changeLines(diff: ChangeRow[], lang: Lang): string[] {
  const tx = RULES_SIGNOFF_TEXT[lang];
  return signedRows(diff).map((d) => {
    switch (d.field) {
      case "groups":
        return tx.groups(listL(added(d).map((g) => groupNameL(g, lang)), lang));
      case "perOrderLimitEur":
        return tx.limit(`${d.after} €`);
      case "weeklyBudgetEur":
        return tx.budget(`${d.after} €`);
      case "forbiddenAllergens":
        return tx.unforbid(listL(removed(d).map((x) => attrL(x, lang)), lang));
      case "requiredAttributes":
        return tx.unrequire(listL(removed(d).map((x) => attrL(x, lang)), lang));
      case "maxLeadDays":
        return tx.lead(d.after);
      case "substitution":
        return tx.substitution;
      case "autoRenew":
        return tx.autoRenew(listL(added(d).map((x) => familyL(x, lang).toLowerCase()), lang));
      default:
        return tx.signer(d.after);
    }
  });
}

/** What was before, for the phone's detail: "Now: up to 300 € an order". Undefined when it says nothing useful. */
export function changeBefore(d: ChangeRow, lang: Lang): string | undefined {
  const now = { en: "Now", fi: "Nyt", sv: "Nu" }[lang];
  if (d.field === "perOrderLimitEur") return `${now}: ${d.before} €`;
  if (d.field === "weeklyBudgetEur") return `${now}: ${d.before} €`;
  if (d.field === "maxLeadDays") return `${now}: ${d.before}`;
  if (d.field === "signer") return `${now}: ${d.before}`;
  if (d.field === "groups") return `${now}: ${listL(split(d.before).map((g) => groupNameL(g, lang)), lang)}`;
  if (d.field === "autoRenew") return { en: "Now: it reminds you before each order", fi: "Nyt: agentti muistuttaa ennen jokaista tilausta", sv: "Nu: agenten påminner före varje order" }[lang];
  return undefined;
}

/** The change as a clause after it is signed: "I may now buy frozen". */
export function changeClauses(diff: ChangeRow[], lang: Lang): string {
  const c = (d: ChangeRow): string => {
    switch (d.field) {
      case "groups": {
        const g = listL(added(d).map((x) => groupNameL(x, lang)), lang);
        return { en: `I may now buy ${g}`, fi: `saan nyt ostaa myös: ${g}`, sv: `jag får nu köpa ${g}` }[lang];
      }
      case "perOrderLimitEur":
        return { en: `I may now spend up to ${d.after} € an order alone`, fi: `saan nyt tilata yksin enintään ${d.after} € kerralla`, sv: `jag får nu beställa upp till ${d.after} € per order själv` }[lang];
      case "weeklyBudgetEur":
        return { en: `the weekly budget is now ${d.after} €`, fi: `viikkobudjetti on nyt ${d.after} €`, sv: `veckobudgeten är nu ${d.after} €` }[lang];
      case "forbiddenAllergens": {
        const x = listL(removed(d).map((a) => attrL(a, lang)), lang);
        return { en: `${x} is no longer ruled out`, fi: `kielto poistui: ${x}`, sv: `${x} är inte längre uteslutet` }[lang];
      }
      case "requiredAttributes": {
        const x = listL(removed(d).map((a) => attrL(a, lang)), lang);
        return { en: `${x} is no longer required`, fi: `vaatimus poistui: ${x}`, sv: `${x} krävs inte längre` }[lang];
      }
      case "maxLeadDays":
        return { en: `I may now order up to ${d.after} days ahead`, fi: `saan nyt tilata ${d.after} päivää etukäteen`, sv: `jag får nu beställa ${d.after} dagar i förväg` }[lang];
      case "substitution":
        return { en: "I may now choose substitutes on my own", fi: "saan nyt valita korvaavat tuotteet itse", sv: "jag får nu välja ersättare själv" }[lang];
      case "autoRenew": {
        const x = listL(added(d).map((f) => familyL(f, lang).toLowerCase()), lang);
        return { en: `I'll now renew the ${x} by myself before each cut-off, and ask first if anything has changed`, fi: `uusin nyt itse ennen jokaista tilausaikaa: ${x}; jos jokin on muuttunut, kysyn ensin`, sv: `jag förnyar nu ${x} själv före varje sista beställningstid och frågar först om något har ändrats` }[lang];
      }
      default:
        return { en: `${d.after} now gives the OK`, fi: `hyväksyjä on nyt ${d.after}`, sv: `${d.after} godkänner nu` }[lang];
    }
  };
  return signedRows(diff).map(c).join("; ");
}

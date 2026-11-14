import { categoryCodesFor } from "@/core/catalog/partner";
import type { DockError } from "@/core/errors";
import type { IntakeView } from "@/core/intake";
import { attrL, dayL } from "@/app/_i18n/format";
import { DEPARTMENT_NAME } from "@/app/k/[kitchen]/catalogue.text";
import generated from "../catalog-categories.json";
import type { TurnRun } from "./pipeline";

/**
 * Every "no" the conversation can say, in one place and in words: a refusal is a code with parameters (never a
 * sentence from a lower layer), worded here in the first person, in the buyer's language, with the next step when
 * there is one. No category code, product id, rule id or snake_case token reaches a sentence (codeLeaks checks).
 */

export type Lang = "en" | "fi" | "sv";

export type Refusal =
  | { code: "out_of_mandate"; what: string; group?: string; groups: string[]; signer?: string }
  | { code: "not_sold"; what: string }
  | { code: "cutoff_passed"; what: string; day?: string; earliest?: string }
  | { code: "forbidden_allergen"; what: string; allergens: string[] }
  | { code: "nutrition_rule"; what: string; detail?: string }
  | { code: "out_of_stock"; what: string; day?: string }
  | { code: "over_budget"; leftCents?: number; signer?: string }
  | { code: "over_limit"; limitCents?: number; signer?: string }
  | { code: "suspended" }
  | { code: "mandate_ended" }
  | { code: "licence"; signer?: string }
  | { code: "recall"; what: string }
  | { code: "nothing_fits"; what: string };

const DATA = generated as { departments: Record<string, string>; categories: Record<string, { label: string }> };

/** A product family's group (department) in words: "dairy and cheese", "maito- ja juustotuotteet". */
export function groupOf(category: string, lang: Lang): string | undefined {
  const code = categoryCodesFor(category)[0];
  const dept = code?.slice(0, 2);
  if (!dept || !DATA.departments[dept]) return undefined;
  const name = lang === "en" ? DATA.departments[dept] : (DEPARTMENT_NAME[lang][dept] ?? DATA.departments[dept]);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** The kitchen's allowed groups in words, the ones it has most categories in first, at most three. */
export function groupsOf(categories: string[], lang: Lang): string[] {
  const n = new Map<string, number>();
  for (const c of categories) {
    const g = groupOf(c, lang);
    if (g) n.set(g, (n.get(g) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 3);
}

const list = (xs: string[], lang: Lang) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : lang === "sv" ? "och" : "and"} ${xs.at(-1)}`);
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/** An English day as people write it: "Monday 16 Nov"; Finnish and Swedish keep "ma 16.11.". */
export function dayWords(iso: string, lang: Lang): string {
  if (lang !== "en") return dayL(iso, lang);
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${d.getUTCDate()} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/** The refusal in words, first person, with the next step when there is one. */
export function sayRefusal(r: Refusal, lang: Lang): string {
  const fi = lang === "fi";
  const sv = lang === "sv";
  const who = (s?: string) => s || (fi ? "Sääntöjenne hyväksyjä" : sv ? "Den som godkänner era regler" : "Whoever confirms your rules");
  switch (r.code) {
    case "out_of_mandate": {
      const not = r.group ? (fi ? `, eivät ryhmää ${r.group}` : sv ? `, inte ${r.group}` : `, not ${r.group}`) : "";
      const add = r.group ?? (fi ? "sen" : sv ? "den" : "it");
      if (fi) return `En voi ostaa tuotetta ${r.what} tälle keittiölle: sen säännöt kattavat ${list(r.groups, lang)}${not}. ${who(r.signer)} voi lisätä ryhmän ${add} kohdassa Sääntösi; kysynkö häneltä?`;
      if (sv) return `Jag kan inte köpa ${r.what} åt det här köket: dess regler omfattar ${list(r.groups, lang)}${not}. ${who(r.signer)} kan lägga till ${add} under Dina regler; ska jag fråga?`;
      return `I can't buy ${r.what} for this kitchen: its rules cover ${list(r.groups, lang)}${not}. ${who(r.signer)} can add ${add} under Your rules; shall I ask them?`;
    }
    case "not_sold":
      if (fi) return `En löydä tuotetta ${r.what} tukun valikoimasta. Onko sille toinen nimi tai merkki?`;
      if (sv) return `Jag hittar inte ${r.what} i grossistens sortiment. Finns det ett annat namn eller märke?`;
      return `I can't find ${r.what} in the wholesaler's assortment. Is there another name for it, or a brand?`;
    case "cutoff_passed": {
      const day = r.day ? dayWords(r.day, lang) : "";
      const earliest = r.earliest ? dayWords(r.earliest, lang) : "";
      if (fi) return `${cap(r.what)} ei ehdi${day ? ` ${day}` : ""}: tilausaika on mennyt.${earliest ? ` Aikaisintaan ${earliest}; tilaanko silloin?` : " Katsonko toisen päivän?"}`;
      if (sv) return `${cap(r.what)} hinner inte fram${day ? ` ${day}` : ""}: beställningstiden har gått ut.${earliest ? ` Tidigast ${earliest}; ska jag beställa till dess?` : " Ska jag titta på en annan dag?"}`;
      return `${cap(r.what)} can't arrive${day ? ` by ${day}` : ""}: the order time has passed.${earliest ? ` The earliest is ${earliest}; shall I order it for then?` : " Shall I look at another day?"}`;
    }
    case "forbidden_allergen": {
      const a = list(r.allergens.map((x) => attrL(x, lang)), lang);
      if (fi) return `Kaikissa löytämissäni tuotteissa (${r.what}) on ${a}, jotka sääntönne kieltävät. Etsinkö jotain ilman niitä?`;
      if (sv) return `Allt jag hittade (${r.what}) innehåller ${a}, som era regler utesluter. Ska jag leta efter något utan?`;
      return `Everything I found for ${r.what} contains ${a}, which your rules rule out. Shall I look for something without it?`;
    }
    case "nutrition_rule":
      if (fi) return `${cap(r.what)} ei täytä ravintosääntöänne${r.detail ? `: ${r.detail}` : ""}. Etsinkö sääntöjen mukaisen vaihtoehdon?`;
      if (sv) return `${cap(r.what)} uppfyller inte er näringsregel${r.detail ? `: ${r.detail}` : ""}. Ska jag leta efter något som gör det?`;
      return `${cap(r.what)} doesn't keep your nutrition rule${r.detail ? `: ${r.detail}` : ""}. Shall I look for one that does?`;
    case "out_of_stock": {
      const day = r.day ? dayWords(r.day, lang) : "";
      if (fi) return `Tuotetta ${r.what} ei ole tarpeeksi varastossa${day ? ` ${day}` : ""}. Katsonko toisen päivän tai korvaavan tuotteen?`;
      if (sv) return `Det finns inte tillräckligt av ${r.what} i lager${day ? ` ${day}` : ""}. Ska jag titta på en annan dag eller en ersättare?`;
      return `There isn't enough ${r.what} in stock${day ? ` for ${day}` : ""}. Shall I look at another day, or a stand-in?`;
    }
    case "over_budget": {
      const left = r.leftCents !== undefined ? eur(r.leftCents) : "";
      if (fi) return `Tämä ylittäisi viikkobudjettinne${left ? `: jäljellä on ${left}` : ""}. ${who(r.signer)} voi nostaa budjettia kohdassa Sääntösi.`;
      if (sv) return `Det här skulle gå över veckobudgeten${left ? `: ${left} återstår` : ""}. ${who(r.signer)} kan höja den under Dina regler.`;
      return `This would go over your weekly budget${left ? `: ${left} is left this week` : ""}. ${who(r.signer)} can raise it under Your rules.`;
    }
    case "over_limit": {
      const lim = r.limitCents !== undefined ? eur(r.limitCents) : "";
      if (fi) return `Tämä ylittää ${lim ? `${lim} rajan` : "rajan"}, jonka voin käyttää yksin, joten ${r.signer ?? "vastuuhenkilö"} hyväksyy sen.`;
      if (sv) return `Det här är över ${lim ? `gränsen på ${lim}` : "gränsen"} jag får handla för själv, så ${r.signer ?? "en ansvarig"} godkänner det.`;
      return `It's over the ${lim ? `${lim} ` : ""}limit I may spend alone, so ${r.signer ? `${r.signer}'s` : "a person's"} OK is needed.`;
    }
    case "suspended":
      if (fi) return "Tukun henkilökunta on keskeyttänyt minut tämän keittiön osalta, joten en voi tilata nyt. Keittiönne yhteyshenkilö tukussa voi palauttaa minut.";
      if (sv) return "Grossistens personal har pausat mig för det här köket, så jag kan inte beställa nu. Er kontakt hos grossisten kan häva det.";
      return "The wholesaler's staff have paused me for this kitchen, so I can't order anything now. Your contact at the wholesaler can lift it.";
    case "mandate_ended":
      if (fi) return "Sääntönne eivät ole enää voimassa, joten en voi tilata. Ne voi uusia kohdassa Sääntösi.";
      if (sv) return "Era regler gäller inte längre, så jag kan inte beställa. De kan förnyas under Dina regler.";
      return "Your rules are no longer in force, so I can't order. They can be renewed under Your rules.";
    case "licence":
      if (fi) return `Lupani eivät riitä tämän tilaamiseen yksin, joten ${r.signer ?? "vastuuhenkilö"} hyväksyy sen.`;
      if (sv) return `Min licens räcker inte för att beställa det här själv, så ${r.signer ?? "en ansvarig"} godkänner det.`;
      return `My licence doesn't cover ordering this alone, so ${r.signer ? `${r.signer}'s` : "a person's"} OK is needed.`;
    case "recall":
      if (fi) return `${cap(r.what)} on pysäytetty takaisinvedon vuoksi, joten en tilaa sitä. Etsinkö korvaavan?`;
      if (sv) return `${cap(r.what)} är stoppad på grund av en återkallelse, så jag beställer den inte. Ska jag leta efter en ersättare?`;
      return `${cap(r.what)} is held under a recall notice, so I won't order it. Shall I look for a stand-in?`;
    case "nothing_fits":
      if (fi) return `Mikään valikoiman tuote (${r.what}) ei sovi sääntöihinne tälle päivälle. Katsonko toisen päivän tai väljemmän vaihtoehdon?`;
      if (sv) return `Inget i sortimentet (${r.what}) passar era regler för den dagen. Ska jag titta på en annan dag, eller något mindre strikt?`;
      return `Nothing in the assortment for ${r.what} fits your rules for that day. Shall I look at another day, or loosen something?`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Who confirms the kitchen's rules, by name when the mandate names one. */
function signerOf(run: TurnRun): string | undefined {
  return run.session.mandate.approvers?.[0]?.name;
}

/** Why an intake step found nothing, as a refusal (from its own codes, not its sentences). */
export function refusalOfStep(run: TurnRun, step: IntakeView, lang: Lang): Refusal {
  const what = (step.need?.item?.text ?? "").trim() || (lang === "fi" ? "tätä" : lang === "sv" ? "det här" : "this");
  const m = run.session.mandate;
  if (step.family && !m.allowedCategories.includes(step.family) && !/nothing called/i.test(step.notes.join(" "))) {
    return { code: "out_of_mandate", what, ...(groupOf(step.family, lang) ? { group: groupOf(step.family, lang) } : {}), groups: groupsOf(m.allowedCategories, lang), ...(signerOf(run) ? { signer: signerOf(run) } : {}) };
  }
  if (/nothing called|found nothing called/i.test(step.notes.join(" "))) return { code: "not_sold", what };
  const codes = new Map<string, number>();
  for (const e of step.excluded) if (e.code && e.code !== "compromise") codes.set(e.code, (codes.get(e.code) ?? 0) + 1);
  const top = [...codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const day = step.need?.deliverBy;
  if (top === "cutoff_passed" || top === "too_late") return { code: "cutoff_passed", what, ...(day ? { day } : {}) };
  if (top === "out_of_stock") return { code: "out_of_stock", what, ...(day ? { day } : {}) };
  if (top === "over_budget") return { code: "over_budget", ...(signerOf(run) ? { signer: signerOf(run) } : {}) };
  if (top === "nutrition_rule") {
    const e = step.excluded.find((x) => x.code === "nutrition_rule");
    return { code: "nutrition_rule", what, ...(e ? { detail: plainDetail(e.reason) } : {}) };
  }
  const allergens = step.excluded.flatMap((e) => /contains ([a-z_, ]+)/i.exec(e.reason)?.[1]?.split(/,\s*/) ?? []).filter((a) => m.forbiddenAllergens.includes(a.trim()));
  if (allergens.length) return { code: "forbidden_allergen", what, allergens: [...new Set(allergens.map((a) => a.trim()))].slice(0, 3) };
  return { code: "nothing_fits", what };
}

/** A gate rule that refused or stopped an order, as a refusal. */
export function refusalOfRule(run: TurnRun, rule: string | undefined, what: string, details?: Record<string, unknown>, lang: Lang = "en"): Refusal {
  const signer = signerOf(run);
  switch (rule) {
    case "category_allowed":
      return { code: "out_of_mandate", what, groups: groupsOf(run.session.mandate.allowedCategories, lang), ...(signer ? { signer } : {}) };
    case "forbidden_allergens":
      return { code: "forbidden_allergen", what, allergens: run.session.mandate.forbiddenAllergens.slice(0, 3) };
    case "nutrition_rules":
      return { code: "nutrition_rule", what };
    case "recall_hold":
      return { code: "recall", what };
    case "delivery_deadline":
      return { code: "cutoff_passed", what };
    case "weekly_budget":
      return { code: "over_budget", ...(signer ? { signer } : {}) };
    case "per_order_limit":
      return { code: "over_limit", ...(typeof details?.limitCents === "number" ? { limitCents: details.limitCents } : {}), ...(signer ? { signer } : {}) };
    case "mandate_window":
      return { code: "mandate_ended" };
    case "operator_suspension":
      return { code: "suspended" };
    default:
      return { code: "nothing_fits", what };
  }
}

/** A refusal from an error the engine caught (a suspended agent, an ended mandate), if it is one. */
export function refusalOfError(err: DockError): Refusal | undefined {
  if (/suspend/i.test(err.code) || err.rule === "operator_suspension") return { code: "suspended" };
  if (/mandate_(expired|ended|replaced|window)/.test(err.code) || err.rule === "mandate_window") return { code: "mandate_ended" };
  return undefined;
}

/** A lower layer's sentence made fit to say: product codes and ids out, snake_case words as words. */
function plainDetail(reason: string): string {
  return reason
    .replace(/\s*\((?:[A-Z]{2}-)?\d{4,}\)/g, "")
    .replace(/\b\d{6}\b:?\s*/g, "")
    .replace(/\b([a-z]+)_([a-z_]+)\b/g, (m) => m.replaceAll("_", " "))
    .split(/(?<=[.!?])\s+/)[0]!
    .slice(0, 160);
}

/**
 * Codes that must never reach a sentence the buyer reads: a category code ("cat 10418"), a product id (six digits,
 * or "VA-1010"), an internal id (req_…, ord_…), a rule or reason code, any snake_case token.
 */
export function codeLeaks(text: string): string[] {
  const out: string[] = [];
  const add = (re: RegExp) => {
    for (const m of text.matchAll(re)) out.push(m[0]);
  };
  add(/\bcat[ _]\d{3,}\b/gi);
  add(/\b(req|ord|opt|apr|mnd|trn|sh|pln|off|rq)_[0-9a-z]{4,}\b/gi);
  add(/\b[A-Z]{2}-\d{3,}\b/g);
  add(/(?<![\d.,])\b\d{6}\b(?![.,]\d)/g);
  add(/\b[a-z]+_[a-z_]+\b/g);
  return [...new Set(out)];
}

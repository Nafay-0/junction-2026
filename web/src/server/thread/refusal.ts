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
  | { code: "out_of_mandate"; what: string; group?: string; groups: string[]; signer?: string; draft?: boolean }
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
  | { code: "no_such_kind"; what: string }
  | { code: "claim_missing"; what: string; claims: string[]; products?: string[] }
  | { code: "nothing_fits"; what: string; detail?: string; noOffer?: boolean; /** The reason is about the day asked (stock, a cut-off, too late): another day may have it. */ day?: boolean };

const DATA = generated as { departments: Record<string, string>; categories: Record<string, { label: string }> };

/** A product family's group (department) in words: "dairy and cheese", "maito- ja juustotuotteet". */
export function groupOf(category: string, lang: Lang): string | undefined {
  const code = categoryCodesFor(category)[0];
  const dept = code?.slice(0, 2);
  if (!dept || !DATA.departments[dept]) return undefined;
  const name = lang === "en" ? DATA.departments[dept] : (DEPARTMENT_NAME[lang][dept] ?? DATA.departments[dept]);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** A product family's group id (the department number the kitchen's terms list), when it is one. */
export function groupIdOf(category: string): string | undefined {
  const dept = categoryCodesFor(category)[0]?.slice(0, 2);
  return dept && DATA.departments[dept] ? dept : undefined;
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
      // Only offered when it can be done here (an account's own session signs its new terms): never a promise it cannot keep.
      const next = r.draft
        ? fi ? `Laadinko muutoksen (${add} sääntöihin) ${r.signer ? `${r.signer} vahvistettavaksi` : "vahvistettavaksi"}?` : sv ? `Ska jag skriva ändringen (${add} i reglerna) så att ${r.signer ?? "ni"} kan bekräfta den?` : `Shall I draft that change (${add} added to your rules) for ${r.signer ?? "you"} to confirm?`
        : fi ? `${who(r.signer)} voi lisätä ryhmän ${add} kohdassa Sääntösi.` : sv ? `${who(r.signer)} kan lägga till ${add} under Dina regler.` : `${who(r.signer)} can add ${add} under Your rules.`;
      if (fi) return `En voi ostaa tuotetta ${r.what} tälle keittiölle: sen säännöt kattavat ${list(r.groups, lang)}${not}. ${next}`;
      if (sv) return `Jag kan inte köpa ${r.what} åt det här köket: dess regler omfattar ${list(r.groups, lang)}${not}. ${next}`;
      return `I can't buy ${r.what} for this kitchen: its rules cover ${list(r.groups, lang)}${not}. ${next}`;
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
    case "claim_missing": {
      const c = list(r.claims.map((x) => attrL(x, lang)), lang);
      const which = r.products?.length ? list(r.products, lang) : r.what;
      if (fi) return `En voi tilata tätä: ${which} ei ole todistetusti ${c}, ja sääntönne vaativat sen. Vaihdanko sen tuotteeseen, joka on?`;
      if (sv) return `Jag kan inte beställa det: ${which} är inte visat ${c}, och era regler kräver det. Ska jag byta till en som är det?`;
      return `I can't order this: ${which} isn't shown to be ${c}, and your rules require it. Shall I swap it for one that is?`;
    }
    case "no_such_kind":
      if (fi) return `Valikoimassa ei ole juuri tätä (${r.what}) sille päivälle; löytämäni ovat muita lajeja. Näytänkö lähimmät?`;
      if (sv) return `Sortimentet har inte just ${r.what} för den dagen; det jag hittade är andra sorter. Ska jag visa de närmaste?`;
      return `I couldn't find ${r.what} as such for that day; what the assortment has are other kinds. Shall I show the closest?`;
    case "nothing_fits":
      // Never "another day" without why: the wholesaler not offering it now, or the first reason the products were left.
      if (r.noOffer) {
        if (fi) return `Tukku ei tarjoa nyt tuotetta ${r.what}. Etsinkö toisen tuotteen?`;
        if (sv) return `Grossisten erbjuder inte ${r.what} just nu. Ska jag leta efter en annan produkt?`;
        return `The wholesaler isn't offering ${r.what} right now. Shall I look for another product?`;
      }
      // "Another day" only when the reason is the day: an offer the agent makes is one a yes carries out (engine.ts
      // anotherDay); a reason of another kind ends on a question the buyer answers in their own words.
      if (!r.day) {
        if (fi) return `En löytänyt tuotetta ${r.what}, jonka voisin tilata${r.detail ? `: ${r.detail.replace(/\.$/, "")}` : ""}. Kelpaako jokin muu tuote?`;
        if (sv) return `Jag hittade inget ${r.what} som jag kan beställa${r.detail ? `: ${r.detail.replace(/\.$/, "")}` : ""}. Duger en annan produkt?`;
        return `I couldn't find ${r.what} that I can order${r.detail ? `: ${r.detail.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}. Would another product do?`;
      }
      if (fi) return `En löytänyt tuotetta ${r.what}, jonka voisin tilata sille päivälle${r.detail ? `: ${r.detail.replace(/\.$/, "")}` : ""}. Katsonko toisen päivän?`;
      if (sv) return `Jag hittade inget ${r.what} som kan beställas för den dagen${r.detail ? `: ${r.detail.replace(/\.$/, "")}` : ""}. Ska jag titta på en annan dag?`;
      return `I couldn't find ${r.what} that can be ordered for that day${r.detail ? `: ${r.detail.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}. Shall I look at another day?`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether a change to the kitchen's terms can be drafted and confirmed here (an account's own signed-in session). */
export function canDraft(run: TurnRun): boolean {
  const kind = run.k.info.kind;
  const p = run.person;
  return kind === "account" && !!p && !p.callOnly && (!p.account || p.account === run.k.info.slug);
}

/** Who confirms the kitchen's rules, by name when the mandate names one. */
function signerOf(run: TurnRun): string | undefined {
  return run.session.mandate.approvers?.[0]?.name;
}

/** Why an intake step found nothing, as a refusal (from its own codes, not its sentences). */
export function refusalOfStep(run: TurnRun, step: IntakeView, lang: Lang): Refusal {
  const what = (step.need?.item?.text ?? "").trim() || (lang === "fi" ? "tätä" : lang === "sv" ? "det här" : "this");
  const m = run.session.mandate;
  if (step.family && !m.allowedCategories.includes(step.family) && !/nothing called/i.test(step.notes.join(" "))) {
    return { code: "out_of_mandate", what, ...(groupOf(step.family, lang) ? { group: groupOf(step.family, lang) } : {}), groups: groupsOf(m.allowedCategories, lang), ...(signerOf(run) ? { signer: signerOf(run) } : {}), ...(canDraft(run) && groupIdOf(step.family) ? { draft: true } : {}) };
  }
  if (/nothing called|found nothing called/i.test(step.notes.join(" "))) return { code: "not_sold", what };
  const codes = new Map<string, number>();
  for (const e of step.excluded) if (e.code && e.code !== "compromise") codes.set(e.code, (codes.get(e.code) ?? 0) + 1);
  const top = [...codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const day = step.need?.deliverBy;
  // Another day was already looked at (the buyer's yes to that offer): never offered a second time.
  if (run.anotherDayFor && (top === "cutoff_passed" || top === "too_late" || top === "out_of_stock" || top === "no_substitute"))
    return { code: "nothing_fits", what, detail: { en: `nothing can come in the week after the day you asked for either${day ? `, up to ${dayWords(day, lang)}` : ""}`, fi: `mikään ei ehdi myöskään pyytämääsi päivää seuraavalla viikolla${day ? ` (${dayWords(day, lang)} mennessä)` : ""}`, sv: `inget kan komma veckan efter den dag du bad om heller${day ? ` (senast ${dayWords(day, lang)})` : ""}` }[lang] };
  if (top === "cutoff_passed" || top === "too_late") return { code: "cutoff_passed", what, ...(day ? { day } : {}) };
  if (top === "out_of_stock") return { code: "out_of_stock", what, ...(day ? { day } : {}) };
  if (top === "over_budget") return { code: "over_budget", ...(signerOf(run) ? { signer: signerOf(run) } : {}) };
  if (top === "nutrition_rule") {
    const e = step.excluded.find((x) => x.code === "nutrition_rule") as { reason: string; params?: Record<string, string | number> } | undefined;
    return { code: "nutrition_rule", what, ...(e ? { detail: nutritionDetail(e.params, lang) ?? plainDetail(e.reason) } : {}) };
  }
  // Most of what was looked at is another kind of product: say that, never "your rules" (it is not a rule).
  const kinds = step.excluded.filter((e) => /different kind of product/i.test(e.reason)).length;
  if (kinds > 0 && kinds >= step.excluded.length / 2) return { code: "no_such_kind", what };
  const allergens = step.excluded.flatMap((e) => /contains ([a-z_, ]+)/i.exec(e.reason)?.[1]?.split(/,\s*/) ?? []).filter((a) => m.forbiddenAllergens.includes(a.trim()));
  if (allergens.length) return { code: "forbidden_allergen", what, allergens: [...new Set(allergens.map((a) => a.trim()))].slice(0, 3) };
  if (top === "no_offer") return { code: "nothing_fits", what, noOffer: true };
  const first = step.excluded.find((e) => e.code && e.code !== "compromise") ?? step.excluded[0];
  const byDay = !!first?.code && ["cutoff_passed", "too_late", "out_of_stock", "no_substitute"].includes(first.code);
  // The reason is the store's own English words: said in English only (Finnish and Swedish keep the plain sentence).
  return { code: "nothing_fits", what, ...(byDay ? { day: true } : {}), ...(first && lang === "en" ? { detail: plainDetail(first.reason) } : {}) };
}

/** A gate rule that refused or stopped an order, as a refusal. */
export function refusalOfRule(run: TurnRun, rule: string | undefined, what: string, details?: Record<string, unknown>, lang: Lang = "en"): Refusal {
  const signer = signerOf(run);
  switch (rule) {
    case "category_allowed":
      return { code: "out_of_mandate", what, groups: groupsOf(run.session.mandate.allowedCategories, lang), ...(signer ? { signer } : {}) };
    case "required_attributes": {
      const missing = (details?.missing as string[] | undefined) ?? run.session.mandate.requiredAttributes;
      const products = ((details?.products as { name?: string }[] | undefined) ?? []).map((p) => String(p.name ?? "")).filter(Boolean).slice(0, 2);
      return { code: "claim_missing", what, claims: missing.slice(0, 2), ...(products.length ? { products } : {}) };
    }
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

/** "the cherry yoghurt has 13 g sugar per 100 g; your rule is at most 12 g", from the finding's own figures. */
export function nutritionDetail(p: Record<string, string | number> | undefined, lang: Lang): string | undefined {
  if (!p?.nutrient) return undefined;
  const NUT: Record<string, Record<Lang, string>> = { sugar: { en: "sugar", fi: "sokeria", sv: "socker" }, salt: { en: "salt", fi: "suolaa", sv: "salt" }, protein: { en: "protein", fi: "proteiinia", sv: "protein" }, fibre: { en: "fibre", fi: "kuitua", sv: "fiber" }, fat: { en: "fat", fi: "rasvaa", sv: "fett" }, saturated_fat: { en: "saturated fat", fi: "tyydyttynyttä rasvaa", sv: "mättat fett" } };
  const n = NUT[String(p.nutrient)]?.[lang] ?? String(p.nutrient).replaceAll("_", " ");
  const per = String(p.per ?? "100g").replace(/^100/, "100 ");
  const product = p.product ? String(p.product).replace(/[®™]/g, "").split(/\s+/).filter((w) => !/\d/.test(w) && !/^(kg|g|l|ml|dl|cl|x)$/i.test(w)).slice(0, 4).join(" ") : "";
  const bound = p.max !== undefined ? { en: `at most ${p.max} g`, fi: `enintään ${p.max} g`, sv: `högst ${p.max} g` }[lang] : p.min !== undefined ? { en: `at least ${p.min} g`, fi: `vähintään ${p.min} g`, sv: `minst ${p.min} g` }[lang] : "";
  if (p.problem === "unknown") return { en: `${product} does not declare its ${n}, and your rule asks for ${bound} per ${per}`, fi: `${product} ei ilmoita ${n}, ja sääntönne vaatii ${bound} / ${per}`, sv: `${product} anger inte ${n}, och er regel kräver ${bound} per ${per}` }[lang];
  const v = p.value !== undefined ? `${String(p.value).replace(".", lang === "en" ? "." : ",")} g` : "";
  return { en: `${product} has ${v} ${n} per ${per}; your rule is ${bound}`, fi: `${product}: ${v} ${n} / ${per}; sääntönne on ${bound}`, sv: `${product} har ${v} ${n} per ${per}; er regel är ${bound}` }[lang];
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

/** Text from a lower layer made to read as people write: English days as "Tue 17 Nov", catalogue capitals in case. */
export function readable(text: string, lang: Lang): string {
  const KEEP = new Set(["VAT", "ALV", "MOMS", "UHT", "ESL", "EUR", "MSC", "ASC", "CO2", "OK", "EU", "NL", "FI", "SE", "DE", "PL"]);
  let t = text.replace(/\b([A-ZÄÖÅ]{3,}(?:[ -][A-ZÄÖÅ0-9]{2,})*)\b/g, (m) => {
    const parts = m.split(/([ -])/);
    if (!parts.some((w) => w.length >= 5 && !KEEP.has(w))) return m;
    return parts.map((w, i) => (KEEP.has(w) || /^[A-ZÄÖÅ]{2}$/.test(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
  });
  if (lang === "en") t = englishDays(t);
  return t.replace(/(\d{1,2}\.\d{1,2}\.)\./g, "$1").replace(/(\d{1,2}\.\d{1,2})\.(?=[?;:,!])/g, "$1");
}

const TELL = /\b(send|type|write|re-?send|give me|tell me)\b[^.?!]{0,60}\b(product name|the name and|with the amount|order with|the exact|again as|as its own message|request again)\b|\b(kirjoita|lähetä)\b[^.?!]{0,40}\b(tuotteen nimi|määrä)/i;
const INSIDE = /\b(the store treated|treated your message|neither result|the results? (gave|give|show|showed|didn't|don't|did not|do not)|the store's results|tool results?|my tools|none of my tools|the engine|the reader|the intake|routing|(the )?menu planner|the planner|a step did not finish|didn't (connect|link)|did not (connect|link)|the (system|backend|server|database)|ruokalistasuunnittelija|suunnittelija ei)\b/i;

/** A sentence that tells the buyer what to type, or says how the system works inside: never shown. */
export function insideOrTell(sentence: string): boolean {
  return TELL.test(sentence) || INSIDE.test(sentence);
}

/**
 * English days as people write them: "Tue 17.11." becomes "Tue 17 Nov". The date's own dot often also ends the
 * sentence ("... arrives Monday 16.11." or "16.11. Shall I"): then the sentence keeps a full stop.
 */
export function englishDays(text: string): string {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return text.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)( |\u00a0)(\d{1,2})\.(\d{1,2})(\.?)/g, (m: string, w: string, sp: string, d: string, mo: string, dot: string, offset: number, all: string) => {
    if (!(Number(mo) >= 1 && Number(mo) <= 12 && Number(d) <= 31)) return m;
    const rest = all.slice(offset + m.length);
    const mark = /^(\}\}|\*\*)/.exec(rest)?.[0] ?? "";
    const after = rest.slice(mark.length);
    const ends = dot === "." && (/^\s*$/.test(after) || /^\s+[\p{Lu}"“]/u.test(after));
    return `${w}${sp}${Number(d)} ${MON[Number(mo) - 1]}${ends && !mark ? "." : ""}${ends && mark ? "" : ""}`;
  }).replace(/(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))(\}\}|\*\*)(?=\s+[\p{Lu}"“]|\s*$)/gu, "$1$2.");
}

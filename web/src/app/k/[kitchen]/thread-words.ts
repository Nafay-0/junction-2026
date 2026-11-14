import { attrL, dayL, measureL, roleLabelL, ruleTitleL, weekdayL, weekdaysL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { clock, money, num } from "../../_ui/plain";
import type { AnomalyCard, MemoryLine, OptionView, OptionsCard, ThreadStep } from "@/server/thread/types";
import type { Fmt, ThreadWords } from "./thread-words.text";

/**
 * What the thread's cards say, decided by plain code from the engine's codes and parameters: which option leads,
 * the one thing each other option differs in, which reasons every option shares (said once), why products were left
 * out, and every sentence in the buyer's language (thread-words.text.ts). Pure functions, tested in
 * thread-words.test.ts. The engine's English sentence is used only for a code this file does not know, and only in
 * English: in Finnish or Swedish an unknown line is left out rather than shown in English.
 */

export function fmtFor(lang: Lang): Fmt {
  return {
    money,
    day: (iso) => dayL(iso.slice(0, 10), lang),
    weekday: (iso) => weekdayL(iso.slice(0, 10), lang),
    weekdays: (days) => weekdaysL(days, lang),
    measure: (n, unit) => measureL(n, unit, lang),
    num: (n) => num(n, 2),
    pct: (x) => `${num(Math.round(x * 100), 0)} %`,
    clock: (iso) => clock(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")),
    attr: (a) => attrL(a, lang),
    role: (r) => roleLabelL(r, lang),
    rule: (r) => ruleTitleL(r, lang),
  };
}

type Reason = OptionView["reasons"][number];

const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function reasonText(r: Reason, w: ThreadWords, f: Fmt): string | undefined {
  const say = r.tone === "signoff" ? (w.signoff[r.code] ?? w.reason[r.code]) : w.reason[r.code];
  return say?.(r.params, f);
}

export function shortText(r: Reason, w: ThreadWords, f: Fmt): string | undefined {
  return w.short[r.code]?.(r.params, f);
}

// ---------- the options card ----------

/** The option the card leads with: the agent's pick when it made one, else the first (ranked best). */
export function leadOption(card: Pick<OptionsCard, "options" | "preselected" | "chosen">): OptionView {
  return card.options.find((o) => o.optionId === card.chosen) ?? card.options.find((o) => o.optionId === card.preselected?.optionId) ?? card.options[0];
}

/** Sign-off reasons every option shares: said once for the card. */
export function sharedSignoff(options: OptionView[]): Reason[] {
  if (!options.length) return [];
  const first = options[0].reasons.filter((r) => r.tone === "signoff");
  return first.filter((r) => options.every((o) => o.reasons.some((x) => x.tone === "signoff" && x.code === r.code)));
}

/** Quiet facts every option shares (stock not reported, instead of the usual): said once for the card, not as drawbacks. */
export function sharedQuiet(options: OptionView[]): Reason[] {
  if (!options.length) return [];
  return options[0].reasons.filter((r) => r.tone === "quiet" && options.every((o) => o.reasons.some((x) => x.tone === "quiet" && x.code === r.code)));
}

/** At most `max` short reasons for the lead option, pros first, in plain words. */
export function leadReasons(o: OptionView, w: ThreadWords, f: Fmt, max = 2): string[] {
  const pros = o.reasons.filter((r) => r.tone === "pro").map((r) => reasonText(r, w, f));
  const cons = o.reasons.filter((r) => r.tone === "con" && r.code !== "more_expensive").map((r) => reasonText(r, w, f));
  return [...pros, ...cons].filter((x): x is string => !!x).slice(0, max);
}

const DISTINCT_PROS = ["your_usual", "same_as_last", "lowest_co2", "most_reliable", "arrives_first", "alternative", "exact_amount"];
const DISTINCT_CONS = ["arrives_later", "gives_up", "partial_stock", "rounds_up", "less_reliable", "many_packs", "cutoff_soon"];

/** The one thing another option differs in from the lead, in a few words: what it has that the lead lacks, else what it gives up, else the price. */
export function oneThing(o: OptionView, lead: OptionView, w: ThreadWords, f: Fmt): string {
  const leadHas = new Set(lead.reasons.map((r) => r.code));
  for (const code of DISTINCT_PROS) {
    const r = o.reasons.find((x) => x.code === code && x.tone === "pro");
    if (r && !leadHas.has(code)) {
      const t = shortText(r, w, f);
      if (t) return withPrice(t, o, lead, w, f);
    }
  }
  for (const code of DISTINCT_CONS) {
    const r = o.reasons.find((x) => x.code === code && x.tone === "con");
    if (r && !leadHas.has(code)) {
      const t = shortText(r, w, f);
      if (t) return withPrice(t, o, lead, w, f);
    }
  }
  return priceDelta(o, lead, w, f) ?? "";
}

function priceDelta(o: OptionView, lead: OptionView, w: ThreadWords, f: Fmt): string | undefined {
  const d = o.totalCents - lead.totalCents;
  if (Math.abs(d) < 100) return undefined;
  return d > 0 ? w.moreBy(f.money(d)) : w.cheaperBy(f.money(-d));
}

function withPrice(t: string, o: OptionView, lead: OptionView, w: ThreadWords, f: Fmt): string {
  const p = priceDelta(o, lead, w, f);
  return p ? `${cap(t)}, ${p}` : cap(t);
}

/** The full trade-offs of one option, said once: shared sign-off and quiet facts are left to the card. */
export function tradeOffs(o: OptionView, shared: Reason[], w: ThreadWords, f: Fmt): { pros: string[]; cons: string[]; signoff: string[] } {
  const sharedCodes = new Set(shared.map((r) => `${r.tone}:${r.code}`));
  const say = (r: Reason) => reasonText(r, w, f);
  const pros = o.reasons.filter((r) => r.tone === "pro").map(say);
  const cons = o.reasons.filter((r) => r.tone === "con").map(say);
  const signoff = o.reasons.filter((r) => r.tone === "signoff" && !sharedCodes.has(`signoff:${r.code}`)).map(say);
  const known = new Set(o.reasons.filter((r) => r.code === "gives_up").map((r) => String(r.params.text ?? "")));
  // Gives-ups the engine added after the ranking (the stand-in check) carry no code: their words are the buyer's own.
  const extra = o.givesUp.filter((g) => !known.has(g));
  const clean = (xs: (string | undefined)[]) => xs.filter((x): x is string => !!x);
  return { pros: clean(pros), cons: [...extra, ...clean(cons)], signoff: clean(signoff) };
}

/** Price per litre or kilo, when the option is sold by volume or weight. */
export function perUnitPrice(o: OptionView, w: ThreadWords, f: Fmt): string | undefined {
  const unit = o.delivered.unit;
  if ((unit !== "L" && unit !== "kg") || !o.delivered.amount) return undefined;
  return w.perUnit(f.money(Math.round(o.totalCents / o.delivered.amount)), unit === "L" ? "l" : "kg");
}

/** "1 000 × 1 l" (+ "384 × 1 l" for a second product). */
export function packsText(o: OptionView, w: ThreadWords, f: Fmt): string {
  return o.lines.map((l) => w.packsOf(f.num(l.quantity), l.packSize !== undefined && l.unit ? f.measure(l.packSize, l.unit) : "")).join(" + ");
}

/** The approver an order of this total goes to: the first in the mandate whose limit covers it. */
export function approverFor(totalCents: number, approvers: { name: string; role: string; maxApprovalCents: number }[]): { name: string; role: string } | undefined {
  return approvers.find((a) => a.maxApprovalCents >= totalCents) ?? approvers.at(-1);
}

// ---------- left out, and the usual ----------

const REF_NOTE = /^(Your usual|Same as last time|The product you named) \((.+?)\) (?:cannot do it|is not possible): (.+?)\.?( Here are the options instead\.)?$/;

/**
 * "Your usual (X) cannot do it: why" and "Same as last time (X) is not possible: why" about the same product say one
 * thing: once, with the reason in the buyer's language when it is one of the left-out reasons.
 */
export function usualNote(card: Pick<OptionsCard, "notes" | "excluded">, w: ThreadWords, lang: Lang): string | undefined {
  for (const n of card.notes) {
    const m = REF_NOTE.exec(n.trim());
    if (!m) continue;
    const [, , name, why] = m;
    const code = card.excluded.find((e) => e.reason === why || why.startsWith(e.reason))?.code ?? (/cut-off/.test(why) ? "cutoff_passed" : /stock/.test(why) ? "no_substitute" : undefined);
    const reason = (code && w.excluded[code]) || (lang === "en" ? why : undefined);
    return reason ? w.usualNotOffered(name, reason) : undefined;
  }
  return undefined;
}

/** The card's other notes, in the buyer's language; one the words do not know is shown only in English. */
export function otherNotes(card: Pick<OptionsCard, "notes">, w: ThreadWords, lang: Lang): string[] {
  return card.notes.filter((n) => !REF_NOTE.test(n.trim())).flatMap((n) => {
    const known = w.fixedNotes[n.trim()];
    if (known) return [known];
    return lang === "en" ? [n] : [];
  });
}

/** Why products were left out, grouped by kind, each in a few words. */
export function leftOutGroups(card: Pick<OptionsCard, "excluded">, w: ThreadWords, lang: Lang): { label: string; count: number }[] {
  const out = new Map<string, number>();
  for (const e of card.excluded) {
    const label = (e.code && w.excluded[e.code]) || (lang === "en" ? e.reason : w.excluded.no_offer);
    out.set(label, (out.get(label) ?? 0) + e.count);
  }
  return [...out.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// ---------- the gate ----------

/** The rules that did not simply pass, as sentences in the buyer's language. */
export function gateReasons(rules: { rule: string; outcome: string; details?: Record<string, unknown> }[] | undefined, fallback: string[], w: ThreadWords, f: Fmt, lang: Lang): string[] {
  if (!rules?.length) return lang === "en" ? fallback : [];
  return rules
    .filter((r) => r.outcome !== "pass" && !(r.rule === "weekly_budget" && r.outcome === "escalate" && !r.details?.budgetCents))
    .map((r) => w.rule[r.rule]?.((r.details ?? {}) as Record<string, string | number>, f) ?? `${f.rule(r.rule)}.`);
}

// ---------- the mistake check ----------

const num0 = (x: unknown) => (typeof x === "number" ? x : Number(x));

/** One concern in the buyer's language, from its code, key and evidence; the English message only as a last resort. */
export function concernText(c: AnomalyCard["concerns"][number], w: ThreadWords, f: Fmt, lang: Lang): string {
  const say = w.concern[c.code];
  if (!say) return lang === "en" ? c.message : w.concern.readings_differ({}, f);
  const [, a, u] = c.key.split(":");
  const e = (c.evidence ?? {}) as Record<string, unknown>;
  const asked = (e.asked as { amount?: number; unit?: string } | undefined) ?? {};
  const fix = c.corrections.map((x) => /^use_([\d.]+)_(\w+)$/.exec(x.id)).find(Boolean);
  const params: Record<string, string | number> = {
    asked: num0(asked.amount ?? a ?? e.asked ?? 0),
    askedUnit: String(asked.unit ?? u ?? e.unit ?? ""),
    unit: String(e.unit ?? u ?? ""),
    usualAmount: num0(e.usualAmount ?? e.usual ?? 0),
    ratio: num0(e.ratio ?? 0),
    low: num0(e.low ?? 0),
    high: num0(e.high ?? 0),
    deliverBy: String(e.deliverBy ?? (c.key.split(":")[1] || "")),
    ...(fix ? { fix: Number(fix[1]), fixUnit: fix[2] } : {}),
  };
  if (c.code === "standing_order_range" && typeof e.asked === "number") params.asked = e.asked;
  return say(params, f);
}

/** A correction button in the buyer's language, from its id. */
export function correctionLabel(x: { id: string; label: string }, w: ThreadWords, f: Fmt, lang: Lang): string {
  const use = /^use_([\d.]+)_(\w+)$/.exec(x.id);
  if (use) return w.correction.use(f.measure(Number(use[1]), use[2]));
  const deliver = /^deliver_(\d{4}-\d{2}-\d{2})$/.exec(x.id);
  if (deliver) return w.correction.deliver(f.day(deliver[1]));
  if (x.id === "cancel") return w.correction.cancel;
  if (x.id === "show_options") return w.correction.show_options;
  if (x.id === "choose_other") return w.correction.choose_other;
  if (x.id.startsWith("keep_")) return w.correction.keep;
  void lang;
  return x.label; // a correction this file does not know: the engine's words

}

// ---------- memory ----------

/** What a remembered fact is, in the buyer's language. */
function factWords(p: Record<string, string | number>, w: ThreadWords, f: Fmt, lang: Lang): string {
  const label = String(p.label ?? "");
  switch (p.kind) {
    case "diet":
      return cap(f.attr(String(p.claim)));
    case "allergen":
      return w.memory.no(f.attr(String(p.allergen)));
    case "spec":
    case "learned":
      return p.choice ? cap(f.attr(String(p.choice))) : lang === "en" ? label : "";
    case "product":
      return String(p.name ?? label);
    case "brand":
      return String(p.brand ?? label);
    case "goal":
      return w.memory.goal[String(p.goal)] ?? label;
    case "standing_order":
      return cap(w.memory.standing(f.weekdays(String(p.weekdays ?? "").split(",").filter(Boolean).map(Number))));
    case "delivery_days":
      return f.weekdays(String(p.weekdays ?? "").split(",").filter(Boolean).map(Number));
    case "rule":
      return label; // the person's own words
    default:
      return lang === "en" ? label : "";
  }
}

/** One line of what memory used, in the buyer's language; the engine's English text when it carries no data. */
export function memoryText(m: MemoryLine | string, w: ThreadWords, f: Fmt, lang: Lang): string | undefined {
  if (typeof m === "string" || !m.code || !m.params) {
    const text = typeof m === "string" ? m : m.text;
    return lang === "en" ? text : undefined;
  }
  const p = m.params;
  const what = factWords(p, w, f, lang);
  if (!what) return lang === "en" ? m.text : undefined;
  const from =
    p.how === "stated" || p.how === "confirmed" || p.how === "said"
      ? w.memory.stated(String(p.by ?? ""), p.at ? f.day(String(p.at)) : "")
      : p.how === "learned_orders"
        ? w.memory.learned_orders(Number(p.n))
        : p.how === "learned_choices"
          ? w.memory.learned_choices(Number(p.n))
          : "";
  const say = m.code === "applied" ? w.memory.applied : m.code === "preselected" ? w.memory.preselected : w.memory.checked;
  return say(what, from);
}

/** A key for a memory line, to say it once in a thread. */
export function memoryKey(m: MemoryLine | string): string {
  return typeof m === "string" ? m : (m.itemId ?? m.text);
}

// ---------- steps and notices ----------

export function stepLabel(s: Pick<ThreadStep, "kind" | "label">, w: ThreadWords, lang: Lang): string {
  if (lang === "en") return s.label;
  const kind = s.kind.startsWith("tool:") ? "model" : s.kind;
  return w.step[kind] ?? w.step.model;
}

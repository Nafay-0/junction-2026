import { dayL } from "@/app/_i18n/format";
import type { Lang } from "@/app/_i18n/lang";
import { clock, money } from "@/app/_ui/plain";
import type { AgentSession } from "@/core/orders";
import { localNow } from "@/core/kitchen";
import { yesOrNo } from "../../channels/speech";
import type { EventResult, SeasonalResult, SheetLines, SubOption } from "./scenarios";
import { MENU_SAY_TEXT } from "./say.text";

/**
 * The two menu scenarios as the kitchen's own conversation uses them: data and actions, no card. The thread (owned by
 * the conversation engineer) decides where it is said; this module gives it what to say, what the closed steps view
 * shows, how the buyer's words become a decision, and what that decision puts on the order sheet.
 *
 *   scenarioOf(words)                                 "seasonal" | "event" | undefined: which of the two the words ask for
 *   seasonalForThread(slug, words, by, lang)          { planId, say, ask, steps, facts, pending }: the menu around what is
 *                                                     in season, what is on hand (labelled), what is left to buy
 *   eventForThread(slug, words, by, lang, date?)      { planId, say, ask, steps, facts, pending }: what cannot arrive and
 *                                                     why, the best one or two substitutes by recipe logic
 *   scenarioAnswerOf(words, pending)                  { kind: "yes" | "no" | "choose" (optionId) | "day" (date) } or undefined
 *   actOnScenario(slug, pending, answer, who, lang)   { reply, sheet? }: `sheet` is what the thread opens with its own
 *                                                     createSheet(run, sheet) (lines, deliveryDate, text, session); the
 *                                                     sheet's confirm then goes through the gate like any order
 *
 * Plain code chooses everything; the words are the frame around figures from the plan. Nothing here orders.
 */

export type ScenarioKind = "seasonal" | "event";

/** What the thread keeps between the question and the answer (small, JSON-safe). */
export type PendingScenario = {
  kind: ScenarioKind;
  planId: string;
  /** The options named in the question, in the order said: what "the first", "the second" or a product's name picks. */
  options: { optionId: string; lineId: string; words: string[] }[];
  /** Every verified option of every line, by its words: "use the frozen one", "add the smetana" picks any of them. */
  more?: { optionId: string; lineId: string; words: string[] }[];
  /** For a day nothing could make: the earliest day, which a yes plans for. */
  earliest?: string;
  words: string;
};

export type ThreadScenario = {
  planId: string;
  kind: ScenarioKind;
  /** One or two plain sentences in the kitchen's language, with the figures. */
  say: string;
  /** The question it ends on, answered in words. */
  ask: string;
  /** Lines for the closed "steps" view (English, like the rest of the steps): every search, check and figure's source. */
  steps: string[];
  /** The facts the agent's own line may be grounded against (core/grounding factsFrom). */
  facts: Record<string, unknown>;
  pending: PendingScenario;
};

const SEASON_WORDS = /\b(in season|seasonal|season's|sesonki|sesongin|satokau|säsong|what is fresh now|mitä nyt on)|\bjuurek|\broot vegetables?\b|\brotfrukt|\bchanterell|\bkantarell|\bmoose\b|\bhirve|\bälg|\bcabbage\b|\bkaali|\bkål\b|\blingonberr|\bpuoluk|\bpumpkin|\bkurpits/iu;
const EVENT_WORDS = /\b(booking|booked|unexpected|last[- ]minute|at short notice|tomorrow|tonight|varaus|varauksen|yllättävä|huomenna|huomiseksi|bokning|oväntad|i morgon|imorgon)\b/iu;

/** Which scenario the words ask for: a booking at short notice before a season (a booking for tomorrow around chanterelles is an event). */
export function scenarioOf(words: string): ScenarioKind | undefined {
  if (EVENT_WORDS.test(words)) return "event";
  if (SEASON_WORDS.test(words)) return "seasonal";
  return undefined;
}

async function kit(slug: string) {
  const { menuScenarios } = await import("./runtime");
  const { resolveMenuKitchen } = await import("./kitchens");
  const { rt, service, scenarios } = await menuScenarios();
  const kitchen = await resolveMenuKitchen(slug, rt);
  if (!kitchen) throw new Error(`no menu kitchen ${slug}`);
  return { rt, service, scenarios, kitchen };
}

/** Product names in the kitchen's language, from master data (no live call). */
async function namesIn(rt: Awaited<ReturnType<typeof kit>>["rt"], ids: string[], lang: Lang): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const ps = await rt.catalog.searchProducts({ ids: [...new Set(ids)], limit: 100 });
  return new Map(ps.map((p) => [p.id, (lang === "fi" ? p.names?.fi : lang === "sv" ? p.names?.sv : p.names?.en) ?? p.names?.en ?? p.name]));
}

/** A dish's name in the reply's language when the planner gave one (the same model call writes en, fi, sv). */
const dishL = (d: { name: string; nameFi?: string | null; nameSv?: string | null }, lang: Lang) => (lang === "fi" ? d.nameFi : lang === "sv" ? d.nameSv : null) || d.name;
const list = (xs: string[], lang: Lang) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : lang === "sv" ? "och" : "and"} ${xs.at(-1)}`);
const at = (orderBy: string | undefined, lang: Lang) => (orderBy ? `${dayL(localNow(new Date(orderBy)).date, lang)} ${lang === "fi" ? "klo " : lang === "sv" ? "kl. " : "at "}${clock(orderBy)}` : "");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Sentence case, and no double stop after a date that ends in one ("16.11.."). */
const upper = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\.\.(?=\s|$)/g, ".").replace(/\.\?/g, "?");

// ---------- scenario 1 ----------

export async function seasonalForThread(slug: string, words: string, by: string, lang: Lang = "en"): Promise<ThreadScenario> {
  const { rt, scenarios, kitchen } = await kit(slug);
  const r = await scenarios.seasonal(kitchen, words, by);
  return seasonalSay(r, rt, lang, words, kitchen.info.name);
}

async function seasonalSay(r: SeasonalResult, rt: Awaited<ReturnType<typeof kit>>["rt"], lang: Lang, words: string, kitchenName: string): Promise<ThreadScenario> {
  const t = MENU_SAY_TEXT[lang];
  const buying = r.lines.filter((l) => l.product);
  const names = await namesIn(rt, [...buying.map((l) => l.product!.productId), ...(r.anchor?.products.slice(0, 3).map((p) => p.productId) ?? [])], lang);
  const said = r.lines.filter((l) => l.onHand && l.onHand.source === "said" && !l.toBuy).map((l) => lower(l.ingredient));
  const est = r.lines.filter((l) => l.onHand && l.onHand.source === "bought" && !l.toBuy).map((l) => `${l.need} ${lower(l.ingredient)}`);
  const covers = r.covers ? (lang === "fi" ? `${r.covers} annosta` : lang === "sv" ? `${r.covers} portioner` : `${r.covers} covers`) : "";
  const day = r.deliverBy ? dayL(r.deliverBy, lang) : "";
  const parts = [
    r.anchor ? t.season(r.anchor.label[lang], list(r.anchor.products.slice(0, 3).map((p) => names.get(p.productId) ?? p.name), lang)) : t.noSeason,
    t.dishes(r.dishes.length, covers, day, list(r.dishes.map((d) => dishL(d, lang)), lang)),
    said.length ? t.onHand(list(said, lang)) : "",
    est.length ? t.estimate(list(est, lang)) : "",
    t.buy(buying.length, money(r.totalCents)),
    r.gate?.outcome === "needs_human_approval" && r.gate.approver ? t.signOff(r.gate.approver.name) : "",
  ].filter(Boolean);
  const steps = [
    r.anchor ? `In season in Finland now: ${r.anchor.label.en} (${r.anchor.why}) Source: ${r.anchor.source.title}, ${r.anchor.source.url}. The range has ${r.anchor.products.length} such products (master data, no live call): ${r.anchor.products.map((p) => p.name).join("; ")}.` : "No calendar entry in season this month has products in the range for these words.",
    ...r.dishes.map((d) => `Dish: ${d.name} (${d.course})${d.anchorLine ? `, built on ${d.anchorLine}` : ""}.`),
    ...r.lines.map((l) => `${l.ingredient}: need ${l.need ?? "?"}${l.onHand ? `; on hand ${l.onHand.amount ?? "enough"} (${l.onHand.text})` : "; nothing known on hand, none assumed"}; ${l.toBuy ? `buy ${l.toBuy}${l.product ? `: ${l.product.packText}, ${l.product.name}, ${money(l.product.totalCents)}, arrives ${l.product.deliveryDate}` : ""}` : "nothing to buy"}${l.leftover ? `. ${l.leftover}` : ""}${l.status === "needs_decision" ? `. Open: ${l.note}` : ""}.`),
    `Total ${money(r.totalCents)}. ${r.gate ? `The gate's preview: ${r.gate.outcome}${r.gate.approver ? `, sign-off by ${r.gate.approver.name}` : ""}.` : ""}`,
    ...r.blockers.map((b) => `Blocker: ${b}`),
  ];
  return { planId: r.planId, kind: "seasonal", say: upper(parts.join(" ")), ask: upper(t.askSheet), steps, facts: { seasonal: r, kitchen: kitchenName }, pending: { kind: "seasonal", planId: r.planId, options: [], words } };
}

// ---------- scenario 2 ----------

export async function eventForThread(slug: string, words: string, by: string, lang: Lang = "en", date?: string, planId?: string): Promise<ThreadScenario> {
  const { rt, scenarios, kitchen } = await kit(slug);
  // The same plan for the earliest day, worked out while the buyer reads "plan it for Monday instead?": a yes then
  // answers in seconds (no model call; the live prices and the ways out are already in).
  const ahead = planId && date ? early.get(`${planId}:${date}`) : undefined;
  const r = (ahead ? await ahead.catch(() => undefined) : undefined) ?? (await scenarios.event(kitchen, words, by, { ...(date ? { date } : {}), ...(planId ? { planId } : {}) }));
  if (r.allLate?.earliest && !date) {
    const key = `${r.planId}:${r.allLate.earliest}`;
    const job = scenarios.event(kitchen, words, by, { planId: r.planId, date: r.allLate.earliest });
    job.catch(() => undefined);
    early.set(key, job);
    if (early.size > 50) early.delete(early.keys().next().value!);
  }
  return eventSay(r, rt, lang, words);
}

const g = globalThis as typeof globalThis & { __dockEventAhead?: Map<string, Promise<EventResult>> };
const early: Map<string, Promise<EventResult>> = (g.__dockEventAhead ??= new Map<string, Promise<EventResult>>());

function optionLabel(o: SubOption, names: Map<string, string>, lang: Lang): string {
  if (o.kind === "dish" && o.dish) return dishL(o.dish, lang);
  if (lang === "en" || !o.checks.length) return lower(o.title);
  return list(o.checks.filter((c) => c.product).map((c) => names.get(c.product!.productId) ?? c.product!.name), lang);
}

async function eventSay(r: EventResult, rt: Awaited<ReturnType<typeof kit>>["rt"], lang: Lang, words: string): Promise<ThreadScenario> {
  const t = MENU_SAY_TEXT[lang];
  const day = r.deliverBy ? dayL(r.deliverBy, lang) : "";
  const ids = [...r.cannotArrive.flatMap((x) => (x.product ? [x.product.productId] : [])), ...Object.values(r.options).flatMap((os) => os.flatMap((o) => o.checks.flatMap((c) => (c.product ? [c.product.productId] : []))))];
  const names = await namesIn(rt, ids, lang);
  const what = (x: EventResult["cannotArrive"][number]) => (lang === "en" ? lower(x.ingredient) : x.product ? (names.get(x.product.productId) ?? x.ingredient) : x.ingredient);
  const why = (x: EventResult["cannotArrive"][number]) => {
    const a = x.arrival;
    const fn = t.why[a.code];
    return a.code === "cutoff_passed" ? fn(at(a.orderBy, lang)) : a.code === "later" ? fn(a.earliest ? dayL(a.earliest, lang) : "") : fn("");
  };
  const steps: string[] = [
    ...r.lines.map((l) => `${l.ingredient}${l.dishes.length ? ` (${l.dishes.join(", ")})` : ""}: ${l.arrival === null ? `not bought (${l.note})` : l.arrival.ok ? `arrives ${l.arrival.date}${l.arrival.orderBy ? `, order by ${l.arrival.orderBy}` : ""}${l.product ? `: ${l.product.packText}, ${l.product.name}, ${money(l.product.totalCents)}` : ""}` : `cannot arrive: ${l.arrival.why}`}.`),
  ];
  const pending: PendingScenario = { kind: "event", planId: r.planId, options: [], words };
  const menu = r.dishes.length ? t.menuIs(list(r.dishes.map((d) => dishL(d, lang)), lang)) : "";
  if (r.allLate) {
    const earliest = r.allLate.earliest ? dayL(r.allLate.earliest, lang) : "";
    steps.push(`Nothing on the plan can come by ${r.allLate.neededBy}${r.allLate.earliest ? `; the earliest delivery is ${r.allLate.earliest}` : ""}: no recipe changes proposed, the fix is the day.`);
    if (r.allLate.earliest) pending.earliest = r.allLate.earliest;
    return { planId: r.planId, kind: "event", say: upper(`${menu} ${t.allLate(day, earliest)}`.trim()), ask: upper(r.allLate.earliest ? t.askDay(earliest) : t.askSheet), steps, facts: { event: r }, pending };
  }
  if (!r.cannotArrive.length) return { planId: r.planId, kind: "event", say: `${menu} ${t.allArrive(day)} ${t.buy(r.lines.filter((l) => l.product).length, money(r.totalCents))}`, ask: t.askSheet, steps, facts: { event: r }, pending };
  const parts: string[] = menu ? [menu] : [];
  const named = r.cannotArrive.slice(0, 4).map((x) => `${what(x)} (${why(x)})`);
  const more = r.cannotArrive.length - named.length;
  parts.push(r.cannotArrive.length === 1 ? t.cannot(what(r.cannotArrive[0]), day, why(r.cannotArrive[0])) : t.cannotMany(r.cannotArrive.length, day, more > 0 ? `${named.join(", ")} ${t.more(more)}` : list(named, lang)));
  let ask = t.askSheet;
  let rest = 0;
  // At most the first two ingredients get their options said; every option is in the steps.
  for (const x of r.cannotArrive) {
    const os = r.options[x.lineId] ?? [];
    steps.push(`${x.ingredient} does ${x.roleText ? `"${x.roleText}"` : "its job"} in ${x.dish} (role: ${x.role}).`);
    for (const o of os) steps.push(`  ${o.rank}: ${o.title} [${o.source}]. Taste: ${o.tradeoff.taste}; texture: ${o.tradeoff.texture}; work: ${o.tradeoff.work}.${o.checks.map((c) => ` ${c.part}: ${c.product ? `${c.product.packText} ${c.product.name}, ${money(c.product.totalCents)}` : "nothing"}; ${c.arrival.ok ? `arrives ${c.arrival.date}` : c.arrival.why}; rules ${c.rules.ok ? "pass" : c.rules.reason}.`).join("")} ${o.deltaCents !== null ? `${o.deltaCents >= 0 ? "+" : ""}${money(o.deltaCents)} against the original. ` : ""}${o.signOff.needed ? `Needs sign-off: ${o.signOff.reason}` : `Inside the kitchen's preferences: ${o.signOff.reason}`}`);
    for (const u of r.unresolved[x.lineId] ?? []) steps.push(`  not offered: ${u}`);
    if (parts.length >= 3) {
      // Not said one by one: a yes takes the best verified option of each, which the steps list.
      if (os[0]) {
        pending.options.push({ optionId: os[0].optionId, lineId: x.lineId, words: optionWords(os[0], names) });
        rest++;
      }
      continue;
    }
    if (!os.length) {
      parts.push(t.noOption(what(x)));
      continue;
    }
    const best = os[0];
    const other = os[1];
    parts.push(t.instead(what(x), optionLabel(best, names, lang), lang === "en" ? best.tradeoff.taste : ""));
    if (best.signOff.needed && best.signOff.approver) parts.push(t.needsOk(best.signOff.approver.name));
    pending.options.push(...os.slice(0, 2).map((o) => ({ optionId: o.optionId, lineId: x.lineId, words: optionWords(o, names) })));
    if (pending.options.length <= 2) ask = t.askChoice(optionLabel(best, names, lang), other ? optionLabel(other, names, lang) : undefined);
  }
  if (rest) parts.push(t.restBest(rest));
  pending.more = r.cannotArrive.flatMap((x) => (r.options[x.lineId] ?? []).map((o) => ({ optionId: o.optionId, lineId: x.lineId, words: optionWords(o, names) })));
  return { planId: r.planId, kind: "event", say: upper(parts.join(" ")), ask: upper(ask), steps, facts: { event: r }, pending };
}

/** Words of an option a buyer may say back: its product names and title, folded, five letters or more. */
function optionWords(o: SubOption, names: Map<string, string>): string[] {
  const text = [o.title, o.dish?.name ?? "", ...o.checks.flatMap((c) => (c.product ? [c.product.name, names.get(c.product.productId) ?? ""] : [c.part]))].join(" ");
  return [...new Set(fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)))];
}
const STOP = new Set(["instead", "amount", "lactose", "laktoositon", "laktosfri", "frozen", "fresh", "parts", "about", "other"]);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export type ScenarioAnswer = { kind: "yes" } | { kind: "no" } | { kind: "choose"; optionId: string } | { kind: "day"; date: string };

const FIRST = /\b(?:first|1st|former|ensimmäi|eka\b|edelli|första)/iu;
const SECOND = /\b(?:second|2nd|latter|the other|toinen|toista|jälkimmäi|toka\b|andra|den senare)/iu;

/**
 * The person's words as an answer to the open scenario question: an option by its product's name or by "the first /
 * the second", a yes (the best options, or the earliest day), or a no. Undefined when the words answer none of these.
 */
export function scenarioAnswerOf(words: string, pending: PendingScenario): ScenarioAnswer | undefined {
  const w = fold(words.trim());
  if (!w) return undefined;
  const hits = [...pending.options, ...(pending.more ?? []).filter((m) => !pending.options.some((o) => o.optionId === m.optionId))].filter((o) => o.words.some((x) => w.includes(x)));
  const named = hits.filter((o) => !hits.some((h) => h !== o && h.words.filter((x) => w.includes(x)).length > o.words.filter((x) => w.includes(x)).length));
  if (named.length === 1) return { kind: "choose", optionId: named[0].optionId };
  if (pending.options.length >= 2 && SECOND.test(words)) return { kind: "choose", optionId: pending.options[1].optionId };
  if (pending.options.length >= 1 && FIRST.test(words)) return { kind: "choose", optionId: pending.options[0].optionId };
  const yn = yesOrNo(words);
  if (yn === "no" || NO_WORDS.test(words)) return { kind: "no" };
  // "Monday is fine", "sounds good", "use that instead": a yes to what was asked.
  const dayNamed = pending.earliest ? WEEKDAY_WORDS[new Date(`${pending.earliest}T12:00:00Z`).getUTCDay()].test(words) : false;
  if (yn === "yes" || dayNamed || OK_WORDS.test(words)) return pending.earliest ? { kind: "day", date: pending.earliest } : { kind: "yes" };
  return undefined;
}

const OK_WORDS = /\b(fine|ok|okay|sure|sounds good|go ahead|do it|do that|use that|use those|that one|that works|works for me|perfect|great|please do|käy|sopii|selvä|hyvä on|tehdään niin|käytä sitä|går bra|okej|gör det|använd den|det funkar)\b/iu;
const NO_WORDS = /\b(no thanks|don't|do not|not that|ei käy|älä|inte|nej tack)\b/iu;
const WEEKDAY_WORDS: RegExp[] = [
  /\b(sunday|sunnuntai|söndag)/iu,
  /\b(monday|maanantai|måndag)/iu,
  /\b(tuesday|tiistai|tisdag)/iu,
  /\b(wednesday|keskiviikko|onsdag)/iu,
  /\b(thursday|torstai|torsdag)/iu,
  /\b(friday|perjantai|fredag)/iu,
  /\b(saturday|lauantai|lördag)/iu,
];

export type Who = { by: string };

/**
 * Act on the answer. A yes or a choice returns the order sheet's lines for the thread to open (with the menu agent's
 * session: the mandate the plan was made and checked under); a no is recorded nowhere and orders nothing; a new day
 * plans the booking again for that day and returns what to say then (`next`).
 */
export async function actOnScenario(slug: string, pending: PendingScenario, answer: ScenarioAnswer, who: Who, lang: Lang = "en"): Promise<{ reply: string; sheet?: SheetLines & { session: AgentSession }; next?: ThreadScenario }> {
  const t = MENU_SAY_TEXT[lang];
  if (answer.kind === "no") return { reply: t.declined };
  const { scenarios, service, kitchen } = await kit(slug);
  if (answer.kind === "day") {
    const next = await eventForThread(slug, pending.words, who.by, lang, answer.date, pending.planId);
    return { reply: next.say, next };
  }
  let choices: { lineId: string; optionId: string }[] = [];
  if (pending.kind === "event") {
    const ev = scenarios.cached(pending.planId);
    // The buyer's pick for its ingredient; for the others, the best option the question named, which their yes accepts.
    const picked = answer.kind === "choose" ? (pending.options.find((o) => o.optionId === answer.optionId) ?? pending.more?.find((o) => o.optionId === answer.optionId)) : undefined;
    // The question said "with the best stand-ins for the rest": a yes takes the best verified option of every line.
    for (const x of ev?.cannotArrive ?? []) {
      const best = ev?.options[x.lineId]?.[0];
      if (picked && picked.lineId === x.lineId) choices.push({ lineId: x.lineId, optionId: picked.optionId });
      else if (best) choices.push({ lineId: x.lineId, optionId: best.optionId });
    }
  } else choices = [];
  const sheet = await scenarios.sheetOf(kitchen, pending.planId, choices, { by: who.by, agentAlone: true });
  const session = await service.agentSession(kitchen);
  return { reply: [t.onSheet, sheet.leftOff.length ? t.leftOff(sheet.leftOff.map((x) => x.name).join(", ")) : ""].filter(Boolean).join(" "), sheet: { ...sheet, session } };
}

/** The same scenario worded in another language, from the same figures (no model, no live call). */
export async function inLanguage(t: ThreadScenario, lang: Lang): Promise<ThreadScenario> {
  const { getRuntime } = await import("../../runtime");
  const rt = await getRuntime();
  return t.kind === "seasonal" ? seasonalSay(t.facts.seasonal as SeasonalResult, rt, lang, t.pending.words, String(t.facts.kitchen)) : eventSay(t.facts.event as EventResult, rt, lang, t.pending.words);
}

export type MenuChecks = import("./scenarios").PlanChecks & {
  /** One or two sentences for the conversation, in the kitchen's language: the refused dish and its rule first, then what can be made instead; else the lines a rule or the day keeps off, and the staples assumed. Empty when there is nothing to say. */
  say: string;
  /** The question for a refused dish ("Which one?"), answered by naming one of `instead`; then plan it with the planner as any menu. */
  ask?: string;
  /** The count to say is the count shown: lines bought, and apart from them the staples assumed and what is on hand. */
  counts: { ingredients: number; toBuy: number; staples: number; onHand: number; open: number };
};

/**
 * The planner's own checks on any menu plan (the thread's plan_menu, a menu card), as facts for one sentence: a dish
 * refused under a named rule and what to make instead, the lines a rule keeps off (with the rule), the lines that
 * cannot make the offered day (with why), and how every ingredient is covered (ordered, on hand, a staple assumed).
 */
export async function menuChecks(slug: string, planId: string, lang: Lang = "en"): Promise<MenuChecks> {
  const { service, kitchen } = await kit(slug);
  const { view } = await service.get(kitchen, planId);
  const { checksOf } = await import("./scenarios");
  const c = checksOf(view);
  const t = MENU_SAY_TEXT[lang];
  const parts: string[] = [];
  let ask: string | undefined;
  if (c.refusedDish) {
    const r = c.refusedDish;
    const drafted = (await service.get(kitchen, planId)).record.draft.dishes.find((d) => d.name === r.name);
    // "Fish fingers: its fish fingers, breaded, frozen is fish" says nothing: when the ingredient is the dish, say what it is.
    const same = fold(r.ingredient).includes(fold(r.name).split(/\s+/)[0]) || fold(r.name).includes(fold(r.ingredient).split(/[\s,]+/)[0]);
    const allergen = t.allergen[r.allergen] ?? (lang === "fi" ? "kiellettyä" : lang === "sv" ? "förbjudet" : "not allowed");
    parts.push(t.refused(drafted ? dishL(drafted, lang) : r.name, same ? "" : lower(r.ingredient), allergen, r.rule.text));
    ask = c.instead.length ? t.insteadAsk(list(c.instead.map((x) => dishL(x, lang)), lang)) : t.noInstead;
  } else {
    for (const r of c.ruleRefusals.slice(0, 2)) parts.push(t.ruleLine(r.ingredient, r.rule.text));
    // The first reason only, without the planner's "Cannot arrive by …:" lead: the steps have the rest.
    for (const d of c.day.lines.filter((x) => !x.ok).slice(0, 2)) parts.push(t.dayLine(d.ingredient, (d.why ?? "").replace(/^Cannot arrive[^:]*:\s*/i, "").split(";")[0].replace(/\.$/, "")));
    const staples = c.coverage.filter((x) => x.basis === "staple").map((x) => lower(x.ingredient));
    if (staples.length) parts.push(t.staples(list([...new Set(staples)], lang)));
  }
  const by = (b: string) => new Set(c.coverage.filter((x) => x.basis === b).map((x) => x.lineId)).size;
  const counts = { ingredients: new Set(c.coverage.map((x) => x.lineId)).size, toBuy: by("ordered"), staples: by("staple"), onHand: by("on_hand"), open: by("open") };
  if (!c.refusedDish && counts.ingredients) parts.unshift(t.counts(counts.toBuy + counts.open, counts.staples, counts.onHand));
  return { ...c, counts, say: upper(parts.join(" ")), ...(ask ? { ask: upper(ask) } : {}) };
}

// ---------- a change to the plan on the table, in words ----------

export type MenuChange = {
  planId: string;
  /** What the words were read as (plain code); empty when they ask for no change this can make. */
  edits: import("./service").PlanEdit[];
  /** What changed, line by line, in English for the steps. */
  changed: string[];
  beforeCents: number;
  totalCents: number;
  /** One or two sentences in the kitchen's language: what changed and the new total, or why nothing could. */
  say: string;
  /** The changed plan's own checks (a dish refused under the new rule, rule refusals, the day, coverage). */
  checks: import("./scenarios").PlanChecks;
};

const CLAIM_WORDS: [RegExp, string][] = [
  [/lactose[- ]?free|laktoosit(o|t)|laktosfri/i, "lactose_free"],
  [/gluten[- ]?free|gluteenit(o|t)|glutenfri/i, "gluten_free"],
  [/\bvegan|vegaani|vegansk/i, "vegan"],
  [/vegetarian|kasvis|vegetarisk/i, "vegetarian"],
];
const ALLERGEN_WORDS_SAID: [RegExp, string][] = [
  [/\bno nuts?\b|nut[- ]?free|without nuts|pähkinät(o|ö)n|ilman pähkinöitä|utan nötter|nötfri/i, "nuts"],
  [/no peanuts?|peanut[- ]?free|maapähkinät(o|ö)n|utan jordnötter/i, "peanuts"],
  [/no fish|fish[- ]?free|kalat(o|o)n|ilman kalaa|utan fisk/i, "fish"],
  [/no eggs?|egg[- ]?free|munat(o|o)n|kananmunaton|utan ägg/i, "eggs"],
  [/milk[- ]?free|dairy[- ]?free|no dairy|maidot(o|o)n|mjölkfri/i, "milk"],
  [/no sesame|sesame[- ]?free|seesamit(o|o)n/i, "sesame"],
];

/**
 * A change to the plan on the table, in the buyer's words, made by plain code on the planner's own edits: a dietary
 * constraint ("make it lactose-free", "no nuts", "vegetarian"), the portions ("for 20", "20 annosta"), one ingredient
 * swapped ("use oat cream instead of the whipping cream"), a dish dropped ("drop the dessert"). Only what the change
 * touches is searched and priced again; the rest stays. Returns what changed and the new total, said in one sentence.
 */
export async function changeMenu(slug: string, planId: string, words: string, by: string, lang: Lang = "en"): Promise<MenuChange> {
  const { service, kitchen } = await kit(slug);
  const before = await service.get(kitchen, planId);
  const p = before.record;
  const edits = changeEditsOf(words, p);
  const t = MENU_SAY_TEXT[lang];
  if (!edits.length) {
    const { checksOf } = await import("./scenarios");
    return { planId, edits, changed: [], beforeCents: before.view.totals.totalCents, totalCents: before.view.totals.totalCents, say: t.noChange, checks: checksOf(before.view) };
  }
  const after = await service.edit(kitchen, planId, edits, by);
  const { checksOf } = await import("./scenarios");
  const changed: string[] = [];
  for (const l of after.view.lines) {
    const was = before.view.lines.find((x) => x.lineId === l.lineId);
    const a = l.chosen?.products.map((x) => `${x.packs} × ${x.name}`).join(" + ") ?? (l.status === "struck" ? "not bought" : "nothing found");
    const b = was?.chosen?.products.map((x) => `${x.packs} × ${x.name}`).join(" + ") ?? (was?.status === "struck" ? "not bought" : "nothing found");
    if (a !== b || l.name !== was?.name) changed.push(`${was?.name ?? l.name}${l.name !== was?.name ? ` → ${l.name}` : ""}: ${b} → ${a}`);
  }
  const what = edits.map((e) => (e.op === "rules" ? t.changedRules([...(e.requiredClaims ?? []).map((c) => t.claim[c] ?? c), ...(e.forbiddenAllergens ?? []).map((x) => t.noAllergen(t.allergen[x] ?? x))].join(", ")) : e.op === "covers" ? t.changedCovers(e.covers) : e.op === "ingredient" ? t.changedIngredient(e.name) : e.op === "dropDish" ? t.changedDrop(dishL(p.draft.dishes.find((d) => d.id === e.dishId)!, lang)) : "")).filter(Boolean);
  const checks = checksOf(after.view);
  const lines = changed.length ? t.changedLines(changed.length) : t.nothingElse;
  const refused = checks.refusedDish ? ` ${t.refused(checks.refusedDish.name, "", t.allergen[checks.refusedDish.allergen] ?? checks.refusedDish.allergen, checks.refusedDish.rule.text)}` : "";
  const say = upper(`${what.join(" ")} ${lines} ${t.newTotal(money(after.view.totals.totalCents), money(before.view.totals.totalCents))}${refused}`.replace(/\s+/g, " ").trim());
  return { planId, edits, changed, beforeCents: before.view.totals.totalCents, totalCents: after.view.totals.totalCents, say, checks };
}


/** The buyer's words as the planner's edits on this plan (plain code): a constraint, the portions, a swap, a dish dropped. */
export function changeEditsOf(words: string, p: Pick<import("./service").PlanRecord, "settings" | "specs" | "draft">): import("./service").PlanEdit[] {
  const edits: import("./service").PlanEdit[] = [];
  const claims = CLAIM_WORDS.filter(([re]) => re.test(words)).map(([, c]) => c);
  const allergens = ALLERGEN_WORDS_SAID.filter(([re]) => re.test(words)).map(([, a]) => a);
  if (claims.length || allergens.length) edits.push({ op: "rules", ...(claims.length ? { requiredClaims: claims } : {}), ...(allergens.length ? { forbiddenAllergens: allergens } : {}) });
  const covers = /(?:for|make it|to|kaikkiaan|yhteensä|för)?\s*(\d{1,5})\s*(?:portions?|covers?|people|guests|persons?|servings?|annosta|annokselle|hengelle|hengen|portioner|personer|gäster)\b/i.exec(words) ?? /\b(?:make it|for|now)\s+(\d{1,5})\b(?!\s*(?:kg|g|l|ml|dl|%))/i.exec(words);
  if (covers && Number(covers[1]) > 0 && Number(covers[1]) !== p.settings.covers) edits.push({ op: "covers", covers: Number(covers[1]) });
  const swap = /(?:use|with)\s+(.+?)\s+(?:instead of|rather than|in place of)\s+(?:the\s+)?(.+?)[.!?]*$/i.exec(words) ?? /(?:replace|swap)\s+(?:the\s+)?(.+?)\s+(?:with|for)\s+(.+?)[.!?]*$/i.exec(words);
  if (swap) {
    const [newName, oldName] = /^(?:replace|swap)/i.test(words.trim()) ? [swap[2], swap[1]] : [swap[1], swap[2]];
    const target = matchLine(p, oldName);
    if (target) edits.push({ op: "ingredient", lineId: target, name: newName });
  }
  const drop = /(?:drop|remove|skip|leave out|without|no more)\s+(?:the\s+)?(.+?)[.!?]*$/i.exec(words) ?? /(?:jätä|poista)\s+(.+?)\s+pois/i.exec(words) ?? /(?:ta bort|stryk)\s+(.+?)[.!?]*$/i.exec(words);
  if (drop && !swap && !allergens.length) {
    const dish = p.draft.dishes.find((d) => [d.name, d.nameFi ?? "", d.nameSv ?? "", d.course].some((n) => n && stemsMatch(n, drop[1])));
    if (dish) edits.push({ op: "dropDish", dishId: dish.id });
  }
  return edits;
}

const stemsOf = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.min(6, Math.max(3, w.length - 2))));
const stemsMatch = (name: string, said: string) => {
  const n = fold(name);
  const ws = stemsOf(said).filter((w) => !["the", "and", "ja", "och"].includes(w));
  return ws.length > 0 && ws.every((w) => n.includes(w));
};
function matchLine(p: Pick<import("./service").PlanRecord, "specs">, said: string): string | undefined {
  return p.specs.find((s) => [s.name, s.key.replace(/_/g, " "), ...s.ingredient.searchTerms].some((n) => stemsMatch(n, said)))?.lineId;
}

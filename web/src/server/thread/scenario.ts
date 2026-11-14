import { dayL } from "@/app/_i18n/format";
import { clock, money } from "@/app/_ui/plain";
import { localNow } from "@/core/kitchen";
import type { EventResult, SubOption } from "@/server/agent/menu/scenarios";
import { MENU_SAY_TEXT } from "@/server/agent/menu/say.text";
import { actOnScenario, eventForThread, incompleteChoices, inLanguage, scenarioAnswerOf, seasonalForThread, type IncompleteChoices, type PendingScenario, type ScenarioAnswer, type ScenarioKind, type ThreadScenario } from "@/server/agent/menu/thread";
import { cardId } from "./cards";
import { canDraft, groupIdByName, readable } from "./refusal";
import { byLine, record, step, type TurnRun } from "./pipeline";
import type { ScenarioCard } from "./types";

/**
 * Valio's two menu scenarios in the conversation (server/agent/menu/thread.ts): a menu around what is in season,
 * buying only what is missing; and a booking at short notice, saying what cannot arrive and the stand-in by the
 * ingredient's role. The engine takes up to two minutes: the working line names each real step as it completes (read
 * from the plan's own record), and says so if it runs long. What is said is short, from the figures: the count, the
 * one that matters most with its reason, the best swap with its trade-off, the rest behind the list, then the question.
 */

type Lang = "en" | "fi" | "sv";
const LANGS: Lang[] = ["en", "fi", "sv"];

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const at = (orderBy: string | undefined, lang: Lang) => (orderBy ? `${dayL(localNow(new Date(orderBy)).date, lang)} ${lang === "fi" ? "klo " : lang === "sv" ? "kl. " : "at "}${clock(orderBy)}` : "");

const REST: Record<Lang, (n: number) => string> = {
  en: (n) => (n === 1 ? "The other one is in the list, with the best stand-in that can come in time." : `The other ${n} are in the list, each with the best stand-in that can come in time.`),
  fi: (n) => (n === 1 ? "Toinen on listassa parhaan ajoissa ehtivän korvaajan kanssa." : `Muut ${n} ovat listassa, kukin parhaan ajoissa ehtivän korvaajan kanssa.`),
  sv: (n) => (n === 1 ? "Den andra finns i listan, med den bästa ersättaren som hinner fram." : `De andra ${n} finns i listan, var och en med den bästa ersättaren som hinner fram.`),
};

/** The question after the short event: the best swap and the rest's best stand-ins, onto the order sheet. */
const ASK: Record<Lang, (best: string, rest: boolean) => string> = {
  en: (best, rest) => `Shall I put it on the order sheet with ${best}${rest ? " and the best stand-ins for the rest" : ""}?`,
  fi: (best, rest) => `Laitanko tilauslistalle korvaajalla ${best}${rest ? " ja muille parhaat korvaajat" : ""}?`,
  sv: (best, rest) => `Ska jag lägga det på beställningen med ${best}${rest ? " och de bästa ersättarna för resten" : ""}?`,
};

/** An option's name as said: no "instead of …" (the sentence says what it replaces). */
const optionName = (o: SubOption) => {
  if (o.kind === "dish" && o.dish) return o.dish.name;
  // A catalogue name in capitals ("PARSLEY EU") as people write it, never "pARSLEY EU".
  const t = readable(o.title.replace(/\s+instead( of .*)?$/i, "").replace(/\s+\(.*\)$/, ""), "en");
  return /^[A-ZÄÖÅ]{2,}\b/.test(t) ? t : lower(t);
};

/** The event said short, from its figures: the count, the one that matters most and why, the best swap, the rest listed. */
async function eventShort(run: TurnRun, r: EventResult, lang: Lang, fallback: ThreadScenario): Promise<{ say: string; ask: string }> {
  if (r.allLate || !r.cannotArrive.length) return { say: fallback.say, ask: fallback.ask };
  const t = MENU_SAY_TEXT[lang];
  const ids = r.cannotArrive.flatMap((x) => (x.product ? [x.product.productId] : []));
  const ps = lang === "en" ? [] : await run.rt.catalog.searchProducts({ ids, limit: 50 }).catch(() => []);
  const { shortName } = await import("./watch");
  const what = (x: EventResult["cannotArrive"][number]) => (lang === "en" || !x.product ? lower(x.ingredient).replace(/,.*$/, "").replace(/\s*\(.*\)$/, "") : shortName(((ps.find((p) => p.id === x.product!.productId) as { names?: Partial<Record<Lang, string>> } | undefined)?.names?.[lang]) ?? x.ingredient));
  const why = (x: EventResult["cannotArrive"][number]) => {
    const a = x.arrival;
    const fn = t.why[a.code as keyof typeof t.why] as (s: string) => string;
    return a.code === "cutoff_passed" ? fn(at(a.orderBy, lang)) : a.code === "later" ? fn(a.earliest ? dayL(a.earliest, lang) : "") : fn("");
  };
  const day = r.deliverBy ? dayL(r.deliverBy, lang) : "";
  // The one that matters most: a main ingredient of a main course first, then the one with no way round.
  const order = [...r.cannotArrive].sort((a, b) => score(b, r) - score(a, r));
  const first = order[0];
  const n = r.cannotArrive.length;
  // The menu first, by its dishes (the buyer must know what is being planned), then what cannot come.
  const DISHES: Record<Lang, (names: string) => string> = { en: (x) => `The menu: ${x}.`, fi: (x) => `Menu: ${x}.`, sv: (x) => `Menyn: ${x}.` };
  const and = lang === "fi" ? " ja " : lang === "sv" ? " och " : " and ";
  const names = r.dishes.map((d) => d.name);
  const parts = [
    ...(names.length ? [DISHES[lang](names.length > 1 ? `${names.slice(0, -1).join(", ")}${and}${names.at(-1)}` : names[0])] : []),
    n === 1 ? t.cannot(cap(what(first)), day, why(first)) : t.cannotMany(n, day, `${what(first)} (${why(first)}) ${t.more(n - 1)}`),
  ];
  const best: SubOption | undefined = r.options[first.lineId]?.[0];
  if (best) {
    const label = optionName(best);
    // The one trade-off that matters, its first clause ("fat 4 % → 2.8 %" and the brand stay in the steps).
    const trade = lang === "en" ? lower(best.tradeoff.taste.split(/;\s*/)[0].replace(/\.$/, "")) : "";
    parts.push(t.instead(what(first), label, trade).replace(/:\s*\.$/, "."));
    if (best.signOff.needed && best.signOff.approver) parts.push(t.needsOk(best.signOff.approver.name));
  } else parts.push(t.noOption(what(first)).replace(/;[^.]*\.$/, "."));
  if (n > 1) parts.push(REST[lang](n - 1));
  // No stand-in for the one that matters most: the question is what to cook in its place (never a side line's pick).
  const instead = { en: `What shall I plan in place of the ${what(first)}?`, fi: `Mitä suunnittelen tilalle (${what(first)})?`, sv: `Vad ska jag planera i stället för ${what(first)}?` }[lang];
  return { say: parts.join(" ").replace(/\.\.(?=\s|$)/g, "."), ask: best ? ASK[lang](optionName(best), n > 1) : instead };
}

function score(x: EventResult["cannotArrive"][number], r: EventResult): number {
  const dish = r.dishes.find((d) => d.name === x.dish);
  return (/main|pää/i.test(dish?.course ?? "") ? 4 : 0) + (/main|protein|base|star|body/i.test(String(x.role)) ? 2 : 0) + (r.options[x.lineId]?.length ? 0 : 1);
}

/** The working line, named by the plan's own record as each real step completes. */
function watchSteps(run: TurnRun, since: number, kind: ScenarioKind, lang: Lang): () => void {
  const done = new Set<string>();
  const label: Record<string, Record<Lang, string>> = {
    menu_plan: { en: "Planning the courses", fi: "Suunnittelen ruokalajit", sv: "Planerar rätterna" },
    seasonal_anchor: { en: "Finding what is in season", fi: "Etsin sesongin raaka-aineen", sv: "Hittar vad som är i säsong" },
    on_hand: { en: "Checking what you already have", fi: "Tarkistan, mitä teillä jo on", sv: "Kollar vad ni redan har" },
    cannot_arrive: { en: "Checking what can arrive in time", fi: "Tarkistan, mikä ehtii ajoissa", sv: "Kollar vad som hinner fram" },
    substitution_options: { en: "Finding stand-ins by each ingredient's role", fi: "Etsin korvaajat raaka-aineen tehtävän mukaan", sv: "Hittar ersättare efter ingrediensens roll" },
  };
  let current = step(run, "plan", kind === "event" ? label.menu_plan[lang] : label.seasonal_anchor[lang]);
  const t0 = Date.now();
  let longSaid = false;
  const timer = setInterval(() => {
    const entries = run.rt.dock.ledger.entries({}).filter((e) => Date.parse(e.at) >= since && e.type === "intake" && typeof (e.data as { step?: unknown }).step === "string");
    for (const e of entries) {
      const s = String((e.data as { step: string }).step);
      if (!label[s] || done.has(s)) continue;
      done.add(s);
      current.done();
      current = step(run, "plan", label[s][lang]);
    }
    if (!longSaid && Date.now() - t0 > 110_000) {
      longSaid = true;
      current.done();
      current = step(run, "plan", lang === "fi" ? "Tämä vie tavallista kauemmin; jatkan, voit kirjoittaa välillä" : lang === "sv" ? "Det här tar längre tid än vanligt; jag fortsätter, du kan skriva under tiden" : "This is taking longer than usual; I'm carrying on, and you can keep typing");
    }
  }, 1200);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    clearInterval(timer);
    current.done();
  };
}

/** Say the scenario the words ask for, as a card in this turn; its words are the turn's reply. */
export async function sayScenario(run: TurnRun, kind: ScenarioKind, words: string, lang: Lang): Promise<ScenarioCard | undefined> {
  const since = Date.now() - 1000;
  const stop = watchSteps(run, since, kind, lang);
  try {
    const by = byLine(run);
    const base = kind === "event" ? await eventForThread(run.k.info.slug, words, by, lang) : await seasonalForThread(run.k.info.slug, words, by, lang);
    return await cardOf(run, base, lang);
  } finally {
    stop();
  }
}

async function cardOf(run: TurnRun, base: ThreadScenario, lang: Lang): Promise<ScenarioCard> {
  const text = {} as ScenarioCard["text"];
  for (const l of LANGS) {
    const s = l === lang ? base : await inLanguage(base, l).catch(() => base);
    const short = base.kind === "event" ? await eventShort(run, s.facts.event as EventResult, l, s) : { say: s.say, ask: s.ask };
    text[l] = { say: readable(short.say, l), ask: readable(short.ask, l) };
  }
  // A seasonal menu that cannot be bought in full never ends on "Shall I put it on the order sheet?": the menu, what
  // is missing and why, then the ways forward (read by engine.ts ways, not as a yes to the sheet).
  let incomplete = false;
  if (base.kind === "seasonal") {
    const inc = await incompleteChoices(run.k.info.slug, base.planId, lang, { ideas: false }).catch(() => undefined);
    if (inc && !inc.complete && inc.missing.length) {
      incomplete = true;
      const said = incompleteSaid(run, base.pending as PendingScenario, inc, lang);
      run.scenarioReplyIsLine = false;
      const menuPart = text[lang].say.split(/(?<=[.!?])\s+/).filter((x) => !/\b(\d+ of the \d+|\d+\/\d+|\d+ av de \d+)\b/.test(x)).join(" ");
      text[lang] = { say: readable(`${menuPart} ${said}`.trim(), lang), ask: "" };
    }
  }
  const ev = base.kind === "event" ? (base.facts.event as EventResult) : undefined;
  const others = ev ? ev.cannotArrive.map((x) => `${lower(x.ingredient)}: ${ev.options[x.lineId]?.[0] ? lower(ev.options[x.lineId][0].title) : "-"}`) : undefined;
  const card: ScenarioCard = {
    type: "scenario",
    cardId: cardId("scenario", `${run.turnId}:${base.planId}`),
    kind: base.kind,
    planId: base.planId,
    text,
    steps: base.steps.slice(0, 40),
    pending: base.pending,
    ...(others?.length ? { others } : {}),
    state: incomplete ? "answered" : "open",
  };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card, base.facts);
  run.scenarioSaid = card.cardId;
  // The menu itself is content: its dishes and ingredients are shown in the reply, each late line with its best stand-in.
  run.dishesFor = { planId: base.planId, ...(ev ? { standIns: Object.fromEntries(ev.cannotArrive.flatMap((x) => (ev.options[x.lineId]?.[0] ? [[x.lineId, lower(ev.options[x.lineId][0].title)]] : []))) } : {}) };
  record(run, "scenario_said", `The ${base.kind === "event" ? "short-notice booking" : "seasonal menu"} ${base.planId} was said in the conversation.`, { planId: base.planId, kind: base.kind });
  return card;
}

/** A scenario's plan that cannot be completed, said: the count, each missing ingredient with its reason, the ways. */
function incompleteSaid(run: TurnRun, pending: PendingScenario, inc: IncompleteChoices, lang: Lang): string {
  const reason = (m: IncompleteChoices["missing"][number]) => lower(m.words.split(/[;:]\s|\.\s/)[0].replace(/\.$/, "").replace(/\s*\((?:[A-Z]{2}-)?\d{4,}\)/g, "")).slice(0, 90);
  const and = lang === "fi" ? " ja " : lang === "sv" ? " och " : " and ";
  const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")}${and}${xs.at(-1)}`);
  // Grouped by reason: what the kitchen's product groups do not cover, in one clause; each other one with its own.
  const outside = inc.missing.filter((m) => m.group);
  const others = inc.missing.filter((m) => !m.group);
  const groupsOut = [...new Set(outside.map((m) => lower(m.group!.split(":")[0])))];
  const names = (ms: typeof inc.missing) => list([...new Set(ms.map((m) => lower(m.ingredient).replace(/\s*\(.*\)$/, "")))].slice(0, 5)) + (new Set(ms.map((m) => m.ingredient)).size > 5 ? { en: " and more", fi: " ja muita", sv: " med flera" }[lang] : "");
  const parts = [
    ...(outside.length ? [{ en: `${names(outside)}: your rules don't cover ${list(groupsOut)}`, fi: `${names(outside)}: sääntönne eivät kata ryhmiä ${list(groupsOut)}`, sv: `${names(outside)}: era regler omfattar inte ${list(groupsOut)}` }[lang]] : []),
    ...others.slice(0, 4).map((m) => `${lower(m.ingredient)} (${reason(m)})`),
  ];
  const missing = parts.join("; ");
  const more = others.length > 4 ? { en: `; and ${others.length - 4} more`, fi: `; ja ${others.length - 4} muuta`, sv: `; och ${others.length - 4} till` }[lang] : "";
  const head = {
    en: `I can't order this menu as planned: only ${inc.covered} of its ${inc.of} ingredients can be bought. Not covered: ${missing}${more}.`,
    fi: `En voi tilata tätä menua suunnitellusti: vain ${inc.covered}/${inc.of} raaka-ainetta saa tilattua. Puuttuu: ${missing}${more}.`,
    sv: `Jag kan inte beställa menyn som den är planerad: bara ${inc.covered} av ${inc.of} ingredienser går att köpa. Saknas: ${missing}${more}.`,
  }[lang];
  const ownerChoice = inc.choices.find((c) => c.kind === "ask_owner");
  const groupIds = ownerChoice?.kind === "ask_owner" ? [...new Set(ownerChoice.groups.map(groupIdByName).filter((x): x is string => !!x))] : [];
  run.scenarioReplyIsLine = true;
  const w = run.thread as unknown as { ways?: Record<string, unknown> };
  w.ways = { planId: inc.planId, categories: [], owner: groupIds.length > 0 && canDraft(run), groupIds, scenario: pending, turnId: run.turnId };
  record(run, "scenario_incomplete", `The ${pending.kind} ${inc.planId} cannot be completed (${inc.covered} of ${inc.of}): said with each missing ingredient and the ways forward, no order.`, { planId: inc.planId, missing: inc.missing.map((m) => m.ingredient) });
  // Only the ways this conversation can carry out: asking the owner only where a change can be drafted here.
  const t = MENU_SAY_TEXT[lang];
  const choices = inc.choices
    .filter((c) => c.kind !== "ask_owner" || (w.ways as { owner: boolean }).owner)
    .map((c) => (c.kind === "ask_owner" ? t.choiceOwner(list(groupsOut.length ? groupsOut : c.groups.map((g) => lower(g.split(":")[0])))) : c.kind === "order_partial" ? t.choicePartial(c.items.length > 4 ? { en: `${c.items.length} ingredients`, fi: `${c.items.length} raaka-ainetta`, sv: `${c.items.length} ingredienser` }[lang] : list(c.items.map(lower))) : c.words));
  const ask = choices.length ? { en: `Shall I ${choices.join(", or ")}?`, fi: `${choices.map((c, i) => (i === 0 ? c.charAt(0).toUpperCase() + c.slice(1) : c)).join(", vai ")}?`, sv: `Ska jag ${choices.join(", eller ")}?` }[lang] : "";
  return readable(`${head} ${ask}`.trim(), lang);
}

/** "Only what can be bought": the scenario's own partial order, on the order sheet to confirm (nothing is ordered yet). */
export async function orderScenarioPartial(run: TurnRun, pending: unknown, lang: Lang): Promise<string> {
  const r = await actOnScenario(run.k.info.slug, pending as PendingScenario, { kind: "partial" }, { by: byLine(run) }, lang);
  if (!r.sheet) return r.reply;
  const { createSheet } = await import("./sheet");
  const sheet = await createSheet(run, { lines: r.sheet.lines, ...(r.sheet.deliveryDate ? { deliveryDate: r.sheet.deliveryDate } : {}), text: r.sheet.text, session: r.sheet.session });
  record(run, "scenario_sheet", `Only what can be bought of ${(pending as PendingScenario).planId} is on order sheet ${sheet.sheetId}: ${money(sheet.totalCents)}.`, { sheetId: sheet.sheetId });
  const day = sheet.deliveryDate ? dayL(sheet.deliveryDate, lang) : "";
  // A form the planner bought in place of the one in the recipe (onion powder for fresh onion) is said as a swap.
  const { dishGroups } = await import("@/server/agent/menu/thread");
  const g = await dishGroups(run.k.info.slug, (pending as PendingScenario).planId, lang).catch(() => undefined);
  const { shortName } = await import("./watch");
  const swaps = (g?.toOrder ?? []).filter((i) => i.standIn && i.product).map((i) => ({ en: `${shortName(i.product!)} in place of ${lower(i.ingredient)}`, fi: `${shortName(i.product!)} raaka-aineen ${lower(i.ingredient)} tilalla`, sv: `${shortName(i.product!)} i stället för ${lower(i.ingredient)}` }[lang]));
  const t = MENU_SAY_TEXT[lang];
  const left = (r.sheet as { leftOff?: { name: string }[] }).leftOff ?? [];
  const and = lang === "fi" ? " ja " : lang === "sv" ? " och " : " and ";
  const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")}${and}${xs.at(-1)}`);
  const reply = [t.onSheet, left.length ? t.leftOff(list([...new Set(left.map((x) => lower(x.name)))])) : "", swaps.length ? `${cap(list(swaps))}.` : ""].filter(Boolean).join(" ");
  return readable({ en: `${reply} ${money(sheet.totalCents)}${day ? ` for ${day}` : ""}. Shall I order it?`, fi: `${reply} ${money(sheet.totalCents)}${day ? ` (${day})` : ""}. Tilaanko sen?`, sv: `${reply} ${money(sheet.totalCents)}${day ? ` till ${day}` : ""}. Ska jag beställa det?` }[lang], lang);
}

/**
 * "Braised pork shoulder instead": the named dish takes the place of the booking's dish that cannot come, in the same
 * plan (the menu adapter's own edit, covers and day kept), then the booking is worked out again and said.
 */
export async function replaceInEvent(run: TurnRun, r: { planId: string; pending: unknown; words: string }, lang: Lang): Promise<string | undefined> {
  const { changeMenu } = await import("@/server/agent/menu/thread");
  const st = step(run, "plan", { en: "Planning that dish in its place", fi: "Suunnittelen ruuan tilalle", sv: "Planerar rätten i stället" }[lang]);
  const c = await changeMenu(run.k.info.slug, r.planId, r.words, byLine(run), lang).catch(() => undefined);
  if (!c?.edits.length) {
    st.done();
    return undefined;
  }
  const p = r.pending as PendingScenario;
  const old = run.store.cards(run.thread).map((x) => x.card).filter((x): x is ScenarioCard => x.type === "scenario" && x.planId === r.planId).at(-1);
  if (old) run.store.card(run.thread, run.turnId, { ...old, state: "answered" });
  // The day the booking is planned for now (the buyer may have moved it): the plan's own, not the words' first day.
  const { dishGroups } = await import("@/server/agent/menu/thread");
  const day = p.earliest ?? (await dishGroups(run.k.info.slug, r.planId, lang).catch(() => undefined))?.day ?? undefined;
  // The booking worked out ahead for that day was for the plan before the change: not reused.
  const ahead = (globalThis as { __dockEventAhead?: Map<string, unknown> }).__dockEventAhead;
  for (const k of [...(ahead?.keys() ?? [])]) if (k.startsWith(`${r.planId}:`)) ahead!.delete(k);
  const next = await eventForThread(run.k.info.slug, p.words, byLine(run), lang, day, r.planId);
  st.done();
  record(run, "event_replace", `The buyer named a dish for the booking's main that cannot come: "${r.words.slice(0, 80)}" (${c.changed.slice(0, 2).join("; ")}).`, { planId: r.planId });
  const card = await cardOf(run, next, lang);
  run.scenarioSaid = undefined;
  return `${card.text[lang].say} ${card.text[lang].ask}`.trim();
}

/** The open scenario card (newest), when its question is still open. */
export function openScenario(run: TurnRun): ScenarioCard | undefined {
  const c = run.store.cards(run.thread).map((x) => x.card).filter((x): x is ScenarioCard => x.type === "scenario").at(-1);
  return c?.state === "open" ? c : undefined;
}

/** The buyer's words as an answer to the open scenario question (plain code). */
export function scenarioAnswerIn(card: ScenarioCard, words: string): ScenarioAnswer | undefined {
  return scenarioAnswerOf(words, card.pending as PendingScenario);
}

/** Act on the answer: the order sheet opens (substitutes declared), or the booking is planned again for the day. */
export async function answerScenarioIn(run: TurnRun, card: ScenarioCard, answer: ScenarioAnswer, lang: Lang): Promise<string> {
  const stop = answer.kind === "day" ? watchSteps(run, Date.now() - 1000, card.kind, lang) : () => undefined;
  try {
    const r = await actOnScenario(run.k.info.slug, card.pending as PendingScenario, answer, { by: byLine(run) }, lang);
    run.store.card(run.thread, run.turnId, { ...card, state: "answered" });
    record(run, "scenario_answer", `The buyer answered the ${card.kind} ${card.planId}: ${answer.kind}.`, { planId: card.planId, answer });
    if (r.next) {
      const next = await cardOf(run, r.next, lang);
      return `${next.text[lang].say} ${next.text[lang].ask}`;
    }
    // The plan cannot be completed (the main cannot arrive, a line breaks a rule): no order of what is left. What is
    // missing and why, each named, then the ways forward; the answer is read against them (engine.ts ways).
    if (r.incomplete && !r.incomplete.complete) return incompleteSaid(run, card.pending as PendingScenario, r.incomplete, lang);
    if (r.sheet) {
      const { createSheet } = await import("./sheet");
      const sheet = await createSheet(run, { lines: r.sheet.lines, ...(r.sheet.deliveryDate ? { deliveryDate: r.sheet.deliveryDate } : {}), text: r.sheet.text, session: r.sheet.session });
      record(run, "scenario_sheet", `The ${card.kind} ${card.planId} is on order sheet ${sheet.sheetId}: ${money(sheet.totalCents)}.`, { sheetId: sheet.sheetId });
    }
    return r.reply;
  } finally {
    stop();
  }
}

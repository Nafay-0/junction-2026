import { dayL } from "@/app/_i18n/format";
import { clock, money } from "@/app/_ui/plain";
import { localNow } from "@/core/kitchen";
import type { EventResult, SubOption } from "@/server/agent/menu/scenarios";
import { MENU_SAY_TEXT } from "@/server/agent/menu/say.text";
import { actOnScenario, eventForThread, inLanguage, scenarioAnswerOf, seasonalForThread, type PendingScenario, type ScenarioAnswer, type ScenarioKind, type ThreadScenario } from "@/server/agent/menu/thread";
import { cardId } from "./cards";
import { readable } from "./refusal";
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
const optionName = (o: SubOption) => (o.kind === "dish" && o.dish ? o.dish.name : lower(o.title.replace(/\s+instead of .*$/i, "").replace(/\s+\(.*\)$/, "")));

/** The event said short, from its figures: the count, the one that matters most and why, the best swap, the rest listed. */
async function eventShort(run: TurnRun, r: EventResult, lang: Lang, fallback: ThreadScenario): Promise<{ say: string; ask: string }> {
  if (r.allLate || !r.cannotArrive.length) return { say: fallback.say, ask: fallback.ask };
  const t = MENU_SAY_TEXT[lang];
  const ids = r.cannotArrive.flatMap((x) => (x.product ? [x.product.productId] : []));
  const ps = lang === "en" ? [] : await run.rt.catalog.searchProducts({ ids, limit: 50 }).catch(() => []);
  const { shortName } = await import("./watch");
  const what = (x: EventResult["cannotArrive"][number]) => (lang === "en" || !x.product ? lower(x.ingredient) : shortName(((ps.find((p) => p.id === x.product!.productId) as { names?: Partial<Record<Lang, string>> } | undefined)?.names?.[lang]) ?? x.ingredient));
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
  const parts = [n === 1 ? t.cannot(cap(what(first)), day, why(first)) : t.cannotMany(n, day, `${what(first)} (${why(first)}) ${t.more(n - 1)}`)];
  const best: SubOption | undefined = r.options[first.lineId]?.[0];
  if (best) {
    const label = optionName(best);
    const trade = lang === "en" ? best.tradeoff.taste : "";
    parts.push(t.instead(what(first), label, trade).replace(/:\s*\.$/, "."));
    if (best.signOff.needed && best.signOff.approver) parts.push(t.needsOk(best.signOff.approver.name));
  } else parts.push(t.noOption(what(first)));
  if (n > 1) parts.push(REST[lang](n - 1));
  return { say: parts.join(" ").replace(/\.\.(?=\s|$)/g, "."), ask: best ? ASK[lang](optionName(best), n > 1) : fallback.ask };
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
    state: "open",
  };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card, base.facts);
  run.scenarioSaid = card.cardId;
  record(run, "scenario_said", `The ${base.kind === "event" ? "short-notice booking" : "seasonal menu"} ${base.planId} was said in the conversation.`, { planId: base.planId, kind: base.kind });
  return card;
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

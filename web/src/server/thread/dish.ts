import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { byLine, record, step, type TurnRun } from "./pipeline";

/**
 * Planning a dish, the way a chef asks for one (the user's shape): an open request gets ONE skippable question (what
 * they are in the mood for, and what they already have); then three or four ideas, each with why it fits and whether
 * this kitchen can buy it completely; then the picked dish with every ingredient in three groups (you have, I'll
 * order, can't get) and one question that fits. A request that already names the dish goes straight to it (the menu
 * builder, menu.ts); one that already gives preferences goes straight to the ideas. Plain code routes; the planner
 * (server/agent/menu/thread.ts menuIdeas, pickIdea) drafts the dishes and checks them against the kitchen's rules.
 */

type Lang = "en" | "fi" | "sv";
type Ideas = { ideasId: string; words: string; covers?: number; date?: string; ideas: { dishId: string; name: string; nameFi: string | null; nameSv: string | null; buyable: boolean }[] };
type DishState = { asked?: { words: string; covers?: number; date?: string }; ideas?: Ideas };
const stateOf = (run: TurnRun): DishState => ((run.thread as unknown as { dish?: DishState }).dish ??= {});

/** Words that only frame a request (who, when, how many, "plan", "a dish"): nothing about what the dish is. */
const FRAME = new Set(
  "i we our us have has had a an the big small large lunch lunches dinner dinners meal meals menu dish dishes food something coming up next this week weekend tomorrow today monday tuesday wednesday thursday friday saturday sunday need needs needed to plan planning make cook serve for people persons guests covers portions pax please can could you help me with some idea ideas suggest suggestion recommend what should would do do it and or on at in of event party group kids pupils staff ruoka ruokaa lounas lounaalle lounaaksi pitää pitäisi täytyy tulossa olisi on yksi illallinen ateria annos annosta hengelle henkeä ihmiselle tarvitsen tarvitaan suunnittele suunnitella ehdota ehdotuksia keksi jotain meillä on iso pieni ensi viikolla viikko huomenna mat lunch middag rätt rätter behöver planera föreslå något för personer till nästa vecka".split(" "),
);
/** Preference words: the request already says what is wanted, so no question first, straight to the ideas. */
const PREFERENCE = /\b(vegetarian|vegan|plant[- ]based|lactose[- ]free|gluten[- ]free|light|lighter|hearty|cheap|budget|healthy|finnish|italian|asian|indian|mexican|nordic|seasonal|fish|chicken|beef|pork|soup|salad|pasta|curry|kasvis|vegaani|laktoositon|gluteeniton|kevyt|halpa|suomalai\w*|keitto|kala|kana|vegetarisk|vegansk|laktosfri|glutenfri|soppa|fisk|kyckling)\b|€|eur\b|euro/i;
const PLANNING = /\b(plan|planning|ideas?|suggest|recommend|need (a|some) (dish|lunch|dinner|meal|menu)|dish for|what (should|could|can) (we|i) (make|cook|serve)|suunnittel\w*|ehdot\w*|keksi|ideoi\w*|planera|föreslå|förslag)\b/i;

/** "for 20 people", "20 annosta", "40 hengelle": the covers. */
export function coversIn(words: string): number | undefined {
  const m = /(\d{1,4})\s*(people|persons|guests|covers|portions|pax|servings|kids|pupils|hengelle|henkeä|hengen|annosta|annokselle|ihmiselle|personer|portioner|gäster)\b/i.exec(words);
  return m ? Number(m[1]) : undefined;
}

/** "on Tuesday", "tiistaiksi": the next such day; "tomorrow": tomorrow. */
export function dayIn(words: string): string | undefined {
  const today = localNow(new Date()).date;
  if (/\b(tomorrow|huomenna|huomiseksi|imorgon)\b/i.test(words)) return addDaysIso(today, 1);
  const days = [/\b(monday|maanantai\w*|måndag)\b/i, /\b(tuesday|tiistai\w*|tisdag)\b/i, /\b(wednesday|keskiviikko\w*|onsdag)\b/i, /\b(thursday|torstai\w*|torsdag)\b/i, /\b(friday|perjantai\w*|fredag)\b/i, /\b(saturday|lauantai\w*|lördag)\b/i, /\b(sunday|sunnuntai\w*|söndag)\b/i];
  const i = days.findIndex((re) => re.test(words));
  if (i < 0) return undefined;
  for (let k = 1; k <= 7; k++) {
    const d = addDaysIso(today, k);
    if (isoWeekday(d) === i + 1) return d;
  }
  return undefined;
}

/** What kind of dish request these words are: open (ask one question), with preferences (straight to ideas), or neither. */
export function dishRequestOf(words: string): "open" | "preferences" | undefined {
  if (!PLANNING.test(words) && !/\b(dish|ruoka|rätt)\b/i.test(words)) return undefined;
  if (!/\b(dish|dishes|lunch|dinner|meal|menu|food|something|ruoka\w*|lounas\w*|illallinen|ateria|mat|middag|rätt\w*)\b/i.test(words)) return undefined;
  const rest = words
    .toLowerCase()
    .replace(/[^\p{L}\d€ ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w) && !FRAME.has(w));
  if (PREFERENCE.test(words)) return "preferences";
  return rest.length === 0 ? "open" : undefined;
}

/** The one question for an open request: both things at once, and skippable. */
function question(lang: Lang): string {
  return {
    en: "What are you in the mood for: a cuisine, a diet, a budget per person? And tell me anything you already have in the kitchen. Or say 'surprise me'.",
    fi: "Mitä teille maistuisi: keittiö, ruokavalio, budjetti per henkilö? Kerro myös, mitä keittiössä jo on. Tai sano 'yllätä'.",
    sv: "Vad är ni sugna på: ett kök, en kost, en budget per person? Och berätta vad ni redan har i köket. Eller säg 'överraska mig'.",
  }[lang];
}

const nameL = (d: { name: string; nameFi: string | null; nameSv: string | null }, lang: Lang) => (lang === "fi" ? d.nameFi : lang === "sv" ? d.nameSv : null) || d.name;
const ORDINALS: RegExp[] = [/\b(first|1st|one|ensimmäi\w*|eka\w*|första|1)\b/i, /\b(second|2nd|two|toinen|toka|andra|2)\b/i, /\b(third|3rd|three|kolma\w*|tredje|3)\b/i, /\b(fourth|4th|four|neljä\w*|fjärde|4)\b/i];
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Which idea the words pick: an ordinal, or words of its name. */
function picked(ideas: Ideas, words: string, lang: Lang): Ideas["ideas"][number] | undefined {
  const w = fold(words);
  const named = ideas.ideas.find((d) => [d.name, d.nameFi ?? "", d.nameSv ?? ""].some((n) => fold(n).split(/[^a-z0-9äöå]+/).filter((x) => x.length >= 4).some((x) => w.includes(x))));
  if (named) return named;
  const i = ORDINALS.findIndex((re) => re.test(words));
  void lang;
  return i >= 0 ? ideas.ideas[i] : undefined;
}

/**
 * The dish flow's turn, before the agent: the question, the ideas, the pick. Returns the reply (plain code), or
 * undefined when these words are not part of it.
 */
export async function dishTurn(run: TurnRun, words: string, lang: Lang): Promise<string | undefined> {
  const st = stateOf(run);
  const last = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
  const lastLine = last?.role === "agent" ? (last.line ?? "") : "";
  // 1. The answer to the question: preferences and what is on hand, then the ideas.
  if (st.asked && lastLine === question(lang)) {
    const asked = st.asked;
    delete st.asked;
    return ideasFor(run, `${asked.words}. ${/surprise|yllätä|överraska/i.test(words) ? "" : words}`, lang, asked, words);
  }
  // 2. A pick among the ideas just offered (or "something lighter": new ideas).
  if (st.ideas && last?.role === "agent" && /Which one shall I plan\?|Minkä niistä suunnittelen\?|Vilken ska jag planera\?/.test(lastLine)) {
    const p = picked(st.ideas, words, lang);
    if (p) return pick(run, st.ideas, p, lang);
    if (/\b(something|another|other|different|lighter|cheaper|jotain|muu|toinen|kevyemp\w*|halvemp\w*|något|annat|lättare|billigare)\b/i.test(words)) return ideasFor(run, `${st.ideas.words}. ${words}`, lang, st.ideas, "");
    return undefined;
  }
  // 3. A new request for a dish: open (one question) or with preferences (straight to the ideas).
  const kind = dishRequestOf(words);
  if (!kind) return undefined;
  const frame = { words, ...(coversIn(words) ? { covers: coversIn(words) } : {}), ...(dayIn(words) ? { date: dayIn(words) } : {}) };
  if (kind === "open") {
    st.asked = frame;
    delete st.ideas;
    record(run, "dish_question", "An open request for a dish: one question first (what they are in the mood for, what they have).", {});
    return question(lang);
  }
  return ideasFor(run, words, lang, frame, "");
}

async function ideasFor(run: TurnRun, words: string, lang: Lang, frame: { covers?: number; date?: string }, have: string): Promise<string> {
  const s = step(run, "plan", lang === "fi" ? "Etsin ruokia, jotka sopivat ja jotka voitte ostaa" : lang === "sv" ? "Letar efter rätter som passar och som ni kan köpa" : "Finding dishes that fit and that you can buy");
  const { menuIdeas } = await import("@/server/agent/menu/thread");
  const r = await menuIdeas(run.k.info.slug, words, byLine(run), lang, { ...(have.trim() ? { have } : {}), count: 3 });
  s.done(`${r.ideas.length}`);
  const st = stateOf(run);
  st.ideas = { ideasId: r.ideasId, words, ...frame, ideas: r.ideas.map((d) => ({ dishId: d.dishId, name: d.name, nameFi: d.nameFi, nameSv: d.nameSv, buyable: d.buyable })) };
  record(run, "dish_ideas", `${r.ideas.length} ideas, ${r.ideas.filter((d) => d.buyable).length} the kitchen can buy completely: ${r.ideas.map((d) => `${d.name}${d.buyable ? "" : ` (needs ${d.missing.map((m) => m.ingredient).join(", ")})`}`).join("; ")}.`, { ideasId: r.ideasId });
  // The reason, short and whole: its first clause, cut at a comma when it runs long, never mid-phrase.
  const short = (t: string) => {
    const x = t.replace(/^[^:—]*[:—]\s*/, "").split(/(?<=[.;])\s/)[0].replace(/[.;]$/, "");
    return x.split(/\s+/).length <= 12 ? x : "";
  };
  const lines = r.ideas.slice(0, 4).map((d, i) => {
    const groups = [...new Set(d.missing.map((m) => (m.group ? m.group.split(":")[0].toLowerCase() : m.ingredient.toLowerCase())))];
    const can = d.buyable
      ? { en: "you can buy it all", fi: "kaiken voi ostaa", sv: "allt går att köpa" }[lang]
      : { en: `needs ${groups.join(", ")}, which your rules don't cover`, fi: `tarvitsee: ${groups.join(", ")}, joita sääntönne eivät kata`, sv: `behöver ${groups.join(", ")}, som era regler inte omfattar` }[lang];
    const why = d.reason ? short(d.reason) : "";
    return `${i + 1}. ${nameL(d, lang)}${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""} (${can}).`;
  });
  return `${lines.join("\n")}\n${{ en: "Which one shall I plan?", fi: "Minkä niistä suunnittelen?", sv: "Vilken ska jag planera?" }[lang]}`;
}

async function pick(run: TurnRun, ideas: Ideas, d: Ideas["ideas"][number], lang: Lang): Promise<string> {
  const s = step(run, "plan", lang === "fi" ? `Suunnittelen: ${nameL(d, lang)}, hinnat suoraan tukusta` : lang === "sv" ? `Planerar ${nameL(d, lang)} med priser direkt från grossisten` : `Planning ${nameL(d, lang)} with live prices`);
  const { pickIdea } = await import("@/server/agent/menu/thread");
  let g = await pickIdea(run.k.info.slug, ideas.ideasId, d.dishId, byLine(run), lang, { ...(ideas.covers ? { covers: ideas.covers } : {}), ...(ideas.date ? { date: ideas.date } : {}) });
  s.done();
  // No day named ("next week", or none): the first delivery day on which every ingredient can arrive, said as the day.
  let moved: string | undefined;
  if (!ideas.date && !g.complete) {
    const { adoptPlan: adopt, earliestWholeDay } = await import("./menu");
    await adopt(run, g.planId);
    const until = /\b(next week|ensi viikolla|nästa vecka)\b/i.test(ideas.words) ? nextSunday() : undefined;
    moved = await earliestWholeDay(run, g.planId, { move: true, ...(until ? { until } : {}) }).catch(() => undefined);
    if (moved) g = await (await import("@/server/agent/menu/thread")).dishGroups(run.k.info.slug, g.planId, lang);
  }
  const { adoptPlan } = await import("./menu");
  await adoptPlan(run, g.planId);
  delete stateOf(run).ideas;
  run.dishesFor = { planId: g.planId };
  record(run, "dish_picked", `The buyer picked ${d.name}: ${g.covered} of ${g.of} ingredients covered${g.complete ? " (the whole dish)" : ""}.`, { planId: g.planId, complete: g.complete });
  // A dish fully covered: its price and the one question, with the day. Not covered: said by the difference check
  // (engine.ts tellDifferences) with the ways forward, never "Shall I order it?".
  const money = (c: number) => `**${(c / 100).toFixed(2).replace(".", ",")} €**`;
  const { dayWords } = await import("./refusal");
  const day = g.day ? `{{${dayWords(g.day, lang)}}}` : "";
  const name = nameL(d, lang);
  const first = moved ? { en: `The first day everything can arrive is ${day}, so I've planned it for then. `, fi: `Kaikki ehtii aikaisintaan ${day}, joten suunnittelin sen silloin. `, sv: `Allt hinner fram tidigast ${day}, så jag har planerat den dit. ` }[lang] : "";
  if (g.complete)
    return first + {
      en: `${name}${g.covers ? ` for ${g.covers}` : ""}: ${money(g.totalToOrderCents)} for what I'll order${g.perCoverCents ? `, ${money(g.perCoverCents)} a portion` : ""}. Shall I order it${day ? ` for ${day}` : ""}?`,
      fi: `${name}${g.covers ? ` ${g.covers} hengelle` : ""}: tilattavat ${money(g.totalToOrderCents)}${g.perCoverCents ? `, ${money(g.perCoverCents)} annokselta` : ""}. Tilaanko sen${day ? ` (${day})` : ""}?`,
      sv: `${name}${g.covers ? ` för ${g.covers}` : ""}: ${money(g.totalToOrderCents)} för det jag beställer${g.perCoverCents ? `, ${money(g.perCoverCents)} per portion` : ""}. Ska jag beställa den${day ? ` till ${day}` : ""}?`,
    }[lang];
  return first ? `${first.trim()}` : name;
}

/** The Sunday that ends next week (Helsinki). */
function nextSunday(): string {
  const today = localNow(new Date()).date;
  let d = addDaysIso(today, 1);
  while (isoWeekday(d) !== 1) d = addDaysIso(d, 1);
  return addDaysIso(d, 6);
}

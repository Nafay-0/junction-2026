import { randomBytes } from "node:crypto";
import { isStepCount, ToolLoopAgent, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { localNow } from "@/core/kitchen";
import { createModel, defaultModel } from "@/server/agent/models";
import { yesOrNo } from "@/server/channels/speech";
import { overview } from "@/server/kitchen-portal";
import { reserveLlmCall } from "@/server/limits";
import { callTool } from "@/server/mcp/server";
import { TOOLS } from "@/server/mcp/tools";
import { cardId, gateCard, orderCard } from "./cards";
import { withFallback } from "./fallback";
import { byLine, combineItems, orderFromWords, record, REPEAT_SCALED, repeatScaled, runAction, step, type ItemOutcome, type TurnRun } from "./pipeline";
import { ADDITION, isShort, subjectLine, subjectOf, type Subject } from "./subject";
import type { Card, RecordsCard, ThreadAction } from "./types";
import { earlierFor } from "./earlier";
import { speakFacts } from "./speak";

/**
 * The kitchen's agent on the AI SDK's agent loop (ToolLoopAgent). It orchestrates and converses; the plain-code
 * engine (pipeline.ts) and the gate do the work. Its tool table is the one the open interface publishes
 * (server/mcp/tools.ts, every tool run through the same callTool the MCP door uses) plus four thread tools.
 *
 *   order           the buyer's words → the reader → the intake → cards (and a routine order placed alone)
 *   buyer_reply     the newest buyer words mapped onto a card that is open now (checked by code)
 *   order_history   "what did we order last week?" → a records card
 *   find_products, product_facts, show_home   the home's cards (home.ts): the assortment, one product, the kitchen's records
 *   await_sign_off  pauses the loop until the named person signs on their phone: the runtime's approval step,
 *                   answered only by the server when the passkey sign-off is recorded
 *
 * The published tools that carry a buyer's answer or commit to an order (respond_to_concerns, answer_questions,
 * choose_option, place_order, submit_need, open_request, request_quote) are in the table but not offered to the
 * model (activeTools), and the runtime's approval layer denies them if it ever calls one (toolApproval): those steps
 * are the buyer's, through buyer_reply and the cards, or the engine's.
 */

export const AGENT_INSTRUCTIONS = `You are the purchasing agent of one restaurant or catering kitchen, working inside its wholesaler's food-service store. The buyer talks to you in words; you answer in a few plain sentences. Plain code does the work (reading the request, the kitchen's history, live prices, the kitchen's rules, the order): you call it through your tools and say what it found. Its results are true; your words must be too.

How to work each turn:
- The buyer wants to buy something, change or repeat an order, adjust an amount, ask for a variant ("is there a lactose-free one?"), or names several items: call order with their own words, copied exactly. One call per message is enough: several items in one message become one order by code. For "same as last Thursday but 20 % more" or "make it 200 litres", pass the words as they are: code reads them against earlier requests.
- The buyer's newest words answer something open (listed under OPEN DECISIONS): call buyer_reply with the matching ref. "the second one", "the cheaper one", "the soup" pick a choice; "make it 12" or "Monday is fine" change the order to confirm (pass amount or date); "yes, order it", "go ahead" confirm. Only use refs that are listed. A question is never a yes. If their words do not clearly pick one, ask one short question instead.
- After an order waits for a named person's OK (status pending_approval), write your sentences and call await_sign_off with its orderId in the same reply.
- The buyer wants to look around without ordering ("show me oat drinks"): find_products. About one product: product_facts. "What do I need to do today?", "our recurring orders", "what's arriving", "what do you remember about us": show_home.
- A dish or a menu for a number of covers ("lunch for 10 tomorrow", "salmon soup for 300 on Friday", "chocolate cake"), a booking at short notice ("unexpected booking for 40 tomorrow") or a menu around what is in season: plan_menu with their words. Open words get up to three menus to pick from.
- Every message is read in the light of the conversation so far (TALKING ABOUT NOW). A short follow-up fills in or changes that thing: "10 portions" after a dish sets its covers; "200 litres", "for Friday", "no, 200", "make it 40", "the organic one" complete or change the request on the table (call order with their words, code applies them); "and oat drink too" adds to the same order (order). Do it; do not ask them to confirm a change they just said. A new subject starts only when they clearly name a new thing. Never ask for what they already said in this conversation.
- Past orders: order_history. Rules, limits, who gives the OK, or a change to them ("never nuts", "raise the limit to 800"): rules, with the change when they ask for one; the buyer then confirms it with a yes, through buyer_reply. Say "confirm", never "sign" or "mandate". An order's status: get_order or explain.
- "Anything I should know about this week's orders?", "is this week's milk sorted?", "what's coming this week?": this_week. After the store said a watch moment (a product that cannot come, a held renewal), "yes", "switch", "the second one", "keep it", "the usual", "the new amount", "skip it" are buyer_reply with its watch: ref.
- "Anything new or worth trying?", "what's in season?": wholesaler_offer. After the store said an offer, the buyer's yes, no, "don't suggest this kind again" or "no offers at all" is buyer_reply (offer:yes, offer:no, offer:mute, offer:off); a no or a mute is acknowledged in one short sentence and never raised again.
- Anything else (a greeting, small talk, something outside buying food): one short sentence, no tool.

Your reply (the store shows it under the buyer's words, with your work folded away beneath it):
- Two to four plain sentences (never five), under 50 words in all, in the buyer's language (English, Finnish or Swedish: the language they wrote in).
- The most important thing first: what you can do, how much, for how much, on which day. Prices and days sit inside the sentence. If nothing can arrive in time, or the kind they asked for cannot be had, that is your first sentence, said once, with the reason.
- Mark a figure the eye should find (a price, an amount) like **1 010,00 €** or **1 000 L**, and a day or a time like {{Monday 16 Nov}} (in Finnish {{maanantaina 16.11.}}) or {{17.00}}. Nothing else is marked. No lists, no headings, no links, no ids, no codes.
- When something is open, end on it in a few words, one thing only: "Which one?" only when two or more can be ordered (the store lists them under your words); with one, "Shall I order it?" (with the day when it matters: "Shall I order it for Monday 16.11.?"); a rules change, "Shall I change it?". If it needs a person's OK, say so and whose, and why in a few words ("It's over your 500 € limit, so it needs your OK"): the store shows the OK button.
- A plain yes to your own proposal ("Is it still for 120 kids?") is a yes: act on it with the figure you proposed or the buyer gave earlier. A figure given once in the conversation is never asked for again.
- Never tell the buyer what to type or say (no "say ...", no "send the product name with the amount"): ask a question a plain yes or a few words answer. If you asked something last turn and the answer did not settle it, do not ask it again in other words: offer your best reading from what is on the table ("12 litres of the cream for the sauce?").
- Name the options in their order (n = 1 first, as the store lists them), so "the first one" is the one you named first. One product per option, each with its own price: never two options in one phrase ("Oatly Semi or Whole, 16,80 €"). When the buyer counts in another unit than the product (cartons, packs, boxes), say the amount in theirs too ("12 cartons of 1 L"). When the usual product cannot be had, say what changes for them: how it comes now (1 000 one-litre cartons instead of 100 boxes of 10 L) and the price difference when a result gives it.
- Exceptions come first, one clear sentence each: nothing can arrive in time (and the earliest day that can), the kind asked for cannot be had (and what stands in, and what differs), an amount looks unusual, it needs a person's OK (whose). Then the question that moves it on. Which products and order times stay in the steps.
- Never describe how you work inside ("the store treated your message", "the results", "my tools"): say what you found, what you did and what you need, as a person would.
- In Finnish, packs are said with their size: "1 000 yhden litran tölkkiä" (never "1 000 litran tölkkeinä"), "10 litran laatikko"; in English "10 l box", never "novobox".
- Every item the buyer asked for is on the order or named as left out, with why, in one sentence (notOnTheOrder). Never drop one without a word.
- Never say the kitchen's rules stop something unless a result names the rule (a refusal, a gate decision, an exclusion by the mandate); "nothing fits" for another reason (the day, stock, another kind of product) is said as that reason.
- Never call a product or a menu nut-free, gluten-free or lactose-free unless a result states it; "without nuts, as you asked" only when the result says the plan left them out.
- In English a day is "Monday 16 Nov"; in Finnish and Swedish "16.11.", whose own dot is never followed by another mark: end the sentence before the date or rephrase.
- When something cannot be done, say it in the first person ("I can't buy burger buns for this kitchen"), the kitchen's product groups in words (at most three), never a code, an id or a rule name, and end on the next step when there is one ("The owner can add bread under Your rules; shall I ask them?"). A refusal in the results already says it that way: keep its sense.
- Prices are before VAT: when a result gives the rate, say it once ("before 14 % VAT"), never on every price. A deposit is one clause on the total ("plus 4,80 € deposit"). A product left out by the kitchen's nutrition rules (a school's milk protein, sugar, salt) is one sentence with the figure ("Oat drink has 1 g protein per 100 ml, under the 3 g your rules ask for").
- Use only figures, products, days, times and claims that this turn's results state (the \`shown\` facts and the tool results). Euros with a comma for cents ("41,00 €"). Never say an order is placed, OK'd or delivered unless a result says so; a waiting order is waiting. An earlier delivery than the day asked is said as earlier.
- Do not describe how you searched or checked (the store shows those steps), and do not repeat what you said in an earlier turn. If memory answered something, a few words ("lactose-free, as always").
- No greetings, no apologies, no markdown beyond the two marks.`;

const PUBLISHED_FOR_MODEL = ["read_mandate", "read_kitchen_memory", "get_intake_step", "get_order", "explain"] as const;
const BUYERS_OR_ENGINES = ["submit_need", "respond_to_concerns", "answer_questions", "choose_option", "place_order", "open_request", "request_quote", "search_products", "check_availability"] as const;

/** One secret per process unless configured: an approval signed by another process (after a restart) is refused, and the card still updates from the order itself. */
const approvalSecret = process.env.DOCK_TOOL_APPROVAL_SECRET || randomBytes(32).toString("base64");

let modelForTests: { model: LanguageModel; id: string } | undefined;
/** Tests and recorded runs: the agent's model, instead of DOCK_AGENT_MODEL. */
export function setAgentModelForTests(m: { model: LanguageModel; id: string } | undefined): void {
  modelForTests = m;
}

export const AGENT_MODEL_DEFAULT = "anthropic:claude-opus-5-5";
export const AGENT_FALLBACK_DEFAULT = "anthropic:claude-fable-5-2";

function modelFor(spec: string | undefined, onFallback: (i: { from: string; to: string; reason: string }) => void): { model: LanguageModel; id: string } {
  if (modelForTests) return modelForTests;
  // Never a smaller model by accident: with Anthropic credentials and nothing set, Opus 5.5 (not the cheap default).
  const primarySpec = spec ?? (process.env.DOCK_AGENT_MODEL || (process.env.ANTHROPIC_API_KEY ? AGENT_MODEL_DEFAULT : defaultModel("DOCK_AGENT_MODEL")));
  if (!primarySpec) throw new DockError(503, "model_unavailable", "No model is configured for the store agent: set DOCK_AGENT_MODEL or a provider key.");
  const primary = createModel(primarySpec).model as LanguageModelV4;
  // The fallback is another model of the same tier, never a smaller one: Fable 5.2 when the primary is Opus 5.5.
  const fallbackSpec = process.env.DOCK_AGENT_FALLBACK_MODEL || (process.env.DOCK_INTERPRET_MODEL && process.env.DOCK_INTERPRET_MODEL !== primarySpec ? process.env.DOCK_INTERPRET_MODEL : primarySpec.startsWith("anthropic:") ? AGENT_FALLBACK_DEFAULT : undefined);
  const fallback = fallbackSpec && fallbackSpec !== primarySpec ? (createModel(fallbackSpec).model as LanguageModelV4) : undefined;
  const firstChunkMs = Number(process.env.DOCK_AGENT_FIRST_TOKEN_MS ?? 6000) || 6000;
  return { model: withFallback(primary, fallback, { firstChunkMs, totalMs: firstChunkMs * 3, onFallback }), id: primarySpec };
}

/** What the model sees of a tool result: short, no tokens or signatures. */
function compact(v: unknown, max = 2500): string {
  const s = JSON.stringify(v, (k, x) => (k === "quoteToken" || k === "confirmation" || k === "hash" || k === "prevHash" || k === "signature" ? undefined : x));
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const forModel = (items: ItemOutcome[]) =>
  items.map((i) => ({
    requestId: i.requestId,
    state: i.state,
    ...(i.notice ? { notice: i.notice.kind, message: i.notice.message } : {}),
    ...(i.concerns ? { flagged: i.concerns } : {}),
    ...(i.questions ? { questions: i.questions } : {}),
    ...(i.options ? { options: i.options.map((o) => ({ ref: o.ref, title: o.title, totalEur: (o.totalCents / 100).toFixed(2), delivery: o.deliveryDate, match: o.match })) } : {}),
    ...(i.placed ? { order: { orderId: i.placed.orderId, status: i.placed.status, totalEur: (i.placed.totalCents / 100).toFixed(2), ...(i.placed.approver ? { waitsFor: i.placed.approver } : {}) } } : {}),
  }));

// ---------- open decisions: what buyer_reply may map words onto ----------

export type OpenRef = { ref: string; label: string; action: ThreadAction; confirm?: boolean; /** The buyer's words must carry a number (packs or an amount) or a day for this one. */ needs?: "amount" | "date" };

/** The buyer asking for the quoted order in so many words (English, Finnish, Swedish). */
const ASKS_TO_ORDER = /(?<![\p{L}\p{N}])(order|buy|purchase|send it|tilaa|tilataan|osta|ostetaan|beställ|köp)(?![\p{L}\p{N}])/iu;

/** Every decision open in the thread right now, newest request first, with the ref the model may name. */
export async function openRefs(run: TurnRun): Promise<OpenRef[]> {
  const refs: OpenRef[] = [];
  const seen = new Set<string>();
  const cards = run.store.cards(run.thread).reverse();
  let c = 0;
  let q = 0;
  for (const { card } of cards) {
    if (!("requestId" in card) || !card.requestId || seen.has(`${card.type}:${card.requestId}`)) continue;
    seen.add(`${card.type}:${card.requestId}`);
    const requestId = card.requestId;
    if (card.type === "anomaly" && !card.answered) {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "needs_confirmation") continue;
      for (const k of s.concerns) {
        c++;
        if (k.confirmable) refs.push({ ref: `c${c}:confirm`, label: `confirm "${k.message}"`, action: { type: "concern", requestId, key: k.key, choice: "confirm" }, confirm: true });
        for (const x of k.corrections) refs.push({ ref: `c${c}:${x.id}`, label: `${x.label} (for "${k.message}")`, action: { type: "concern", requestId, key: k.key, choice: x.id } });
      }
    } else if (card.type === "question") {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "needs_input") continue;
      for (const x of s.questions) {
        q++;
        for (const o of x.options) refs.push({ ref: `q${q}:${o.id}`, label: `${o.label} (answer to "${x.text}")`, action: { type: "answer", requestId, questionId: x.id, optionId: o.id } });
      }
    } else if (card.type === "options" && !card.chosen && !refs.some((r) => r.ref.startsWith("o"))) {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "options_ready") continue;
      card.options.forEach((o, i) => refs.push({ ref: `o${i + 1}`, label: `order option ${i + 1}: ${o.title}, €${(o.totalCents / 100).toFixed(2)}, delivery ${o.deliveryDate}${o.match === "compromise" ? `, compromise: ${o.givesUp.join("; ")}` : ""}`, action: { type: "choose", requestId, optionId: o.optionId } }));
    } else if (card.type === "price") {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "quoted") continue;
      if (!(await placedAlready(run, requestId))) refs.push({ ref: "place", label: `order at the fixed price €${(card.totalCents / 100).toFixed(2)}`, action: { type: "place", requestId }, confirm: true });
    } else if (card.type === "gate" && card.outcome === "waiting" && card.orderId) {
      refs.push({ ref: "withdraw", label: "take back the order waiting for sign-off", action: { type: "withdraw", orderId: card.orderId } });
    }
  }
  const menu = [...cards].reverse().find((x) => x.card.type === "menu" && !x.card.sheetId && (x.card.stage === "ready" || x.card.stage === "choose"))?.card;
  if (menu?.type === "menu" && menu.stage === "choose") menu.proposals.forEach((p, i) => refs.push({ ref: `menu_p${i + 1}`, label: `cook menu ${i + 1}: ${p.title} (${p.dishes.join(", ")})`, action: { type: "menu_choose", planId: menu.planId, proposalId: p.proposalId } }));
  if (menu?.type === "menu" && (menu.stage === "ready" || menu.stage === "choose") && !menu.covers) refs.push({ ref: "menu:covers", label: "set how many covers (portions, people) the menu is for; pass amount", action: { type: "menu_covers", planId: menu.planId, covers: 1 }, needs: "amount" });
  if (menu?.type === "menu" && menu.stage === "choose") {
    /* the proposals above */
  } else if (menu?.type === "menu" && menu.stage === "ready" && menu.dayProblem?.earliest) {
    // Nothing can arrive on the day asked: the yes moves it to the earliest day that can (said first); then it is ordered.
    refs.push({ ref: "menu:earliest", label: `move the menu to ${menu.dayProblem.earliest}, the earliest day it can arrive (a yes to that question)`, action: { type: "menu_day", planId: menu.planId, date: menu.dayProblem.earliest }, confirm: true });
    refs.push({ ref: "menu:day", label: `move the menu to another day (possible: ${menu.days.filter((d) => d.available).map((d) => d.date).join(", ")}); pass date`, action: { type: "menu_day", planId: menu.planId, date: menu.serviceDate ?? "" }, needs: "date" });
  } else if (menu?.type === "menu" && menu.stage === "ready" && menu.totalCents > 0 && !menu.blockers.length) {
    refs.push({ ref: "menu", label: `order the menu (${menu.dishes.map((d) => d.name).join(", ")}), €${(menu.totalCents / 100).toFixed(2)}`, action: { type: "menu_to_sheet", planId: menu.planId }, confirm: true });
    // An amount of one ingredient in all ("12 litres" of the cream): its amount per cover, from the total the buyer said.
    if (menu.covers)
      for (const d of menu.dishes)
        for (const l of d.lines.filter((x) => (x.status === "ready" || x.status === "decide") && (x.perCover.unit === "ml" || x.perCover.unit === "g")).slice(0, 8))
          refs.push({ ref: `menu:${l.lineId}:amount`, label: `${l.ingredient} (${d.name}): ${l.need.amount} ${l.need.unit} in all now; pass the total the buyer said, with unit L or kg`, action: { type: "menu_line_per_cover", planId: menu.planId, lineId: l.lineId, dishId: d.dishId, amount: l.perCover.amount }, needs: "amount" });
    if (menu.covers) refs.push({ ref: "menu:covers", label: `change the number of covers (now ${menu.covers}); pass amount`, action: { type: "menu_covers", planId: menu.planId, covers: menu.covers }, needs: "amount" });
    if (menu.days.some((d) => d.available)) refs.push({ ref: "menu:day", label: `move the menu to another day (possible: ${menu.days.filter((d) => d.available).map((d) => d.date).join(", ")}); pass date`, action: { type: "menu_day", planId: menu.planId, date: menu.serviceDate ?? "" }, needs: "date" });
  }
  // The order sheet open now (several items, the usual, a menu or an option changed): ordered, or changed, in words.
  const { currentSheet } = await import("./sheet");
  // A menu scenario's question (a booking at short notice, a seasonal menu): answered in words.
  const { openScenario } = await import("./scenario");
  const sc = openScenario(run);
  if (sc) {
    refs.push({ ref: "scenario:yes", label: sc.pending.earliest ? `yes: plan it for ${sc.pending.earliest}` : "yes: the best stand-ins, onto the order sheet", action: { type: "scenario_answer", planId: sc.planId, answer: sc.pending.earliest ? { kind: "day", date: sc.pending.earliest } : { kind: "yes" } }, confirm: true });
    refs.push({ ref: "scenario:no", label: "no: order nothing for it", action: { type: "scenario_answer", planId: sc.planId, answer: { kind: "no" } } });
    sc.pending.options.slice(0, 4).forEach((o, i) => refs.push({ ref: `scenario:o${i + 1}`, label: `use stand-in ${i + 1} (${o.words.slice(0, 3).join(" ")})`, action: { type: "scenario_answer", planId: sc.planId, answer: { kind: "choose", optionId: o.optionId } } }));
  }
  // The watch's moment (a stock-out, a held renewal) said last turn or on the opening: answered in words.
  const { openWatch } = await import("./watch");
  const wc = openWatch(run);
  if (wc) {
    const holder = run.thread.turns.find((x) => x.role === "agent" && x.cards.some((c) => c.cardId === wc.cardId));
    const after = holder ? run.thread.turns.slice(run.thread.turns.indexOf(holder) + 1).filter((x) => x.role === "agent" && x.turnId !== run.turnId) : [];
    if (holder && after.length === 0) {
      const label: Record<string, string> = { switch: "yes, switch to the closest substitute", keep: "no, keep it as it is", renew_new: "renew at the new amount", usual: "renew at the usual amount", skip: "skip this week" };
      for (const a of wc.answers) refs.push({ ref: `watch:${a.startsWith("switch:") ? `alt${wc.answers.filter((x) => x.startsWith("switch:")).indexOf(a) + 2}` : a}`, label: a.startsWith("switch:") ? `switch to substitute ${wc.answers.filter((x) => x.startsWith("switch:")).indexOf(a) + 2} instead` : (label[a] ?? a), action: { type: "watch_answer", momentId: wc.momentId, answer: a }, ...(a === "switch" || a === "renew_new" || a === "usual" ? { confirm: a === "switch" } : {}) });
    }
  }
  // The wholesaler's offer said last turn (or on the opening): answered in words.
  const { openOffer } = await import("./offer");
  const offer = openOffer(run);
  if (offer) {
    const holder = run.thread.turns.find((x) => x.role === "agent" && x.cards.some((c) => c.cardId === offer.cardId));
    const after = holder ? run.thread.turns.slice(run.thread.turns.indexOf(holder) + 1).filter((x) => x.role === "agent" && x.turnId !== run.turnId) : [];
    if (holder && after.length === 0) {
      refs.push({ ref: "offer:yes", label: `yes to the wholesaler's offer of ${offer.name}: put it on an order to confirm`, action: { type: "offer_answer", offerId: offer.offerId, answer: "yes" }, confirm: true });
      refs.push({ ref: "offer:no", label: "no to the offer", action: { type: "offer_answer", offerId: offer.offerId, answer: "no" } });
      refs.push({ ref: "offer:mute", label: "don't suggest this kind again", action: { type: "offer_answer", offerId: offer.offerId, answer: "mute" } });
      refs.push({ ref: "offer:off", label: "no offers at all", action: { type: "offer_answer", offerId: offer.offerId, answer: "off" } });
    }
  }
  const sh = currentSheet(run);
  const sheetCard = sh ? run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "sheet" && c.sheetId === sh.sheetId) : undefined;
  if (sh && sheetCard?.type === "sheet" && sheetCard.state === "editing") {
    refs.push({ ref: "sheet", label: `order it as it stands: ${sheetCard.lines.map((l) => `${l.packs} × ${l.name}`).join(", ")}, €${(sheetCard.totalCents / 100).toFixed(2)}, delivery ${sheetCard.deliveryDate}`, action: { type: "sheet_place", sheetId: sh.sheetId, version: sheetCard.version }, confirm: true });
    sheetCard.lines.forEach((l, i) => {
      refs.push({ ref: `sheet:L${i + 1}:amount`, label: `change ${l.name} (now ${l.packs} packs of ${l.packSize} ${l.unit}); pass amount (packs, or litres/kilos)`, action: { type: "sheet_packs", sheetId: sh.sheetId, version: sheetCard.version, lineId: l.lineId, packs: l.packs }, needs: "amount" });
      if (sheetCard.lines.length > 1) refs.push({ ref: `sheet:L${i + 1}:remove`, label: `take ${l.name} off the order`, action: { type: "sheet_remove", sheetId: sh.sheetId, version: sheetCard.version, lineId: l.lineId } });
    });
    refs.push({ ref: "sheet:day", label: `move the delivery day (possible: ${sheetCard.days.filter((d) => d.available).map((d) => d.date).join(", ")}); pass date`, action: { type: "sheet_day", sheetId: sh.sheetId, version: sheetCard.version, date: sheetCard.deliveryDate }, needs: "date" });
  }
  // A change to the kitchen's rules waiting for the person's yes.
  const rules = [...cards].reverse().find((x) => x.card.type === "rules")?.card;
  if (rules?.type === "rules" && rules.proposal?.state === "open" && rules.proposal.canSign) {
    refs.push({ ref: "rules:confirm", label: `confirm the change to the rules: ${rules.diff.map((d) => `${d.field} ${d.before || "none"} → ${d.after || "none"}`).join("; ")}`, action: { type: "rules_sign", proposalId: rules.proposal.proposalId }, confirm: true });
    refs.push({ ref: "rules:cancel", label: "leave the rules as they are", action: { type: "rules_cancel", proposalId: rules.proposal.proposalId } });
  }
  for (const { card } of cards) {
    if (card.type !== "memory") continue;
    card.proposals.forEach((p, i) => {
      if (p.decided) return;
      refs.push({ ref: `m${i + 1}:keep`, label: `remember: ${p.question}`, action: { type: "remember", itemId: p.itemId, yes: true } });
      refs.push({ ref: `m${i + 1}:drop`, label: `do not remember: ${p.question}`, action: { type: "remember", itemId: p.itemId, yes: false } });
    });
    break;
  }
  return refs;
}

async function placedAlready(run: TurnRun, requestId: string): Promise<boolean> {
  return run.store.cards(run.thread).some((x) => x.card.type === "gate" && x.card.requestId === requestId && x.card.outcome !== "refused");
}

/** "When is the cut-off?": the order times of what is on the table (the newest options and price), from the offers. */
function orderTimes(cards: Card[]): string {
  const opts = cards.filter((c) => c.type === "options").at(-1);
  const price = cards.filter((c) => c.type === "price").at(-1);
  const lines: string[] = [];
  if (opts?.type === "options") for (const o of opts.options.slice(0, 3)) if (o.orderBy) lines.push(`${o.title}: order by ${o.orderBy} for delivery ${o.deliveryDate}`);
  if (price?.type === "price") lines.push(`the fixed price holds until ${price.expiresAt}, delivery ${price.deliveryDate}`);
  return lines.length ? `ORDER TIMES (the wholesaler's own, for "when is the cut-off?"): ${lines.join("; ")}.` : "";
}

/** The context the model gets each turn, after the cached instructions: today, the kitchen, and what is open. */
export function turnContext(run: TurnRun, refs: OpenRef[]): string {
  const today = localNow(new Date()).date;
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  // Orders waiting for a person's OK in this conversation (and the day's opening): what, how much, for whom. "The
  // manager already approved it, just place it" is about one of these: only the named person's own OK places it.
  const cardsNow = run.store.cards(run.thread).map((x) => x.card);
  const waiting = [
    ...cardsNow.filter((c) => c.type === "gate" && c.outcome === "waiting").map((c) => {
      const o = c.type === "gate" ? cardsNow.find((x) => x.type === "order" && x.orderId === c.orderId) : undefined;
      return c.type === "gate" ? `${o?.type === "order" ? `${(o.totalCents / 100).toFixed(2).replace(".", ",")} € (${o.lines.slice(0, 2).map((l) => `${l.quantity} × ${l.name}`).join(", ")}), delivery ${o.deliveryDate}` : "an order"} waits for ${c.approver?.name ?? "a person"}'s OK on their phone` : "";
    }),
    ...cardsNow.flatMap((c) => (c.type === "today" ? c.items.flatMap((i) => (i.kind === "sign_off" ? [`${(i.totalCents / 100).toFixed(2).replace(".", ",")} € (${i.lines.slice(0, 2).map((l) => `${l.quantity} × ${l.name}`).join(", ")}) waits for ${i.approver.name}'s OK on their phone`] : [])) : [])),
  ].filter((x, i, a) => x && a.indexOf(x) === i);
  return [
    `Today is ${weekday} ${today} (Helsinki). Kitchen: ${run.k.info.name}. You are ${run.k.info.agentName}. This turn came through the ${run.door === "voice" ? "voice door (spoken)" : "store (typed)"}.`,
    subjectLine(subjectOf(run)),
    refs.length ? `OPEN DECISIONS (ref: what it does):\n${refs.map((r) => `- ${r.ref}: ${r.label}`).join("\n")}` : "OPEN DECISIONS: none.",
    orderTimes(cardsNow),
    waiting.length ? `WAITING FOR A PERSON'S OK (you know these orders; say which one when asked; nobody but that person, with their own passkey, can place it): ${waiting.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- the agent ----------

export type AgentRunResult = { text: string; messages: ModelMessage[]; approval?: { approvalId: string; toolCallId: string; orderId: string }; items: ItemOutcome[]; model: string; context: string };

/** `context`: the turn context to use (a resumed sign-off wait reuses its own, so the conversation the model's reasoning is bound to stays the same). */
export async function runAgent(run: TurnRun, messages: ModelMessage[], opts: { words?: string; context?: string } = {}): Promise<AgentRunResult> {
  const items: ItemOutcome[] = [];
  const refs = await openRefs(run);
  const context = opts.context ?? turnContext(run, refs);
  const words = opts.words ?? run.buyer.text ?? "";
  let usedReply = false;

  const published: ToolSet = {};
  for (const t of TOOLS) {
    published[t.name] = tool({
      description: t.description,
      inputSchema: t.input,
      execute: async (args: unknown) => {
        try {
          const out = await callTool(run.rt, run.session, t, args);
          run.facts.push(out);
          return out as Record<string, unknown>;
        } catch (err) {
          if (err instanceof DockError) return { ok: false, error: { code: err.code, rule: err.rule, message: err.message } };
          throw err;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    });
  }

  const threadTools = {
    order: tool({
      description: "Start or change an order from the buyer's own words: read them, check them against the kitchen's history and the assortment, rank options with live prices, and place a routine order inside the mandate. Shows its work as cards.",
      inputSchema: z.object({ words: z.string().min(1).max(2000).describe("The buyer's words, copied exactly from their newest message (or the part of it about the purchase).") }),
      execute: async ({ words: w }) => {
        // The model may only pass on words the buyer said: anything else is read from the buyer's message itself.
        let said = words.includes(w.trim()) ? w.trim() : words;
        // "Switch auto-renew on for the weekly milk order": the kitchen's own choice for a recurring order (server/watch).
        const { autoRenewFromWords } = await import("./watch");
        const auto = await autoRenewFromWords(run, said);
        if (auto) return { done: "auto-renew", say: auto };
        // What the conversation is about now (subject.ts): a short follow-up completes, changes or adds to it.
        const subj = subjectOf(run);
        let followUp = false;
        let addTo: Extract<Subject, { kind: "need" }> | undefined;
        if (subj && isShort(said) && !REPEAT_SCALED.test(said)) {
          if (subj.kind === "incomplete") said = subj.usual && yesOrNo(said) === "yes" ? `${subj.words} ${subj.usual}` : `${subj.words} ${said}`;
          else if (subj.kind === "need" && ADDITION.test(said)) addTo = subj;
          else if (subj.kind === "need") followUp = true;
        }
        if (subj) record(run, "subject", `Talking about: ${subjectLine(subj).slice(0, 200)}; the buyer's words "${said.slice(0, 120)}" ${subj.kind === "incomplete" ? "complete it" : addTo ? "add to the same order" : followUp ? "change it" : "start a new request"}.`, { subject: subj.kind });
        // "Same as last week but 20 % more": a whole earlier order, scaled by code (the reader reads one item at a time).
        const scaled = await repeatScaled(run, said).catch(() => undefined);
        if (scaled) {
          items.push(...scaled);
          return forModel(scaled);
        }
        if (addTo) {
          // A further item for the order under discussion: the same day, and one order with it when both are ready.
          const out = await orderFromWords(run, said, [], { quietIfNotPurchase: true, ...(addTo.day ? { deliverBy: addTo.day } : {}) });
          const s0 = addTo.placed ? undefined : await run.rt.dock.intake.get(run.session, addTo.requestId).catch(() => undefined);
          if (s0?.state === "options_ready") {
            run.multi = true;
            const all = await combineItems(run, said, [{ words: addTo.words, requestId: addTo.requestId, state: s0.state }, ...out]);
            const sheet = all.filter((x) => x.sheet);
            items.push(...out, ...sheet);
            return forModel([...out, ...sheet]);
          }
          items.push(...out);
          return forModel(out);
        }
        const earlier = await earlierFor(run, said, { followUp });
        const out = await orderFromWords(run, said, earlier, { quietIfNotPurchase: true });
        items.push(...out);
        return forModel(out);
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    buyer_reply: tool({
      description: "The buyer's newest words answer one of the OPEN DECISIONS: pass its ref. Code checks that it is open and that a confirmation is a clear yes in their words.",
      inputSchema: z.object({
        ref: z.string().min(1).max(40).describe("A ref from OPEN DECISIONS, e.g. o2, c1:confirm, q1:cheapest, place, sheet, menu, rules:confirm, sheet:L1:amount, m1:keep."),
        amount: z.number().positive().optional().describe("For a ref that needs an amount: the number the buyer said"),
        unit: z.enum(["packs", "L", "kg", "covers"]).optional().describe("What that number counts, as the buyer said it"),
        date: z.iso.date().optional().describe("For a ref that needs a day: YYYY-MM-DD"),
      }),
      execute: async ({ ref, amount, unit, date }) => {
        const r0 = refs.find((x) => x.ref === ref);
        // A number or a day is taken only when the buyer's own words carry it (code checks; never the model's guess).
        let r = r0;
        if (r0?.needs === "amount") {
          // In their newest words, or in the words before, when this is the yes to the agent's reading of them.
          const prevBuyer = [...run.thread.turns].reverse().find((x) => x.role === "buyer" && x.turnId !== run.buyer.turnId);
          const inWords = (x: string) => amount !== undefined && new RegExp(`(?<![\\d.,])${String(amount).replace(".", "[.,]")}(?![\\d])`).test(x.replace(/\s+/g, ""));
          // A plain yes to the agent's own proposal ("Is it still for 120 kids?"): the figure the buyer gave earlier in this
          // conversation, or the one the agent proposed in its last words, stands. A figure given once is never asked again.
          const lastAgent = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId);
          const lastAgentLine = lastAgent?.role === "agent" ? (lastAgent.line ?? "") : "";
          const earlier = run.thread.turns.flatMap((x) => (x.role === "buyer" && x.text && x.turnId !== run.buyer.turnId ? [x.text] : []));
          const said = inWords(words) || (yesOrNo(words) === "yes" && ((prevBuyer?.role === "buyer" && !!prevBuyer.text && inWords(prevBuyer.text)) || inWords(lastAgentLine) || earlier.some(inWords)));
          if (amount === undefined || !said) return { ok: false, refused: "amount_not_in_words", say: "Ask the buyer for the number." };
          const a = r0.action;
          // "12 litres" is an amount of something, not a number of covers.
          if (a.type === "menu_covers" && /\d\s*(l\b|litr|liter|kg\b|kilo|g\b|dl\b|ml\b|cartons?|packs?|boxes|tölk|pakk|purk|laatik)/i.test(words)) return { ok: false, refused: "not_covers", say: "Those words are an amount of an ingredient, not covers: say your best reading of which ingredient, as a yes/no question." };
          if (a.type === "menu_covers") r = { ...r0, action: { ...a, covers: Math.round(amount) } };
          else if (a.type === "menu_line_per_cover") {
            const card = run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "menu" && c.planId === a.planId);
            const line = card?.type === "menu" ? card.dishes.flatMap((d) => d.lines).find((l) => l.lineId === a.lineId) : undefined;
            const covers = card?.type === "menu" ? card.covers : null;
            if (!line || !covers) return { ok: false, refused: "not_open", say: "That line is not on the menu now." };
            const total = unit === "L" || unit === "kg" || unit === undefined ? amount * 1000 : amount;
            r = { ...r0, action: { ...a, amount: Math.round((total / covers) * 10) / 10 } };
          }
          else if (a.type === "sheet_packs") {
            const card = run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "sheet" && c.sheetId === a.sheetId);
            const line = card?.type === "sheet" ? card.lines.find((l) => l.lineId === a.lineId) : undefined;
            const packs = !line || unit === "packs" || unit === undefined ? Math.round(amount) : Math.max(1, Math.ceil(amount / line.packSize - 1e-9));
            r = { ...r0, action: { ...a, packs } };
          }
        } else if (r0?.needs === "date") {
          if (!date) return { ok: false, refused: "day_not_in_words", say: "Ask the buyer which day." };
          const a = r0.action;
          if (a.type === "sheet_day" || a.type === "menu_day") r = { ...r0, action: { ...a, date } };
        }
        if (!r) return { ok: false, refused: "not_open", say: "That is not one of the open decisions. Ask the buyer which one they mean." };
        if (usedReply) return { ok: false, refused: "one_decision_per_message", say: "One decision per message." };
        // A confirmation is the buyer's only when their own newest words say so: a clear yes (for placing a quoted
        // order, also a word that asks for it). Not merely the absence of a no: with the kitchen's signed-in person at
        // the screen the answer is recorded as theirs, verified, so the model must not be able to give it for them
        // after "hmm", a question, an unrelated sentence, or text it was fed.
        const said = yesOrNo(words);
        if (r.confirm && said !== "yes" && !(said === "unclear" && (r.action.type === "place" || r.action.type === "sheet_place" || r.action.type === "menu_to_sheet") && ASKS_TO_ORDER.test(words))) return { ok: false, refused: "not_a_yes", say: `The buyer's words ("${words.slice(0, 80)}") are not a clear yes. Ask again; do not answer for them.` };
        usedReply = true;
        if (r.action.type === "remember") {
          const out = await remember(run, r.action.itemId, r.action.yes, words);
          return out;
        }
        // A widget's action (a menu picked, the order sheet changed or ordered, the rules confirmed): the same handler as a tap.
        const { runWidget } = await import("./widgets");
        if (await runWidget(run, r.action, words)) {
          if (r.action.type === "scenario_answer") {
            const { currentSheet } = await import("./sheet");
            const sheet = currentSheet(run);
            return { ok: true, done: "answered", say: run.scenarioReply, ...(sheet ? { orderToConfirm: { sheetId: sheet.sheetId, deliveryDate: sheet.deliveryDate } } : {}) };
          }
          if (r.action.type === "watch_answer") {
            const id = r.action.momentId;
            const c = run.store.cards(run.thread).map((x) => x.card).find((x) => x.type === "watch" && x.momentId === id);
            return { ok: true, done: "answered", say: c?.type === "watch" ? c.reply : undefined, ...([...run.orders.values()].at(-1) ? { order: { status: [...run.orders.values()].at(-1)!.status, totalEur: ([...run.orders.values()].at(-1)!.totalCents / 100).toFixed(2) } } : {}) };
          }
          if (r.action.type === "offer_answer") {
            const offerId = r.action.offerId;
            const c = run.store.cards(run.thread).map((x) => x.card).find((x) => x.type === "offer" && x.offerId === offerId);
            const { currentSheet } = await import("./sheet");
            const sheet = currentSheet(run);
            return { ok: true, done: `offer ${c?.type === "offer" ? c.state : "answered"}`, say: c?.type === "offer" ? c.reply : undefined, ...(c?.type === "offer" && c.state === "yes" && sheet ? { orderToConfirm: { sheetId: sheet.sheetId, deliveryDate: sheet.deliveryDate } } : {}) };
          }
          // "Go ahead" on a menu orders it: onto one order sheet, then that sheet through the gate, as its yes says.
          if (r.action.type === "menu_to_sheet") {
            const { currentSheet, placeSheet } = await import("./sheet");
            const s = currentSheet(run);
            if (s) {
              const o = await placeSheet(run, s.sheetId, s.version);
              return { ok: true, done: "menu ordered", order: { orderId: o.orderId, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), ...(o.approval ? { waitsFor: o.approval.approver.name } : {}) } };
            }
          }
          if (r.action.type === "sheet_place") {
            const o = [...run.orders.values()].at(-1);
            if (o) return { ok: true, done: "ordered", order: { orderId: o.orderId, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), ...(o.approval ? { waitsFor: o.approval.approver.name } : {}) } };
          }
          return { ok: true, done: r.action.type };
        }
        const out = await runAction(run, r.action, words);
        items.push(...out);
        return forModel(out);
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    plan_menu: tool({
      description: "A dish or a menu for a number of covers: the menu planner drafts the dishes, works out the ingredients, matches each to the assortment and prices them live, shown as a menu card that forms as it works; the buyer edits it in place and puts it on the order sheet.",
      inputSchema: z.object({ words: z.string().min(1).max(2000).describe("The buyer's words, copied exactly from their newest message.") }),
      execute: async ({ words: w }) => {
        const said = words.includes(w.trim()) ? w.trim() : words;
        // "10 portions" while a menu is on the table: its covers, not a new menu (subject.ts).
        const subj = subjectOf(run);
        const n = /(?<![\d.,])(\d{1,4})(?![\d.,])/.exec(said);
        const rest = said.replace(/(?<![\d.,])\d{1,4}(?![\d.,])/, " ").replace(/\b(portions?|people|persons?|covers?|guests?|servings?|for|make it|no|then|instead|annosta|annos|annokselle|hengelle|henkeä|hengen|henkilölle|ihmiselle|vierasta|ei|tee siitä|sitten|portioner|personer|gäster|för|nej)\b/giu, " ").replace(/[\s,.!]+/g, "");
        if (subj?.kind === "menu" && n && !rest) {
          const { runWidget } = await import("./widgets");
          await runWidget(run, { type: "menu_covers", planId: subj.planId, covers: Number(n[1]) }, words);
          record(run, "subject_covers", `"${said.slice(0, 60)}" sets the covers of the menu on the table to ${n[1]}.`, { planId: subj.planId });
          return { ok: true, done: "covers set on the menu on the table", covers: Number(n[1]) };
        }
        // Valio's two menu scenarios: a booking at short notice, or a menu around what is in season (scenario.ts).
        const { scenarioOf } = await import("@/server/agent/menu/thread");
        const kind = scenarioOf(said);
        if (kind) {
          const { sayScenario } = await import("./scenario");
          const c = await sayScenario(run, kind, said, run.lang ?? (/[äö]|huomen|lounas|varaus/i.test(said) ? "fi" : "en")).catch((err) => {
            console.error("[thread] scenario", err);
            return undefined;
          });
          if (c) return { said: c.kind, note: "the store shows the scenario's own words as your reply; write one short sentence only" };
        }
        // A follow-up about the menu on the table keeps what the conversation already said: its covers and its day.
        const onTable = subj?.kind === "menu" && subj.covers && !/\d/.test(said) ? ` (for ${subj.covers} covers${subj.day ? ` on ${subj.day}` : ""})` : "";
        const { menuFromWords } = await import("./menu");
        return menuFromWords(run, `${said}${onTable}`);
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    this_week: tool({
      description: "The buyer asks about this week's orders or deliveries, whether something is sorted, or what they should know ('anything I should know about this week's orders?', 'is the milk sorted?'): the wholesaler's watch over the kitchen's key products (a product that cannot come and its closest substitute, a standing order held because it drifted, what was renewed). The store says the watch's own words; nothing is ordered.",
      inputSchema: z.object({}),
      execute: async () => {
        const { sayWatch } = await import("./watch");
        const c = await sayWatch(run, { asked: true });
        if (!c) return { watch: "nothing: every key product this week can come as ordered. Say so in one sentence, or look at the orders with order_history." };
        run.watchAsked = c.momentId;
        return { watch: c.kind, said: "the store shows the watch's own sentence and question as your reply; write one short sentence only" };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    wholesaler_offer: tool({
      description: "The buyer asks what is new, in season or worth trying from the wholesaler: its selling agent's one offer for this kitchen, if it has one worth saying (signed, checked against the kitchen's rules). The store says the offer in its own words; nothing is ordered.",
      inputSchema: z.object({}),
      execute: async () => {
        const { sayOffer } = await import("./offer");
        const c = await sayOffer(run, { asked: true });
        if (!c) return { offer: "none: the wholesaler has nothing worth suggesting to this kitchen now. Say so in one sentence." };
        run.offerAsked = c.offerId;
        return { offer: c.name, said: "the store shows the offer's own sentence and question as your reply; write one short sentence only" };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    order_history: tool({
      description: "The kitchen's orders between two dates (inclusive), optionally one product family, for questions like 'what did we order last week?'. Shows them as a records card.",
      inputSchema: z.object({ from: z.iso.date().describe("YYYY-MM-DD"), to: z.iso.date().describe("YYYY-MM-DD"), family: z.string().max(40).optional().describe("e.g. milk, cream, butter") }),
      execute: async ({ from, to, family }) => {
        const st = step(run, "records", "Reading your order history");
        const ov = await overview(run.k);
        const rows = ov.orders
          .filter((o) => (o.deliveryDate || o.createdAt.slice(0, 10)) >= from && (o.deliveryDate || o.createdAt.slice(0, 10)) <= to)
          .filter((o) => !family || o.lines.some((l) => l.name.toLowerCase().includes(family.toLowerCase())) || ov.requests.some((r) => r.order?.orderId === o.orderId && r.family === family))
          .slice(0, 12);
        st.done(`${rows.length}`);
        const card: RecordsCard = {
          type: "records",
          cardId: cardId("records", run.turnId),
          question: words.slice(0, 200),
          rows: rows.map((o) => ({ kind: "order", label: o.lines.map((l) => `${l.quantity} × ${l.name}`).join(", "), totalCents: o.totalCents, date: o.deliveryDate, ref: o.requestId ?? o.orderId, detail: o.status })),
          ...(rows[0]?.requestId ? { repeat: { ref: rows[0].requestId, label: rows[0].lines[0]?.name ?? "" } } : {}),
          repeatable: true,
        };
        run.store.card(run.thread, run.turnId, card);
        run.facts.push(card);
        record(run, "memory_read", `Order history read for ${from}..${to}${family ? ` (${family})` : ""}: ${rows.length} orders.`, { from, to, family, orders: rows.map((r) => r.orderId) });
        return { orders: rows.map((o) => ({ delivered: o.deliveryDate, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), lines: o.lines.map((l) => `${l.quantity} × ${l.name}`) })) };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    find_products: tool({
      description: "Browse the assortment: products matching a few words (and optionally a category), shown as a grid of products the mandate allows, from master data only (no live price or stock until one goes on the order sheet). For 'show me oat drinks', 'what butters do you have?'. Not for ordering: use order for that.",
      inputSchema: z.object({ query: z.string().max(120).describe("A few words for the product, e.g. 'oat drink', 'butter'."), category: z.string().max(40).optional().describe("A category id, only if the buyer named one.") }),
      execute: async ({ query, category }) => {
        const st = step(run, "products", "Looking through the assortment");
        const { productsCard } = await import("./home");
        const c = await productsCard(run, query, category);
        st.done(`${c.total}`);
        return { shown: c.products.length, total: c.total, products: c.products.slice(0, 8).map((p) => p.name) };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    product_facts: tool({
      description: "One product's facts as a card: pack, allergens, certificates, origin, carbon, delivery reliability (master data). For 'what's in the Arla butter?' after a product grid or sheet showed it.",
      inputSchema: z.object({ productId: z.string().min(1).max(80).describe("A productId from a tool result in this conversation.") }),
      execute: async ({ productId }) => {
        const { productCard } = await import("./home");
        const c = await productCard(run, productId);
        return { name: c.product.name, allergens: c.product.allergens, certificates: c.product.certificates };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    show_home: tool({
      description: "Show one of the kitchen's own records as a card: what needs them today, their order history, recurring orders, upcoming deliveries, or what the agent remembers about them.",
      inputSchema: z.object({ what: z.enum(["today", "history", "standing", "deliveries", "memory"]) }),
      execute: async ({ what }) => {
        const { runHomeAction } = await import("./home");
        await runHomeAction(run, { type: "home_show", what });
        // What the card holds, in counts only: enough for one true sentence ("nothing needs you today").
        const card = [...run.store.agentTurn(run.thread, run.turnId)!.cards].reverse().find((c) => ["today", "records", "standing", "deliveries", "memory_list"].includes(c.type));
        const n = !card ? 0 : card.type === "today" ? card.items.length : card.type === "records" ? card.rows.length : card.type === "standing" || card.type === "deliveries" || card.type === "memory_list" ? card.items.length : 0;
        return { shown: what, items: n, ...(card?.type === "today" ? { kinds: card.items.map((i) => i.kind) } : {}) };
      },
    }),
    rules: tool({
      description: "The kitchen's rules: its signed mandate (limits, budget, product groups, required claims, forbidden allergens, who signs, lead days) and its stated rules, as a rules card. With a change, the card shows before and after and waits for the kitchen's signed-in person to sign it; nothing is signed by this tool.",
      inputSchema: z.object({
        change: z
          .object({
            forbidAdd: z.array(z.string().max(40)).max(14).optional().describe("Allergens to forbid, e.g. nuts, peanuts, sesame"),
            forbidRemove: z.array(z.string().max(40)).max(14).optional(),
            requireAdd: z.array(z.string().max(40)).max(5).optional().describe("Claims every product must have: lactose_free, gluten_free, organic, vegan, vegetarian"),
            requireRemove: z.array(z.string().max(40)).max(5).optional(),
            perOrderLimitEur: z.number().optional().describe("The most the agent may spend on one order alone, in euros, exactly as the buyer said"),
            weeklyBudgetEur: z.number().optional(),
            maxLeadDays: z.number().int().optional(),
            signer: z.string().max(60).optional().describe("Who signs off, as the buyer named them"),
            substitution: z.enum(["within_preferences", "needs_approval", "none"]).optional(),
          })
          .optional()
          .describe("Only when the buyer asks for a change. Leave out to show the rules."),
      }),
      execute: async ({ change }) => {
        const { groundedChange, showRules } = await import("./rules");
        const { change: kept, dropped } = change ? groundedChange(change, words) : { change: undefined, dropped: [] as string[] };
        const card = await showRules(run, kept && Object.keys(kept).length ? kept : undefined);
        return { shown: card.proposal ? "proposal" : "rules", ...(card.proposal ? { kind: card.proposal.kind, canSign: card.proposal.canSign, ...(card.proposal.why ? { why: card.proposal.why } : {}), changes: card.diff.map((d) => `${d.field}: ${d.before || "none"} -> ${d.after || "none"}`) } : {}), ...(dropped.length ? { notInTheirWords: dropped } : {}), confirmedBy: "nobody yet: the kitchen's person confirms it on the card" };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    await_sign_off: tool({
      description: "Wait for the named person to sign the order off on their own phone. Call it once, right after an order is pending_approval. The loop pauses until they decide.",
      inputSchema: z.object({ orderId: z.string().min(1).max(60) }),
      execute: async ({ orderId }) => {
        const o = await run.rt.dock.getOrder(run.session, orderId);
        run.facts.push(o);
        run.store.card(run.thread, run.turnId, gateCard(o));
        run.store.card(run.thread, run.turnId, orderCard(o));
        return { orderId, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), ...(o.approval ? { decidedBy: o.approval.approver.name, decision: o.approval.status } : {}) };
      },
    }),
  };

  // Every thread tool shows the model what the buyer now has in front of them (speak.ts): its reply is written from
  // those facts and checked against them.
  for (const t of Object.values(threadTools) as { toModelOutput?: unknown }[])
    t.toModelOutput = ({ output }: { output: unknown }) => {
      try {
        return { type: "text" as const, value: compact({ result: output, shown: speakFacts(run) }, 6000) };
      } catch (e) {
        console.error("[speak]", e);
        return { type: "text" as const, value: compact(output) };
      }
    };
  const tools = { ...published, ...threadTools } as ToolSet;
  let fellBack = "";
  const { model, id } = modelFor(undefined, (i) => {
    fellBack = i.to;
    run.store.step(run.thread, run.turnId, { stepId: `fb${Date.now()}`, kind: "model", label: "The first model did not answer in time; a second one answers", status: "done", startedAt: new Date().toISOString(), detail: i.reason });
    record(run, "model_fallback", `The agent's model ${i.from} did not answer in time (${i.reason}); ${i.to} answered instead.`, i);
  });

  const deny = (why: string) => ({ type: "denied" as const, reason: why });
  const agent = new ToolLoopAgent({
    id: "dock-store-agent",
    model,
    instructions: [
      { role: "system", content: AGENT_INSTRUCTIONS, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
      { role: "system", content: context },
    ],
    tools,
    activeTools: [...PUBLISHED_FOR_MODEL, "order", "plan_menu", "buyer_reply", "order_history", "find_products", "product_facts", "show_home", "rules", "await_sign_off", "wholesaler_offer", "this_week"],
    toolApproval: {
      ...Object.fromEntries(BUYERS_OR_ENGINES.map((n) => [n, deny(`${n} is the buyer's decision or the engine's step in the store: use buyer_reply or order.`)])),
      // The pause for a person's sign-off. Only the server answers it, when the passkey sign-off is recorded.
      await_sign_off: { type: "user-approval", reason: "Waiting for the named person's passkey sign-off on their phone." },
    },
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: isStepCount(5),
    maxOutputTokens: 600,
    telemetry: { functionId: "thread.agent" },
    reasoning: (process.env.DOCK_AGENT_REASONING as "low" | "medium" | "high" | "none" | undefined) ?? "low",
    prepareStep: async () => {
      reserveLlmCall(); // the daily caps: every agent step counts (server/limits.ts)
      return {};
    },
    repairToolCall: async ({ toolCall, error }) => {
      // A call to a tool the model may not use, or with arguments that do not fit: dropped, recorded, never guessed at.
      record(run, "tool_call_repaired", `The agent's call to ${toolCall.toolName} did not fit its schema and was dropped (${String((error as Error).message).slice(0, 160)}).`, { tool: toolCall.toolName });
      return null;
    },
  });

  const result = await agent.stream({ messages, timeout: { totalMs: 90_000, toolMs: 60_000 } });
  for await (const part of result.fullStream) {
    if (part.type === "tool-call" && !["order", "plan_menu", "buyer_reply", "order_history", "find_products", "product_facts", "show_home", "await_sign_off", "wholesaler_offer", "this_week"].includes(part.toolName)) {
      const st = step(run, `tool:${part.toolName}`, LABELS[part.toolName] ?? `Looking up ${part.toolName.replace(/_/g, " ")}`);
      void result.steps.then(() => st.done(), () => st.fail());
    }
  }
  const [text, response, content] = await Promise.all([result.text, result.response, result.content]);
  let approval: AgentRunResult["approval"];
  for (const p of content) {
    if (p.type === "tool-approval-request" && !p.isAutomatic && p.toolCall.toolName === "await_sign_off") {
      approval = { approvalId: p.approvalId, toolCallId: p.toolCall.toolCallId, orderId: String((p.toolCall.input as { orderId?: string }).orderId ?? "") };
    }
  }
  return { text: text.trim(), messages: response.messages, approval, items, model: fellBack || id, context };
}

const LABELS: Record<string, string> = {
  read_mandate: "Reading your mandate",
  read_kitchen_memory: "Reading what we remember about your kitchen",
  get_intake_step: "Checking where the request stands",
  get_order: "Checking the order",
  explain: "Reading the audit trail",
};

/** A memory proposal kept or dropped by the kitchen's person (memory service confirm), shown on its card. */
export async function remember(run: TurnRun, itemId: string, yes: boolean, words?: string): Promise<Record<string, unknown>> {
  const { getMemoryService } = await import("@/server/memory/runtime");
  const memory = await getMemoryService();
  const st = step(run, "memory", yes ? "Remembering it" : "Leaving it out");
  try {
    const r = await memory.confirm(run.session.mandate.issuer.orgId, itemId, yes, run.person?.name ?? run.k.info.by);
    st.done(r.outcome);
    record(run, "memory_write", `${yes ? "Kept" : "Dropped"} a memory proposal (${itemId}): ${r.outcome}.`, { itemId, yes, outcome: r.outcome, ...(words ? { heard: words.slice(0, 300) } : {}) });
    for (const { turnId, card } of run.store.cards(run.thread)) {
      if (card.type === "memory" && card.proposals.some((p) => p.itemId === itemId)) {
        run.store.card(run.thread, turnId, { ...card, proposals: card.proposals.map((p) => (p.itemId === itemId ? { ...p, decided: yes ? ("kept" as const) : ("dropped" as const) } : p)) });
      }
    }
    return { ok: true, outcome: r.outcome };
  } catch (err) {
    st.fail(err instanceof DockError ? err.code : undefined);
    if (err instanceof DockError) return { ok: false, error: err.message };
    throw err;
  }
}

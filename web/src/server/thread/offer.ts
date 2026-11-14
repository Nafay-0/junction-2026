import { answerOffer, offerAnswerOf, offerForThread, offerOnSheet, type OfferAnswer } from "@/server/offers/thread";
import { byLine, record, step, type TurnRun } from "./pipeline";
import { cardId } from "./cards";
import type { OfferCard } from "./types";

/**
 * The wholesaler's offer in the conversation (server/offers, docs/offers.md): at most one, never in the middle of
 * something the buyer is doing. It is said on the day's opening, after an order is finished, or when the buyer asks
 * what is new; answered in words (yes, no, "don't suggest this kind again", offers off). A yes puts it on an order
 * sheet, which is ordered like any other. Nothing here orders.
 */

type Lang = "en" | "fi" | "sv";

/** The open offer said in this thread, if any (the newest). */
export function openOffer(run: TurnRun): OfferCard | undefined {
  const c = run.store.cards(run.thread).map((x) => x.card).filter((x): x is OfferCard => x.type === "offer").at(-1);
  return c?.state === "open" ? c : undefined;
}

/** Whether this thread has said an offer already (one per conversation). */
const saidOne = (run: TurnRun) => run.store.cards(run.thread).some((x) => x.card.type === "offer");

/**
 * The offer, as a card in this turn, when one is worth saying and none was said yet. `force`: the buyer asked for
 * suggestions (said even when one was said before, if it is still open: the same one).
 */
export async function sayOffer(run: TurnRun, opts: { asked?: boolean } = {}): Promise<OfferCard | undefined> {
  if (!opts.asked && saidOne(run)) return undefined;
  const open = openOffer(run);
  if (open) return opts.asked ? open : undefined;
  const st = step(run, "offer", "Asked the wholesaler's selling agent");
  try {
    const name = run.k.info.name;
    const [en, fi, sv] = await Promise.all((["en", "fi", "sv"] as Lang[]).map((l) => offerForThread(run.rt, run.session, name, l)));
    if (!en) {
      st.done("nothing worth suggesting");
      return undefined;
    }
    const card: OfferCard = {
      type: "offer",
      cardId: cardId("offer", `${run.turnId}:${en.offerId}`),
      offerId: en.offerId,
      productId: en.productId,
      name: en.name,
      text: { en: { say: en.say, ask: en.ask }, fi: { say: fi?.say ?? en.say, ask: fi?.ask ?? en.ask }, sv: { say: sv?.say ?? en.say, ask: sv?.ask ?? en.ask } },
      steps: en.steps,
      proof: { token: en.proof.token, keysUrl: en.proof.keysUrl, verified: en.proof.verified },
      validUntil: en.validUntil,
      state: "open",
    };
    run.store.card(run.thread, run.turnId, card);
    run.facts.push(card, en.facts);
    st.done(en.name);
    record(run, "offer_said", `The wholesaler's offer ${en.offerId} (${en.name}) was said in the conversation${opts.asked ? ", as asked" : ""}.`, { offerId: en.offerId, productId: en.productId });
    return card;
  } catch (err) {
    st.fail();
    console.error("[thread] offer", err);
    return undefined;
  }
}

/** The answer in words, read by plain code: "don't suggest this kind again" and "no offers at all" win over a no. */
export function offerAnswerIn(words: string, fallback?: OfferAnswer): OfferAnswer | undefined {
  const a = offerAnswerOf(words);
  return a === "mute" || a === "off" ? a : (a ?? fallback);
}

/** The buyer answered the offer: done and recorded; a yes opens an order sheet with it. Returns the agent's line. */
export async function answerOfferIn(run: TurnRun, offerId: string, answer: OfferAnswer, words: string | undefined, lang: Lang): Promise<{ reply: string; sheetId?: string }> {
  const card = run.store.cards(run.thread).map((x) => x.card).find((c): c is OfferCard => c.type === "offer" && c.offerId === offerId);
  const who = { by: byLine(run), via: run.door === "voice" ? "voice" : "typed", ...(words ? { words } : {}), name: run.person?.name ?? run.k.info.name, lang };
  const r = await answerOffer(run.rt, run.session, offerId, answer, who);
  let reply = r.reply ?? "";
  let sheetId: string | undefined;
  let requestId: string | undefined;
  if (r.answer === "yes" && r.sheet) {
    const { createSheet } = await import("./sheet");
    const sheet = await createSheet(run, { lines: [{ productId: r.sheet.productId, packs: r.sheet.packs }], ...(r.sheet.deliveryDate ? { deliveryDate: r.sheet.deliveryDate } : {}), text: r.sheet.text, category: r.sheet.category });
    const { currentSheet } = await import("./sheet");
    sheetId = sheet.sheetId;
    requestId = sheet.requestId ?? currentSheet(run)?.requestId;
    if (requestId) reply = await offerOnSheet(run.rt, run.session, offerId, who, requestId);
  }
  if (card) run.store.card(run.thread, run.turnId, { ...card, state: r.answer, ...(reply ? { reply } : {}), ...(requestId ? { requestId } : {}) });
  record(run, "offer_answer", `The buyer answered the wholesaler's offer ${offerId}: ${r.answer}${words ? ` ("${words.slice(0, 80)}")` : ""}.`, { offerId, answer: r.answer, ...(requestId ? { requestId } : {}) });
  return { reply, ...(sheetId ? { sheetId } : {}) };
}

import { yesOrNo } from "@/server/channels/speech";

/**
 * Two questions open after one reply: the receipt ("Shall I email the receipt?") and the wholesaler's offer ("Shall I
 * add it?"). The buyer's words decide which they answer: "add it", "take it", "order it" is the offer; "email it", "the
 * receipt" is the receipt. A plain "yes" goes to the question asked last in the reply; the other stays open.
 */
const NAMES_MAIL = /(?<![\p{L}])(e-?mail\p{L}*|mail|receipts?|kuitti\p{L}*|sähköpost\p{L}*|mejl\p{L}*|kvitto\p{L}*)(?![\p{L}])/iu;
const NAMES_OFFER = /(?<![\p{L}])(add|take|try|order|buy|get|lisää|ota|tilaa|kokeil\p{L}*|lägg|ta|beställ|köp)(?![\p{L}])/iu;

export function whichQuestion(words: string, line: string, mailAsk: string, offerAsk: string | undefined): "mail" | "offer" | undefined {
  if (yesOrNo(words) !== "yes" && !NAMES_MAIL.test(words) && !NAMES_OFFER.test(words)) return undefined;
  const mailAt = line.indexOf(mailAsk);
  const offerAt = offerAsk ? line.indexOf(offerAsk) : -1;
  if (mailAt < 0) return offerAsk ? "offer" : undefined;
  if (!offerAsk) return "mail";
  if (NAMES_MAIL.test(words)) return "mail";
  if (NAMES_OFFER.test(words)) return "offer";
  // A plain yes: the question said last. An offer said as a card only (not in the sentence) is newer than the reply's words.
  return offerAt > mailAt || offerAt < 0 ? "offer" : "mail";
}

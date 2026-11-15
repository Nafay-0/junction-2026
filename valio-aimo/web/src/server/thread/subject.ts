import { ownTurns } from "./visitor";
import type { TurnRun } from "./pipeline";
import type { Card } from "./types";

/**
 * What the conversation is about now: the newest thing still open in the thread (a request that could not be read
 * whole yet, a request with its options or questions, a menu). A short follow-up ("10 portions", "for Friday", "no,
 * 200", "and oat drink too") attaches to it instead of starting a new request with holes in it. A side question
 * ("what did we spend this week?") does not change the subject: its turn is passed over. Plain code, from the cards.
 */
export type Subject =
  | { kind: "incomplete"; turnId: string; words: string; missing: string[]; usual?: string }
  | { kind: "need"; turnId: string; words: string; requestId: string; item: string; amount?: { amount: number; unit: string }; day?: string; placed: boolean }
  | { kind: "menu"; turnId: string; planId: string; stage: string; covers: number | null; day?: string; dishes: string[] };

/** Turns that only look things up leave the subject where it was. */
const SIDE = new Set<Card["type"]>(["records", "rules", "today", "products", "standing", "deliveries", "memory_list", "offer", "watch", "scenario", "dishes"]);

export function subjectOf(run: TurnRun): Subject | undefined {
  // What this browser session opened: another visitor's request in a shared kitchen is not the subject (visitor.ts).
  const turns = ownTurns(run.thread.turns);
  let seen = 0;
  for (let i = turns.length - 1; i >= 0 && seen < 8; i--) {
    const t = turns[i];
    if (t.role !== "agent" || t.turnId === run.turnId) continue;
    seen++;
    const cards = t.cards;
    const menu = [...cards].reverse().find((c) => c.type === "menu");
    if (menu?.type === "menu") {
      if (menu.stage === "ordered" || menu.stage === "declined" || menu.sheetId) return undefined;
      return { kind: "menu", turnId: t.turnId, planId: menu.planId, stage: menu.stage, covers: menu.covers, ...(menu.serviceDate ? { day: menu.serviceDate } : {}), dishes: menu.dishes.map((d) => d.name).slice(0, 6) };
    }
    const u = [...cards].reverse().find((c) => c.type === "understood" && c.requestId);
    if (u?.type === "understood" && u.requestId) {
      const placed = run.store.cards(run.thread).some((x) => (x.card.type === "order" || x.card.type === "gate") && x.card.requestId === u.requestId && (x.card.type === "order" || x.card.outcome !== "refused"));
      return { kind: "need", turnId: t.turnId, words: u.words, requestId: u.requestId, item: u.item, ...(u.amount ? { amount: u.amount } : {}), ...((u.deliverOn ?? u.deliverBy) ? { day: u.deliverOn ?? u.deliverBy } : {}), placed };
    }
    const inc = cards.find((c) => c.type === "notice" && c.kind === "incomplete");
    if (inc?.type === "notice") {
      const buyer = turns.find((x) => x.turnId === t.replyTo);
      const words = inc.words ?? (buyer?.role === "buyer" ? buyer.text : undefined);
      if (words) return { kind: "incomplete", turnId: t.turnId, words, missing: inc.missing ?? [], ...(inc.usual ? { usual: inc.usual } : {}) };
    }
    // A sheet or an order of its own ends the subject; a look-up only turn is passed over.
    if (cards.some((c) => c.type === "sheet" || c.type === "order")) return undefined;
    if (cards.length && cards.every((c) => SIDE.has(c.type) || c.type === "notice")) continue;
    if (!cards.length) continue;
    return undefined;
  }
  return undefined;
}

/** "And oat drink too", "also 6 kg of butter", "ja kermaa myös": a further item for the same order. */
export const ADDITION = /^\s*(and|also|plus|as well|ja|sekä|lisäksi|myös|och|även|samt)\b|\b(too|as well|also|myös|lisäksi|kanssa|också|även)\s*[.!]?\s*$/iu;

/** A short follow-up: a few words, no new sentence of its own. */
export const isShort = (words: string) => words.trim().split(/\s+/).length <= 8;

/** How the subject reads for the model, in one line (the turn context). */
export function subjectLine(s: Subject | undefined): string {
  if (!s) return "";
  if (s.kind === "incomplete") return `TALKING ABOUT NOW: the request "${s.words.slice(0, 120)}", still missing ${s.missing.join(" and ") || "a detail"}${s.usual ? ` (the kitchen's usual is ${s.usual}: a yes takes it)` : ""}. A short answer, or a yes, completes it: call order with the buyer's words (code joins them to the request).`;
  if (s.kind === "need")
    return `TALKING ABOUT NOW: ${s.item}${s.amount ? `, ${s.amount.amount} ${s.amount.unit}` : ""}${s.day ? `, for ${s.day}` : ""}${s.placed ? " (ordered)" : ""}. A short follow-up changes it ("for Friday", "no, 200", "the organic one") or adds to the same order ("and oat drink too"): call order with the buyer's words; code applies them to this request. Never ask again for what the buyer already said.`;
  return `TALKING ABOUT NOW: the menu${s.dishes.length ? ` (${s.dishes.join(", ")})` : ""}${s.covers ? ` for ${s.covers} covers` : ", covers not given yet"}${s.day ? `, for ${s.day}` : ""}. A number of covers or portions sets its covers (buyer_reply menu:covers with the amount); a day moves it (menu:day).`;
}

/** Words that frame an amount or a day, not what is bought ("2 kg of … for Friday", "make it 5 litres please"). */
const FRAME = /^(\d+([.,]\d+)?|of|for|the|a|an|on|by|to|at|and|please|thanks|i|we|need|want|order|get|make|it|them|some|more|just|only|instead|then|yes|no|ok|okay|l|ltr|litres?|liters?|kg|kilos?|kilograms?|g|grams?|dl|ml|cl|packs?|pcs|pieces?|boxes?|bottles?|cartons?|cases?|cans?|tomorrow|today|next|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|ja|tilaa|tarvitsen|litraa|kiloa|kg:aa|pakkausta|kappaletta|kpl|laatikkoa|huomiseksi|huomenna|maanantaiksi|tiistaiksi|keskiviikoksi|torstaiksi|perjantaiksi|lauantaiksi|sunnuntaiksi|och|jag|vi|behöver|beställ|liter|kilo|förpackningar|st|lådor|till|imorgon|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)$/i;

/** The unit an amount is given in (en, fi, sv). */
const UNIT = /^(l|ltr|litres?|liters?|kg|kilos?|kilograms?|g|grams?|dl|ml|cl|packs?|pcs|pieces?|boxes?|bottles?|cartons?|cases?|cans?|litra|litraa|kiloa|kg:aa|pakkausta|kappaletta|kpl|laatikkoa|liter|kilo|förpackningar|st|lådor)$/i;

/**
 * Words that can follow an amount without naming anything new to buy: verbs and hedges ("should do", "is enough"),
 * pointers back to the waiting item ("the same", "the Valio one", "that"), sizes, and the catalogue's common brands.
 */
const FILLER = /^(should|would|could|will|shall|can|may|might|must|does|are|was|per|each|every|total|altogether|max|min|minimum|maximum|less|enough|fine|good|great|perfect|now|asap|soon|tonight|delivered|delivery|deliver|this|that|these|those|same|usual|one|ones|kind|type|sort|brand|version|size|sized|big|small|large|with|without|into|from|all|again|too|also|actually|sorry|thank|you|like|not|but|organic|luomu|lactose|free|valio|arla|oatly|atria|fazer|paulig|alpro|planti|juustoportti|pirkka|eila|kiitos|riittää|yhteensä|sama|samaa|tavallista|tavallinen|tack|räcker|totalt|samma|vanliga)$/i;

/**
 * Whether short words complete the request that waits for its amount or day ("5 litres", "about five litres", "5 l of
 * the Valio one, for Friday"), or are a new request of their own ("2 kg of chicken breast for Friday" while
 * "lactose-free whipping cream" waits for an amount).
 *
 * They complete it unless they are plainly a request of their own: an amount with its unit, followed at once by a
 * word that names something the waiting request does not ("2 kg of chicken …", "10 litres oat drink"). Anything less
 * certain completes the waiting request, as answering the question asked is by far the common case.
 */
export function completesIncomplete(waiting: string, said: string): boolean {
  const words = (t: string) => t.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s.,:-]/gu, " ").split(/[\s-]+/).map((w) => w.replace(/^[.,:]+|[.,:]+$/g, "")).filter(Boolean);
  const known = words(waiting);
  const same = (w: string) => known.some((k) => k === w || k === `${w}s` || `${k}s` === w || (k.length >= 4 && w.length >= 4 && k.slice(0, 4) === w.slice(0, 4)));
  const all = words(said);
  const NUM = /^\d+([.,]\d+)?$/;
  const at = all.findIndex((w, i) => (NUM.test(w) && UNIT.test(all[i + 1] ?? "")) || /^\d+([.,]\d+)?(l|kg|g|dl|ml|cl)$/i.test(w));
  if (at < 0) return true; // no amount with a unit: the words answer the question, whatever else they say
  const next = all.slice(at + (NUM.test(all[at]) ? 2 : 1)).find((w) => !/^(of|the|a|an|some)$/.test(w));
  if (!next || next.length < 3 || /^\d/.test(next)) return true;
  return FRAME.test(next) || FILLER.test(next) || same(next);
}

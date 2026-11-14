import type { TurnRun } from "./pipeline";
import type { Card } from "./types";

/**
 * What the conversation is about now: the newest thing still open in the thread (a request that could not be read
 * whole yet, a request with its options or questions, a menu). A short follow-up ("10 portions", "for Friday", "no,
 * 200", "and oat drink too") attaches to it instead of starting a new request with holes in it. A side question
 * ("what did we spend this week?") does not change the subject: its turn is passed over. Plain code, from the cards.
 */
export type Subject =
  | { kind: "incomplete"; turnId: string; words: string; missing: string[] }
  | { kind: "need"; turnId: string; words: string; requestId: string; item: string; amount?: { amount: number; unit: string }; day?: string; placed: boolean }
  | { kind: "menu"; turnId: string; planId: string; stage: string; covers: number | null; day?: string; dishes: string[] };

/** Turns that only look things up leave the subject where it was. */
const SIDE = new Set<Card["type"]>(["records", "rules", "today", "products", "standing", "deliveries", "memory_list", "offer"]);

export function subjectOf(run: TurnRun): Subject | undefined {
  const turns = run.thread.turns;
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
      if (words) return { kind: "incomplete", turnId: t.turnId, words, missing: inc.missing ?? [] };
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
  if (s.kind === "incomplete") return `TALKING ABOUT NOW: the request "${s.words.slice(0, 120)}", still missing ${s.missing.join(" and ") || "a detail"}. A short answer completes it: call order with the buyer's words (code joins them to the request).`;
  if (s.kind === "need")
    return `TALKING ABOUT NOW: ${s.item}${s.amount ? `, ${s.amount.amount} ${s.amount.unit}` : ""}${s.day ? `, for ${s.day}` : ""}${s.placed ? " (ordered)" : ""}. A short follow-up changes it ("for Friday", "no, 200", "the organic one") or adds to the same order ("and oat drink too"): call order with the buyer's words; code applies them to this request. Never ask again for what the buyer already said.`;
  return `TALKING ABOUT NOW: the menu${s.dishes.length ? ` (${s.dishes.join(", ")})` : ""}${s.covers ? ` for ${s.covers} covers` : ", covers not given yet"}${s.day ? `, for ${s.day}` : ""}. A number of covers or portions sets its covers (buyer_reply menu:covers with the amount); a day moves it (menu:day).`;
}

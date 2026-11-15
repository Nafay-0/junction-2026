import type { PublicOrder } from "@/core/orders";
import type { Fulfilment } from "@/server/fulfilment/service";
import type { Runtime } from "@/server/runtime";
import { threadStore } from "./engine";
import type { AgentTurn, OrderCard } from "./types";

/**
 * The wholesaler's team decided on a placed order (server/fulfilment): the kitchen's conversation shows it at once if
 * it is open, and the next time it is opened otherwise. The order's card carries the state ("Confirmed by the
 * wholesaler's team"), and one quiet line is said beneath the reply that placed it. Nothing else in the thread changes.
 */

const WD = { en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], fi: ["sunnuntaiksi", "maanantaiksi", "tiistaiksi", "keskiviikoksi", "torstaiksi", "perjantaiksi", "lauantaiksi"], sv: ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"] } as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayOf(iso: string, lang: "en" | "fi" | "sv"): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return lang === "en" ? `${WD.en[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : lang === "fi" ? `${WD.fi[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.` : `${WD.sv[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** The conversation's language, from what was said in it (the thread keeps no language of its own). */
function langOf(lines: string[]): "en" | "fi" | "sv" {
  const t = lines.join(" ");
  if (/\b(tilasin|tilaus|tilauksen|kiinteään|hyväksyntä\w*|toimitus\w*)\b/i.test(t)) return "fi";
  if (/\b(beställ\w*|jag har|leverans\w*)\b/i.test(t)) return "sv";
  return "en";
}

/** The sentence said in the conversation. */
export function fulfilmentLine(card: Pick<OrderCard, "lines" | "deliveryDate">, f: Pick<Fulfilment, "state" | "reason">, lang: "en" | "fi" | "sv"): string {
  const l = card.lines[0];
  const what = l ? `${l.name.split(",")[0]!.replace(/[®™]/g, "").trim()}` : "";
  const day = card.deliveryDate ? dayOf(card.deliveryDate, lang) : "";
  if (f.state === "confirmed")
    return { en: `The wholesaler's team confirmed your order${what ? ` of ${what}` : ""}${day ? ` for ${day}` : ""}.`, fi: `Tukkurin tiimi vahvisti tilauksesi${what ? ` (${what})` : ""}${day ? ` ${day}` : ""}.`, sv: `Grossistens team bekräftade din beställning${what ? ` av ${what}` : ""}${day ? ` till ${day}` : ""}.` }[lang];
  return { en: `The wholesaler's team could not confirm your order${what ? ` of ${what}` : ""}${day ? ` for ${day}` : ""}${f.reason ? `: ${f.reason}` : ""}. Shall I look for another option?`, fi: `Tukkurin tiimi ei voinut vahvistaa tilaustasi${what ? ` (${what})` : ""}${f.reason ? `: ${f.reason}` : ""}. Etsinkö toisen vaihtoehdon?`, sv: `Grossistens team kunde inte bekräfta din beställning${what ? ` av ${what}` : ""}${f.reason ? `: ${f.reason}` : ""}. Ska jag leta efter ett annat alternativ?` }[lang];
}

export async function sayFulfilment(_rt: Runtime, order: Pick<PublicOrder, "orderId" | "orgId">, f: Fulfilment): Promise<void> {
  const store = await threadStore();
  for (const t of store.all()) {
    if (t.orgId !== order.orgId) continue;
    const holder = t.turns.find((x): x is AgentTurn => x.role === "agent" && x.cards.some((c) => c.type === "order" && c.orderId === order.orderId));
    if (!holder) continue;
    const card = holder.cards.find((c): c is OrderCard => c.type === "order" && c.orderId === order.orderId)!;
    store.card(t, holder.turnId, { ...card, fulfilment: { state: f.state, at: f.at, ...(f.reason ? { reason: f.reason } : {}) } });
    const lang = (t as unknown as { lang?: "en" | "fi" | "sv" }).lang ?? langOf(t.turns.flatMap((x) => (x.role === "agent" && x.line ? [x.line] : [])).slice(-4));
    const said = fulfilmentLine(card, f, lang);
    const before = holder.line ?? "";
    if (!before.includes(said)) store.line(t, holder.turnId, before ? `${before}\n${said}` : said);
    store.save(t);
  }
}

import { isoWeekday, type HistoryEntry, type KitchenProfile } from "@/core/kitchen";
import { SPEC_DIMENSIONS } from "@/core/need";
import type { Candidate, Interaction, InteractionEvent } from "./model";

/**
 * Candidates made by plain code from what Dock itself recorded: taps, answers, substitutes and committed orders.
 * They need no model and carry their own evidence (the event or the order ids), so they cannot be invented.
 */

/** A standing order needs four orders on the same weekday over at least three different weeks, within eight weeks. */
export const STANDING_MIN_ORDERS = 4;
export const STANDING_MIN_WEEKS = 3;
/** A delivery-days habit needs six deliveries in eight weeks, all on at most three weekdays. */
export const DAYS_MIN_DELIVERIES = 6;
export const DAYS_MAX_WEEKDAYS = 3;
const WINDOW_DAYS = 56;
const STANDING_RECENT = 8;

export function fromEvents(interaction: Interaction): Candidate[] {
  return interaction.events.flatMap((e, i) => fromEvent(e, `event:${i}`));
}

function fromEvent(e: InteractionEvent, event: string): Candidate[] {
  const evidence = { event };
  switch (e.type) {
    case "option_chosen": {
      // A choice is behaviour: a faint habit for the product (and its pack), strengthened by each repeat. Accepting
      // the option Dock pre-selected is the habit confirming itself; choosing another one goes against it.
      const out: Candidate[] = [{ fact: { kind: "product", productId: e.productId, name: e.name, stance: "prefer" }, family: e.family, strength: "habit", explicit: false, origin: "learned", evidence }];
      if (e.packSize && e.unit) out.push({ fact: { kind: "pack", packSize: e.packSize, unit: e.unit, stance: "prefer" }, family: e.family, strength: "habit", explicit: false, origin: "learned", evidence });
      if (e.brand) out.push({ fact: { kind: "brand", brand: e.brand, stance: "prefer" }, family: e.family, strength: "habit", explicit: false, origin: "learned", evidence });
      return out;
    }
    case "substitute":
      // A person tapped yes or no on a substitute: a record of their decision, with their reason if they gave one.
      return [
        {
          fact: { kind: "substitute", ...(e.forProductId ? { forProductId: e.forProductId } : {}), ...(e.forName ? { forName: e.forName } : {}), ...(e.productId ? { productId: e.productId } : {}), name: e.name, accepted: e.accepted, ...(e.reason ? { reason: e.reason } : {}) },
          family: e.family,
          strength: "habit",
          explicit: true,
          origin: "stated",
          evidence,
          weight: 0.8,
        },
      ];
    case "answer": {
      // An answer the person asked to remember is already a stated preference (the intake writes it; memory
      // adopts it). Without "remember" it is one data point for a habit.
      if (e.remember) return [];
      const dim = SPEC_DIMENSIONS.find((d) => `dim:${d.id}` === e.questionId);
      if (dim && e.optionId !== "no_preference") return [{ fact: { kind: "spec", dimension: dim.id, choice: e.optionId }, family: e.family, strength: "habit", explicit: false, origin: "learned", evidence }];
      if (e.questionId === "optimise" && ["price", "co2", "reliability"].includes(e.optionId)) {
        return [{ fact: { kind: "goal", goal: e.optionId as "price" }, family: e.family, strength: "habit", explicit: false, origin: "learned", evidence }];
      }
      return [];
    }
    case "rule_stated":
      return [{ fact: e.fact, family: e.family, scope: e.scope, strength: e.strength ?? "rule", explicit: true, origin: "stated", evidence, ...(e.text ? { text: e.text } : {}) }];
    default:
      return []; // concern responses act on the cited items directly; committed orders feed fromHistory
  }
}

/** Standing orders and delivery days read from the order history, each with the orders it rests on. */
export function fromHistory(profile: KitchenProfile, now: Date): Candidate[] {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const recent = profile.history.filter((h) => h.placedAt >= since);
  const out: Candidate[] = [];
  const byFamilyDay = new Map<string, HistoryEntry[]>();
  for (const h of recent) {
    const k = `${h.family}|${isoWeekday(dayOf(h))}|${h.unit}`;
    byFamilyDay.set(k, [...(byFamilyDay.get(k) ?? []), h]);
  }
  for (const [k, hs] of byFamilyDay) {
    const [family, wd] = k.split("|");
    const last = hs.sort((a, b) => a.placedAt.localeCompare(b.placedAt)).slice(-STANDING_RECENT);
    const weeks = new Set(last.map((h) => weekOf(dayOf(h))));
    if (last.length < STANDING_MIN_ORDERS || weeks.size < STANDING_MIN_WEEKS) continue;
    const amounts = last.map((h) => h.amount).sort((a, b) => a - b);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
    out.push({
      fact: { kind: "standing_order", weekdays: [Number(wd)], amount: median, unit: last[0].unit, low: amounts[0], high: amounts.at(-1)! },
      family,
      strength: "habit",
      explicit: false,
      origin: "learned",
      evidence: { orderIds: last.map((h) => h.orderId) },
      weight: Math.min(1, 0.4 + 0.1 * last.length),
    });
  }
  const deliveries = recent.map(dayOf);
  const weekdays = [...new Set(deliveries.map(isoWeekday))].sort();
  if (deliveries.length >= DAYS_MIN_DELIVERIES && weekdays.length <= DAYS_MAX_WEEKDAYS && weekdays.length < profile.deliveryWeekdays.length) {
    out.push({ fact: { kind: "delivery_days", weekdays }, strength: "habit", explicit: false, origin: "learned", evidence: { orderIds: recent.map((h) => h.orderId) }, weight: 0.7 });
  }
  return out;
}

/** The day the kitchen asked for: an order is delivered "by" that day, so the delivery date can be earlier. */
const dayOf = (h: HistoryEntry) => h.neededBy ?? h.deliveryDate;

/** Monday of the ISO week of a date, as a key. */
function weekOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (isoWeekday(date) - 1));
  return d.toISOString().slice(0, 10);
}

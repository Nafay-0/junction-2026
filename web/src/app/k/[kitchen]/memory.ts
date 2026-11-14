import type { NeedInput } from "@/core/need";
import type { EarlierRequest } from "../../_client/interpret";
import { amount, day, helsinkiToday, shortProduct } from "../../_ui/plain";
import type { PortalRequest } from "./types";

/**
 * How the shop remembers: earlier requests become context for follow-ups ("same again but 200 litres"), and a
 * one-click repeat rebuilds an earlier need with plain code (no model) and a fresh delivery date.
 */

/** Words that refer back to an earlier request, in English, Finnish and Swedish. */
const FOLLOW_UP = /\b(same|again|repeat|like (last|on|before)|as (last|on|before)|last (mon|tue|wed|thu|fri|sat|sun)\w*|uudestaan|samat?|sama kuin|kuten|viime|viimeksi|toista|samma|igen|som (i|förra|sist)|förra)\b/i;

export function looksLikeFollowUp(text: string): boolean {
  return FOLLOW_UP.test(text);
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay() || 7;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next date after today on the same weekday as `iso` (tomorrow at the earliest). */
export function nextSameWeekday(iso: string, today = helsinkiToday()): string {
  const want = weekdayOf(iso);
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === want) return d;
  }
  return addDays(today, 7);
}

function orderedLine(r: PortalRequest): string | null {
  const o = r.order;
  if (!o) return null;
  return `${o.lines.map((l) => `${l.quantity} x ${l.name}`).join(" + ")}${o.status === "committed" || o.status === "history" ? "" : ` (${o.status.replace("_", " ")})`}`;
}

/** The structured need an order from the history stands for, when there was no request. */
function needFromOrder(r: PortalRequest): NeedInput | undefined {
  const o = r.order;
  const main = o?.lines[0];
  if (!o || !main) return undefined;
  const total = o.lines.reduce((s, l) => s + l.quantity * (l.packSize ?? 1), 0);
  const unit = (main.unit as "L" | "kg" | "pcs" | undefined) ?? "pcs";
  return {
    item: { text: main.name, ...(r.family ? { category: r.family } : {}), attributes: (main.attributes ?? []).filter((a) => a === "lactose_free" || a === "organic" || a.startsWith("fat_")) },
    quantity: { amount: Math.round(total * 100) / 100, unit },
  };
}

export function needOf(r: PortalRequest): NeedInput | undefined {
  return (r.need as NeedInput | undefined) ?? needFromOrder(r);
}

export function toEarlier(r: PortalRequest): EarlierRequest {
  const need = needOf(r);
  const { text: _t, ...rest } = (need ?? {}) as NeedInput;
  void _t;
  return {
    id: r.key,
    at: r.at,
    text: r.text,
    need: need ? (rest as Record<string, unknown>) : null,
    ordered: orderedLine(r),
    deliveredOn: r.order?.deliveryDate ?? (need?.deliverBy as string | undefined) ?? null,
  };
}

/** Earlier requests worth giving the interpreter: real requests and orders, newest first. */
export function earlierFor(requests: PortalRequest[], max = 6): EarlierRequest[] {
  return requests.filter((r) => r.kind !== "basket" || r.order).slice(0, max).map(toEarlier);
}

/** "your request of Tue 10.11. (“100 L milk for Thursday”)" or "your order of Thu 5.11." */
export function describeEarlier(r: PortalRequest): string {
  const d = day(helsinkiToday(new Date(r.at)));
  if (r.text) return `your request of ${d} (“${r.text.length > 60 ? `${r.text.slice(0, 57)}…` : r.text}”)`;
  return `your order of ${d}`;
}

const FIELD_WORD: Record<string, string> = { item: "the product", quantity: "the amount", attributes: "the requirements", optimise: "what matters most", allergens: "the allergens", deliverBy: "the day" };

export function memoryLineFor(r: PortalRequest, fields: string[]): string {
  const words = fields.map((f) => FIELD_WORD[f]).filter(Boolean);
  if (words.length === 0) return `Read against ${describeEarlier(r)}.`;
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return `From ${describeEarlier(r)}: ${list}, so not asked again.`;
}

/** A one-click repeat: the earlier need, its own words kept, delivered on the next same weekday. */
export function repeatNeed(r: PortalRequest, today = helsinkiToday()): { need: NeedInput; memoryLine: string } | undefined {
  const need = needOf(r);
  if (!need) return undefined;
  const was = (need.deliverBy as string | undefined) ?? r.order?.deliveryDate;
  const deliverBy = was ? nextSameWeekday(was, today) : undefined;
  const qty = need.quantity ? amount(need.quantity.amount, need.quantity.unit) : "the same amount";
  const text = r.text ? `Repeat: ${r.text.replace(/^(Repeat: )+/, "")}` : `Repeat of the order of ${day(helsinkiToday(new Date(r.at)))}: ${r.order ? r.order.lines.map((l) => `${l.quantity} × ${shortProduct(l.name)}`).join(" + ") : qty}`;
  const next: NeedInput = { ...need, text: text.slice(0, 2000), sameAsLastTime: false };
  if (deliverBy) next.deliverBy = deliverBy;
  else delete next.deliverBy;
  const line = `Repeats ${describeEarlier(r)}: ${qty}${deliverBy ? `, now for ${day(deliverBy)}, the next ${day(deliverBy).slice(0, 3)}` : ""}. Nothing asked that it already answered.`;
  return { need: next, memoryLine: line };
}

"use client";

import { useEffect, useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { artFor } from "../../_ui/art";
import { clock, money } from "../../_ui/plain";
import { AlternativesPicker, OrderSheet, type Candidate, type DayChoice, type Outcome, type PickerCell, type SheetLine } from "../../_ui/widgets";
import type { AlternativesCard, BuyerTurn, GatePreview, OrderCard, SheetCard, Thread, ThreadAction } from "@/server/thread/types";
import { usePortal } from "./portal";
import { THREAD_SHEET_TEXT } from "./thread-sheet.text";

type Tap = (action: ThreadAction, label: string) => void;
type Tx = (typeof THREAD_SHEET_TEXT)["en"];

/**
 * The order sheet and the alternatives picker (server/thread/sheet.ts) drawn with the design kit's OrderSheet and
 * AlternativesPicker (docs/DESIGN.md §7b). The card is one order: lines, day, total, what will happen and the one
 * button that says it. Edits are turns through the same engine and gate; they do not appear as bubbles in the
 * conversation (the sheet changes in place), and only the confirm button orders.
 */

/** Edits made in place: no bubble for the tap, no empty agent turn after it (the card itself changes). */
export const QUIET_ACTIONS = new Set<ThreadAction["type"]>(["sheet_packs", "sheet_day", "sheet_swap", "sheet_remove", "sheet_alternatives", "alt_rerank", "alt_pick", "menu_covers", "menu_day", "menu_line_swap", "menu_line_have", "menu_line_per_cover", "menu_accept"]);

export function isQuiet(t: BuyerTurn): boolean {
  if (!t.action) return false;
  if (t.action.type === "sheet_add") return !!t.action.sheetId; // an undo; "add" from the catalogue stays visible
  return QUIET_ACTIONS.has(t.action.type);
}

const sheetOfAction = (a: ThreadAction | undefined): string | undefined => {
  if (!a) return undefined;
  if ("sheetId" in a && typeof a.sheetId === "string") return a.sheetId;
  if ((a.type === "alt_rerank" || a.type === "alt_pick") && a.pickerId.startsWith("pk_")) return `sh_${a.pickerId.slice(3).split("_")[0]}`;
  return undefined;
};

/** A turn touching this sheet is still on its way: the sheet shows it is updating and holds its buttons. */
function sheetWorking(t: Thread | undefined, pending: BuyerTurn[], sheetId: string): boolean {
  if (pending.some((p) => sheetOfAction(p.action) === sheetId)) return true;
  const buyers = new Map((t?.turns ?? []).flatMap((x) => (x.role === "buyer" ? [[x.turnId, x] as const] : [])));
  return (t?.turns ?? []).some((x) => x.role === "agent" && x.status === "working" && sheetOfAction(buyers.get(x.replyTo)?.action) === sheetId);
}

const firstName = (name: string | undefined) => (name ?? "").split(/\s+/)[0] || (name ?? "");

/** "Sun 17.00" for an order-by time: as written (Helsinki) when it has no offset, else in Helsinki. */
export function whenText(at: string, day: (iso: string) => string): string {
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(at);
  if (local) return `${day(local[1]).split(" ")[0]} ${local[2]}.${local[3]}`;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return at;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${day(date).split(" ")[0]} ${clock(d)}`;
}

const detail = (g: GatePreview, rule: string, key: string): number | undefined => {
  const v = g.rules.find((r) => r.rule === rule)?.details?.[key];
  return typeof v === "number" ? v : undefined;
};

/** What the gate's own preview says will happen on confirm, in the kitchen's words, and the button's words. */
export function outcomeOf(g: GatePreview, totalCents: number, tx: Tx): { outcome: Outcome; confirm: string } {
  const total = money(totalCents);
  if (g.outcome === "auto_approve") {
    const limit = detail(g, "per_order_limit", "limitCents");
    return { outcome: { kind: "alone", text: limit !== undefined ? tx.alone.limit(money(limit)) : tx.alone.plain }, confirm: tx.confirm.alone(total) };
  }
  if (g.outcome === "needs_human_approval") {
    const who = firstName(g.approver?.name) || "—";
    const rule = g.rules.find((r) => r.outcome === "escalate" && !(r.rule === "weekly_budget" && !r.details?.budgetCents))?.rule ?? g.rule ?? "";
    const text =
      rule === "per_order_limit"
        ? tx.sign.per_order_limit(who, money(detail(g, "per_order_limit", "limitCents") ?? 0))
        : rule === "weekly_budget"
          ? tx.sign.weekly_budget(who, money(detail(g, "weekly_budget", "budgetCents") ?? 0))
          : rule in tx.sign && rule !== "other"
            ? (tx.sign[rule as "substitution_rule"] as (w: string) => string)(who)
            : tx.sign.other(who);
    return { outcome: { kind: "sign", text }, confirm: tx.confirm.sign(who, total) };
  }
  const rule = g.rule ?? "";
  const text = rule === "weekly_budget" ? tx.blocked.weekly_budget(money(detail(g, "weekly_budget", "budgetCents") ?? 0)) : rule in tx.blocked && rule !== "other" ? (tx.blocked[rule as "category_allowed"] as string) : tx.blocked.other;
  return { outcome: { kind: "blocked", text }, confirm: tx.confirm.blocked };
}

/** The newest card of this order in the thread (its status moves on as a person signs or it is taken back). */
function orderOf(t: Thread, orderId: string | undefined): OrderCard | undefined {
  if (!orderId) return undefined;
  let found: OrderCard | undefined;
  for (const x of t.turns) if (x.role === "agent") for (const c of x.cards) if (c.type === "order" && c.orderId === orderId) found = c;
  return found;
}

/** Orders that came from an order sheet: their sheet already says what was ordered, so the order card does not repeat it. */
export function sheetOrders(t: Thread | undefined): Set<string> {
  const out = new Set<string>();
  for (const x of t?.turns ?? []) if (x.role === "agent") for (const c of x.cards) if (c.type === "sheet" && c.orderId) out.add(c.orderId);
  return out;
}

export function SheetView({ card, tap, busy }: { card: SheetCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_SHEET_TEXT);
  const f = useFormat();
  const { thread: api, fieldRef } = usePortal();
  const working = sheetWorking(api.thread, api.pending, card.sheetId);
  const settled = card.state === "placed";
  const lock = busy || working;

  // The steppers: a run of taps is one edit, sent once the buyer stops (the server checks the sheet's version).
  const [rawDraft, setDraft] = useState<Record<string, number>>({});
  // Only what still differs from the card counts: a value the server has taken is no longer a draft.
  const draft = Object.fromEntries(Object.entries(rawDraft).filter(([id, n]) => card.lines.some((l) => l.lineId === id && l.packs !== n)));
  const [sentAt, setSentAt] = useState<number | undefined>(undefined);
  const waitingFor = sentAt !== undefined && card.version <= sentAt;
  const next = Object.entries(draft)[0];
  useEffect(() => {
    if (!next || waitingFor || working) return;
    const [lineId, packs] = next;
    const name = card.lines.find((l) => l.lineId === lineId)?.name ?? "";
    const timer = setTimeout(() => {
      setSentAt(card.version);
      tap({ type: "sheet_packs", sheetId: card.sheetId, version: card.version, lineId, packs }, tx.words.packs(name, packs));
    }, 650);
    return () => clearTimeout(timer);
  }, [next?.[0], next?.[1], waitingFor, working, card.version, card.lines, card.sheetId, tap, tx]); // eslint-disable-line react-hooks/exhaustive-deps
  // An edit the server refused (its notice says why) must not hold the steppers for ever: the card's numbers win.
  useEffect(() => {
    if (working || !waitingFor) return;
    const t = setTimeout(() => {
      setSentAt(undefined);
      setDraft({});
    }, 4000);
    return () => clearTimeout(t);
  }, [working, waitingFor]);

  const lines: SheetLine[] = card.lines.map((l) => {
    const packs = draft[l.lineId] ?? l.packs;
    const blocking = l.issues.find((i) => i.blocking && (i.code === "no_offer" || i.code === "short"));
    return {
      id: l.lineId,
      name: l.name,
      pack: f.measure(l.packSize, l.unit),
      art: artFor({ name: l.name, category: l.category }),
      packs,
      minPacks: l.minPacks,
      maxPacks: l.maxPacks,
      amount: f.measure(Math.round(packs * l.packSize * 100) / 100, l.unit),
      ...(l.perUnitCents !== undefined ? { unitPrice: `${money(l.perUnitCents)}/${l.unit.toLowerCase() === "pcs" ? "kpl" : l.unit.toLowerCase()}` } : {}),
      total: money(l.unitPriceCents * packs),
      state: blocking ? "unavailable" : "ok",
      ...(blocking ? { reason: blocking.code === "short" ? tx.notice.short(l.maxPacks) : tx.notice.noOffer } : {}),
      ...(l.substituteFor ? { swappedFrom: l.substituteFor.name } : {}),
    };
  });
  const totalCents = card.lines.reduce((t, l) => t + l.unitPriceCents * (draft[l.lineId] ?? l.packs), 0);
  const days: DayChoice[] = card.days.map((d) => {
    const [weekday, date] = f.day(d.date).split(" ");
    return { id: d.date, weekday, date, ...(d.orderBy ? { orderBy: whenText(d.orderBy, f.day) } : {}), possible: d.available, ...(d.why ? { reason: /earlier/.test(d.why) ? tx.day.noEarlier : tx.day.why } : {}) };
  });
  const drafting = Object.keys(draft).length > 0;
  const { outcome, confirm } = outcomeOf(card.gate, totalCents, tx);

  const order = orderOf(api.thread!, card.orderId);
  const approver = firstName(order?.authorised.by !== "agent" ? order?.authorised.name : undefined);
  const settledNote = !order
    ? tx.settled.sending
    : order.status === "committed"
      ? tx.settled.committed(f.day(order.deliveryDate || card.deliveryDate))
      : order.status === "pending_approval"
        ? tx.settled.pending_approval(approver)
        : order.status === "declined"
          ? tx.settled.declined(approver)
          : order.status === "withdrawn"
            ? tx.settled.withdrawn
            : order.status === "expired"
              ? tx.settled.expired
              : tx.settled.rejected;
  const takeBack =
    order?.status === "committed" && order.takeBackUntil
      ? { label: tx.takeBack(whenText(order.takeBackUntil, f.day)), onClick: () => tap({ type: "withdraw", orderId: order.orderId }, tx.takeBackWords) }
      : undefined;

  return (
    <OrderSheet
      kind={tx.kind}
      lines={lines}
      onPacks={(id, n) => setDraft((d) => ({ ...d, [id]: n }))}
      onSwap={lock ? undefined : (id) => {
        const l = card.lines.find((x) => x.lineId === id);
        if (l && l.alternatives > 0) tap({ type: "sheet_alternatives", sheetId: card.sheetId, lineId: id }, tx.words.swap(l.name));
      }}
      onRemove={card.lines.length > 1 && !lock ? (id) => tap({ type: "sheet_remove", sheetId: card.sheetId, version: card.version, lineId: id }, tx.words.remove(card.lines.find((x) => x.lineId === id)?.name ?? "")) : undefined}
      onAdd={() => fieldRef.current?.focus()}
      days={days}
      day={card.deliveryDate}
      onDay={(date) => !lock && date !== card.deliveryDate && tap({ type: "sheet_day", sheetId: card.sheetId, version: card.version, date }, tx.words.day(f.day(date)))}
      total={money(totalCents)}
      outcome={outcome}
      confirm={confirm}
      onConfirm={() => !lock && !drafting && tap({ type: "sheet_place", sheetId: card.sheetId, version: card.version }, confirm)}
      busy={working || drafting}
      settled={settled}
      settledNote={settledNote}
      {...(takeBack ? { takeBack } : {})}
      {...(card.removed && !settled ? { removed: { name: card.removed.name, onUndo: () => !lock && tap({ type: "sheet_add", sheetId: card.sheetId, version: card.version, productId: card.removed!.productId, packs: card.removed!.packs }, tx.words.undo(card.removed!.name)) } } : {})}
    />
  );
}

// ---------- the picker ----------

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

export function PickerView({ card, tap, busy, thread }: { card: AlternativesCard; tap: Tap; busy: boolean; thread: Thread }) {
  const tx = useText(THREAD_SHEET_TEXT);
  const f = useFormat();
  const [closed, setClosed] = useState(false);
  const sheet = card.for.sheetId ? thread.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).find((c): c is SheetCard => c.type === "sheet" && c.sheetId === card.for.sheetId) : undefined;
  // A later picker for the same line, a pick, or the order sent: this one is history.
  const newer = thread.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).some((c) => c.type === "alternatives" && c.cardId !== card.cardId && c.for.lineId === card.for.lineId && c.for.sheetId === card.for.sheetId && thread.turns.findIndex((t) => t.role === "agent" && t.cards.includes(c)) > thread.turns.findIndex((t) => t.role === "agent" && t.cards.includes(card)));
  const done = closed || !!card.picked || newer || sheet?.state === "placed";
  const current = card.candidates.find((c) => c.current);
  if (done) {
    const took = card.candidates.find((c) => c.productId === card.picked && !c.current);
    if (!took) return null;
    return <p className="px-1 text-[0.86rem] leading-snug text-ink-soft">{tx.words.pick(took.name)}</p>;
  }
  const per = (c: AlternativesCard["candidates"][number]) => (c.perUnitCents !== undefined ? `${money(c.perUnitCents)}/${c.unit.toLowerCase() === "pcs" ? "kpl" : c.unit.toLowerCase()}` : undefined);
  const tone = (a: number | null | undefined, b: number | null | undefined, lowerIsBetter: boolean): PickerCell["tone"] => (a == null || b == null ? "plain" : sign(a - b) === 0 ? "same" : (sign(a - b) < 0) === lowerIsBetter ? "better" : "worse");
  const candidates: Candidate[] = card.candidates.map((c) => {
    const diff = current && !c.current ? c.totalCents - current.totalCents : 0;
    const headline = c.current ? tx.headline.current : diff < 0 ? tx.headline.less(money(-diff)) : diff > 0 ? tx.headline.more(money(diff)) : tx.headline.same;
    const isCur = c.current;
    return {
      id: c.productId,
      name: c.name,
      pack: `${f.num(c.packs)} × ${f.measure(c.packSize, c.unit)}`,
      art: artFor({ name: c.name, category: c.category, attributes: c.attributes }),
      price: money(c.totalCents),
      ...(per(c) ? { per: per(c) } : {}),
      headline,
      ...(isCur ? { badge: "current" as const } : {}),
      ...(c.gate.outcome === "needs_human_approval" && !isCur ? { signOff: tx.signOff(firstName(c.gate.approver?.name)) } : {}),
      cells: {
        per: { text: per(c) ?? tx.unknown, tone: isCur ? "plain" : tone(c.perUnitCents, current?.perUnitCents, true) },
        co2: { text: c.co2Kg == null ? tx.unknown : `${f.num(c.co2Kg)} kg`, tone: isCur ? "plain" : tone(c.co2Kg, current?.co2Kg, true) },
        reliability: { text: c.reliability == null ? tx.unknown : tx.onTime(f.num(Math.round(c.reliability * 1000) / 10)), tone: isCur ? "plain" : tone(c.reliability, current?.reliability, false) },
        day: { text: `${f.day(c.deliveryDate)}${c.orderBy ? `, ${whenText(c.orderBy, f.day)}` : ""}`, tone: isCur ? "plain" : c.deliveryDate === current?.deliveryDate ? "same" : c.deliveryDate < (current?.deliveryDate ?? "") ? "better" : "worse" },
      },
    };
  });
  return (
    <AlternativesPicker
      kind={tx.pickerKind}
      insteadOf={card.for.name}
      filters={card.chips.filter((c) => c.id !== "pack_size").map((c) => ({ id: c.id, label: tx.chips[c.id] ?? c.label, on: c.on }))}
      onFilter={(id) => !busy && tap({ type: "alt_rerank", pickerId: card.pickerId, chip: id }, tx.words.rank(tx.chips[id] ?? id))}
      candidates={candidates}
      rows={[
        { key: "per", label: tx.rows.per },
        { key: "co2", label: tx.rows.co2 },
        { key: "reliability", label: tx.rows.reliability },
        { key: "day", label: tx.rows.day },
      ]}
      {...(card.picked ? { selected: card.picked } : {})}
      onSelect={(id) => {
        if (busy) return;
        const c = card.candidates.find((x) => x.productId === id);
        if (!c || c.current) return setClosed(true);
        tap({ type: "alt_pick", pickerId: card.pickerId, productId: id }, tx.words.pick(c.name));
      }}
      busy={busy}
      onClose={() => setClosed(true)}
    />
  );
}

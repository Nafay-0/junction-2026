"use client";

import { BookOpen, CalendarClock, ChefHat, ClipboardList, Repeat, Search, ShieldCheck, Truck } from "lucide-react";
import { useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { verifySigned, type KeySet } from "../../_client/verify-signed";
import { AgentHome, type TodayItem as TodayRowItem } from "../../_ui/agent-home";
import { artFor } from "../../_ui/art";
import { buttonClass } from "../../_ui/kit";
import { money } from "../../_ui/plain";
import { FactRows, InPlace } from "../../_ui/widgets";
import { DeliveryCard, MemoryList, ProductFacts, ProductResults, StandingOrders } from "../../_ui/widgets-more";
import type { Card, DeliveriesCard, GateCard, MemoryListCard, OrderCard, PriceCard, ProductCard, ProductsCard, StandingCard, ThreadAction, TodayCard, TodayItem } from "@/server/thread/types";
import { usePortal } from "./portal";
import { THREAD_HOME_TEXT } from "./thread-home.text";
import { WaitingGate } from "./thread-signoff";

/**
 * The agent as the kitchen's home (docs/agent-thread.md "The home"): the day's opening, the assortment, the kitchen's
 * own records, and the in-place details of an order and a price. Every button is a turn through the same engine and
 * gate (a tap); nothing here orders anything: buying lands on the order sheet, and the sheet's confirmation is the
 * buyer's. The views take the cards' data as it came from plain code on the server.
 */

type Tap = (action: ThreadAction, label: string) => void;
const HOME_TYPES = new Set(["today", "products", "product", "standing", "deliveries", "memory_list"]);

/** The home's cards, or null for any other card type (thread.tsx renders those). */
export function HomeCardView({ card, tap, busy }: { card: Card; tap: Tap; busy: boolean }) {
  if (!HOME_TYPES.has(card.type)) return null;
  switch (card.type) {
    case "today":
      return <TodayView card={card} tap={tap} busy={busy} />;
    case "products":
      return <ProductsView card={card} tap={tap} busy={busy} />;
    case "product":
      return <ProductView card={card} tap={tap} busy={busy} />;
    case "standing":
      return <StandingView card={card} tap={tap} busy={busy} />;
    case "deliveries":
      return <DeliveriesView card={card} tap={tap} busy={busy} />;
    case "memory_list":
      return <MemoryListView card={card} tap={tap} busy={busy} />;
    default:
      return null;
  }
}


// ---------- the day's opening ----------

function TodayView({ card, tap, busy }: { card: TodayCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  const { kitchen, agent, fieldRef } = usePortal();
  const [signing, setSigning] = useState<string>();
  const pct = (n: number) => `${n > 0 ? "+" : ""}${f.num(Math.round(n))} %`;
  const go = (action: ThreadAction, label: string) => () => !busy && tap(action, label);
  const rows: TodayRowItem[] = card.items.map((i, n) => row(i, n));
  function row(i: TodayItem, n: number): TodayRowItem {
    const id = `${i.kind}:${n}`;
    switch (i.kind) {
      case "sign_off":
        return { id, kind: "signoff", title: tx.signOff(i.approver.name, money(i.totalCents)), detail: i.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", "), primary: { label: signing === i.approvalId ? tx.hideSign : tx.sign, onClick: () => setSigning(signing === i.approvalId ? undefined : i.approvalId) }, secondary: { label: tx.showOrder, onClick: go({ type: "order_show", orderId: i.orderId }, tx.showOrder) } };
      case "cutoff":
        return { id, kind: "cutoff", title: tx.cutoff(i.name, f.clock(i.orderBy)), detail: tx.cutoffDetail(f.measure(i.usual.amount, i.usual.unit), f.day(i.deliveryDate)), figure: f.clock(i.orderBy), primary: { label: tx.putOnSheet(f.num(i.packs)), onClick: go({ type: "standing_change", family: i.family, packs: i.packs }, tx.putOnSheet(f.num(i.packs))) } };
      case "drift":
        return { id, kind: "drift", title: tx.drift(i.name), detail: [i.amountPct !== null ? tx.driftAmount(pct(i.amountPct)) : "", i.pricePct !== null ? tx.driftPrice(pct(i.pricePct)) : ""].filter(Boolean).join(" "), figure: i.amountPct !== null ? pct(i.amountPct) : i.pricePct !== null ? pct(i.pricePct) : undefined, primary: { label: tx.seeRecurring, onClick: go({ type: "home_show", what: "standing" }, tx.seeRecurring) }, secondary: { label: tx.orderUsual, onClick: go({ type: "standing_change", family: i.family }, tx.orderUsual) } };
      case "recall":
        return { id, kind: "recall", title: tx.recall(i.productName), detail: `${i.drill ? `${tx.recallDrill}: ` : ""}${tx.recallDetail(i.noticeTitle, i.publisher)}`, primary: { label: tx.readNotice, onClick: () => window.open(i.noticeUrl, "_blank", "noopener,noreferrer") }, secondary: { label: tx.history, onClick: go({ type: "home_show", what: "history" }, tx.history) } };
      case "delivery":
        return { id, kind: "delivery", title: tx.delivery(f.day(i.deliveryDate)), detail: i.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", "), figure: money(i.totalCents), primary: { label: tx.showOrder, onClick: go({ type: "order_show", orderId: i.orderId }, tx.showOrder) } };
    }
  }
  const starters = [
    { id: "browse", label: tx.browse, icon: <Search aria-hidden size={18} />, onClick: go({ type: "products_search", query: "" }, tx.browse) },
    { id: "history", label: tx.history, icon: <ClipboardList aria-hidden size={18} />, onClick: go({ type: "home_show", what: "history" }, tx.history) },
    { id: "standing", label: tx.standing, icon: <Repeat aria-hidden size={18} />, onClick: go({ type: "home_show", what: "standing" }, tx.standing) },
    { id: "deliveries", label: tx.deliveries, icon: <Truck aria-hidden size={18} />, onClick: go({ type: "home_show", what: "deliveries" }, tx.deliveries) },
    { id: "memory", label: tx.memory, icon: <BookOpen aria-hidden size={18} />, onClick: go({ type: "home_show", what: "memory" }, tx.memory) },
    { id: "rules", label: tx.rules, icon: <ShieldCheck aria-hidden size={18} />, onClick: go({ type: "rules_show" }, tx.rules) },
    // The menu builder starts from the kitchen's own words (covers, day, what it is built around): the composer opens
    // with the start of the sentence, and the buyer finishes it.
    { id: "menu", label: tx.planMenu, icon: <ChefHat aria-hidden size={18} />, onClick: () => { agent.setDraft(tx.planMenuWords); requestAnimationFrame(() => fieldRef.current?.focus()); } },
  ];
  const sign = card.items.find((i): i is Extract<TodayItem, { kind: "sign_off" }> => i.kind === "sign_off" && i.approvalId === signing);
  if (card.pending)
    return (
      <p className="flex items-center gap-2 px-1 text-[0.92rem] text-ink-soft" role="status">
        <CalendarClock aria-hidden size={16} /> {tx.gathering}
      </p>
    );
  return (
    <div className="flex flex-col gap-3" data-card="today">
      <AgentHome greeting={tx.greeting(kitchen.name)} lead={rows.length ? tx.lead(rows.length) : undefined} today={rows} quiet={tx.quiet} starters={starters} />
      {sign && <WaitingGate card={signGate(sign)} kind={tx.sign} title={tx.signOff(sign.approver.name, money(sign.totalCents))} reason={undefined} role={f.role(sign.approver.role)} />}
    </div>
  );
}

/** The sign-off widget of a waiting order, as the gate card it already understands. */
function signGate(i: Extract<TodayItem, { kind: "sign_off" }>): GateCard {
  return { type: "gate", cardId: `gate:${i.requestId ?? i.orderId}`, requestId: i.requestId ?? "", orderId: i.orderId, approvalId: i.approvalId, outcome: "waiting", approver: i.approver, reasons: [], rules: [] } as GateCard;
}

// ---------- the assortment ----------

function ProductsView({ card, tap, busy }: { card: ProductsCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  if (!card.products.length) return <p className="px-1 text-[0.9rem] text-ink-soft">{tx.noProducts}</p>;
  const name = (id: string) => card.products.find((p) => p.productId === id)?.name ?? id;
  return (
    <ProductResults
      kind={tx.productsFor(card.query, card.total)}
      products={card.products.map((p) => ({ id: p.productId, name: p.name, pack: f.measure(p.packSize, p.unit), art: artFor({ name: p.name, category: p.category, attributes: p.attributes }), price: tx.priceWhenOpened }))}
      onAdd={(id) => !busy && tap({ type: "sheet_add", productId: id, packs: 1 }, `${tx.add}: ${name(id)}`)}
      onOpen={(id) => !busy && tap({ type: "product_show", productId: id }, `${tx.facts}: ${name(id)}`)}
    />
  );
}

function ProductView({ card, tap, busy }: { card: ProductCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  const p = card.product;
  return (
    <ProductFacts
      kind={tx.facts}
      name={p.name}
      pack={f.measure(p.packSize, p.unit)}
      art={artFor({ name: p.name, category: p.category, attributes: p.attributes })}
      rows={[
        { label: tx.allergens, value: !p.allergensDeclared ? tx.notDeclared : p.allergens.length ? p.allergens.join(", ") : tx.noAllergens },
        ...(p.attributes.length ? [{ label: tx.facts, value: p.attributes.map((a) => f.attr(a)).join(", ") }] : []),
        { label: tx.certificates, value: p.certificates.length ? p.certificates.join(", ") : tx.unknown },
        ...(p.origin ? [{ label: tx.origin, value: p.origin }] : []),
        { label: tx.co2, value: p.co2KgPerUnit === null ? tx.unknown : `${f.num(p.co2KgPerUnit)} kg` },
        { label: tx.reliability, value: p.reliability === null ? tx.unknown : `${f.num(Math.round(p.reliability * 100))} %` },
      ]}
      add={{ label: tx.add, onClick: () => !busy && tap({ type: "sheet_add", productId: p.productId, packs: 1 }, `${tx.add}: ${p.name}`) }}
    />
  );
}

// ---------- recurring orders, deliveries ----------

/**
 * Recurring orders, read from the order history: a switch pauses one (no reminders, not part of "the usual") and runs
 * it again; "Change" puts it on an order sheet for its next day, where the amount and the day are changed and ordered.
 */
function StandingView({ card, tap, busy }: { card: StandingCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  if (!card.items.length) return <p className="px-1 text-[0.9rem] text-ink-soft">{tx.noRecurring}</p>;
  const pct = (n: number) => `${n > 0 ? "+" : ""}${f.num(n)} %`;
  return (
    <StandingOrders
      kind={tx.standing}
      items={card.items.map((it) => ({
        id: it.family,
        name: it.name,
        rhythm: tx.rhythm(tx.usual(f.measure(it.usual.amount, it.usual.unit), f.num(it.usualPacks)), tx.every(f.weekdays(it.weekdays))),
        ...(it.nextDue ? { next: tx.nextDue(f.day(it.nextDue)) } : {}),
        paused: !!it.paused,
        ...(it.drift.amountPct !== null && Math.abs(it.drift.amountPct) >= 10 ? { note: tx.driftNote(pct(it.drift.amountPct)) } : {}),
      }))}
      onPause={(family, paused) => !busy && tap({ type: "standing_pause", family, paused }, `${paused ? tx.paused : tx.orderUsual}: ${card.items.find((x) => x.family === family)?.name ?? family}`)}
      onChange={(family) => !busy && tap({ type: "standing_change", family }, `${tx.onSheet}: ${card.items.find((x) => x.family === family)?.name ?? family}`)}
    />
  );
}

/** Each delivery coming as the kit's delivery card: ordered, the OK (or waiting for it), confirmed, arrives. */
function DeliveriesView({ card }: { card: DeliveriesCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  if (!card.items.length) return <p className="px-1 text-[0.9rem] text-ink-soft">{tx.noDeliveries}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {card.items.slice(0, 3).map((d) => {
        const waiting = d.status === "pending_approval";
        return (
          <DeliveryCard
            key={d.orderId}
            kind={tx.deliveries}
            title={tx.deliveryTitle(f.day(d.deliveryDate), money(d.totalCents))}
            detail={d.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")}
            steps={[
              { label: tx.stepOrdered, state: "done" },
              waiting ? { label: tx.stepWaiting, state: "now" } : { label: tx.stepConfirmed, state: "done" },
              { label: tx.stepArrives, at: f.day(d.deliveryDate), state: waiting ? "next" : "now" },
            ]}
          />
        );
      })}
    </div>
  );
}

// ---------- what the agent remembers ----------

/**
 * What the agent remembers, as the kit's list: each line edited (in place, below the list) or forgotten by the
 * kitchen's signed-in person. Without one the list is read-only and says how to change it.
 */
function MemoryListView({ card, tap, busy }: { card: MemoryListCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const [editing, setEditing] = useState<string>();
  const [text, setText] = useState("");
  if (!card.items.length) return <p className="px-1 text-[0.9rem] text-ink-soft">{tx.noMemory}</p>;
  const item = card.items.find((x) => x.itemId === editing);
  return (
    <div className="flex flex-col gap-2">
      <MemoryList
        kind={tx.memory}
        items={card.items.map((it) => ({ id: it.itemId, text: it.text, ...(it.status === "pending_confirmation" ? { source: tx.pending } : {}) }))}
        {...(card.canChange
          ? {
              onEdit: (id: string) => {
                setEditing(id);
                setText(card.items.find((x) => x.itemId === id)?.text ?? "");
              },
            }
          : {})}
        onForget={(id) => card.canChange && !busy && tap({ type: "memory_forget", itemId: id }, `${tx.forget}: ${card.items.find((x) => x.itemId === id)?.text ?? ""}`)}
      />
      {!card.canChange && <p className="px-1 text-[0.84rem] text-ink-soft">{tx.memorySignIn}</p>}
      {item && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 2 || busy) return;
            tap({ type: "memory_edit", itemId: item.itemId, text: text.trim() }, `${tx.edit}: ${text.trim()}`);
            setEditing(undefined);
          }}
        >
          <label className="text-[0.82rem] text-ink-soft">
            {tx.editLabel}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[0.92rem] text-ink" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
              {tx.save}
            </button>
            <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setEditing(undefined)}>
              {tx.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- in place: an order's details and confirmation, a price's proof ----------

type Check = { state: "idle" | "checking" | "done"; results: { label: string; ok: boolean; detail?: string }[] };

async function keys(): Promise<KeySet> {
  const r = await fetch("/.well-known/jwks.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`keys: ${r.status}`);
  return (await r.json()) as KeySet;
}

function useChecks(tokens: { label: string; token: string }[]) {
  const [c, setC] = useState<Check>({ state: "idle", results: [] });
  const run = async () => {
    setC({ state: "checking", results: [] });
    try {
      const k = await keys();
      const results = await Promise.all(tokens.map(async (t) => ({ label: t.label, ...(await verifySigned(t.token, k).then((r) => (r.ok ? { ok: true } : { ok: false, detail: r.message }))) })));
      setC({ state: "done", results });
    } catch (err) {
      setC({ state: "done", results: tokens.map((t) => ({ label: t.label, ok: false, detail: (err as Error).message })) });
    }
  };
  return { check: c, run };
}

function Checks({ tokens }: { tokens: { label: string; token: string }[] }) {
  const tx = useText(THREAD_HOME_TEXT);
  const { check, run } = useChecks(tokens);
  return (
    <div className="mt-2 space-y-2">
      <button type="button" disabled={check.state === "checking"} className={buttonClass("secondary", "sm")} onClick={() => void run()}>
        {check.state === "checking" ? tx.checking : tx.check}
      </button>
      {check.results.length > 0 && (
        <ul className="space-y-1 text-[0.86rem]" aria-live="polite">
          {check.results.map((r, i) => (
            <li key={i} className={r.ok ? "text-good" : "text-bad"}>
              {r.label}: {r.ok ? tx.valid : `${tx.invalid}${r.detail ? ` (${r.detail})` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The order card's details, opened where it is: who authorised it, the lines, and the wholesaler's signed confirmation. */
export function OrderInPlace({ card }: { card: OrderCard }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  return (
    <InPlace summary={tx.details}>
      <FactRows
        rows={[
          { label: tx.orderId, value: card.orderId, mono: true },
          ...card.lines.map((l) => ({ label: `${f.num(l.quantity)} × ${l.name}`, value: l.unitPriceCents !== undefined ? money(l.unitPriceCents * l.quantity) : "" })),
          ...(card.authorised.by === "person" ? [{ label: tx.signedBy, value: `${card.authorised.name} (${f.role(card.authorised.role)})` }] : []),
          ...(card.confirmation ? [{ label: tx.quoteToken, value: `${card.confirmation.slice(0, 18)}…`, mono: true }] : []),
        ]}
      />
      {card.confirmation && <Checks tokens={[{ label: tx.details, token: card.confirmation }]} />}
    </InPlace>
  );
}

/** The price card's proof, opened where it is: the signed quote and the signed claims it rests on, checked here. */
export function PriceProof({ card }: { card: PriceCard }) {
  const tx = useText(THREAD_HOME_TEXT);
  if (!card.proof) return null;
  const tokens = [{ label: tx.quote, token: card.proof.quoteToken }, ...card.proof.claims.map((c) => ({ label: `${tx.claim[c.type] ?? c.type} · ${c.productId}`, token: c.token }))];
  return (
    <InPlace summary={tx.proof} count={tokens.length}>
      <p className="text-[0.84rem] leading-snug text-ink-soft">{tx.proofNote}</p>
      <Checks tokens={tokens} />
    </InPlace>
  );
}

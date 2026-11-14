"use client";

import { BookOpen, CalendarClock, ClipboardList, Repeat, Search, Truck } from "lucide-react";
import { useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { verifySigned, type KeySet } from "../../_client/verify-signed";
import { AgentHome, type TodayItem as TodayRowItem } from "../../_ui/agent-home";
import { artFor } from "../../_ui/art";
import { buttonClass } from "../../_ui/kit";
import { money } from "../../_ui/plain";
import { FactRows, InPlace, Stepper, Thumb } from "../../_ui/widgets";
import type { Card, DeliveriesCard, GateCard, MemoryListCard, OrderCard, PriceCard, ProductCard, ProductTile, ProductsCard, StandingCard, ThreadAction, TodayCard, TodayItem } from "@/server/thread/types";
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

const Frame = ({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) => (
  <section className="rounded-xl border border-line bg-paper p-3.5 shadow-xs">
    <h3 className="px-0.5 text-[0.82rem] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
    {note && <p className="mt-1 px-0.5 text-[0.84rem] leading-snug text-ink-soft">{note}</p>}
    <div className="mt-2.5">{children}</div>
  </section>
);

// ---------- the day's opening ----------

function TodayView({ card, tap, busy }: { card: TodayCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  const { kitchen } = usePortal();
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

function Tile({ p, tap, busy }: { p: ProductTile; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  return (
    <li className="flex items-center gap-3 rounded-lg border border-line/80 p-2.5">
      <Thumb art={artFor({ name: p.name, category: p.category, attributes: p.attributes })} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.92rem] font-medium leading-snug [overflow-wrap:anywhere]">{p.name}</p>
        <p className="text-[0.8rem] leading-snug text-ink-soft">
          {[p.brand, tx.pack(f.measure(p.packSize, p.unit)), ...p.attributes.slice(0, 2).map((a) => f.attr(a))].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
        <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={() => tap({ type: "sheet_add", productId: p.productId, packs: 1 }, `${tx.add}: ${p.name}`)}>
          {tx.add}
        </button>
        <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => tap({ type: "product_show", productId: p.productId }, `${tx.facts}: ${p.name}`)}>
          {tx.facts}
        </button>
      </div>
    </li>
  );
}

function ProductsView({ card, tap, busy }: { card: ProductsCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const [q, setQ] = useState(card.query);
  return (
    <Frame title={tx.productsFor(card.query, card.total)} note={tx.productsNote}>
      <form
        className="mb-2.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) tap({ type: "products_search", query: q.trim(), ...(card.category ? { category: card.category } : {}) }, `${tx.browse}: ${q.trim()}`);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx.browse} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-3 text-[0.92rem]" />
        <button type="submit" disabled={busy} className={buttonClass("secondary", "sm")} aria-label={tx.browse}>
          <Search aria-hidden size={16} />
        </button>
      </form>
      {card.products.length ? (
        <ul className="grid gap-2">
          {card.products.map((p) => (
            <Tile key={p.productId} p={p} tap={tap} busy={busy} />
          ))}
        </ul>
      ) : (
        <p className="text-[0.9rem] text-ink-soft">{tx.noProducts}</p>
      )}
    </Frame>
  );
}

function ProductView({ card, tap, busy }: { card: ProductCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  const p = card.product;
  return (
    <Frame title={p.name}>
      <div className="flex items-start gap-3">
        <Thumb art={artFor({ name: p.name, category: p.category, attributes: p.attributes })} className="size-16" />
        <div className="min-w-0 flex-1">
          <FactRows
            rows={[
              { label: tx.pack(""), value: f.measure(p.packSize, p.unit) },
              { label: tx.allergens, value: !p.allergensDeclared ? tx.notDeclared : p.allergens.length ? p.allergens.join(", ") : tx.noAllergens },
              ...(p.attributes.length ? [{ label: tx.facts, value: p.attributes.map((a) => f.attr(a)).join(", ") }] : []),
              { label: tx.certificates, value: p.certificates.length ? p.certificates.join(", ") : tx.unknown },
              ...(p.origin ? [{ label: tx.origin, value: p.origin }] : []),
              { label: tx.co2, value: p.co2KgPerUnit === null ? tx.unknown : `${f.num(p.co2KgPerUnit)} kg` },
              { label: tx.reliability, value: p.reliability === null ? tx.unknown : `${f.num(Math.round(p.reliability * 100))} %` },
              ...(p.gtin ? [{ label: tx.gtin, value: p.gtin, mono: true }] : []),
            ]}
          />
        </div>
      </div>
      <p className="mt-2.5">
        <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={() => tap({ type: "sheet_add", productId: p.productId, packs: 1 }, `${tx.add}: ${p.name}`)}>
          {tx.add}
        </button>
      </p>
    </Frame>
  );
}

// ---------- recurring orders, deliveries ----------

function StandingRow({ it, tap, busy }: { it: StandingCard["items"][number]; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  const [packs, setPacks] = useState(it.usualPacks);
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-lg border border-line/80 p-3">
      <p className="font-medium leading-snug [overflow-wrap:anywhere]">{it.name}</p>
      <p className="text-[0.84rem] leading-snug text-ink-soft">
        {[tx.every(f.weekdays(it.weekdays)), tx.usual(f.measure(it.usual.amount, it.usual.unit), f.num(it.usualPacks)), it.nextDue ? tx.nextDue(f.day(it.nextDue)) : ""].filter(Boolean).join(" · ")}
      </p>
      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Stepper value={packs} onChange={setPacks} min={1} max={9999} less={tx.less} more={tx.more} label={tx.packs} disabled={busy} />
          <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={() => tap({ type: "standing_change", family: it.family, packs }, `${tx.onSheet}: ${f.num(packs)} × ${it.name}`)}>
            {tx.onSheet}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={() => tap({ type: "standing_change", family: it.family }, `${tx.orderUsual}: ${it.name}`)}>
            {tx.orderUsual}
          </button>
          <button type="button" disabled={busy} className={buttonClass("secondary", "sm")} onClick={() => setEditing(true)}>
            {tx.change}
          </button>
        </div>
      )}
    </li>
  );
}

function StandingView({ card, tap, busy }: { card: StandingCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  return (
    <Frame title={tx.standing} note={tx.recurringNote}>
      {card.items.length ? (
        <ul className="grid gap-2">
          {card.items.map((it) => (
            <StandingRow key={it.family} it={it} tap={tap} busy={busy} />
          ))}
        </ul>
      ) : (
        <p className="text-[0.9rem] text-ink-soft">{tx.noRecurring}</p>
      )}
    </Frame>
  );
}

function DeliveriesView({ card, tap, busy }: { card: DeliveriesCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const f = useFormat();
  return (
    <Frame title={tx.deliveries}>
      {card.items.length ? (
        <ul className="divide-y divide-line/80">
          {card.items.map((d) => (
            <li key={d.orderId} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{f.day(d.deliveryDate)}</p>
                <p className="text-[0.84rem] leading-snug text-ink-soft [overflow-wrap:anywhere]">
                  {d.status === "pending_approval" ? `${tx.waiting} · ` : ""}
                  {d.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")}
                </p>
              </div>
              <span className="tabular shrink-0 text-[0.9rem]">{money(d.totalCents)}</span>
              <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => tap({ type: "order_show", orderId: d.orderId }, tx.showOrder)}>
                {tx.showOrder}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9rem] text-ink-soft">{tx.noDeliveries}</p>
      )}
    </Frame>
  );
}

// ---------- what the agent remembers ----------

function MemoryRow({ it, tap, busy, canChange }: { it: MemoryListCard["items"][number]; tap: Tap; busy: boolean; canChange: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(it.text);
  const [forgetting, setForgetting] = useState(false);
  return (
    <li className="py-2">
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 2) return;
            tap({ type: "memory_edit", itemId: it.itemId, text: text.trim() }, `${tx.edit}: ${text.trim()}`);
            setEditing(false);
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
            <button type="button" className={buttonClass("quiet", "sm")} onClick={() => {
                setEditing(false);
                setText(it.text);
              }}>
              {tx.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-[0.92rem] leading-snug [overflow-wrap:anywhere]">
            {it.text}
            {it.status === "pending_confirmation" && <span className="ml-2 text-[0.8rem] text-ink-soft">({tx.pending})</span>}
          </p>
          {canChange && (
            <div className="flex shrink-0 gap-1.5">
              {forgetting ? (
                <>
                  <button type="button" disabled={busy} className={buttonClass("secondary", "sm")} onClick={() => tap({ type: "memory_forget", itemId: it.itemId }, `${tx.forget}: ${it.text}`)}>
                    {tx.confirmForget}
                  </button>
                  <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setForgetting(false)}>
                    {tx.cancel}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => setEditing(true)}>
                    {tx.edit}
                  </button>
                  <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => setForgetting(true)}>
                    {tx.forget}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function MemoryListView({ card, tap, busy }: { card: MemoryListCard; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_HOME_TEXT);
  const [words, setWords] = useState("");
  return (
    <Frame title={tx.memory} note={card.canChange ? tx.memoryNote : tx.memorySignIn}>
      {card.items.length ? (
        <ul className="divide-y divide-line/80">
          {card.items.map((it) => (
            <MemoryRow key={it.itemId} it={it} tap={tap} busy={busy} canChange={card.canChange} />
          ))}
        </ul>
      ) : (
        <p className="text-[0.9rem] text-ink-soft">{tx.noMemory}</p>
      )}
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const t = words.trim();
          if (t.length < 2 || busy) return;
          tap({ type: "remember_this", text: t }, `${tx.remember}: ${t}`);
          setWords("");
        }}
      >
        <input value={words} onChange={(e) => setWords(e.target.value)} maxLength={500} aria-label={tx.rememberLabel} placeholder={tx.rememberPh} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-3 text-[0.92rem]" />
        <button type="submit" disabled={busy || words.trim().length < 2} className={buttonClass("secondary", "sm")}>
          {tx.remember}
        </button>
      </form>
    </Frame>
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

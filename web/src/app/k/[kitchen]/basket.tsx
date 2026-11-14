"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { helsinkiToday, money, num } from "../../_ui/plain";
import { useFormat, useText } from "../../_i18n/provider";
import { BASKET_TEXT } from "./basket.text";
import { usePortal, type BasketLine } from "./portal";
import { Quantity } from "./qty";
import { TEMP, TempMark, nameIn, packGlyph, problemsText, readable } from "./shop";
import { Glyph } from "../../_ui/glyphs";
import { Empty, Working, buttonClass } from "../../_ui/kit";
import { Gate, Quote, SignedOrder } from "./stages";
import { Button, ErrorPlate } from "./ui";
import { co2Of, contentOf, unitWord } from "./units";
import type { Order, QuoteBundle } from "./types";

/**
 * The basket: the buyer ordering by hand. Running totals in euros, litres, kilograms and the product-group
 * carbon figure; then the wholesaler fixes the price and the order goes through the same gate as an agent's
 * (the same mandate, limits and sign-off), shown with the same cards.
 */
type Run = { phase: "idle" | "quoting" | "quoted" | "placing" | "done"; requestId?: string; quote?: QuoteBundle; order?: Order; refusal?: ApiError; error?: string };

export function BasketPage() {
  const { basket, live, ui, call, kitchen, overview, base, lang, agent } = usePortal();
  const tx = useText(BASKET_TEXT);
  const f = useFormat();
  const next = overview.data?.standing.map((x) => x.nextDue).filter((d): d is string => !!d).sort()[0];
  const [deliverBy, setDeliverBy] = useState("");
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const check = live.check;
  const ids = basket.lines.map((l) => l.productId).join(",");
  useEffect(() => {
    // Price what is in the basket (already-checked products cost nothing; at most five at a time).
    if (!ids) return;
    const todo = ids.split(",");
    void (async () => {
      for (let i = 0; i < todo.length; i += 5) await check(todo.slice(i, i + 5));
    })();
  }, [ids, check]);

  const totals = useMemo(() => {
    let cents = 0;
    let priced = 0;
    let L = 0;
    let kg = 0;
    let co2 = 0;
    let co2Lines = 0;
    for (const l of basket.lines) {
      const o = live.results[l.productId]?.offer;
      if (o) {
        cents += o.unitPriceCents * l.packs;
        priced += 1;
      }
      const m = contentOf(l.product, l.packs);
      if (m?.unit === "L") L += m.amount;
      if (m?.unit === "kg") kg += m.amount;
      const c = co2Of(l.product, l.packs);
      if (c !== null) {
        co2 += c;
        co2Lines += 1;
      }
    }
    return { cents, priced, L, kg, co2, co2Lines };
  }, [basket.lines, live.results]);
  const names = useMemo(() => Object.fromEntries(basket.lines.map((l) => [l.productId, lang === "en" ? l.product.name : readable(nameIn(l.product, lang))])), [basket.lines, lang]);

  const orderId = run.order?.orderId;
  const orderLive = useLive(
    async () => {
      const r = await call<{ order: Order }>("GET", `/api/v1/orders/${orderId}`);
      if (!r.ok) throw new Error(r.error.message);
      return r.data.order;
    },
    { events: `/api/v1/events?orgId=${encodeURIComponent(kitchen.orgId)}`, enabled: !!orderId && run.order?.status === "pending_approval", pollMs: 1500, pollMsStreaming: 4000 },
  );
  const shownOrder = orderLive.data && orderLive.data.orderId === orderId ? orderLive.data : run.order;

  const quote = async () => {
    setRun({ phase: "quoting" });
    const r = await ui<QuoteBundle & { requestId: string }>("POST", "basket", { lines: basket.lines.map((l) => ({ productId: l.productId, packs: l.packs })), ...(deliverBy ? { deliverBy } : {}) });
    if (r.ok) setRun({ phase: "quoted", requestId: r.data.requestId, quote: { quote: r.data.quote, quoteToken: r.data.quoteToken, policyPreview: r.data.policyPreview } as QuoteBundle });
    else setRun({ phase: "idle", error: r.error.message });
  };
  const place = async () => {
    if (!run.quote || !run.requestId) return;
    setRun((x) => ({ ...x, phase: "placing", error: undefined }));
    const r = await call<{ order: Order }>("POST", "/api/v1/orders", {
      requestId: run.requestId,
      quoteToken: run.quote.quoteToken,
      lines: run.quote.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
    });
    overview.refresh();
    if (r.ok) setRun((x) => ({ ...x, phase: "done", order: r.data.order }));
    else if (r.data?.order) setRun((x) => ({ ...x, phase: "done", order: r.data!.order, refusal: r.error }));
    else if (r.status === 0 || r.status >= 500) setRun((x) => ({ ...x, phase: "quoted", error: r.error.message }));
    else setRun((x) => ({ ...x, phase: "done", refusal: r.error }));
  };
  const reset = () => {
    if (shownOrder && shownOrder.status !== "rejected") basket.clear();
    setRun({ phase: "idle" });
  };
  const locked = run.phase !== "idle";

  const measures = [
    { label: tx.litres, value: totals.L ? f.measure(Math.round(totals.L * 10) / 10, "L") : "–" },
    { label: tx.kilograms, value: totals.kg ? f.measure(Math.round(totals.kg * 10) / 10, "kg") : "–" },
    { label: tx.carbon, value: totals.co2Lines ? `${num(totals.co2, 1)} kg` : tx.noData, note: totals.co2Lines > 0 && totals.co2Lines < basket.lines.length ? tx.linesOf(totals.co2Lines, basket.lines.length) : totals.co2Lines ? "CO2e" : undefined },
  ];

  return (
    <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_27rem]">
      <section aria-labelledby="basket-h" className="min-w-0">
        <h1 id="basket-h" className="display text-[2.6rem] text-ink sm:text-[3rem]">
          {tx.title}
        </h1>
        <p className="max-w-[62ch] leading-snug text-ink-soft">{tx.intro}</p>
        {basket.lines.length === 0 ? (
          <div className="mt-4">
            <Empty
              title={tx.empty}
              glyph={<Glyph kind="case" size={48} />}
              action={
                <>
                  <Link href={`${base}/catalogue`} className={buttonClass("primary")}>
                    {tx.openCatalogue}
                  </Link>
                  <Button kind="quiet" onClick={agent.open}>
                    {tx.tellAgent}
                  </Button>
                </>
              }
            >
              {next ? tx.nextDelivery(f.day(next)) : ""}
              {tx.emptyHelp}
            </Empty>
          </div>
        ) : (
          <ul className="mt-4 space-y-px bg-line">
            {basket.lines.map((l) => {
              const r = live.results[l.productId];
              const o = r?.offer;
              return (
                <li key={l.productId} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 bg-paper p-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                  <MiniPack p={l.product} />
                  <div className="min-w-0">
                    <p className="text-[0.82rem]">
                      <TempMark t={l.product.temperatureClass} />
                    </p>
                    <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="text-[1.05rem] font-semibold leading-snug text-ink hover:text-petrol">
                      {readable(nameIn(l.product, lang))}
                    </Link>
                    <p className="text-[0.9rem] text-ink-soft">
                      {o ? tx.perUnit(money(o.unitPriceCents), unitWord(l.product, 1, lang)) : live.busy.includes(l.productId) ? tx.checkingPrice : r ? tx.notOrderable(r.problems.length ? problemsText(r.problems, lang) : r.message) : tx.noLivePrice}
                      {o?.stockKnown === false ? tx.stockNotConfirmed : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                      <Quantity p={l.product} value={l.packs} onChange={(n) => basket.set(l.productId, n)} id={`b-${l.productId}`} disabled={locked} compact />
                      {!locked && (
                        <button type="button" className="min-h-10 text-[0.92rem] text-petrol underline underline-offset-4" onClick={() => basket.remove(l.productId)}>
                          {tx.remove}
                        </button>
                      )}
                    </div>
                  </div>
                  <p key={`${l.packs}-${o?.unitPriceCents}`} className="changed display col-span-2 text-right text-[1.7rem] tabular sm:col-span-1">
                    {o ? money(o.unitPriceCents * l.packs) : "–"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside aria-label={tx.totalsLabel} className="space-y-3 lg:sticky lg:top-3">
        <div className="bg-paper">
          <div aria-hidden className="h-1.5 bg-petrol" />
          <div className="p-5">
            <p className="text-[0.9rem] font-medium text-ink-soft">{tx.estimate}</p>
            <p key={totals.cents} className="changed display text-[3.2rem] text-ink tabular">
              {money(totals.cents)}
            </p>
            {totals.priced < basket.lines.length && (
              <p className="text-[0.88rem] text-ink-soft">
                {tx.unpriced(basket.lines.length - totals.priced, basket.lines.length)}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-px bg-line">
              {measures.map((x) => (
                <div key={x.label} className="min-w-0 bg-paper py-2 pr-2 [&:not(:first-child)]:pl-3">
                  <dt className="break-words text-[0.8rem] text-ink-soft hyphens-auto">{x.label}</dt>
                  <dd className="display text-[1.5rem] tabular">{x.value}</dd>
                  {x.note && <dd className="text-[0.78rem] text-ink-soft">{x.note}</dd>}
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[0.8rem] leading-snug text-ink-soft">{tx.carbonNote}</p>
          </div>
          {basket.lines.length > 0 && run.phase === "idle" && (
            <div className="border-t border-line p-5">
              <label htmlFor="deliver-by" className="text-[0.95rem] font-semibold">
                {tx.deliverBy} <span className="font-normal text-ink-soft">{tx.optional}</span>
              </label>
              <input id="deliver-by" type="date" min={helsinkiToday()} value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} className="mt-1 block min-h-11 w-full border-2 border-petrol px-2" />
              <Button kind="go" size="lg" className="mt-4 w-full" onClick={() => void quote()}>
                {tx.getPrice}
              </Button>
              <p className="mt-2 text-[0.85rem] text-ink-soft">{tx.priceNote}</p>
            </div>
          )}
          {run.phase === "quoting" && <Working className="border-t border-line p-5">{tx.fixing}</Working>}
          {run.error && (
            <div className="px-5 pb-5">
              <ErrorPlate title={tx.failed} message={run.error} onRetry={run.phase === "quoted" ? () => void place() : undefined} />
            </div>
          )}
        </div>
        {(run.phase === "quoted" || run.phase === "placing" || run.phase === "done") && run.quote && <Quote q={run.quote} names={names} decided={run.phase === "done"} busy={run.phase === "placing"} onPlace={() => void place()} onNew={reset} />}
        {run.phase === "done" && (
          <>
            <Gate order={shownOrder} refusal={run.refusal} kitchen={kitchen} names={names} streaming={orderLive.streaming} byHand />
            {shownOrder && (shownOrder.status === "committed" || shownOrder.status === "declined") ? (
              <SignedOrder order={shownOrder} names={names} onNew={reset} />
            ) : (
              <Button kind="secondary" onClick={reset}>
                {shownOrder?.status === "pending_approval" ? tx.newBasket : tx.backToBasket}
              </Button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** A small pack plate for a basket line. */
function MiniPack({ p }: { p: BasketLine["product"] }) {
  const t = TEMP[p.temperatureClass ?? ""];
  return (
    <div className="flex aspect-square items-center justify-center" style={{ background: t?.tint ?? "var(--color-mist)" }}>
      <Glyph kind={packGlyph(p)} size={40} className="text-petrol-deep" />
    </div>
  );
}

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
import { ShoppingBasket, Trash2 } from "lucide-react";
import { Card, Empty, IconButton, IconDisc, Input, PageHeader, Skeleton, Spinner, buttonClass } from "../../_ui/kit";
import { Art, artFor } from "../../_ui/art";
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
  useEffect(() => {
    // On a phone the quote and the gate arrive below the lines: bring them into view.
    if (run.phase !== "quoted" && run.phase !== "done") return;
    const el = document.getElementById("basket-run");
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [run.phase]);

  const measures = [
    { label: tx.litres, value: totals.L ? f.measure(Math.round(totals.L * 10) / 10, "L") : "–" },
    { label: tx.kilograms, value: totals.kg ? f.measure(Math.round(totals.kg * 10) / 10, "kg") : "–" },
    { label: tx.carbon, value: totals.co2Lines ? `${num(totals.co2, 1)} kg` : tx.noData, note: totals.co2Lines > 0 && totals.co2Lines < basket.lines.length ? tx.linesOf(totals.co2Lines, basket.lines.length) : totals.co2Lines ? "CO2e" : undefined },
  ];

  const canQuote = basket.lines.length > 0 && (run.phase === "idle" || run.phase === "quoting");

  return (
    <div className="mt-6 sm:mt-8">
      <PageHeader id="basket-h" title={tx.title} lead={tx.intro} />
      <div className="mt-6 grid items-start gap-6 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-8">
        <section aria-labelledby="basket-h" className="min-w-0">
          {basket.lines.length === 0 ? (
            <Empty
              title={tx.empty}
              glyph={
                <IconDisc tone="muted">
                  <ShoppingBasket size={21} />
                </IconDisc>
              }
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
          ) : (
            <Card as="section">
              <ul className="divide-y divide-line">
                {basket.lines.map((l) => {
                  const r = live.results[l.productId];
                  const o = r?.offer;
                  return (
                    <li key={l.productId} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] gap-x-3.5 gap-y-3 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:gap-x-5 sm:p-5">
                      <MiniPack p={l.product} />
                      <div className="min-w-0">
                        <p className="text-[0.78rem]">
                          <TempMark t={l.product.temperatureClass} />
                        </p>
                        <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="mt-0.5 block text-[1rem] font-semibold leading-snug text-ink hover:text-petrol sm:text-[1.05rem]">
                          {readable(nameIn(l.product, lang))}
                        </Link>
                        <p className="mt-0.5 text-[0.88rem] leading-snug text-ink-soft">
                          {o ? (
                            tx.perUnit(money(o.unitPriceCents), unitWord(l.product, 1, lang))
                          ) : live.busy.includes(l.productId) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Spinner size={12} /> {tx.checkingPrice}
                            </span>
                          ) : r ? (
                            <span className="text-notice">{tx.notOrderable(r.problems.length ? problemsText(r.problems, lang) : r.message)}</span>
                          ) : (
                            tx.noLivePrice
                          )}
                          {o?.stockKnown === false ? tx.stockNotConfirmed : ""}
                        </p>
                      </div>
                      <div className="-mr-2 -mt-2">
                        {!locked && (
                          <IconButton label={`${tx.remove}: ${readable(nameIn(l.product, lang))}`} onClick={() => basket.remove(l.productId)} className="hover:!bg-bad-soft hover:!text-bad">
                            <Trash2 aria-hidden size={18} />
                          </IconButton>
                        )}
                      </div>
                      <div className="col-span-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:col-span-2 sm:col-start-2">
                        <Quantity p={l.product} value={l.packs} onChange={(n) => basket.set(l.productId, n)} id={`b-${l.productId}`} disabled={locked} compact />
                        <p key={`${l.packs}-${o?.unitPriceCents}`} className="changed display ml-auto rounded-sm px-1 text-[1.45rem] tabular sm:text-[1.6rem]">
                          {o ? money(o.unitPriceCents * l.packs) : "–"}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>

        <aside aria-label={tx.totalsLabel} className="space-y-4 lg:sticky lg:top-[8.75rem]">
          <Card raise>
            <div className="p-5 sm:p-6">
              <p className="text-[0.88rem] text-ink-soft">{tx.estimate}</p>
              <p key={totals.cents} className="changed display mt-0.5 inline-block rounded-md text-[2.6rem] leading-tight text-ink tabular">
                {money(totals.cents)}
              </p>
              {totals.priced < basket.lines.length && <p className="mt-0.5 text-[0.86rem] text-ink-soft">{tx.unpriced(basket.lines.length - totals.priced, basket.lines.length)}</p>}
              <dl className="mt-4 grid grid-cols-3 gap-2">
                {measures.map((x) => (
                  <div key={x.label} className="min-w-0 rounded-lg bg-surface px-3 py-2.5">
                    <dt className="break-words text-[0.74rem] leading-tight text-ink-soft hyphens-manual">{x.label}</dt>
                    <dd className="display mt-1 text-[1.2rem] leading-tight tabular">{x.value}</dd>
                    {x.note && <dd className="mt-0.5 text-[0.72rem] leading-tight text-ink-soft">{x.note}</dd>}
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-[0.78rem] leading-snug text-ink-soft">{tx.carbonNote}</p>
            </div>
            {basket.lines.length > 0 && run.phase === "idle" && (
              <div className="border-t border-line p-5 sm:p-6">
                <Input id="deliver-by" type="date" min={helsinkiToday()} value={deliverBy} onChange={setDeliverBy} label={`${tx.deliverBy} ${tx.optional}`} />
                <Button kind="go" size="lg" className="mt-4 w-full max-lg:!hidden" onClick={() => void quote()}>
                  {tx.getPrice}
                </Button>
                <p className="mt-2.5 text-[0.84rem] leading-snug text-ink-soft">{tx.priceNote}</p>
              </div>
            )}
            {run.phase === "quoting" && (
              <div className="border-t border-line p-5" role="status" aria-label={tx.fixing}>
                <Skeleton className="h-5 w-2/3" />
                <p className="mt-2 text-[0.88rem] text-ink-soft">{tx.fixing}</p>
              </div>
            )}
            {run.error && (
              <div className="px-5 pb-5">
                <ErrorPlate title={tx.failed} message={run.error} onRetry={run.phase === "quoted" ? () => void place() : undefined} />
              </div>
            )}
          </Card>
          <div id="basket-run" className="scroll-mt-36 space-y-4">
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
          </div>
        </aside>
      </div>

      {/* A phone: the total and the one action ride above the tab bar, under the thumb. */}
      {canQuote && (
        <>
          <div aria-hidden className="h-20 lg:hidden" />
          <div className="sheet-up fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-full bg-paper py-1.5 pl-5 pr-1.5 shadow-lg ring-1 ring-line lg:hidden">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[0.72rem] text-ink-soft">{tx.estimate}</span>
              <span className="display block text-[1.25rem] tabular">{money(totals.cents)}</span>
            </span>
            <Button kind="go" busy={run.phase === "quoting"} onClick={() => void quote()}>
              {tx.getPrice}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A small picture for a basket line: the kind of product's illustration, or the drawn pack. */
function MiniPack({ p }: { p: BasketLine["product"] }) {
  const t = TEMP[p.temperatureClass ?? ""];
  const key = artFor(p);
  const drawn = (
    <div className="flex size-full items-center justify-center" style={{ background: t?.tint ?? "var(--color-surface)" }}>
      <Glyph kind={packGlyph(p)} size={34} className="text-petrol-deep/75" />
    </div>
  );
  return <div className="aspect-square overflow-hidden rounded-lg">{key ? <Art k={key} cover sizes="5rem" position="50% 58%" fallback={drawn} /> : drawn}</div>;
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { eur, helsinkiToday } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { usePortal } from "./portal";
import { Quantity } from "./qty";
import { TEMP, nameIn, readable } from "./shop";
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
  const { basket, live, ui, call, kitchen, overview, base, lang } = usePortal();
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
  const names = useMemo(() => Object.fromEntries(basket.lines.map((l) => [l.productId, l.product.name])), [basket.lines]);

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

  return (
    <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <section aria-labelledby="basket-h" className="min-w-0">
        <h1 id="basket-h" className="font-display text-[2rem] font-bold leading-tight tracking-tight">
          Basket
        </h1>
        <p className="max-w-[62ch] leading-snug text-ink-soft">Ordered by hand, checked by the same gate as the agent&apos;s orders: the kitchen&apos;s mandate, limits and sign-off apply to both.</p>
        {basket.lines.length === 0 ? (
          <div className="mt-4 bg-paper p-5">
            <p className="font-semibold">The basket is empty.</p>
            <p className="mt-1 text-ink-soft">
              Add products from the{" "}
              <Link href={`${base}/catalogue`} className="font-semibold text-ink underline decoration-2 underline-offset-4">
                catalogue
              </Link>
              , or ask the agent to order for you.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-px bg-ink/10">
            {basket.lines.map((l) => {
              const r = live.results[l.productId];
              const o = r?.offer;
              const t = TEMP[l.product.temperatureClass ?? ""];
              return (
                <li key={l.productId} className="grid gap-x-4 gap-y-2 bg-paper p-4 sm:grid-cols-[minmax(0,1fr)_auto_7rem]" style={{ borderLeft: `6px solid ${t?.color ?? "var(--color-ink)"}` }}>
                  <div className="min-w-0">
                    <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="font-semibold leading-snug hover:underline">
                      {readable(nameIn(l.product, lang))}
                    </Link>
                    <p className="text-[0.9rem] text-ink-soft">
                      {o ? `${eur(o.unitPriceCents)} per ${unitWord(l.product, 1)}` : live.busy.includes(l.productId) ? "Checking the price…" : r ? "Not orderable now" : "No live price yet"}
                      {o?.stockKnown === false ? "; stock not confirmed" : ""}
                    </p>
                    {!locked && (
                      <button type="button" className="mt-1 min-h-9 text-[0.9rem] underline" onClick={() => basket.remove(l.productId)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <Quantity p={l.product} value={l.packs} onChange={(n) => basket.set(l.productId, n)} id={`b-${l.productId}`} disabled={locked} />
                  <p className="text-right font-display text-[1.3rem] font-bold tabular sm:pt-2">{o ? eur(o.unitPriceCents * l.packs) : "–"}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside aria-label="Totals and checkout" className="space-y-3 lg:sticky lg:top-3">
        <div className="bg-paper">
          <div aria-hidden className="h-[3px] bg-ink" />
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 p-4">
            <dt className="font-semibold">Estimate, VAT 0 %</dt>
            <dd className="font-display text-[1.9rem] font-bold leading-none tabular">{eur(totals.cents)}</dd>
            {totals.priced < basket.lines.length && (
              <dd className="col-span-2 text-[0.88rem] text-ink-soft">
                {basket.lines.length - totals.priced} of {basket.lines.length} lines have no live price yet.
              </dd>
            )}
            <dt className="text-ink-soft">Litres</dt>
            <dd className="tabular">{totals.L ? `${totals.L.toLocaleString("en-US", { maximumFractionDigits: 1 })} L` : "–"}</dd>
            <dt className="text-ink-soft">Kilograms</dt>
            <dd className="tabular">{totals.kg ? `${totals.kg.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg` : "–"}</dd>
            <dt className="text-ink-soft">Carbon</dt>
            <dd className="text-right tabular">
              {totals.co2Lines ? `${totals.co2.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg CO2e` : "no data"}
              {totals.co2Lines > 0 && totals.co2Lines < basket.lines.length && <span className="block text-[0.82rem] text-ink-soft">for {totals.co2Lines} of {basket.lines.length} lines</span>}
            </dd>
            <dd className="col-span-2 text-[0.82rem] leading-snug text-ink-soft">Carbon is the product group&apos;s average per kilo (a litre counted as a kilo), not a measurement of these products.</dd>
          </dl>
          {basket.lines.length > 0 && run.phase === "idle" && (
            <div className="border-t border-ink/15 p-4">
              <label htmlFor="deliver-by" className="text-[0.95rem] font-semibold">
                Deliver by <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input id="deliver-by" type="date" min={helsinkiToday()} value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} className="mt-1 block min-h-11 w-full border-2 border-ink px-2" />
              <Button kind="primary" className="mt-3 w-full" onClick={() => void quote()}>
                Get a fixed price
              </Button>
              <p className="mt-2 text-[0.85rem] text-ink-soft">The wholesaler signs the price; it holds for a short time. Nothing is ordered until you place it.</p>
            </div>
          )}
          {run.phase === "quoting" && (
            <p className="flex items-center gap-2 border-t border-ink/15 p-4 text-ink-soft">
              <Target size={18} tone="hollow" spin /> The wholesaler is fixing the price…
            </p>
          )}
          {run.error && (
            <div className="px-4 pb-4">
              <ErrorPlate title="That did not go through" message={run.error} onRetry={run.phase === "quoted" ? () => void place() : undefined} />
            </div>
          )}
        </div>
        {(run.phase === "quoted" || run.phase === "placing" || run.phase === "done") && run.quote && <Quote q={run.quote} names={names} decided={run.phase === "done"} busy={run.phase === "placing"} onPlace={() => void place()} onNew={reset} />}
        {run.phase === "done" && (
          <>
            <Gate order={shownOrder} refusal={run.refusal} kitchen={kitchen} names={names} streaming={orderLive.streaming} />
            {shownOrder && (shownOrder.status === "committed" || shownOrder.status === "declined") ? (
              <SignedOrder order={shownOrder} names={names} onNew={reset} />
            ) : (
              <Button kind="secondary" onClick={reset}>
                {shownOrder?.status === "pending_approval" ? "Start a new basket" : "Back to the basket"}
              </Button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

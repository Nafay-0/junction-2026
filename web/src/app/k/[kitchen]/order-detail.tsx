"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { verifyChain, type ChainCheck } from "../../_client/verify-chain";
import { sha256Hex, verifySigned, type KeySet } from "../../_client/verify-signed";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday, money, say, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { askedText } from "./history";
import { ORDER_DETAIL_TEXT } from "./order-detail.text";
import { usePortal } from "./portal";
import { Gate } from "./stages";
import { Timeline } from "./timeline";
import { Button, ErrorPlate, Field, Paper } from "./ui";
import type { LedgerReply, Order } from "./types";
import { useProductName } from "./names";

/**
 * One order: what was asked, what was ordered at what fixed price, who let it through and how, the timeline of
 * what the agent did and why, and a Verify control that checks in this browser the wholesaler's signature on
 * the order, the signed claims its price rested on, and the whole ledger chain.
 */
type Detail = { order: Order; entries: LedgerReply["entries"] };

export function OrderDetail({ orderId }: { orderId: string }) {
  const pn = useProductName();
  const { call, kitchen, overview, base } = usePortal();
  const tx = useText(ORDER_DETAIL_TEXT);
  const f = useFormat();
  const events = `/api/v1/events?orgId=${encodeURIComponent(kitchen.orgId)}`;
  const live = useLive<Detail>(
    async () => {
      const o = await call<{ order: Order }>("GET", `/api/v1/orders/${orderId}`);
      if (!o.ok) throw new Error(o.error.message);
      const l = await call<LedgerReply>("GET", `/api/v1/ledger?requestId=${o.data.order.requestId}`);
      return { order: o.data.order, entries: l.ok ? l.data.entries : [] };
    },
    { events, pollMs: 3000, pollMsStreaming: 8000 },
  );
  const d = live.data;
  const asked = overview.data?.requests.find((r) => r.requestId === d?.order.requestId)?.text;
  const names = useMemo(() => Object.fromEntries((d?.order.lines ?? []).map((l) => [l.productId, l.name])), [d]);

  if (live.error && !d) return <ErrorPlate title={tx.loadFailed} message={live.error} onRetry={live.refresh} />;
  if (!d) return <div className="mt-6 h-96 animate-pulse bg-concrete-deep/60" aria-label={tx.loading} />;
  const o = d.order;
  const quoteEntry = d.entries.find((e) => e.type === "quote" && e.data.quoteId === o.quoteId);
  const q = quoteEntry?.data as { expiresAt?: string; expiresBecause?: string; evidence?: { claimId: string; type: string; productId: string; sha256: string }[] } | undefined;
  const statusWord = tx.status[o.status] ?? tx.status.rejected;

  return (
    <div className="mt-5 space-y-6">
      <nav aria-label={tx.breadcrumb} className="text-[0.92rem]">
        <Link href={`${base}/orders`} className="underline decoration-1 underline-offset-4">
          {tx.orders}
        </Link>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-soft">
            {tx.at(statusWord, f.day(helsinkiToday(new Date(o.createdAt))), clock(o.createdAt))}
          </p>
          <h1 className="display text-[2.2rem]">{o.lines.map((l) => `${l.quantity} × ${shortProduct(pn(l.productId, l.name))}`).join(" + ")}</h1>
          {asked && <p className="mt-1 text-[1.05rem]">{asked.startsWith("Basket") ? askedText(asked, f.lang) : tx.asked(asked)}</p>}
        </div>
        <p className="display text-[2.8rem] tabular">{money(o.totalCents)}</p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="lines" className="space-y-3">
          <h2 id="lines" className="display text-[1.5rem]">
            {tx.fixedPrice}
          </h2>
          <Paper>
            <div className="p-4">
              <table className="w-full text-left text-[0.98rem]">
                <thead className="text-[0.82rem] text-ink-soft">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">{tx.head.product}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{tx.head.qty}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{tx.head.each}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{tx.head.line}</th>
                    <th className="py-1.5 text-right font-medium">{tx.head.arrives}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.lines.map((l) => (
                    <tr key={l.productId}>
                      <td className="py-1.5 pr-2">
                        <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="hover:underline">
                          {shortProduct(pn(l.productId, l.name))}
                        </Link>
                        {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">{tx.swapFor(shortProduct(l.substituteFor.name))}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">{l.quantity}</td>
                      <td className="py-1.5 pr-2 text-right tabular">{money(l.unitPriceCents)}</td>
                      <td className="py-1.5 pr-2 text-right tabular">{money(l.lineTotalCents)}</td>
                      <td className="py-1.5 text-right">{f.day(l.deliveryDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 sm:grid-cols-3">
                <Field label={tx.priceFixedBy}>{tx.signature}</Field>
                {q?.expiresAt && (
                  <Field label={tx.heldUntil}>
                    {tx.heldTime(clock(q.expiresAt))}
                    {q.expiresBecause === "order_cutoff" ? tx.becauseCutoff : q.expiresBecause === "price_validity" ? tx.becauseValidity : ""}
                  </Field>
                )}
                <Field label={tx.restsOn}>{q?.evidence?.length ? tx.claims(q.evidence.length) : tx.signedQuote}</Field>
              </dl>
            </div>
          </Paper>
        </section>
        <section aria-labelledby="who" className="space-y-3">
          <h2 id="who" className="display text-[1.5rem]">
            {tx.who}
          </h2>
          <Gate order={o} kitchen={kitchen} names={names} streaming={live.streaming} byHand={!!asked?.startsWith("Basket")} />
        </section>
      </div>

      <Verify order={o} evidence={q?.evidence ?? []} />

      {d.entries.length > 0 && (
        <section aria-labelledby="timeline">
          <h2 id="timeline" className="display text-[1.5rem]">
            {tx.timeline}
          </h2>
          <p className="text-[0.95rem] text-ink-soft">{tx.entries(d.entries.length)}</p>
          <div className="mt-2 bg-paper p-4">
            <Timeline entries={d.entries} names={names} agentName={kitchen.agentName} kitchen={kitchen.slug} check={false} />
          </div>
        </section>
      )}
    </div>
  );
}

type Result = {
  ms: number;
  order: { ok: boolean; message: string };
  claims: { ok: number; failed: string[]; total: number };
  chain: ChainCheck;
};

function Verify({ order, evidence }: { order: Order; evidence: { claimId: string; type: string; productId: string; sha256: string }[] }) {
  const { kitchen, ui } = usePortal();
  const tx = useText(ORDER_DETAIL_TEXT);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result>();
  const [error, setError] = useState<string>();

  async function run() {
    setBusy(true);
    setError(undefined);
    const t0 = performance.now();
    const [keys, ledger, claims] = await Promise.all([
      api<KeySet>("GET", "/.well-known/jwks.json"),
      api<LedgerReply>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/call`, { method: "GET", path: "/api/v1/ledger" }),
      evidence.length ? ui<{ claims: { claimId: string; sha256: string; token: string }[] }>("GET", `claims?${evidence.map((e) => `id=${encodeURIComponent(e.claimId)}`).join("&")}`) : Promise.resolve(undefined),
    ]);
    if (!keys.ok || !ledger.ok) {
      setError(!keys.ok ? keys.error.message : !ledger.ok ? ledger.error.message : "");
      setBusy(false);
      return;
    }
    let orderCheck: Result["order"];
    if (!order.confirmation) orderCheck = { ok: false, message: order.status === "pending_approval" ? tx.notSigned : tx.noConfirmation };
    else {
      const v = await verifySigned<{ orderId: string; totalCents: number; lines: unknown[] }>(order.confirmation, keys.data);
      orderCheck = !v.ok
        ? { ok: false, message: v.message }
        : v.payload.orderId !== order.orderId || v.payload.totalCents !== order.totalCents
          ? { ok: false, message: tx.otherOrder }
          : { ok: true, message: tx.signedByKey(v.kid, v.payload.orderId.slice(0, 10), money(v.payload.totalCents), v.payload.lines.length) };
    }
    const failed: string[] = [];
    let ok = 0;
    const tokens = claims && claims.ok ? claims.data.claims : [];
    for (const e of evidence) {
      const t = tokens.find((c) => c.claimId === e.claimId);
      const type = tx.claimType[e.type] ?? e.type;
      if (!t) {
        failed.push(tx.claimMissing(type, e.productId));
        continue;
      }
      const v = await verifySigned(t.token, keys.data);
      if (!v.ok) failed.push(tx.claimBad(type, e.productId, v.message));
      else if ((await sha256Hex(t.token)) !== e.sha256) failed.push(tx.claimOther(type, e.productId));
      else ok += 1;
    }
    const chain = await verifyChain(ledger.data.entries);
    setR({ ms: Math.max(1, Math.round(performance.now() - t0)), order: orderCheck, claims: { ok, failed, total: evidence.length }, chain });
    setBusy(false);
  }

  return (
    <section aria-labelledby="verify" className="bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="verify" className="display text-[1.5rem]">
              {tx.verify}
            </h2>
            <p className="text-[0.95rem] text-ink-soft">{tx.verifyIntro}</p>
          </div>
          <Button kind="primary" busy={busy} onClick={() => void run()}>
            {tx.verifyButton}
          </Button>
        </div>
        {error && <p className="mt-2 text-ink-soft">{tx.verifyFailed(error)}</p>}
        {r && (
          <ul className="mt-3 space-y-2" aria-live="polite">
            <Check ok={r.order.ok} title={tx.checkOrder} text={r.order.message} />
            <Check
              ok={r.claims.failed.length === 0}
              title={tx.checkClaims}
              text={r.claims.total === 0 ? tx.noClaims : r.claims.failed.length === 0 ? tx.allClaims(r.claims.total) : tx.someClaims(r.claims.ok, r.claims.total, r.claims.failed.join("; "))}
            />
            <Check ok={r.chain.ok} title={tx.checkChain} text={r.chain.ok ? tx.chainOk(r.chain.length, r.ms) : r.chain.message} />
            <li className="text-[0.88rem] text-ink-soft">{say(tx.window)}</li>
          </ul>
        )}
      </div>
    </section>
  );
}

function Check({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  const tx = useText(ORDER_DETAIL_TEXT);
  return (
    <li className="flex items-start gap-2 leading-snug">
      <Target size={22} tone={ok ? "ink" : "safety"} className="mt-0.5 shrink-0" />
      <span>
        <strong>
          {title}: {ok ? tx.ok : tx.notOk}
        </strong>{" "}
        {text}
      </span>
    </li>
  );
}

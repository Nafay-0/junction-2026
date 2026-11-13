"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { verifyChain, type ChainCheck } from "../../_client/verify-chain";
import { sha256Hex, verifySigned, type KeySet } from "../../_client/verify-signed";
import { clock, day, eur, helsinkiToday, humanize, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { askedText } from "./history";
import { usePortal } from "./portal";
import { Gate } from "./stages";
import { Timeline } from "./timeline";
import { Button, ErrorPlate, Field, Paper } from "./ui";
import type { LedgerReply, Order } from "./types";

/**
 * One order: what was asked, what was ordered at what fixed price, who let it through and how, the timeline of
 * what the agent did and why, and a Verify control that checks in this browser the wholesaler's signature on
 * the order, the signed claims its price rested on, and the whole ledger chain.
 */
type Detail = { order: Order; entries: LedgerReply["entries"] };

export function OrderDetail({ orderId }: { orderId: string }) {
  const { call, kitchen, overview, base } = usePortal();
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

  if (live.error && !d) return <ErrorPlate title="This order did not load" message={live.error} onRetry={live.refresh} />;
  if (!d) return <div className="mt-6 h-96 animate-pulse bg-paper/60" aria-label="Loading the order" />;
  const o = d.order;
  const quoteEntry = d.entries.find((e) => e.type === "quote" && e.data.quoteId === o.quoteId);
  const q = quoteEntry?.data as { expiresAt?: string; expiresBecause?: string; evidence?: { claimId: string; type: string; productId: string; sha256: string }[] } | undefined;
  const statusWord = o.status === "committed" ? "Placed" : o.status === "pending_approval" ? "Waiting for sign-off" : o.status === "declined" ? "Declined" : "Refused by the gate";

  return (
    <div className="mt-5 space-y-6">
      <nav aria-label="Breadcrumb" className="text-[0.92rem]">
        <Link href={`${base}/orders`} className="underline decoration-1 underline-offset-4">
          Orders
        </Link>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-soft">
            {statusWord}, {day(helsinkiToday(new Date(o.createdAt)))} {clock(o.createdAt)}
          </p>
          <h1 className="font-display text-[2.2rem] font-bold leading-tight tracking-tight">{o.lines.map((l) => `${l.quantity} × ${shortProduct(l.name)}`).join(" + ")}</h1>
          {asked && <p className="mt-1 text-[1.05rem]">{asked.startsWith("Basket") ? askedText(asked) : `Asked: “${asked}”`}</p>}
        </div>
        <p className="font-display text-[2.8rem] font-bold leading-none tabular">{eur(o.totalCents)}</p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="lines" className="space-y-3">
          <h2 id="lines" className="font-display text-[1.5rem] font-bold">
            Fixed price
          </h2>
          <Paper>
            <div className="p-4">
              <table className="w-full text-left text-[0.98rem]">
                <thead className="text-[0.82rem] text-ink-soft">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Product</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Each</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Line</th>
                    <th className="py-1.5 text-right font-medium">Arrives</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {o.lines.map((l) => (
                    <tr key={l.productId}>
                      <td className="py-1.5 pr-2">
                        <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="hover:underline">
                          {shortProduct(l.name)}
                        </Link>
                        {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">swap for {shortProduct(l.substituteFor.name)}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">{l.quantity}</td>
                      <td className="py-1.5 pr-2 text-right tabular">{eur(l.unitPriceCents)}</td>
                      <td className="py-1.5 pr-2 text-right tabular">{eur(l.lineTotalCents)}</td>
                      <td className="py-1.5 text-right">{day(l.deliveryDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-ink/15 pt-3 sm:grid-cols-3">
                <Field label="Price fixed by">the wholesaler&apos;s signature</Field>
                {q?.expiresAt && (
                  <Field label="Price held until">
                    {clock(q.expiresAt)}
                    {q.expiresBecause === "order_cutoff" ? ", the order cut-off" : q.expiresBecause === "price_validity" ? ", when the price ends" : ""}
                  </Field>
                )}
                <Field label="Rests on">{q?.evidence?.length ? `${q.evidence.length} signed claims` : "the signed quote"}</Field>
              </dl>
            </div>
          </Paper>
        </section>
        <section aria-labelledby="who" className="space-y-3">
          <h2 id="who" className="font-display text-[1.5rem] font-bold">
            Who let it through
          </h2>
          <Gate order={o} kitchen={kitchen} names={names} streaming={live.streaming} byHand={!!asked?.startsWith("Basket")} />
        </section>
      </div>

      <Verify order={o} evidence={q?.evidence ?? []} />

      {d.entries.length > 0 && (
        <section aria-labelledby="timeline">
          <h2 id="timeline" className="font-display text-[1.5rem] font-bold">
            What the agent did and why
          </h2>
          <p className="text-[0.95rem] text-ink-soft">{d.entries.length} ledger entries for this request, each chained to the one before.</p>
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
    if (!order.confirmation) orderCheck = { ok: false, message: order.status === "pending_approval" ? "Not signed yet: the wholesaler signs when the order is placed." : "No signed confirmation: nothing was ordered." };
    else {
      const v = await verifySigned<{ orderId: string; totalCents: number; lines: unknown[] }>(order.confirmation, keys.data);
      orderCheck = !v.ok
        ? { ok: false, message: v.message }
        : v.payload.orderId !== order.orderId || v.payload.totalCents !== order.totalCents
          ? { ok: false, message: "The signature is valid but it is for another order or total." }
          : { ok: true, message: `Signed by the wholesaler's key ${v.kid}: order ${v.payload.orderId.slice(0, 10)}…, ${eur(v.payload.totalCents)}, ${v.payload.lines.length} line${v.payload.lines.length === 1 ? "" : "s"}.` };
    }
    const failed: string[] = [];
    let ok = 0;
    const tokens = claims && claims.ok ? claims.data.claims : [];
    for (const e of evidence) {
      const t = tokens.find((c) => c.claimId === e.claimId);
      if (!t) {
        failed.push(`${e.type} claim for ${e.productId}: not available`);
        continue;
      }
      const v = await verifySigned(t.token, keys.data);
      if (!v.ok) failed.push(`${e.type} claim for ${e.productId}: ${v.message}`);
      else if ((await sha256Hex(t.token)) !== e.sha256) failed.push(`${e.type} claim for ${e.productId}: not the one the quote names`);
      else ok += 1;
    }
    const chain = await verifyChain(ledger.data.entries);
    setR({ ms: Math.max(1, Math.round(performance.now() - t0)), order: orderCheck, claims: { ok, failed, total: evidence.length }, chain });
    setBusy(false);
  }

  return (
    <section aria-labelledby="verify" className="bg-paper">
      <div aria-hidden className="h-[3px] bg-ink" />
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="verify" className="font-display text-[1.5rem] font-bold">
              Verify
            </h2>
            <p className="text-[0.95rem] text-ink-soft">Checked in this browser against the wholesaler&apos;s published keys, without trusting the server&apos;s own answer.</p>
          </div>
          <Button kind="primary" busy={busy} onClick={() => void run()}>
            Verify this order
          </Button>
        </div>
        {error && <p className="mt-2 text-ink-soft">Could not verify: {error}</p>}
        {r && (
          <ul className="mt-3 space-y-2" aria-live="polite">
            <Check ok={r.order.ok} title="The wholesaler's signature on the order" text={r.order.message} />
            <Check
              ok={r.claims.failed.length === 0}
              title="The signed claims the price rested on"
              text={r.claims.total === 0 ? "This quote names no separate claims; its own signature covers the price." : r.claims.failed.length === 0 ? `All ${r.claims.total} claims (price, availability, origin) carry a valid wholesaler signature and are exactly the ones the quote names.` : `${r.claims.ok} of ${r.claims.total} check out. ${r.claims.failed.join("; ")}.`}
            />
            <Check ok={r.chain.ok} title="The ledger chain" text={r.chain.ok ? `All ${r.chain.length} entries link up: every SHA-256 recomputed from the first entry, in ${r.ms} ms in total.` : r.chain.message} />
            <li className="text-[0.88rem] text-ink-soft">{humanize("A claim's own validity window (30 minutes for stock) may have passed since; the signature still proves what the wholesaler said at the time.")}</li>
          </ul>
        )}
      </div>
    </section>
  );
}

function Check({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <li className="flex items-start gap-2 leading-snug">
      <Target size={22} tone={ok ? "ink" : "safety"} className="mt-0.5 shrink-0" />
      <span>
        <strong>
          {title}: {ok ? "checks out." : "does not check out."}
        </strong>{" "}
        {text}
      </span>
    </li>
  );
}

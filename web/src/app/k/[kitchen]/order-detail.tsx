"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { verifyChain, type ChainCheck } from "../../_client/verify-chain";
import { sha256Hex, verifySigned, type KeySet } from "../../_client/verify-signed";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday, money, say, shortProduct } from "../../_ui/plain";
import { Check as Check2, ShieldCheck, X } from "lucide-react";
import { Badge, Card, FactList, IconDisc, PageHeader, SectionTitle, Skeleton, Tag, type BadgeTone } from "../../_ui/kit";
import { askedText } from "./history";
import { ORDER_DETAIL_TEXT } from "./order-detail.text";
import { usePortal } from "./portal";
import { Gate } from "./stages";
import { RulesThen } from "./rules-then";
import { Timeline } from "./timeline";
import { OrderTimelineList } from "./order-timeline";
import type { OrderTimeline } from "@/server/ops/order-timeline";
import { Button, ErrorPlate } from "./ui";
import type { LedgerReply, Order } from "./types";
import { useProductName } from "./names";

/**
 * One order: what was asked, what was ordered at what fixed price, who let it through and how, the timeline of
 * what the agent did and why, and a Verify control that checks in this browser the wholesaler's signature on
 * the order, the signed claims its price rested on, and the whole ledger chain.
 */
type Detail = { order: Order; entries: LedgerReply["entries"]; timeline?: OrderTimeline };

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
      // The order's whole timeline: the same steps the wholesaler's operations read (server/ops/order-timeline.ts).
      const [l, t] = await Promise.all([call<LedgerReply>("GET", `/api/v1/ledger?requestId=${o.data.order.requestId}`), call<{ timeline: OrderTimeline }>("GET", `/api/v1/orders/${orderId}/timeline`)]);
      return { order: o.data.order, entries: l.ok ? l.data.entries : [], ...(t.ok ? { timeline: t.data.timeline } : {}) };
    },
    { events, pollMs: 3000, pollMsStreaming: 8000 },
  );
  const d = live.data;
  const asked = overview.data?.requests.find((r) => r.requestId === d?.order.requestId)?.text;
  const names = useMemo(() => Object.fromEntries((d?.order.lines ?? []).map((l) => [l.productId, l.name])), [d]);

  if (live.error && !d)
    return (
      <div className="mt-6">
        <ErrorPlate title={tx.loadFailed} message={live.error} onRetry={live.refresh} />
      </div>
    );
  if (!d)
    return (
      <div className="mt-6 space-y-6 sm:mt-8" role="status" aria-label={tx.loading}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-3/4 max-w-xl" />
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-72 !rounded-[20px]" />
          <Skeleton className="h-72 !rounded-[20px]" />
        </div>
      </div>
    );
  const o = d.order;
  const quoteEntry = d.entries.find((e) => e.type === "quote" && e.data.quoteId === o.quoteId);
  const q = quoteEntry?.data as { expiresAt?: string; expiresBecause?: string; evidence?: { claimId: string; type: string; productId: string; sha256: string }[] } | undefined;
  const statusWord = tx.status[o.status] ?? tx.status.rejected;
  const tone: BadgeTone = o.status === "pending_approval" ? "waiting" : o.status === "committed" ? "good" : o.status === "rejected" ? "refused" : "neutral";

  return (
    <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
      <PageHeader
        back={{ href: `${base}/orders`, label: tx.orders }}
        context={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Badge tone={tone}>{statusWord}</Badge>
            <span className="tabular">{f.day(helsinkiToday(new Date(o.createdAt)))} {clock(o.createdAt)}</span>
          </span>
        }
        title={<span className="mt-1.5 block">{o.lines.map((l) => `${l.quantity} × ${shortProduct(pn(l.productId, l.name))}`).join(" + ")}</span>}
        lead={
          <>
            {asked && <p>{asked.startsWith("Basket") ? askedText(asked, f.lang) : tx.asked(asked)}</p>}
            <p className={asked ? "mt-1 text-[0.92rem]" : undefined}>{tx.intro}</p>
          </>
        }
        actions={
          <div className="hidden text-right sm:block">
            <p className="text-[0.86rem] text-ink-soft">{tx.total}</p>
            <p className="display text-[2.4rem] leading-none tabular sm:text-[2.8rem]">{money(o.totalCents)}</p>
          </div>
        }
      />
      <span className="sr-only">{tx.at(statusWord, f.day(helsinkiToday(new Date(o.createdAt))), clock(o.createdAt))}</span>

      <div className="grid items-start gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section aria-labelledby="lines" className="xl:col-start-1 xl:row-start-1">
          <SectionTitle id="lines">
            {tx.fixedPrice}
          </SectionTitle>
          <Card>
            <ul className="divide-y divide-line">
              {o.lines.map((l) => (
                <li key={l.productId} className="flex items-start gap-4 px-5 py-4">
                  <span className="min-w-0 flex-1">
                    <Link href={`${base}/catalogue/${encodeURIComponent(l.productId)}`} className="font-semibold leading-snug hover:text-petrol hover:underline">
                      {shortProduct(pn(l.productId, l.name))}
                    </Link>
                    <span className="mt-1 block text-[0.9rem] leading-snug text-ink-soft tabular">
                      {l.quantity} × {f.measure(l.packSize, l.unit)} = <span className="font-medium text-ink">{f.measure(Math.round(l.quantity * l.packSize * 1000) / 1000, l.unit)}</span>, {tx.each(money(l.unitPriceCents))}
                    </span>
                    <span className="mt-0.5 block text-[0.9rem] leading-snug text-ink-soft">
                      {tx.head.arrives} <span className="font-medium text-ink">{f.day(l.deliveryDate)}</span>
                    </span>
                    {l.substituteFor && (
                      <span className="mt-1.5 inline-flex">
                        <Tag tone="agent">{tx.swapFor(shortProduct(l.substituteFor.name))}</Tag>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 pt-px text-right font-semibold tabular">
                    <span className="sr-only">{tx.head.line}: </span>
                    {money(l.lineTotalCents)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-4 border-t border-line px-5 py-4">
              <span className="font-semibold">{tx.total}</span>
              <span className="display text-[1.6rem] tabular">{money(o.totalCents)}</span>
            </div>
            <div className="border-t border-line bg-mist/60 px-5 py-4">
              <FactList
                labelWidth="9.5rem"
                rows={[
                  { key: "by", label: tx.priceFixedBy, value: tx.signature },
                  ...(q?.expiresAt ? [{ key: "held", label: tx.heldUntil, value: `${tx.heldTime(clock(q.expiresAt))}${q.expiresBecause === "order_cutoff" ? tx.becauseCutoff : q.expiresBecause === "price_validity" ? tx.becauseValidity : ""}` }] : []),
                  { key: "rests", label: tx.restsOn, value: q?.evidence?.length ? tx.claims(q.evidence.length) : tx.signedQuote },
                ]}
              />
            </div>
          </Card>
        </section>
        <section aria-labelledby="who" className="xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <SectionTitle id="who">{tx.who}</SectionTitle>
          <Gate order={o} kitchen={kitchen} names={names} streaming={live.streaming} byHand={!!asked?.startsWith("Basket")} />
        </section>
        <div className="xl:col-start-1 xl:row-start-2">
          <Verify order={o} evidence={q?.evidence ?? []} />
        </div>
      </div>

      <RulesThen orderId={o.orderId} />

      {(d.timeline?.steps.length ?? d.entries.length) > 0 && (
        <section aria-labelledby="timeline">
          <SectionTitle id="timeline" aside={tx.entries(d.timeline?.steps.length ?? d.entries.length)}>
            {tx.timeline}
          </SectionTitle>
          <Card pad>{d.timeline ? <OrderTimelineList t={d.timeline} agentName={kitchen.agentName} /> : <Timeline entries={d.entries} names={names} agentName={kitchen.agentName} kitchen={kitchen.slug} check={false} />}</Card>
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
    <section aria-labelledby="verify">
      <Card pad>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5">
            <IconDisc size={40}>
              <ShieldCheck size={20} />
            </IconDisc>
            <div className="min-w-0">
              <h2 id="verify" className="display text-[1.35rem]">
                {tx.verify}
              </h2>
              <p className="mt-0.5 text-[0.92rem] leading-relaxed text-ink-soft">{tx.verifyIntro}</p>
            </div>
          </div>
          <Button kind="primary" busy={busy} onClick={() => void run()}>
            {tx.verifyButton}
          </Button>
        </div>
        {error && <p className="mt-3 text-[0.95rem] text-bad">{tx.verifyFailed(error)}</p>}
        {r && (
          <ul className="lane-enter mt-5 space-y-3 border-t border-line pt-4" aria-live="polite">
            <Check ok={r.order.ok} title={tx.checkOrder} text={r.order.message} />
            <Check
              ok={r.claims.failed.length === 0}
              title={tx.checkClaims}
              text={r.claims.total === 0 ? tx.noClaims : r.claims.failed.length === 0 ? tx.allClaims(r.claims.total) : tx.someClaims(r.claims.ok, r.claims.total, r.claims.failed.join("; "))}
            />
            <Check ok={r.chain.ok} title={tx.checkChain} text={r.chain.ok ? tx.chainOk(r.chain.length, r.ms) : r.chain.message} />
            <li className="pl-11 text-[0.86rem] leading-snug text-ink-soft">{say(tx.window)}</li>
          </ul>
        )}
      </Card>
    </section>
  );
}

function Check({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  const tx = useText(ORDER_DETAIL_TEXT);
  return (
    <li className="flex items-start gap-3 leading-snug">
      <IconDisc size={30} tone={ok ? "good" : "muted"} className={ok ? "" : "!bg-bad-soft !text-bad"}>
        {ok ? <Check2 size={16} strokeWidth={2.6} /> : <X size={16} strokeWidth={2.6} />}
      </IconDisc>
      <span className="min-w-0 pt-1 text-[0.95rem]">
        <strong className="font-semibold">
          {title}: {ok ? tx.ok : tx.notOk}
        </strong>{" "}
        <span className="text-ink-soft">{text}</span>
      </span>
    </li>
  );
}

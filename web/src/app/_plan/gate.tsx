"use client";

import { useEffect, useState } from "react";
import type { PlanWire } from "@/server/agent/menu/wire";
import { api } from "../_client/api";
import { clock, day, money, roleLabel, ruleTitle } from "../_ui/plain";
import { Target } from "../_ui/target";
import { cutoff } from "./sheet";
import { Btn, Field, Sheet } from "./ui";

type ApprovalQr = { mode: "demo_link" | "view_only"; approver: { name: string; role: string }; status: string; url: string; qrSvg: string };

/** The bottom of the sheet: total, delivery, what needs a person, and the one button that asks for a fixed price. */
export function Totals({ plan, onQuote, busy }: { plan: PlanWire; onQuote: () => void; busy: boolean }) {
  const t = plan.totals;
  return (
    <Sheet safety={t.signOff.needed || t.openDoubts > 0}>
      <div className="p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Field label="Total, before VAT">
            <span className="font-display text-[2rem] font-bold leading-none tabular">{money(t.totalCents)}</span>
          </Field>
          <Field label="Lines">
            {t.lines} line{t.lines === 1 ? "" : "s"}, {t.products} product{t.products === 1 ? "" : "s"}
            {t.struck ? <span className="block text-[0.9rem] font-medium text-ink-soft">{t.struck} not ordered</span> : null}
          </Field>
          <Field label="Delivery">
            {t.deliveryDate ? day(t.deliveryDate) : "-"}
            {t.orderBy ? <span className="block text-[0.9rem] font-medium text-ink-soft">order by {cutoff(t.orderBy)}</span> : null}
          </Field>
          <Field label="Who decides">
            {t.signOff.needed ? (t.signOff.approver ? `${t.signOff.approver.name}, ${roleLabel(t.signOff.approver.role)}` : "no one may sign it") : "the agent, within its mandate"}
            {t.signOff.reasons[0] ? <span className="block text-[0.9rem] font-medium text-ink-soft">{t.signOff.reasons[0]}</span> : null}
          </Field>
        </dl>
        {plan.state === "planned" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Btn kind="primary" busy={busy} disabled={!t.canQuote} onClick={onQuote} className="min-h-12 px-5 text-[1.1rem]">
              Get a fixed price
            </Btn>
            {t.blockers.length > 0 ? (
              <ul className="text-[0.95rem] leading-snug">
                {t.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.95rem] text-ink-soft">One quote for the whole plan, then the gate checks it against the mandate once.</p>
            )}
          </div>
        )}
        <p className="mt-3 text-[0.85rem] text-ink-soft">
          Live price and availability: {plan.live.calls} batched call{plan.live.calls === 1 ? "" : "s"}, {plan.live.products} products ({plan.live.allowance.newProductsLeft} more allowed this hour).
          {plan.live.refused ? ` ${plan.live.refused}` : ""} Model: {plan.model.calls.length} calls, {(plan.model.ms / 1000).toFixed(1)} s{plan.model.costUsd !== null ? `, $${plan.model.costUsd.toFixed(3)}` : ""}.
        </p>
      </div>
    </Sheet>
  );
}

/** After the fixed price: the quote, the gate's decision, the sign-off on a phone, the signed order. */
export function GateStage({ plan, kitchen, onOrder, onRefresh, busy, base }: { plan: PlanWire; kitchen: string; onOrder: () => void; onRefresh: () => void; busy: boolean; base: string }) {
  const q = plan.quote;
  const o = plan.order;
  useEffect(() => {
    if (o?.status !== "pending_approval") return;
    const t = setInterval(onRefresh, 2000);
    return () => clearInterval(t);
  }, [o?.status, onRefresh]);
  if (!q && !plan.error) return null;
  return (
    <Sheet safety={!!o && (o.status !== "committed" || !!o.approval)}>
      <div className="p-4 sm:p-5">
        {plan.error && (
          <div role="alert" className="mb-3 border-l-[6px] border-ink bg-safety/30 px-3 py-2">
            <p className="font-semibold">The gate said no: {ruleTitle(plan.error.rule) || plan.error.code}</p>
            <p>{plan.error.message}</p>
          </div>
        )}
        {q && (
          <>
            <h2 className="font-display text-[1.6rem] font-bold leading-tight">Fixed price {money(q.totalCents)}</h2>
            <p className="text-[0.95rem] text-ink-soft">
              Quote {q.quoteId}, signed by the wholesaler, holds until {clock(q.expiresAt)}
              {q.expiresBecause === "order_cutoff" ? " (the order cut-off)" : q.expiresBecause === "price_validity" ? " (when the price stops being valid)" : ""}; it rests on {q.evidence} signed claims. {q.lines.length} lines.
            </p>
            {!o && (
              <>
                <p className="mt-2">
                  {q.policyPreview.outcome === "auto_approve"
                    ? "The gate will let the agent place this alone: it is within the mandate."
                    : q.policyPreview.outcome === "needs_human_approval"
                      ? `The gate will ask ${q.policyPreview.approver?.name} (${roleLabel(q.policyPreview.approver?.role ?? "")}) to sign off: ${q.policyPreview.reasons[0]}`
                      : `The gate would refuse it: ${q.policyPreview.reasons[0]}`}
                </p>
                <Btn kind="primary" busy={busy} onClick={onOrder} className="mt-3 min-h-12 px-5 text-[1.1rem]">
                  Place the order
                </Btn>
              </>
            )}
          </>
        )}
        {o && <Decision order={o} kitchen={kitchen} base={base} />}
      </div>
    </Sheet>
  );
}

function Decision({ order, kitchen, base }: { order: NonNullable<PlanWire["order"]>; kitchen: string; base: string }) {
  const a = order.approval;
  const escalated = order.decision.rules.filter((r) => r.outcome === "escalate");
  const failed = order.decision.rules.filter((r) => r.outcome === "fail");
  const title =
    order.status === "committed"
      ? a
        ? `Signed off by ${a.approver.name}: ordered`
        : "Ordered on the agent's own authority"
      : order.status === "pending_approval"
        ? `Waiting for ${a?.approver.name ?? "a person"}`
        : order.status === "declined"
          ? `Declined by ${a?.approver.name}`
          : "Refused by the gate";
  return (
    <div className="mt-4 grid gap-5 border-t border-line pt-4 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <Target size={52} tone={order.status === "committed" && !a ? "ink" : "safety"} spin={order.status === "pending_approval"} className="shrink-0" />
          <div>
            <p className="font-display text-[1.9rem] font-bold leading-tight">{title}</p>
            <p className="text-ink-soft">
              Order {order.orderId}, {money(order.totalCents)}
              {order.confirmed ? ", confirmation signed by the wholesaler" : ""}.
            </p>
          </div>
        </div>
        {(escalated.length > 0 || failed.length > 0) && (
          <ul className="mt-3 space-y-1 leading-snug">
            {[...failed, ...escalated].map((r) => (
              <li key={r.rule}>
                <strong>{ruleTitle(r.rule)}.</strong> {r.reason}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 text-[0.92rem]">
          <summary className="cursor-pointer py-1 font-semibold underline decoration-2 underline-offset-4">All {order.decision.rules.length} checks</summary>
          <ul className="mt-1 divide-y divide-line">
            {order.decision.rules.map((r) => (
              <li key={r.rule} className="grid gap-x-3 py-1 sm:grid-cols-[13rem_5rem_1fr]">
                <span className="font-semibold">{ruleTitle(r.rule)}</span>
                <span>{r.outcome}</span>
                <span className="text-ink-soft">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
      {order.status === "pending_approval" && a && <ApprovalQrPanel kitchen={kitchen} approvalId={a.approvalId} base={base} />}
    </div>
  );
}

function ApprovalQrPanel({ kitchen, approvalId, base }: { kitchen: string; approvalId: string; base: string }) {
  const [qr, setQr] = useState<ApprovalQr>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void api<ApprovalQr>("GET", `${base}/${encodeURIComponent(kitchen)}/approval/${encodeURIComponent(approvalId)}`).then((r) => {
      if (!live) return;
      if (r.ok) setQr(r.data);
      else setError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [kitchen, approvalId, base]);
  if (error) return <p className="max-w-56 text-[0.9rem] text-ink-soft">{error}</p>;
  if (!qr) return <div className="size-48 bg-concrete" />;
  return (
    <div className="w-52 text-[0.85rem]">
      <div className="bg-paper p-1" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
      <p className="mt-1 leading-snug">
        {qr.mode === "demo_link" ? `Scan to sign off as ${qr.approver.name}: the one-time link Dock sent to their phone (demo kitchen).` : `${qr.approver.name} signs off on their phone.`}
      </p>
      <a href={qr.url} target="_blank" rel="noreferrer" className="font-semibold underline">
        Open the sign-off page
      </a>
    </div>
  );
}

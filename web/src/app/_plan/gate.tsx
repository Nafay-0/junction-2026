"use client";

import { useEffect, useState } from "react";
import type { PlanWire } from "@/server/agent/menu/wire";
import { api } from "../_client/api";
import { clock, money, say } from "../_ui/plain";
import { Target } from "../_ui/target";
import { useFormat, useText } from "../_i18n/provider";
import { GATE_TEXT } from "./gate.text";
import { cutoff } from "./sheet";
import { Check, ChevronDown } from "lucide-react";
import { IconDisc, Skeleton } from "../_ui/kit";
import { Btn, Field, Sheet } from "./ui";

type ApprovalQr = { mode: "demo_link" | "view_only"; approver: { name: string; role: string }; status: string; url: string; qrSvg: string };

/** The bottom of the sheet: total, delivery, what needs a person, and the one button that asks for a fixed price. */
export function Totals({ plan, onQuote, busy }: { plan: PlanWire; onQuote: () => void; busy: boolean }) {
  const t = plan.totals;
  const tx = useText(GATE_TEXT);
  const f = useFormat();
  return (
    <section className="rounded-xl border border-line bg-paper shadow-sm">
      <div className="p-5 sm:p-7">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <Field label={tx.total} className="col-span-2 lg:col-span-1">
            <span className="display text-[2.4rem] leading-none tabular">{money(t.totalCents)}</span>
          </Field>
          <Field label={tx.lines}>
            {tx.linesCount(t.lines, t.products)}
            {t.struck ? <span className="block text-[0.9rem] font-medium text-ink-soft">{tx.notOrdered(t.struck)}</span> : null}
          </Field>
          <Field label={tx.delivery}>
            {t.deliveryDate ? f.day(t.deliveryDate) : "-"}
            {t.orderBy ? <span className="block text-[0.9rem] font-medium text-ink-soft">{tx.orderBy(cutoff(t.orderBy, f.lang))}</span> : null}
          </Field>
          <Field label={tx.whoDecides} className="col-span-2 sm:col-span-1">
            {t.signOff.needed && <Target size={16} tone="safety" className="mr-1.5 inline-block align-[-2px]" />}
            {t.signOff.needed ? (t.signOff.approver ? `${t.signOff.approver.name}, ${f.role(t.signOff.approver.role)}` : tx.noOne) : tx.agentAlone}
            {t.signOff.reasons[0] ? <span className="block text-[0.9rem] font-medium text-ink-soft">{t.signOff.reasons[0]}</span> : null}
          </Field>
        </dl>
        {plan.state === "planned" && (
          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:gap-5">
            <Btn kind="go" size="lg" busy={busy} disabled={!t.canQuote} onClick={onQuote} className="w-full shrink-0 sm:w-auto">
              {tx.getPrice}
            </Btn>
            {t.blockers.length > 0 ? (
              <ul className="space-y-0.5 text-[0.95rem] leading-snug text-ink-soft">
                {t.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.95rem] text-ink-soft">{tx.oneQuote}</p>
            )}
          </div>
        )}
        <p className="mt-4 text-[0.84rem] leading-snug text-ink-soft">
          {tx.live(plan.live.calls, plan.live.products, plan.live.allowance.newProductsLeft)}
          {plan.live.refused ? ` ${plan.live.refused}` : ""}
          {tx.model(plan.model.calls.length, plan.model.ms, plan.model.costUsd)}
        </p>
      </div>
    </section>
  );
}

/** After the fixed price: the quote, the gate's decision, the sign-off on a phone, the signed order. */
export function GateStage({ plan, kitchen, onOrder, onRefresh, busy, base }: { plan: PlanWire; kitchen: string; onOrder: () => void; onRefresh: () => void; busy: boolean; base: string }) {
  const q = plan.quote;
  const o = plan.order;
  const tx = useText(GATE_TEXT);
  const f = useFormat();
  useEffect(() => {
    if (o?.status !== "pending_approval") return;
    const t = setInterval(onRefresh, 2000);
    return () => clearInterval(t);
  }, [o?.status, onRefresh]);
  if (!q && !plan.error) return null;
  return (
    <Sheet safety={!!o && (o.status !== "committed" || !!o.approval)}>
      <div className="p-5 sm:p-7">
        {plan.error && (
          <div role="alert" className="mb-4 rounded-lg bg-safety-soft px-4 py-3 ring-1 ring-inset ring-safety/60">
            <p className="font-semibold">{tx.gateSaidNo(f.ruleTitle(plan.error.rule) || plan.error.code)}</p>
            <p>{plan.error.message}</p>
          </div>
        )}
        {q && (
          <>
            <h2 className="display text-[1.5rem] sm:text-[1.7rem]">{tx.fixedPrice(money(q.totalCents))}</h2>
            <p className="mt-0.5 text-[0.95rem] text-ink-soft">{tx.holds(clock(q.expiresAt), q.expiresBecause, q.evidence, q.lines.length)}</p>
            {!o && (
              <>
                <p className="mt-3 max-w-[62ch] leading-relaxed">
                  {q.policyPreview.outcome === "auto_approve"
                    ? tx.previewAuto
                    : q.policyPreview.outcome === "needs_human_approval"
                      ? tx.previewAsk(q.policyPreview.approver?.name, f.role(q.policyPreview.approver?.role ?? ""), q.policyPreview.reasons[0])
                      : tx.previewRefuse(q.policyPreview.reasons[0])}
                </p>
                <Btn kind="go" size="lg" busy={busy} onClick={onOrder} className="mt-4 w-full sm:w-auto">
                  {tx.place}
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
  const tx = useText(GATE_TEXT);
  const f = useFormat();
  const title =
    order.status === "committed"
      ? a
        ? tx.signedOff(a.approver.name)
        : tx.ownAuthority
      : order.status === "pending_approval"
        ? tx.waitingFor(a?.approver.name)
        : order.status === "declined"
          ? tx.declinedBy(a?.approver.name)
          : tx.refused;
  return (
    <div className="mt-5 grid gap-6 border-t border-line pt-5 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          {order.status === "committed" && !a ? (
            <IconDisc tone="good" size={48}>
              <Check size={24} strokeWidth={2.6} />
            </IconDisc>
          ) : (
            <Target size={52} tone="safety" className="shrink-0" />
          )}
          <div>
            <p className="display text-[1.6rem] leading-tight sm:text-[1.9rem]">{title}</p>
            <p className="text-ink-soft">
              {money(order.totalCents)}
              {order.confirmed ? tx.confirmed : ""}.
            </p>
          </div>
        </div>
        {(escalated.length > 0 || failed.length > 0) && (
          <ul className="mt-3 space-y-1 leading-snug">
            {[...failed, ...escalated].map((r) => (
              <li key={r.rule}>
                <strong>{f.ruleTitle(r.rule)}.</strong> {say(r.reason)}
              </li>
            ))}
          </ul>
        )}
        <details className="group mt-4 text-[0.92rem]">
          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 font-semibold text-petrol hover:text-petrol-deep pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden size={17} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            {tx.allChecks(order.decision.rules.length)}
          </summary>
          <ul className="mt-1 divide-y divide-line rounded-lg bg-mist px-3">
            {order.decision.rules.map((r) => (
              <li key={r.rule} className="grid gap-x-3 py-2 sm:grid-cols-[13rem_5rem_1fr]">
                <span className="font-semibold">{f.ruleTitle(r.rule)}</span>
                <span>{tx.outcome[r.outcome === "pass" || r.outcome === "escalate" ? r.outcome : "fail"]}</span>
                <span className="text-ink-soft">{say(r.reason)}</span>
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
  const tx = useText(GATE_TEXT);
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
  if (!qr) return <Skeleton className="size-48 !rounded-[20px]" />;
  return (
    <div className="w-52 text-[0.85rem]">
      <div className="rounded-[1.4rem] bg-safety-ink p-2.5 pb-4">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-paper/25" />
        <div className="overflow-hidden rounded-[0.8rem] bg-paper">
          <div aria-hidden className="hazard-thin h-2" />
          <div className="p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
        </div>
      </div>
      <p className="mt-1 leading-snug">
        {qr.mode === "demo_link" ? tx.scanAs(qr.approver.name) : tx.signsOnPhone(qr.approver.name)}
      </p>
      <a href={qr.url} target="_blank" rel="noreferrer" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
        {tx.openSignOff}
      </a>
    </div>
  );
}

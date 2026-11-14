"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "../../_client/api";
import { api } from "../../_client/api";
import { money, moneyShort, say, shortProduct } from "../../_ui/plain";
import { useFormat, useText } from "../../_i18n/provider";
import { STAGES_TEXT } from "./stages.text";
import { Target } from "../../_ui/target";
import { Spinner } from "../../_ui/kit";
import { Button, Field, Missing, Paper } from "./ui";
import type { ApprovalQr, KitchenInfo, Order, Step } from "./types";
import { useProductName } from "./names";

type Names = Record<string, string>;

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Quote({ q, names, decided, busy, onPlace, onNew }: { q: NonNullable<Step["quote"]>; names: Names; decided: boolean; busy: boolean; onPlace: () => void; onNew: () => void }) {
  const pn = useProductName();
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const now = useNow();
  const end = Date.parse(q.quote.expiresAt);
  const start = Date.parse(q.quote.issuedAt);
  const left = Math.max(0, end - now);
  const share = end > start ? Math.max(0, Math.min(1, left / (end - start))) : 0;
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const expired = left === 0;
  const preview = q.policyPreview;
  const lead =
    preview.outcome === "auto_approve"
      ? tx.withinMandate
      : preview.outcome === "needs_human_approval"
        ? tx.beyondMandate(preview.approver.name, f.role(preview.approver.role))
        : tx.wouldRefuse;
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-[0.88rem] font-medium text-ink-soft">{tx.totalSigned}</p>
            <p className="display text-[3.4rem] text-ink tabular">{money(q.quote.totalCents)}</p>
          </div>
          <div className="min-w-[12rem] flex-1 sm:max-w-[18rem]" aria-live="off">
            <p className="flex items-baseline justify-between gap-3 text-[0.88rem] font-medium text-ink-soft">
              <span>{expired ? tx.priceExpired : decided ? tx.priceHeld : tx.priceHolds}</span>
              <span>{tx.until(f.clock(q.quote.expiresAt))}</span>
            </p>
            <p className={`display text-right text-[2.4rem] tabular ${expired ? "text-ink-soft line-through" : share < 0.2 && !decided ? "text-ink" : "text-petrol-deep"}`}>
              {String(mm).padStart(2, "0")}.{String(ss).padStart(2, "0")}
            </p>
            <div aria-hidden className="mt-1 h-2 bg-line">
              <div className={`h-full transition-[width] duration-1000 ease-linear ${share < 0.2 ? "bg-ink" : "bg-petrol"}`} style={{ width: `${share * 100}%` }} />
            </div>
          </div>
        </div>
        <table className="mt-5 w-full text-left text-[0.98rem]">
          <caption className="sr-only">{tx.quotedLines}</caption>
          <thead className="border-y border-line text-[0.82rem] text-ink-soft">
            <tr>
              <th className="py-2 pr-2 font-medium">{tx.product}</th>
              <th className="py-2 pr-2 text-right font-medium">{tx.packs}</th>
              <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">{tx.perPack}</th>
              <th className="py-2 pr-2 text-right font-medium">{tx.line}</th>
              <th className="py-2 text-right font-medium">{tx.arrives}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.quote.lines.map((l) => (
              <tr key={l.productId}>
                <td className="py-2 pr-2">
                  {shortProduct(pn(l.productId, l.name))}
                  {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">{tx.swapFor(shortProduct(l.substituteFor.name))}</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular">{l.quantity}</td>
                <td className="hidden py-2 pr-2 text-right tabular sm:table-cell">{money(l.unitPriceCents)}</td>
                <td className="py-2 pr-2 text-right tabular">{money(l.lineTotalCents)}</td>
                <td className="py-2 text-right">{f.day(l.deliveryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`mt-4 flex items-start gap-3 px-3 py-2.5 ${preview.outcome === "auto_approve" ? "bg-mist" : "border-l-[6px] border-safety-ink bg-safety/20"}`}>
          {preview.outcome !== "auto_approve" && <Target size={22} tone="safety" className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{tx.preview(lead)}</p>
            {preview.outcome !== "auto_approve" && (
              <ul className="mt-1 space-y-0.5 text-[0.95rem] text-ink-soft">
                {preview.reasons
                  .filter((r) => !r.startsWith("Sent to "))
                  .map((r) => (
                    <li key={r}>{say(r, names)}</li>
                  ))}
              </ul>
            )}
          </div>
        </div>
        {!decided && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button kind="go" size="lg" busy={busy} onClick={onPlace}>
              {tx.place}
            </Button>
            {expired && <span className="text-[0.95rem] text-ink-soft">{tx.expiredHint}</span>}
            <Button kind="quiet" onClick={onNew}>
              {tx.startAgain}
            </Button>
          </div>
        )}
      </div>
    </Paper>
  );
}

// ---------- 6. the gate ----------

/**
 * The gate's decision. When it stops an order this is the loudest thing on the customer side: a black slab in a
 * hazard frame, the crash-test mark, the barrier arms closing. When it passes an order it is a quiet white plate.
 * `withSignOff` puts the sign-off (who, the QR code, the stamp) inside the same plate, for pages without a lane.
 */
export function Gate({ order, refusal, kitchen, names, streaming, byHand = false, withSignOff = true }: { order?: Order; refusal?: ApiError; kitchen: KitchenInfo; names: Names; streaming: boolean; byHand?: boolean; withSignOff?: boolean }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  if (!order) {
    return (
      <GateSlab title={tx.refusedAtGate} sub={f.ruleTitle(refusal?.rule)}>
        <p className="text-[1.1rem] leading-snug text-paper">{say(refusal?.message ?? tx.orderRefused, names)}</p>
        <p className="mt-2 text-[0.95rem] text-paper/70">{tx.nothingOrdered}</p>
      </GateSlab>
    );
  }
  const d = order.decision;
  const rules = d.rules;
  const a = order.approval;
  const checks = <ChecksList rules={rules} names={names} dark={order.status !== "committed" || !!a} />;

  if (order.status === "rejected") {
    const failed = rules.filter((r) => r.outcome === "fail");
    return (
      <GateSlab title={a ? tx.refusedRecheck : tx.refusedAtGate} sub={failed.map((r) => f.ruleTitle(r.rule)).join(", ") || f.ruleTitle(refusal?.rule)}>
        <ul className="space-y-1 text-[1.08rem] leading-snug text-paper">
          {failed.map((r) => (
            <li key={r.rule}>{say(r.reason, names)}</li>
          ))}
        </ul>
        <p className="mt-2 text-[0.95rem] text-paper/70">{tx.nothingOrdered}</p>
        {checks}
      </GateSlab>
    );
  }
  if (a) {
    const escalated = rules.filter((r) => r.outcome === "escalate");
    return (
      <div className="space-y-3">
        <GateSlab title={tx.stoppedAtGate} sub={tx.mustSign(a.approver.name, f.role(a.approver.role))} closed={a.status === "pending"}>
          <ul className="space-y-2 leading-snug">
            {escalated.map((r) => (
              <li key={r.rule} className="text-paper">
                <strong className="text-safety">{f.ruleTitle(r.rule)}.</strong> <span className="text-paper/90">{say(r.reason, names)}</span>
              </li>
            ))}
          </ul>
          {checks}
        </GateSlab>
        {withSignOff && <SignOff order={order} kitchen={kitchen} streaming={streaming} />}
      </div>
    );
  }
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center bg-petrol text-[1.8rem] font-bold text-paper">
            ✓
          </span>
          <div className="min-w-0">
            <p className="display text-[2.2rem] text-ink sm:text-[2.6rem]">{byHand ? tx.passedByHand : tx.passedAlone}</p>
            <p className="mt-1 text-[1.05rem] text-ink-soft">{tx.allPassed(rules.length, byHand)}</p>
          </div>
        </div>
        <p className="mt-3 text-[1.05rem]">{say(d.reasons[0] ?? "", names)}</p>
        {checks}
      </div>
    </Paper>
  );
}

/** The black slab in a hazard frame, with the barrier closing across its top. Gate only. */
function GateSlab({ title, sub, children, closed = true }: { title: string; sub: string; children: React.ReactNode; closed?: boolean }) {
  return (
    <div role="group" aria-label={title} className="hazard-frame on-dark relative overflow-hidden">
      <div aria-hidden className="relative h-4 overflow-hidden">
        {closed ? (
          <>
            <span className="barrier-left hazard-thin absolute inset-y-0 left-0 w-1/2" />
            <span className="barrier-right hazard-thin absolute inset-y-0 right-0 w-1/2" />
          </>
        ) : (
          <>
            <span className="hazard-thin absolute inset-y-0 left-0 w-[12%]" />
            <span className="hazard-thin absolute inset-y-0 right-0 w-[12%]" />
          </>
        )}
      </div>
      <div className="p-4 sm:p-7">
        <div className="flex items-start gap-4 sm:gap-6">
          <Target size={84} tone="safety" className="hidden shrink-0 sm:block" />
          <Target size={52} tone="safety" className="shrink-0 sm:hidden" />
          <div className="min-w-0">
            <p className="display hyphens-manual break-words text-[2.4rem] leading-[0.95] text-safety sm:text-[3.6rem]">{title}</p>
            <p className="mt-2 max-w-[60ch] text-[1.1rem] leading-snug text-paper">{sub}</p>
          </div>
        </div>
        <div className="mt-5 sm:ml-[6.5rem]">{children}</div>
      </div>
    </div>
  );
}

function ChecksList({ rules, names, dark }: { rules: Order["decision"]["rules"]; names: Names; dark: boolean }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const passed = rules.filter((r) => r.outcome === "pass").length;
  return (
    <details className={`mt-4 text-[0.95rem] ${dark ? "text-paper" : ""}`}>
      <summary className={`min-h-10 cursor-pointer py-2 font-semibold underline decoration-2 underline-offset-4 ${dark ? "text-paper" : "text-petrol"}`}>
        {tx.allChecks(rules.length, passed)}
      </summary>
      <ul className={`mt-1 divide-y ${dark ? "divide-paper/15" : "divide-line"}`}>
        {rules.map((r) => (
          <li key={r.rule} className="grid gap-x-3 py-1.5 sm:grid-cols-[16rem_8rem_1fr]">
            <span className="font-semibold">{f.ruleTitle(r.rule)}</span>
            <span className={r.outcome === "pass" ? (dark ? "text-paper/60" : "text-ink-soft") : dark ? "font-semibold text-safety" : "font-semibold"}>{tx.outcome(r.outcome)}</span>
            <span className={dark ? "text-paper/75" : "text-ink-soft"}>{say(r.reason, names)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- 7. sign-off ----------

/**
 * The person the gate named: waiting (a phone with the code to scan, a running clock), or decided (a stamp lands).
 * The phone screen this hands off to opens with the same hazard band and the same words, so it reads as one act.
 */
export function SignOff({ order, kitchen, streaming }: { order: Order; kitchen: KitchenInfo; streaming: boolean }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const a = order.approval;
  const now = useNow(1000);
  if (!a) return null;
  const how = a.signOff?.method === "passkey" ? tx.howPasskey : a.signOff?.method === "link_token" ? tx.howLink : a.signOff?.method === "demo_tap" ? tx.howDemo : "";
  if (a.status === "pending") {
    const since = Math.max(0, Math.floor((now - Date.parse(a.requestedAt)) / 1000));
    return (
      <div className="border-[3px] border-safety-ink bg-paper">
        <div aria-hidden className="hazard h-3" />
        <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
              <span aria-hidden className="breathe inline-block size-3 bg-safety-ink" />
              {tx.waitingPerson}
            </p>
            <p className="display mt-2 text-[2.6rem] leading-[0.95] text-ink sm:text-[3.2rem]">{a.approver.name}</p>
            <p className="mt-1 text-[1.1rem]">{tx.maySign(f.role(a.approver.role), moneyShort(a.approver.maxApprovalCents))}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:max-w-md">
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">{tx.asked}</dt>
                <dd className="display text-[2rem] tabular" aria-live="off">
                  {since < 60 ? `${since} s` : `${Math.floor(since / 60)} min ${String(since % 60).padStart(2, "0")} s`}
                  <span className="ml-1 font-sans text-[0.9rem] font-medium text-ink-soft">{tx.ago}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">{tx.order}</dt>
                <dd className="display text-[2rem] tabular">{money(order.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[0.95rem] text-ink-soft">{streaming ? tx.live : tx.polling}</p>
          </div>
          <ApprovalPanel kitchen={kitchen} approvalId={a.approvalId} />
        </div>
      </div>
    );
  }
  const approved = a.status === "approved";
  return (
    <Paper>
      <div className="flex flex-wrap items-center gap-6 p-4 sm:p-6">
        <div className={`stamp inline-block border-[4px] px-5 py-3 ${approved ? "border-petrol text-petrol" : "border-ink text-ink"}`}>
          <p className="display text-[2.4rem] leading-none">{approved ? tx.stampSigned : tx.stampDeclined}</p>
          <p className="mt-1 text-[1rem] font-semibold">{tx.stampLine(a.approver.name, f.clock(a.decidedAt ?? order.updatedAt))}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[1.1rem] leading-snug">{tx.decided(approved, a.approver.name, f.role(a.approver.role), f.clock(a.decidedAt ?? order.updatedAt), how)}</p>
          {a.note && <p className="mt-1 text-ink-soft">{tx.note(a.note)}</p>}
          {approved && <p className="mt-1 text-ink-soft">{tx.rechecked}</p>}
        </div>
      </div>
    </Paper>
  );
}

/** A phone, drawn: the code to scan sits on its screen, so the hand-off reads as "pick up your phone". */
export function ApprovalPanel({ kitchen, approvalId }: { kitchen: KitchenInfo; approvalId: string }) {
  const tx = useText(STAGES_TEXT);
  const [qr, setQr] = useState<ApprovalQr>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void api<ApprovalQr>("GET", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/approval/${encodeURIComponent(approvalId)}`).then((r) => {
      if (!live) return;
      if (r.ok) setQr(r.data);
      else setError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [kitchen.slug, approvalId]);
  const name = qr?.approver.name ?? tx.theApprover;
  return (
    <figure className="mx-auto w-full max-w-[15rem] md:w-56">
      <div className="rounded-[1.6rem] bg-safety-ink p-2.5 pb-4">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-paper/25" />
        <div className="overflow-hidden rounded-[0.9rem] bg-paper">
          <div aria-hidden className="hazard-thin h-2" />
          <div className="p-2.5">
            <p className="text-center text-[0.8rem] font-semibold leading-tight">{tx.phoneStopped}</p>
            <div className="mt-1.5 aspect-square w-full">
              {qr ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} /> : <div className={`size-full ${error ? "bg-mist" : "animate-pulse bg-mist"}`} />}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-[0.92rem] leading-snug">
        {error && <span className="text-ink-soft">{tx.noCode(error)}</span>}
        {qr?.mode === "passkey" && <>{tx.qrPasskey(name)}</>}
        {qr?.mode === "demo_link" && <>{tx.qrDemo(name)}</>}
        {qr?.mode === "view_only" && <>{tx.qrView(name)}</>}
        {qr?.mode === "enrol" && <>{tx.qrEnrol(name)}</>}
        {qr?.mode === "no_device" && (
          <>
            {tx.qrNoDevice(name)}
            <a href={`/k/${encodeURIComponent(kitchen.slug)}/agent#devices`} className="mt-1 block font-semibold text-petrol underline decoration-2 underline-offset-4">
              {tx.addDevice}
            </a>
          </>
        )}
        {qr && qr.mode !== "no_device" && (
          <a href={qr.url} target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-petrol underline decoration-2 underline-offset-4">
            {qr.mode === "enrol" ? tx.becomeApprover : tx.openSignOff}
          </a>
        )}
        {qr?.orderId && qr.status === "pending" && <WithdrawButton kitchen={kitchen} orderId={qr.orderId} />}
        {!qr && !error && (
          <span className="flex items-center gap-2 text-ink-soft">
            <Spinner size={14} /> {tx.preparing}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The buyer takes the waiting order back: it stops holding the weekly budget, and the approver's phone shows it withdrawn. */
function WithdrawButton({ kitchen, orderId }: { kitchen: KitchenInfo; orderId: string }) {
  const tx = useText(STAGES_TEXT);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  async function withdraw() {
    setBusy(true);
    const r = await api<{ order: Order }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/call`, { method: "POST", path: `/api/v1/orders/${orderId}/withdraw`, body: { reason: "withdrawn from the kitchen portal" } });
    setBusy(false);
    setDone(r.ok ? tx.withdrawn : r.error.message);
  }
  if (done) return <span className="mt-2 block text-ink-soft">{done}</span>;
  return (
    <span className="mt-2 block">
      <Button kind="quiet" busy={busy} onClick={() => void withdraw()}>
        {tx.withdraw}
      </Button>
    </span>
  );
}

// ---------- 8. signed order ----------

function ledgerSeq(jws?: string): number | undefined {
  try {
    const p = jws?.split(".")[1];
    if (!p) return undefined;
    const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as { ledgerHead?: { seq: number } };
    return json.ledgerHead?.seq;
  } catch {
    return undefined;
  }
}

export function SignedOrder({ order, names, onNew }: { order: Order; names: Names; onNew: () => void }) {
  const pn = useProductName();
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  if (order.status === "declined") {
    return (
      <Paper>
        <div className="p-4 sm:p-6">
          <p className="text-[1.35rem] font-semibold">{tx.declinedNothing(order.approval?.approver.name)}</p>
          <div className="mt-4">
            <Button kind="primary" onClick={onNew}>
              {tx.newRequest}
            </Button>
          </div>
        </div>
      </Paper>
    );
  }
  const seq = ledgerSeq(order.confirmation);
  const latest = order.lines.map((l) => l.deliveryDate).sort().at(-1)!;
  const by = order.approval?.status === "approved" ? `${order.approval.approver.name} (${f.role(order.approval.approver.role)})` : tx.byAgent;
  return (
    <div className="bg-paper">
      <div aria-hidden className="h-2 bg-petrol-deep" />
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="display text-[2.2rem] text-petrol-deep">{tx.placed}</p>
            <p className="mt-1 text-ink-soft">{tx.committed(f.clock(order.updatedAt), by)}</p>
          </div>
          <p className="display text-[3rem] text-ink tabular">{money(order.totalCents)}</p>
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {order.lines.map((l) => (
            <li key={l.productId} className="flex justify-between gap-3 py-2">
              <span>
                {l.quantity} × {shortProduct(pn(l.productId, l.name))}
                {l.substituteFor && <span className="text-ink-soft">{tx.swapParen(shortProduct(l.substituteFor.name))}</span>}
              </span>
              <span className="shrink-0 tabular">{money(l.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label={tx.delivery}>{f.day(latest)}</Field>
          <Field label={tx.confirmation}>{order.confirmation ? tx.signedByWholesaler : <Missing>{tx.notSigned}</Missing>}</Field>
          {seq !== undefined && <Field label={tx.inLedger}>{tx.atEntry(seq)}</Field>}
        </dl>
        <p className="mt-3 text-[0.92rem] text-ink-soft">{say(tx.jwks, names)}</p>
        <div className="mt-4">
          <Button kind="secondary" onClick={onNew}>
            {tx.newRequest}
          </Button>
        </div>
      </div>
    </div>
  );
}

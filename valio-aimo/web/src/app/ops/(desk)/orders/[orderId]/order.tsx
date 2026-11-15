"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OrderTimelineView } from "@/server/ops/orders-view";
import type { TimelineStep } from "@/server/ops/order-timeline";
import { Badge } from "../../../../_ui/kit";
import { clockSeconds, dayEn as day, timelineFact } from "../../../../_ui/plain";
import { lookupsTitle, shownSteps } from "../../../../_ui/timeline-steps";
import { STATUS_WORD, decidedWords, fi, money, since, statusTone, whenSeconds } from "../../../_ui/format";
import { Button, Details, KV, LiveMark, LoadError, Loading, PageHead, Panel, useNow, useOps } from "../../../_ui/kit";
import { SamplePill, isSample } from "../../../../_ui/sample";
import { api } from "../../../../_client/api";
import { useViewer } from "../../../_ui/role";

const link = "font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol";
const ACTOR_TONE: Record<TimelineStep["actor"]["kind"], "agent" | "info" | "neutral" | "good"> = { agent: "agent", person: "info", system: "neutral", wholesaler: "good" };

/** One order's whole life: what it is now, then every step in order with who did it and its ledger entry. */
export function OrderScreen({ orderId }: { orderId: string }) {
  const live = useOps<OrderTimelineView>(`/ops-api/orders/${encodeURIComponent(orderId)}`, { pollMs: 5000 });
  const now = useNow();
  const t = live.data;
  return (
    <>
      <p className="mb-2 text-[0.9rem]">
        <Link href="/ops/orders" className={link}>
          All orders
        </Link>
      </p>
      {isSample(live.data) && (
        <p className="mb-1">
          <SamplePill className="ml-0" />
        </p>
      )}
      <PageHead
        title={t ? t.what : "Order"}
        purpose={t ? `${t.orgName} · ${money(t.totalCents)}${t.deliveryDate ? ` · delivery ${day(t.deliveryDate)}` : ""} · placed by ${t.agentLabel}, ${fi(t.sourceText)}` : "Reading the order…"}
        right={t && <LiveMark at={whenSeconds(new Date().toISOString())} error={live.error} />}
      />
      <LoadError message={live.error} />
      {!t ? (
        <Loading label="Reading the order's timeline…" />
      ) : (
        <>
          <Panel className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Now">
              <Badge tone={statusTone(t.status)}>{STATUS_WORD[t.status] ?? fi(t.statusWords)}</Badge>
              {t.waitingSinceAt && now !== undefined && <span className="mt-1 block text-[0.84rem] text-ink-soft">waiting {since(t.waitingSinceAt, now).replace(/ ago$/, "")}</span>}
            </Fact>
            <Fact label="Decided">
              {decidedWords(t.decided).head}
              {decidedWords(t.decided).rule && <span className="block text-[0.84rem] text-ink-soft">{decidedWords(t.decided).rule}</span>}
            </Fact>
            <Fact label="Receipt">
              {!t.receipt.present ? (
                <span className="text-ink-soft">Signed once the order is placed</span>
              ) : t.receipt.ok ? (
                <>
                  Signed by the wholesaler, checked
                  {t.receipt.anchor?.matches === false && <span className="block text-[0.84rem] font-semibold text-bad">Does not match its ledger entry</span>}
                  <Details summary="Key and ledger entry" className="mt-1">
                    <KV k="key" v={t.receipt.kid} />
                    {t.receipt.anchor && <KV k="ledger entry" v={t.receipt.anchor.seq} />}
                  </Details>
                </>
              ) : (
                <span className="text-bad">Signature does not check: {fi(t.receipt.problem)}</span>
              )}
            </Fact>
            <Fact label="Also see">
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <Link href={t.links.trace} className={link}>
                  Trace replay
                </Link>
                <Link href={t.links.audit} className={link}>
                  Audit record
                </Link>
                <Link href={`/ops/time-machine?order=${encodeURIComponent(t.orderId)}`} className={link}>
                  Time machine
                </Link>
                {t.links.conversation && (
                  <Link href={t.links.conversation} className={link}>
                    Conversation
                  </Link>
                )}
              </span>
            </Fact>
          </Panel>
          {t.fulfilment && <Fulfilment orderId={t.orderId} f={t.fulfilment} onDone={live.refresh} />}
          {t.asked && (
            <p className="mt-4 text-[1.02rem]">
              Asked: <span className="font-semibold">&ldquo;{t.asked}&rdquo;</span>
            </p>
          )}
          {!t.complete.ok && <p className="mt-3 rounded-lg bg-safety-soft px-4 py-2.5 text-[0.9rem] ring-1 ring-inset ring-safety/60">Missing from the record: {fi(t.complete.missing.join(", "))}.</p>}
          <Steps t={t} />
        </>
      )}
    </>
  );
}

/** The steps that matter first (the live checks folded into one line that opens), every step one click away. */
function Steps({ t }: { t: OrderTimelineView }) {
  const [all, setAll] = useState(false);
  const shown = shownSteps(t.steps);
  const visible = all ? shown : shown.filter((x) => x.key);
  const hidden = shown.length - shown.filter((x) => x.key).length;
  return (
    <>
      <ol className="mt-5 divide-y divide-line rounded-xl border border-line bg-paper" aria-label="The order's timeline">
        {visible.map((x) =>
          x.kind === "step" ? (
            <Step key={x.step.seq} s={x.step} t={t} />
          ) : (
            <li key={`lookups-${x.seq}`}>
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 hover:bg-mist/60 sm:grid-cols-[5.5rem_12rem_minmax(0,1fr)] sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-[0.88rem] text-ink-soft tabular">{clockSeconds(x.steps[0].at)}</span>
                  <span>
                    <Badge tone={ACTOR_TONE[x.steps[0].actor.kind]}>{x.steps[0].actor.name}</Badge>
                  </span>
                  <span className="flex items-start gap-1.5 font-semibold leading-snug">
                    {lookupsTitle(x.steps)}
                    <ChevronDown aria-hidden size={17} className="mt-0.5 shrink-0 text-petrol transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
                  </span>
                </summary>
                <ol className="divide-y divide-line border-t border-line bg-mist/40">
                  {x.steps.map((s) => (
                    <Step key={s.seq} s={s} t={t} />
                  ))}
                </ol>
              </details>
            </li>
          ),
        )}
      </ol>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.82rem] text-ink-soft">
        {hidden > 0 && (
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="inline-flex min-h-10 items-center gap-1.5 rounded-full text-[0.92rem] font-semibold text-petrol hover:underline">
            <ChevronDown aria-hidden size={16} className={`transition-transform duration-150 motion-reduce:transition-none ${all ? "rotate-180" : ""}`} />
            {all ? "Show the main steps only" : `Show every step (${t.steps.length})`}
          </button>
        )}
        <span>From the hash-chained ledger; the kitchen sees the same steps on its own order page.</span>
      </p>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.8rem] font-medium text-ink-soft">{label}</p>
      <div className="mt-0.5 text-[0.95rem] leading-snug">{children}</div>
    </div>
  );
}

function Step({ s, t }: { s: TimelineStep; t: OrderTimelineView }) {
  const facts = s.facts.map(timelineFact);
  const ids = facts.filter((f) => f.id);
  return (
    <li className={`grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[5.5rem_12rem_minmax(0,1fr)] sm:px-5 ${s.tone === "safety" ? "bg-safety-soft/40" : ""}`}>
      <span className="text-[0.88rem] text-ink-soft tabular">{clockSeconds(s.at)}</span>
      <span className="flex flex-wrap items-start gap-1.5">
        <Badge tone={ACTOR_TONE[s.actor.kind]}>{s.actor.name}</Badge>
        {s.agentChoice && <Badge tone="agent">its own choice</Badge>}
        {s.person && <Badge tone="info">a person</Badge>}
      </span>
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{fi(s.title)}</p>
        {s.lines
          .filter((l) => l && l !== s.title)
          .map((l, i) => (
            <p key={i} className="text-[0.92rem] leading-snug text-ink-soft">
              {fi(l)}
            </p>
          ))}
        {facts.some((f) => !f.id) && (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.86rem]">
            {facts
              .filter((f) => !f.id)
              .map((f, i) => (
                <div key={i} className="flex gap-1">
                  <dt className="text-ink-soft">{f.label}:</dt>
                  <dd>{fi(f.value)}</dd>
                </div>
              ))}
          </dl>
        )}
        {s.checks && s.checks.length > 0 && (
          <details className="mt-1 text-[0.86rem]">
            <summary className="cursor-pointer text-petrol">
              {s.checks.length} rules checked{s.checks.some((c) => c.outcome !== "pass") ? `; ${s.checks.filter((c) => c.outcome !== "pass").map((c) => c.title.charAt(0).toLowerCase() + c.title.slice(1)).join(", ")} decided it` : ", all passed"}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {s.checks.map((c) => (
                <li key={c.rule} className={c.outcome === "pass" ? "text-ink-soft" : "font-semibold"}>
                  {c.outcome === "pass" ? "✓" : c.outcome === "escalate" ? "→ a person:" : "✗"} {c.title}
                  {c.reason && c.outcome !== "pass" ? `: ${fi(c.reason)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        {s.products && s.products.length > 0 && (
          <p className="mt-1 line-clamp-3 text-[0.86rem] text-ink-soft" title={fi(s.products.map((p) => `${p.name}${p.note ? ` (${p.note})` : ""}`).join("; "))}>
            {fi(s.products.slice(0, 6).map((p) => `${p.name}${p.note ? ` (${p.note})` : ""}`).join("; "))}
            {s.products.length > 6 ? `; and ${s.products.length - 6} more` : ""}
          </p>
        )}
        {s.excluded && s.excluded.length > 0 && <p className="mt-1 line-clamp-2 text-[0.86rem] text-ink-soft">Left out: {fi(s.excluded.map((x) => `${x.reason} (${x.count})`).join("; "))}</p>}
        {s.untouched && <p className="text-[0.86rem] text-ink-soft">{fi(s.untouched)}</p>}
        {s.memory && s.memory.length > 0 && <p className="text-[0.86rem] text-ink-soft">Used the kitchen&apos;s {s.memory.join(", ")} (not shown).</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.8rem] text-ink-soft">
          {s.traceStep && (
            <Link href={`${t.links.trace}?step=${s.traceStep}`} className={link}>
              This step in the trace
            </Link>
          )}
          <Details summary={`Ledger entry ${s.seq}`}>
            <KV k="kind" v={s.ledger.type} />
            <KV k="hash" v={s.ledger.hash} />
            {ids.map((f) => (
              <KV key={f.label} k={f.label.toLowerCase()} v={f.value} />
            ))}
          </Details>
        </div>
      </div>
    </li>
  );
}

/**
 * The wholesaler's team's side of a placed order (server/fulfilment): confirm it for delivery, or say it cannot be
 * delivered with a short reason. Staff act; a viewer reads what the buttons do, never a bare disabled button.
 */
function Fulfilment({ orderId, f, onDone }: { orderId: string; f: NonNullable<OrderTimelineView["fulfilment"]>; onDone?: () => void }) {
  const viewer = useViewer();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  async function decide(decision: "confirm" | "refuse") {
    setBusy(true);
    setProblem(undefined);
    const r = await api<unknown>("POST", `/ops-api/orders/${encodeURIComponent(orderId)}`, { decision, ...(decision === "refuse" ? { reason } : {}) });
    setBusy(false);
    if (!r.ok) return setProblem(r.error.message);
    setRefusing(false);
    onDone?.();
  }
  return (
    <Panel className="mt-4 p-5" >
      <h2 className="text-[0.95rem] font-semibold">Confirmation for delivery</h2>
      {f.state === "confirmed" ? (
        <p className="mt-1.5" data-fulfilment="confirmed">
          Confirmed for delivery by {f.by} at {f.at ? clockSeconds(f.at).slice(0, 5) : ""}. The kitchen was told.
        </p>
      ) : f.state === "refused" ? (
        <p className="mt-1.5" data-fulfilment="refused">
          {f.by} could not confirm it: “{f.reason}”. The kitchen was told.
        </p>
      ) : viewer ? (
        <p className="mt-1.5 text-ink-soft" data-fulfilment="waiting">
          Waiting for the wholesaler&apos;s team to confirm it for delivery. Staff confirm orders here, or say they cannot be delivered; sign in as staff to act.
        </p>
      ) : (
        <div className="mt-2" data-fulfilment="waiting">
          <p className="text-ink-soft">The order is placed at its fixed price and waits for your team to confirm it for delivery. The kitchen is told either way.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button kind="go" staff disabled={busy} onClick={() => void decide("confirm")}>
              Confirm for delivery
            </Button>
            {!refusing && (
              <Button kind="plain" staff disabled={busy} onClick={() => setRefusing(true)}>
                Cannot deliver
              </Button>
            )}
          </div>
          {refusing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input aria-label="Why it cannot be delivered" className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-3" placeholder="Why, in a few words" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              <Button kind="stop" staff disabled={busy || !reason.trim()} onClick={() => void decide("refuse")}>
                Tell the kitchen
              </Button>
            </div>
          )}
          {problem && <p className="mt-2 text-[0.9rem] text-bad">{problem}</p>}
        </div>
      )}
    </Panel>
  );
}

"use client";

import Link from "next/link";
import type { OrderTimelineView } from "@/server/ops/orders-view";
import type { TimelineStep } from "@/server/ops/order-timeline";
import { Badge } from "../../../../_ui/kit";
import { clockSeconds, day, timelineFact } from "../../../../_ui/plain";
import { STATUS_WORD, decidedWords, fi, money, since, statusTone, whenSeconds } from "../../../_ui/format";
import { Details, KV, LiveMark, LoadError, Loading, PageHead, Panel, useNow, useOps } from "../../../_ui/kit";

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
                {t.links.conversation && (
                  <Link href={t.links.conversation} className={link}>
                    Conversation
                  </Link>
                )}
              </span>
            </Fact>
          </Panel>
          {t.asked && (
            <p className="mt-4 text-[1.02rem]">
              Asked: <span className="font-semibold">&ldquo;{t.asked}&rdquo;</span>
            </p>
          )}
          {!t.complete.ok && <p className="mt-3 rounded-lg bg-safety-soft px-4 py-2.5 text-[0.9rem] ring-1 ring-inset ring-safety/60">Missing from the record: {fi(t.complete.missing.join(", "))}.</p>}
          <ol className="mt-5 divide-y divide-line rounded-xl border border-line bg-paper" aria-label="The order's timeline">
            {t.steps.map((s) => (
              <Step key={s.seq} s={s} t={t} />
            ))}
          </ol>
          <p className="mt-2 text-[0.82rem] text-ink-soft">{t.steps.length} steps from the hash-chained ledger. The kitchen sees the same steps on its own order page.</p>
        </>
      )}
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

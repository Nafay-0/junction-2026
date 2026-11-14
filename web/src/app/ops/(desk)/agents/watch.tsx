"use client";

import Link from "next/link";
import { useState } from "react";
import type { AlertState } from "@/server/ops/alerts";
import type { EscalationQueue, Scorecard } from "@/server/ops/agent-watch";
import type { ScoreRow } from "@/server/ops/scorecard";
import { api } from "../../../_client/api";
import { Badge } from "../../../_ui/kit";
import { ruleTitle } from "../../../_ui/plain";
import { money, num, since, whenSeconds } from "../../_ui/format";
import { Button, Details, LoadError, Loading, Section, useNow, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { SqlBox } from "../platform/_parts/parts";
import { AuditSearch } from "./audit-search";

type Watch = { scorecard: Scorecard; queue: EscalationQueue; alerts: AlertState };

const STATUS: Record<ScoreRow["status"], { label: string; tone: "good" | "waiting" | "refused" | "neutral" }> = {
  failing: { label: "Failing", tone: "refused" },
  escalating: { label: "Escalating", tone: "waiting" },
  performing: { label: "Performing", tone: "good" },
  quiet: { label: "Quiet", tone: "neutral" },
};
const KIND: Record<string, string> = { demo: "demo kitchen", visitor: "visitor kitchen", account: "account kitchen", outside: "outside agent", "crash-test": "crash-test model", "outside (visitor)": "outside agent over MCP, visitor kitchen", "outside (account)": "outside agent over MCP, account kitchen", "outside (demo)": "outside agent over MCP, demo kitchen" };
const pctOf = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
const secs = (x: number | null) => (x === null ? "–" : `${x.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} s`);

/**
 * The agent watch on the Agents page: one status per agent with its reason, what a person might do about it (through
 * the existing controls, never automatically), the alerts and the orders waiting for a person.
 */
export function AgentWatch() {
  const [window, setWindow] = useState<"1h" | "today" | "24h">("today");
  const live = useOps<Watch>(`/ops-api/agents/watch?window=${window}`, { pollMs: 5000 });
  const now = useNow();
  const d = live.data;
  return (
    <>
      <Section
        id="scorecard"
        title="Scorecard"
        aside={
          <span className="inline-flex gap-1 rounded-full bg-surface p-1" role="group" aria-label="Window">
            {(["1h", "today", "24h"] as const).map((w) => (
              <button key={w} type="button" onClick={() => setWindow(w)} aria-pressed={window === w} className={`inline-flex min-h-8 items-center rounded-full px-3.5 text-[0.86rem] font-medium ${window === w ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}>
                {w === "1h" ? "Last hour" : w === "today" ? "Today" : "24 hours"}
              </button>
            ))}
          </span>
        }
      >
        <LoadError message={live.error} />
        {!d ? (
          <Loading label="Scoring the agents…" />
        ) : (
          <>
            <Alerts a={d.alerts} />
            <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-[0.88rem] text-ink-soft">
              <span>
                <b className="text-ink">{d.scorecard.counts.failing}</b> failing, <b className="text-ink">{d.scorecard.counts.escalating}</b> escalating, <b className="text-ink">{d.scorecard.counts.performing}</b> performing, {d.scorecard.counts.quiet} quiet, {d.scorecard.words}.
              </span>
              <span>
                {d.scorecard.sourceNote} Read {whenSeconds(d.scorecard.at)}.
              </span>
            </p>
            <Scores rows={d.scorecard.rows} onDone={live.refresh} />
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <Details summary="The thresholds and why">
                <ul className="space-y-1.5 text-[0.88rem]">
                  {d.scorecard.thresholds.map((t) => (
                    <li key={t.id}>
                      <b>{t.label}</b>: {t.id === "decide_p90" ? `over ${t.limit} s` : t.id === "over_limit" || t.id === "live_per_order" ? `over ${t.limit}` : `${Math.round(t.limit * 100)} % or more`} {t.unit}, at least {t.min} → <i>{t.status}</i>. {t.why}
                    </li>
                  ))}
                </ul>
              </Details>
              <SqlBox sql={d.scorecard.sql} summary={`The figures' query (${d.scorecard.source === "postgres" ? "ran on PostgreSQL" : "the same definitions, computed from the ledger here"})`} />
            </div>
          </>
        )}
      </Section>
      {d && <Queue q={d.queue} now={now} />}
      <AuditSearch />
    </>
  );
}

function Alerts({ a }: { a: AlertState }) {
  if (a.quiet)
    return (
      <p className="mb-3 rounded-lg bg-good-soft px-4 py-2.5 text-[0.92rem] text-good">
        <b>All quiet.</b> {a.rules.length} alert rules checked {whenSeconds(a.at)}, every {a.evaluatedEveryS} s.
      </p>
    );
  return (
    <ul className="mb-3 space-y-1.5">
      {a.breaches.map((b) => (
        <li key={b.id} className="rounded-lg bg-safety-soft px-4 py-2.5 text-[0.92rem] ring-1 ring-inset ring-safety/60">
          <b>{b.title}</b>: {b.detail} (limit {b.limit} {b.unit}), since {whenSeconds(b.since)}.
        </li>
      ))}
    </ul>
  );
}

function Scores({ rows: all, onDone }: { rows: ScoreRow[]; onDone: () => void }) {
  const rows = all.filter((r) => r.status !== "quiet");
  const quiet = all.filter((r) => r.status === "quiet");
  if (!rows.length) return <p className="text-[0.92rem] text-ink-soft">No agent has come to the gate in this window{quiet.length ? ` (${quiet.length} known agents quiet)` : ""}.</p>;
  return (
    <>
    <Table label="Agent scorecard">
      <thead>
        <tr>
          <th>Agent and status</th>
          <th className="text-right">Requests</th>
          <th className="text-right">Alone</th>
          <th className="text-right">To a person</th>
          <th className="text-right">Refused</th>
          <th className="text-right">Failed</th>
          <th className="text-right">Decided p50 / p90</th>
          <th className="text-right">Corrected</th>
          <th className="text-right">Per order</th>
          <th>What a person might do</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.agentId}>
            <td className="min-w-[19rem] max-w-[26rem]">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <b>{r.label}</b>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </span>
              <span className="block text-[0.82rem] text-ink-soft">
                {r.orgName}, {KIND[r.kind] ?? r.kind}
                {r.suspended ? ", suspended" : ""}
                {" · "}
                <Link href={`/ops/orders?agent=${encodeURIComponent(r.agentId)}`} className="text-petrol underline decoration-petrol/30 underline-offset-4">
                  its orders
                </Link>
              </span>
              <span className="mt-1 block text-[0.86rem] leading-snug">{r.reason.replace(/^(Failing|Escalating|Performing): /, "")}</span>
              {r.notes.length > 0 && <span className="block text-[0.8rem] text-ink-soft">{r.notes.join("; ")}</span>}
            </td>
            <td className="text-right tabular">{num(r.requests)}</td>
            <td className="text-right tabular">{num(r.alone)}</td>
            <td className="text-right tabular">
              {num(r.escalated)}
              <span className="block text-[0.8rem] text-ink-soft">{pctOf(r.rates.escalation)}</span>
            </td>
            <td className="text-right tabular">
              {num(r.refused)}
              {r.refusedRules[0] && <span className="block text-[0.8rem] text-ink-soft">{r.refusedRules.slice(0, 2).map((x) => `${ruleTitle(x.rule)} (${x.n})`).join(", ")}</span>}
            </td>
            <td className="text-right tabular">
              {num(r.failedTurns)}
              <span className="block text-[0.8rem] text-ink-soft">of {num(r.turns)} turns</span>
            </td>
            <td className="text-right tabular">
              {secs(r.decideP50S)} / {secs(r.decideP90S)}
            </td>
            <td className="text-right tabular">
              {num(r.corrections)}
              <span className="block text-[0.8rem] text-ink-soft">of {num(r.proposals)}</span>
            </td>
            <td className="text-right tabular">
              {r.perOrder.spendUsd === null ? (r.spendUsd ? `$${r.spendUsd.toFixed(3)} in all` : "–") : `$${r.perOrder.spendUsd.toFixed(3)} models`}
              <span className="block text-[0.8rem] text-ink-soft">{r.perOrder.liveLookups === null ? (r.liveLookups ? `${r.liveLookups} live calls in all` : "no live calls") : `${r.perOrder.liveLookups.toFixed(1)} live calls`}</span>
            </td>
            <td className="min-w-[11rem]">
              <Proposal r={r} onDone={onDone} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
    {quiet.length > 0 && <p className="mt-1.5 text-[0.84rem] text-ink-soft">Quiet in this window: {quiet.map((r) => r.label).join(", ")}.</p>}
    </>
  );
}

function Proposal({ r, onDone }: { r: ScoreRow; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const trace = r.lastRefusedRequest ? (
    <Link href={`/ops/trace/${r.lastRefusedRequest}`} className="text-[0.86rem] font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
      Its last refused request in Trace
    </Link>
  ) : null;
  if (!r.proposal) return trace ?? <span className="text-[0.84rem] text-ink-soft">Nothing to do.</span>;
  const p = r.proposal;
  async function suspend() {
    setBusy(true);
    const res = await api<{ suspension: { label: string; by: string } }>("POST", "/ops-api/control", { action: "suspend", scope: "agent", target: r.agentId, reason: `From the scorecard: ${r.reason}`.slice(0, 300) });
    setBusy(false);
    setConfirm(false);
    setMsg(res.ok ? `Suspended by ${res.data.suspension.by}; resume it in Control.` : res.error.message);
    onDone();
  }
  return (
    <div className="space-y-1.5 text-[0.86rem]">
      <p className="font-semibold">{p.title}</p>
      {p.action === "suspend" &&
        (confirm ? (
          <span className="flex flex-wrap gap-1.5">
            <Button kind="stop" onClick={suspend} disabled={busy}>
              Suspend, with this evidence
            </Button>
            <Button onClick={() => setConfirm(false)}>Not now</Button>
          </span>
        ) : (
          <Button kind="stop" onClick={() => setConfirm(true)}>
            Suspend…
          </Button>
        ))}
      {p.action === "raise_mandate" && <p className="text-ink-soft">{p.why}</p>}
      {p.action === "trace" && !trace && <p className="text-ink-soft">{p.why}</p>}
      {msg && <p role="status">{msg}</p>}
      {trace}
    </div>
  );
}

function Queue({ q, now }: { q: EscalationQueue; now: number | undefined }) {
  const s = q.signOff;
  return (
    <Section id="escalations" title="Waiting for a person" aside={`Oldest first; over ${q.thresholdMin} min is an alert`}>
      <p className="mb-2 text-[0.9rem] text-ink-soft">
        Today: {s.decided} sign-off{s.decided === 1 ? "" : "s"} answered ({s.granted} approved, {s.declined} declined), half within <b className="text-ink">{s.p50Min === null ? "–" : `${s.p50Min.toLocaleString("fi-FI")} min`}</b>, 90 % within <b className="text-ink">{s.p90Min === null ? "–" : `${s.p90Min.toLocaleString("fi-FI")} min`}</b>.
      </p>
      {q.items.length === 0 ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-[0.92rem]">Nothing is waiting for a person.</p>
      ) : (
        <Table label="Orders waiting for a sign-off">
          <thead>
            <tr>
              <th>Waiting</th>
              <th>Kitchen</th>
              <th>Agent</th>
              <th>Who signs</th>
              <th className="text-right">Total</th>
              <th>Why it needs a person</th>
              <th>Price held</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((w) => (
              <tr key={w.approvalId}>
                <td className="tabular">
                  {now === undefined ? `${w.waitingMin} min` : w.overThreshold ? <Badge tone="waiting">{since(w.requestedAt, now)}</Badge> : since(w.requestedAt, now)}
                </td>
                <td>
                  {w.orgName}
                  <Link href={`/ops/orders/${w.orderId}`} className="block text-[0.8rem] text-petrol underline decoration-petrol/30 underline-offset-4">
                    the order&apos;s timeline
                  </Link>
                </td>
                <td>
                  {w.agentLabel}
                  {w.agentSuspended ? " (suspended)" : ""}
                </td>
                <td>
                  {w.approverName}
                  <span className="block text-[0.8rem] text-ink-soft">{w.approverRole}</span>
                </td>
                <td className="text-right tabular">{money(w.totalCents)}</td>
                <td className="max-w-[24rem] text-[0.88rem]">
                  {w.reasons.join(" ")}
                  {w.requestId && (
                    <Link href={`/ops/trace/${w.requestId}`} className="ml-1 text-petrol underline decoration-petrol/30 underline-offset-4">
                      Trace
                    </Link>
                  )}
                </td>
                <td className="tabular text-[0.86rem]">{w.priceHeldUntil ? whenSeconds(w.priceHeldUntil) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-2">
        <SqlBox sql={q.sql} summary="Sign-off times in SQL (the same definition, over telemetry)" />
      </div>
    </Section>
  );
}

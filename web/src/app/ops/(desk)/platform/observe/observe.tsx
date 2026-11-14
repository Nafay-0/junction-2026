"use client";

import { useState } from "react";
import type { Panels, Range } from "@/server/aiven/showcase/panels";
import { whenSeconds } from "../../../_ui/format";
import { LoadError, Loading, PageHead, Panel, Section, useOps } from "../../../_ui/kit";
import { Bars, HBars, PlatformTabs, Rows, SqlBox, Status, fmtCell } from "../_parts/parts";

/**
 * Observe: the Grafana dashboard's questions inside the operations portal, from the same table, read as the
 * read-only user, each panel with its SQL. Grafana itself stays behind its login (link at the top).
 */
export function Observe() {
  const [range, setRange] = useState<Range>("24h");
  const live = useOps<Panels>(`/ops-api/platform/panels?range=${range}`, { pollMs: 15_000 });
  const p = live.data;
  const grafanaUrl = p?.grafanaUrl;
  return (
    <>
      <PageHead
        title="Observe"
        purpose="The dashboard's numbers: orders, sign-offs, refusals, savings, spend and health."
        about="Orders, sign-offs, refusals by rule, what the cache and narrowing saved, model spend and service health: the dashboard's numbers, drawn here from the same PostgreSQL table, each panel with the query behind it."
        right={
          <span className="flex items-center gap-3">
            {p && <span className="tabular">Read {whenSeconds(p.at)} as {p.readAs}</span>}
            {grafanaUrl && (
              <a href={grafanaUrl} target="_blank" rel="noreferrer" className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                Full Grafana dashboard
              </a>
            )}
          </span>
        }
      />
      <PlatformTabs />
      <div className="inline-flex gap-1 rounded-full bg-surface p-1" role="group" aria-label="Time range">
        {(["1h", "24h", "7d"] as Range[]).map((r) => (
          <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r} className={`inline-flex min-h-9 items-center rounded-full px-4 text-[0.9rem] font-medium transition-[background-color,color,box-shadow] duration-150 ${range === r ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}>
            {r === "1h" ? "Last hour" : r === "24h" ? "24 hours" : "7 days"}
          </button>
        ))}
      </div>
      <LoadError message={live.error} />
      {!p ? <Loading /> : <Body p={p} />}
    </>
  );
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const eur = (v: number) => `${v.toLocaleString("fi-FI", { maximumFractionDigits: 0 })}\u00a0€`;

function Body({ p }: { p: Panels }) {
  const t = p.panels.totals?.rows[0] ?? {};
  const hits = n(t.cache_hits);
  const calls = n(t.partner_calls);
  const priced = n(t.products_priced);
  const pricedRequests = n(t.requests_priced);
  const catalogue = p.catalogueSize ?? 17_546;
  const wait = p.panels.signoffWait?.rows[0] ?? {};
  const spend = p.panels.spend?.rows ?? [];
  const errors = Object.values(p.panels).filter((x) => x.error);
  return (
    <>
      {errors.length > 0 && <p className="mt-3 rounded-lg bg-safety-soft px-4 py-2.5 ring-1 ring-inset ring-safety/50 text-[0.86rem]">{errors.length} panels could not be read: {errors[0].error}</p>}
      <Panel className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-line">
        <Stat n={n(t.orders)} label="orders committed" sub={eur(n(t.value_eur))} />
        <Stat n={n(t.signoffs_asked)} label="sign-offs asked" sub={`${n(t.signoffs_granted)} granted, ${n(t.signoffs_denied)} declined`} />
        <Stat n={n(t.refused)} label="refused by the gate" safety={n(t.refused) > 0} />
        <Stat n={hits} label="live calls avoided by the cache" sub={hits + calls ? `${Math.round((hits / (hits + calls)) * 100)} % of live answers` : "no live lookups"} />
        <Stat n={pricedRequests ? (priced / pricedRequests).toFixed(1).replace(".", ",") : "–"} label={`products priced per request, of ${catalogue.toLocaleString("fi-FI")}`} sub={pricedRequests ? `${Math.max(0, pricedRequests * catalogue - priced).toLocaleString("fi-FI")} live checks avoided by narrowing in master data first` : "no live lookups"} />
        <Stat n={n(t.agents)} label="agents at the door" sub={`${n(t.requests)} requests`} />
      </Panel>
      <p className="mt-1 text-[0.78rem] text-ink-soft">{p.label}.</p>

      <div className="mt-2 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Box title="Gate decisions over time" sql={p.panels.timeline}>
          <Bars rows={p.panels.timeline?.rows ?? []} label="Gate decisions over time" series={[{ key: "allowed", label: "allowed alone", tone: "ink" }, { key: "to_person", label: "sent to a person", tone: "pale" }, { key: "refused", label: "refused", tone: "safety" }]} />
        </Box>
        <Box title="Refusals by rule" sql={p.panels.refusals}>
          <HBars rows={p.panels.refusals?.rows ?? []} labelKey="rule" valueKey="n" safety />
        </Box>
        <Box title="Why orders went to a person" sql={p.panels.escalations}>
          <HBars rows={p.panels.escalations?.rows ?? []} labelKey="rule" valueKey="n" />
        </Box>
        <Box title="How long sign-offs waited" sql={p.panels.signoffWait}>
          <div className="grid grid-cols-4 gap-2">
            <Stat n={n(wait.asked)} label="asked" />
            <Stat n={n(wait.waiting)} label="still waiting" safety={n(wait.waiting) > 0} />
            <Stat n={wait.median_s === null || wait.median_s === undefined ? "–" : `${fmtCell(n(wait.median_s))} s`} label="median wait" />
            <Stat n={wait.max_s === null || wait.max_s === undefined ? "–" : `${fmtCell(n(wait.max_s))} s`} label="longest" />
          </div>
        </Box>
        <Box title="Live price: Valkey cache against partner calls" sql={p.panels.cache}>
          <Bars rows={p.panels.cache?.rows ?? []} label="Live price answers" series={[{ key: "from_cache", label: "from the Valkey cache", tone: "ink" }, { key: "partner_calls", label: "asked the partner API", tone: "pale" }]} />
        </Box>
        <Box title="Model spend" sql={p.panels.spend}>
          <p className="text-[0.9rem]">
            Today on this server: <b>${p.modelToday.usd.toFixed(4)}</b> over <b>{p.modelToday.calls}</b> calls, of a ${p.modelToday.maxUsd} and {p.modelToday.maxCalls}-call daily cap{p.modelToday.enabled ? "" : " (model calls are switched off)"}.
          </p>
          <div className="mt-2">
            <Rows columns={["day", "usd", "calls"]} rows={spend} empty="No spend snapshot written yet (one a minute once a model is called)." />
          </div>
        </Box>
        <Box title="Service health: the app's own probes" sql={p.panels.health}>
          {(p.panels.health?.rows ?? []).length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {p.panels.health!.rows.map((r) => (
                <li key={String(r.service)} className="rounded-lg bg-surface px-3 py-2.5">
                  <p className="font-semibold">{String(r.service)}</p>
                  <Status ok={r.ok as boolean} label={`${r.ok ? "up" : "down"}, ${fmtCell(r.ms)} ms`} />
                  <p className="text-[0.8rem] text-ink-soft">{fmtCell(r.checked_at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.84rem] text-ink-soft">No probe in the last 6 hours: the app writes one a minute while PostgreSQL is on.</p>
          )}
        </Box>
        <Box title="Pipeline: events produced and consumed" sql={p.panels.pipeline}>
          <Bars rows={p.panels.pipeline?.rows ?? []} label="Events through the pipeline" series={[{ key: "published", label: "handed to Kafka", tone: "ink" }, { key: "consumed", label: "written to PostgreSQL", tone: "pale" }, { key: "dropped", label: "dropped", tone: "safety" }]} />
        </Box>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SearchBox p={p} />
        <ConversationBox p={p} />
        <Box title="Orders by who decided" sql={p.panels.decidedBy}>
          <Bars rows={p.panels.decidedBy?.rows ?? []} label="Orders by who decided" series={[{ key: "agent_alone", label: "the agent, alone", tone: "ink" }, { key: "person_approved", label: "a person approved", tone: "pale" }, { key: "person_declined", label: "a person declined", tone: "safety" }]} />
        </Box>
        <Box title="Watch, offers and corrections" sql={p.panels.counters}>
          {(p.panels.counters?.rows ?? []).length ? <HBars rows={p.panels.counters!.rows} labelKey="kind" valueKey="n" /> : <p className="text-[0.84rem] text-ink-soft">None in this range.</p>}
        </Box>
      </div>

      <Section title="Agents: activity, sign-offs and refusals">
        <Panel className="px-3 py-2">
          <Rows columns={["agent_id", "requests", "committed", "value_eur", "signoffs", "refused"]} rows={p.panels.agents?.rows ?? []} max={15} />
          {p.panels.agents && <SqlBox sql={p.panels.agents.sql} />}
        </Panel>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Crash-test scores">
          <Panel className="px-3 py-2">
            <Rows columns={["ts", "agent_id", "score", "run"]} rows={p.panels.crash?.rows ?? []} empty="No crash-test run has reported a score yet." />
            {p.panels.crash && <SqlBox sql={p.panels.crash.sql} />}
          </Panel>
        </Section>
        <Section title="Aiven Managed Agent runs">
          <Panel className="px-3 py-2">
            <Rows columns={["ts", "preset", "ok", "seconds", "detail"]} rows={p.panels.runs?.rows ?? []} empty="No run started from this portal in the last 7 days." />
            {p.panels.runs && <SqlBox sql={p.panels.runs.sql} />}
          </Panel>
        </Section>
      </div>
    </>
  );
}

const ms = (v: unknown) => (v === null || v === undefined ? "–" : `${n(v).toLocaleString("fi-FI")} ms`);

/** Smart search: time by stage, which recall backend answered, fallbacks, cost and "not sold" (search.done events). */
function SearchBox({ p }: { p: Panels }) {
  const r = p.panels.search?.rows[0] ?? {};
  const total = n(r.searches);
  const share = (x: unknown) => (total ? `${Math.round((n(x) / total) * 100)} %` : "–");
  return (
    <Box title="Search right now" sql={p.panels.search}>
      {!total ? (
        <p className="text-[0.84rem] text-ink-soft">No smart search in this range.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={total} label="searches" sub={`${share(r.not_sold)} "not sold"`} />
            <Stat n={share(r.on_opensearch)} label="recall on OpenSearch" sub={`${share(r.in_memory)} in memory`} />
            <Stat n={n(r.fallbacks)} label="recall fallbacks" sub={`${n(r.judge_missed)} without the judge`} safety={total > 0 && n(r.fallbacks) / total > 0.05} />
            <Stat n={`$${n(r.usd_per_1000).toFixed(2)}`} label="per 1,000 searches" />
          </div>
          <Rows
            columns={["stage", "p50", "p90"]}
            rows={[
              { stage: "query embedding", p50: ms(r.embed_p50), p90: ms(r.embed_p90) },
              { stage: "recall", p50: ms(r.recall_p50), p90: ms(r.recall_p90) },
              { stage: "relevance judge", p50: ms(r.judge_p50), p90: ms(r.judge_p90) },
              { stage: "end to end", p50: ms(r.total_p50), p90: ms(r.total_p90) },
            ]}
          />
        </>
      )}
    </Box>
  );
}

/** The conversation: turn time, failures, outcomes, model calls per turn (turn.* and agent.model events). */
function ConversationBox({ p }: { p: Panels }) {
  const r = p.panels.conversation?.rows[0] ?? {};
  const turns = n(r.turns);
  return (
    <Box title="The conversation" sql={p.panels.conversation}>
      {!turns ? (
        <p className="text-[0.84rem] text-ink-soft">No conversation turn in this range.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={turns} label="turns" sub={`${n(r.typed)} typed, ${n(r.spoken)} spoken`} />
            <Stat n={r.turn_p50_s === null || r.turn_p50_s === undefined ? "–" : `${fmtCell(r.turn_p50_s)} s`} label="turn time, median" sub={`90 % within ${r.turn_p90_s === null || r.turn_p90_s === undefined ? "–" : `${fmtCell(r.turn_p90_s)} s`}`} />
            <Stat n={n(r.failed)} label="failed or timed out" safety={n(r.failed) > 0} />
            <Stat n={r.model_calls_per_turn === null || r.model_calls_per_turn === undefined ? "–" : fmtCell(r.model_calls_per_turn)} label="model calls per turn" sub={`$${n(r.model_usd).toFixed(4)} in all`} />
          </div>
          <HBars
            rows={[
              { outcome: "ordered", n: n(r.ordered) },
              { outcome: "sent for sign-off", n: n(r.sign_off) },
              { outcome: "refused by a rule", n: n(r.refused) },
              { outcome: "asked a question", n: n(r.asked) },
              { outcome: "answered", n: n(r.answered) },
            ]}
            labelKey="outcome"
            valueKey="n"
          />
        </>
      )}
    </Box>
  );
}

function Stat({ n: value, label, sub, safety }: { n: number | string; label: string; sub?: string; safety?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="display flex items-center gap-2 text-[2rem] leading-none tabular">
        {typeof value === "number" ? value.toLocaleString("fi-FI") : value}
        {safety && <span aria-hidden className="hazard-thin inline-block size-3.5" />}
      </p>
      <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.82rem] text-ink-soft">{sub}</p>}
    </div>
  );
}

function Box({ title, sql, children }: { title: string; sql?: { sql: string; error?: string; ms?: number }; children: React.ReactNode }) {
  return (
    <Panel className="p-5">
      <h2 className="display text-[1.3rem]">{title}</h2>
      <div className="mt-2">{sql?.error ? <p className="text-[0.84rem] font-semibold">{sql.error}</p> : children}</div>
      {sql && <SqlBox sql={sql.sql} summary={`The query${sql.ms !== undefined ? ` (${sql.ms} ms)` : ""}`} />}
    </Panel>
  );
}

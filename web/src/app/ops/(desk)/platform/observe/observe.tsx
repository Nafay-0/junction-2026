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
        purpose="Orders, sign-offs, refusals by rule, what the cache and narrowing saved, model spend and service health: the dashboard's numbers, drawn here from the same PostgreSQL table, each panel with the query behind it."
        right={
          <span className="flex items-center gap-3">
            {p && <span className="tabular">Read {whenSeconds(p.at)} as {p.readAs}</span>}
            {grafanaUrl && (
              <a href={grafanaUrl} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2">
                Full Grafana dashboard
              </a>
            )}
          </span>
        }
      />
      <PlatformTabs />
      <div className="mt-3 flex gap-1" role="group" aria-label="Time range">
        {(["1h", "24h", "7d"] as Range[]).map((r) => (
          <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r} className={`px-3 py-1 text-[0.86rem] font-semibold ring-1 ring-ink ${range === r ? "bg-ink text-paper" : "bg-paper"}`}>
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
const eur = (v: number) => `€${v.toLocaleString("fi-FI", { maximumFractionDigits: 0 })}`;

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
      {errors.length > 0 && <p className="mt-3 border-l-4 border-safety bg-paper px-3 py-2 text-[0.86rem]">{errors.length} panels could not be read: {errors[0].error}</p>}
      <Panel className="mt-3 grid grid-cols-2 divide-concrete sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
        <Stat n={n(t.orders)} label="orders committed" sub={eur(n(t.value_eur))} />
        <Stat n={n(t.signoffs_asked)} label="sign-offs asked" sub={`${n(t.signoffs_granted)} granted, ${n(t.signoffs_denied)} declined`} />
        <Stat n={n(t.refused)} label="refused by the gate" safety={n(t.refused) > 0} />
        <Stat n={hits} label="live calls avoided by the cache" sub={hits + calls ? `${Math.round((hits / (hits + calls)) * 100)} % of live answers` : "no live lookups"} />
        <Stat n={pricedRequests ? (priced / pricedRequests).toFixed(1).replace(".", ",") : "–"} label={`products priced per request, of ${catalogue.toLocaleString("fi-FI")}`} sub={pricedRequests ? `${Math.max(0, pricedRequests * catalogue - priced).toLocaleString("fi-FI")} live checks avoided by narrowing in master data first` : "no live lookups"} />
        <Stat n={n(t.agents)} label="agents at the door" sub={`${n(t.requests)} requests`} />
      </Panel>
      <p className="mt-1 text-[0.78rem] text-ink-soft">{p.label}.</p>

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
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
                <li key={String(r.service)} className="border border-concrete px-2 py-1.5">
                  <p className="font-semibold">{String(r.service)}</p>
                  <Status ok={r.ok as boolean} label={`${r.ok ? "up" : "down"}, ${fmtCell(r.ms)} ms`} />
                  <p className="text-[0.72rem] text-ink-soft">{fmtCell(r.checked_at)}</p>
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

      <Section title="Agents: activity, sign-offs and refusals">
        <Panel className="px-3 py-2">
          <Rows columns={["agent_id", "requests", "committed", "value_eur", "signoffs", "refused"]} rows={p.panels.agents?.rows ?? []} max={15} />
          {p.panels.agents && <SqlBox sql={p.panels.agents.sql} />}
        </Panel>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
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

function Stat({ n: value, label, sub, safety }: { n: number | string; label: string; sub?: string; safety?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="flex items-center gap-2 font-display text-[1.8rem] font-bold leading-none tabular">
        {typeof value === "number" ? value.toLocaleString("fi-FI") : value}
        {safety && <span aria-hidden className="inline-block h-2.5 w-2.5 bg-safety ring-1 ring-ink" />}
      </p>
      <p className="mt-1 text-[0.8rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.76rem] text-ink-soft">{sub}</p>}
    </div>
  );
}

function Box({ title, sql, children }: { title: string; sql?: { sql: string; error?: string; ms?: number }; children: React.ReactNode }) {
  return (
    <Panel className="px-4 py-3">
      <h2 className="font-display text-[1.08rem] font-bold">{title}</h2>
      <div className="mt-2">{sql?.error ? <p className="text-[0.84rem] font-semibold">{sql.error}</p> : children}</div>
      {sql && <SqlBox sql={sql.sql} summary={`The query${sql.ms !== undefined ? ` (${sql.ms} ms)` : ""}`} />}
    </Panel>
  );
}

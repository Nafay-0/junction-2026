"use client";

import Link from "next/link";
import type { PlatformOverview, ServiceCard } from "@/server/aiven/showcase/platform";
import { whenSeconds } from "../../_ui/format";
import { LoadError, Loading, PageHead, Panel, Section, useOps } from "../../_ui/kit";
import { PlatformTabs, Status } from "./_parts/parts";

/**
 * The Aiven story on one screen, for a judge: which service does which job and why, whether each answers now and
 * how fast, what each did in the last hour, and what it all costs, read from the API.
 */
export function Story() {
  const live = useOps<PlatformOverview>("/ops-api/platform/overview", { pollMs: 10_000 });
  const o = live.data;
  return (
    <>
      <PageHead
        title="The platform"
        purpose="Everything Dock runs on is an Aiven service. Each one has one job, chosen for a reason; every number on this page is read live from the service itself or from Aiven's API."
        right={o && <span className="tabular">Read {whenSeconds(o.at)}</span>}
      />
      <PlatformTabs />
      <LoadError message={live.error} />
      {!o ? <Loading /> : <Body o={o} />}
    </>
  );
}

const usd = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `$${v.toFixed(d)}`);

function Body({ o }: { o: PlatformOverview }) {
  const s = (k: string) => o.services.find((x) => x.key === k);
  return (
    <>
      {o.missing.length > 0 && <p className="mt-3 border-l-4 border-safety bg-paper px-3 py-2 text-[0.88rem]">Not configured on this server: {o.missing.join("; ")}.</p>}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel className="px-3 py-3">
          <Diagram s={s} />
          <p className="mt-1 px-1 text-[0.78rem] text-ink-soft">Squares: filled answers now, yellow does not, empty not configured. Times are one round trip from this server.</p>
        </Panel>
        <div className="space-y-4">
          <Cost o={o} />
          <Panel className="px-4 py-3">
            <h2 className="font-display text-[1.1rem] font-bold">Three things to click</h2>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-[0.92rem]">
              <li>
                <Link href="/ops/platform/agent" className="font-semibold underline underline-offset-2">
                  Send in an Aiven agent
                </Link>
                : a buyer running on Aiven Managed Agents walks through Dock&apos;s MCP door; watch the gate stop it for a sign-off.
              </li>
              <li>
                <Link href="/ops/platform/ask" className="font-semibold underline underline-offset-2">
                  Ask the platform
                </Link>
                : &ldquo;is anything unhealthy?&rdquo; goes through Aiven&apos;s MCP server; the answer shows the call and the rows.
              </li>
              <li>
                <Link href="/ops/platform/stream" className="font-semibold underline underline-offset-2">
                  Watch the stream
                </Link>
                : the agent&apos;s events on Kafka as they are produced, and the consumer writing them into PostgreSQL.
              </li>
            </ol>
          </Panel>
          <McpLine o={o} />
        </div>
      </div>

      <Section title="Each service, its job and why it is the right one" aside="last hour, live">
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {o.services.map((c) => (
            <ServiceTile key={c.key} c={c} />
          ))}
        </div>
      </Section>

      <Section title="Considered and not used" aside="and why">
        <Panel>
          <ul className="divide-y divide-concrete">
            {o.notUsed.map((n) => (
              <li key={n.what} className="grid gap-x-4 px-4 py-2 text-[0.88rem] md:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-semibold">{n.what}</span>
                <span className="text-ink-soft">{n.why}</span>
              </li>
            ))}
          </ul>
        </Panel>
        {o.grafanaUrl && (
          <p className="mt-2 text-[0.86rem]">
            The full Grafana dashboard (Aiven login):{" "}
            <a href={o.grafanaUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
              Dock overview
            </a>
            . The same questions, drawn inside the portal: <Link href="/ops/platform/observe" className="font-semibold underline underline-offset-2">Observe</Link>.
          </p>
        )}
      </Section>
    </>
  );
}

function ServiceTile({ c }: { c: ServiceCard }) {
  return (
    <Panel className="flex flex-col px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-[1.15rem] font-bold leading-tight">{c.name}</p>
          <p className="text-[0.76rem] text-ink-soft">
            {c.key}
            {c.plan ? ` · ${c.plan}` : ""}
            {c.cloud ? ` · ${c.cloud}` : ""}
          </p>
        </div>
        <div className="text-right">
          <Status ok={c.reachable} label={c.reachable === null ? "not configured" : c.ms !== null ? `${c.ms} ms` : c.reachable ? "answers" : "down"} />
          {c.state && <p className="text-[0.72rem] text-ink-soft">{c.state}</p>}
        </div>
      </div>
      <p className="mt-2 text-[0.88rem] font-semibold leading-snug">{c.job}</p>
      <p className="mt-1 text-[0.84rem] leading-snug text-ink-soft">{c.why}</p>
      {c.lastHour.length > 0 && (
        <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 border-t border-concrete pt-2 text-[0.82rem]">
          {c.lastHour.map((x) => (
            <div key={x.label}>
              <dt className="text-ink-soft">{x.label}</dt>
              <dd className="font-display text-[1.25rem] font-bold leading-none tabular">{x.value === null ? "–" : typeof x.value === "number" ? x.value.toLocaleString("fi-FI") : x.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[0.72rem] text-ink-soft">
        {c.usdPerHour === undefined ? "" : c.usdPerHour === 0 ? "free plan" : `${usd(c.usdPerHour, 4)} an hour`}
        {c.detail ? ` · ${c.detail}` : ""}
      </p>
    </Panel>
  );
}

function Cost({ o }: { o: PlatformOverview }) {
  const c = o.cost;
  if (!c) return <Panel className="px-4 py-3 text-[0.9rem]">Cost: set AIVEN_READONLY_TOKEN to read plans and balance from the API.</Panel>;
  const share = c.creditShareUsed ?? 0;
  return (
    <Panel className="px-4 py-3">
      <h2 className="font-display text-[1.1rem] font-bold">What it costs</h2>
      <div className="mt-1 grid grid-cols-3 gap-2">
        <div>
          <p className="font-display text-[1.7rem] font-bold leading-none tabular">{usd(c.runRateUsdPerHour, 4)}</p>
          <p className="text-[0.78rem] text-ink-soft">an hour now ({usd(c.perDay)} a day)</p>
        </div>
        <div>
          <p className="font-display text-[1.7rem] font-bold leading-none tabular">{usd(c.balanceUsd)}</p>
          <p className="text-[0.78rem] text-ink-soft">used so far, of the {usd(c.creditUsd, 0)} credit</p>
        </div>
        <div>
          <p className="font-display text-[1.7rem] font-bold leading-none tabular">{usd(c.projectedToSundayUsd)}</p>
          <p className="text-[0.78rem] text-ink-soft">by Sunday 18:00 at this rate</p>
        </div>
      </div>
      <div className="mt-2 h-2.5 bg-concrete ring-1 ring-ink" aria-label={`${(share * 100).toFixed(1)} % of the credit used`}>
        <span className="block h-full bg-ink" style={{ width: `${Math.min(100, Math.max(0.5, share * 100))}%` }} />
      </div>
      <p className="mt-1 text-[0.76rem] text-ink-soft">
        {(share * 100).toFixed(1)} % of the credit used. {c.note}
      </p>
    </Panel>
  );
}

function McpLine({ o }: { o: PlatformOverview }) {
  const m = o.mcp;
  return (
    <Panel className="px-4 py-3 text-[0.88rem]">
      <p className="flex flex-wrap items-center gap-2">
        <b>Aiven MCP server</b>
        <Status ok={m.orgEnabled === false ? false : m.reachable} label={m.orgEnabled === false ? "switched off" : m.reachable ? `on, ${m.tools} tools` : "not answering"} />
      </p>
      {m.instruction ? <p className="mt-1 bg-safety px-2 py-1 font-semibold text-safety-ink">{m.instruction}</p> : <p className="mt-1 text-ink-soft">Allowed for this organisation{m.orgReadOnly ? " (read-only)" : ""}; the copilot calls it with the read-only token. {m.sql === false ? m.sqlDetail : ""}</p>}
    </Panel>
  );
}

/** Which service does which job, as boxes and arrows, each with its live state. */
function Diagram({ s }: { s: (k: string) => ServiceCard | undefined }) {
  const node = (k: string, x: number, y: number, w: number, h: number, title: string, sub: string, big = false) => {
    const c = s(k);
    const tone = c?.reachable === true ? "var(--color-ink)" : c?.reachable === false ? "var(--color-safety)" : "transparent";
    return (
      <g key={k}>
        <rect x={x} y={y} width={w} height={h} fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth={big ? 2 : 1.25} />
        <rect x={x + w - 15} y={y + 7} width="9" height="9" fill={tone} stroke="var(--color-ink)" strokeWidth="1" />
        <text x={x + 9} y={y + 19} fontSize={big ? 15 : 13} fontWeight="700" fill="var(--color-ink)">
          {title}
        </text>
        <text x={x + 9} y={y + 35} fontSize="10.5" fill="var(--color-ink-soft)">
          {sub}
        </text>
        {c?.ms !== null && c?.ms !== undefined && (
          <text x={x + w - 18} y={y + h - 8} fontSize="10.5" textAnchor="end" fill="var(--color-ink-soft)">
            {c.ms} ms
          </text>
        )}
      </g>
    );
  };
  const arrow = (d: string, label?: string, lx?: number, ly?: number, dashed = false) => (
    <g>
      <path d={d} fill="none" stroke="var(--color-ink)" strokeWidth="1.25" markerEnd="url(#arr)" strokeDasharray={dashed ? "4 3" : undefined} />
      {label && (
        <text x={lx} y={ly} fontSize="10" fill="var(--color-ink-soft)">
          {label}
        </text>
      )}
    </g>
  );
  return (
    <svg viewBox="0 0 900 430" className="h-auto w-full" role="img" aria-label="Which Aiven service does which job">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" fill="var(--color-ink)" />
        </marker>
      </defs>
      {/* outside */}
      {node("managed-agents", 10, 20, 190, 52, "Managed Agent", "outside buyer, runs on Aiven")}
      <g>
        <rect x="10" y="92" width="190" height="44" fill="none" stroke="var(--color-ink-soft)" strokeDasharray="3 3" />
        <text x="19" y="111" fontSize="12.5" fontWeight="700" fill="var(--color-ink)">
          Kitchens, phones
        </text>
        <text x="19" y="126" fontSize="10.5" fill="var(--color-ink-soft)">
          portal agent, sign-off by passkey
        </text>
      </g>
      {/* runtime */}
      {node("dock-app", 285, 20, 230, 116, "Aiven Runtime: Dock", "the gate, MCP door, REST, portals", true)}
      <text x="294" y="80" fontSize="10.5" fill="var(--color-ink)">
        plain code checks every order
      </text>
      <text x="294" y="95" fontSize="10.5" fill="var(--color-ink)">
        against the signed mandate
      </text>
      {arrow("M200 46 L283 46", "MCP over HTTPS", 206, 40)}
      {arrow("M200 114 L283 114", "HTTPS, SSE", 210, 108)}
      {/* data services */}
      {node("dock-pg", 620, 10, 270, 52, "PostgreSQL", "orders, ledger, memory, telemetry")}
      {node("dock-events", 620, 82, 270, 52, "Kafka", "dock.actions: every action, in order")}
      {node("dock-cache", 620, 154, 270, 52, "Valkey", "live-price cache, budgets, event bus")}
      {node("dock-search", 620, 226, 270, 52, "OpenSearch", "17,546 products, fi / sv / en")}
      {arrow("M515 40 L618 36", "transactions", 535, 30)}
      {arrow("M515 80 L618 104", "produce", 548, 84)}
      {arrow("M515 110 L618 176", "SET … EX", 540, 150)}
      {arrow("M515 128 L618 248", "search first", 520, 210)}
      {/* sink */}
      {arrow("M880 82 C 900 70, 900 66, 880 62", undefined, undefined, undefined, true)}
      <text x="768" y="76" fontSize="10" fill="var(--color-ink-soft)">
        sink → telemetry.events
      </text>
      {/* observe */}
      {node("dock-grafana", 285, 330, 230, 52, "Grafana", "dashboard: tables + Aiven API")}
      {node("aiven-mcp", 10, 330, 230, 52, "Aiven MCP server", "copilot: state, logs, metrics")}
      {arrow("M515 352 C 600 352, 640 120, 660 64", "reads as grafana_reader", 540, 320, true)}
      <g>
        <rect x="10" y="190" width="230" height="80" fill="none" stroke="var(--color-ink)" strokeWidth="1.25" />
        <text x="19" y="209" fontSize="12.5" fontWeight="700" fill="var(--color-ink)">
          Operations copilot
        </text>
        <text x="19" y="225" fontSize="10.5" fill="var(--color-ink-soft)">
          plain-words questions, answers
        </text>
        <text x="19" y="239" fontSize="10.5" fill="var(--color-ink-soft)">
          computed from rows; read-only
        </text>
        <text x="19" y="253" fontSize="10.5" fill="var(--color-ink-soft)">
          user dock_copilot, one view
        </text>
      </g>
      {arrow("M125 328 L125 272", "service state", 131, 300)}
      {arrow("M240 230 C 420 230, 520 190, 618 50", "SELECT as dock_copilot", 300, 222, true)}
    </svg>
  );
}


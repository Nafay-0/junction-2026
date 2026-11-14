"use client";

import Link from "next/link";
import type { PlatformOverview, ServiceCard } from "@/server/aiven/showcase/platform";
import type { AlertState } from "@/server/ops/alerts";
import type { RecallRouterStats } from "@/server/search/recall-router";
import { whenSeconds } from "../../_ui/format";
import { buttonClass } from "../../../_ui/kit";
import { Details, LiveMark, LoadError, Loading, PageHead, Panel, Section, useOps } from "../../_ui/kit";
import { PlatformTabs, Status } from "./_parts/parts";
import { RecallProbe } from "./_parts/recall-probe";

/**
 * The Aiven story on one screen, for a judge: which service does which job and why, whether each answers now and
 * how fast, what each did in the last hour, and what it all costs, read from the API.
 */
export function Story() {
  const live = useOps<Overview>("/ops-api/platform/overview", { pollMs: 10_000 });
  const o = live.data;
  return (
    <>
      <PageHead
        title="The platform"
        purpose="Everything AimoPilot runs on is an Aiven service, each with one job, chosen for a reason. Is each one alive, and what did it do in the last hour? Every number here is read live from the service itself or from Aiven's API."
        right={o && <LiveMark at={whenSeconds(o.at)} error={live.error} />}
      />
      <PlatformTabs />
      <LoadError message={live.error} />
      {!o ? <Loading /> : <Body o={o} />}
    </>
  );
}

type Overview = PlatformOverview & { alerts?: AlertState; recall?: (RecallRouterStats & { index?: string }) | null };

/** The app's own alert table and how smart search's recall was answered: what is breaching and since when. */
function Watch({ o }: { o: Overview }) {
  const a = o.alerts;
  const r = o.recall;
  const answered = r ? r.answered.memory + r.answered.opensearch + r.answered["memory-no-vectors"] : 0;
  return (
    <div className="mb-5 grid gap-3 lg:grid-cols-2">
      {a && (
        <Panel className={`px-5 py-4 ${a.quiet ? "" : "ring-1 ring-inset ring-safety/60"}`}>
          <p className="text-[0.84rem] font-medium text-ink-soft">Alerts, checked every {a.evaluatedEveryS} s by the app ({a.rules.length} rules)</p>
          {a.quiet ? (
            <p className="mt-1 text-[1.05rem]">
              <b>All quiet.</b> <span className="text-ink-soft">Last checked {whenSeconds(a.at)}.</span>
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {a.breaches.map((b) => (
                <li key={b.id}>
                  <b>{b.title}</b>: {b.detail}, since {whenSeconds(b.since)}.
                </li>
              ))}
            </ul>
          )}
          <Link href="/ops/agents#scorecard" className="mt-1 inline-block text-[0.88rem] font-medium text-petrol underline decoration-petrol/30 underline-offset-4">
            The agents&apos; scorecard and the sign-off queue
          </Link>
        </Panel>
      )}
      <Panel className="px-5 py-4">
        <p className="text-[0.84rem] font-medium text-ink-soft">Smart search&apos;s recall: who answered since this server started</p>
        {r ? (
          <p className="mt-1 text-[0.95rem]">
            {r.order.length > 1 ? (
              <>
                <b>{r.order[0] === "opensearch" ? "OpenSearch" : "Memory"}</b> first, {r.order[1] === "opensearch" ? "OpenSearch" : "memory"} as the fallback ({r.timeoutMs} ms deadline{r.index ? `, index ${r.index}` : ""}).
              </>
            ) : (
              <>Memory only (OpenSearch is not configured for recall).</>
            )}{" "}
            {answered} searches: {r.answered.opensearch} by OpenSearch, {r.answered.memory} in memory{r.answered["memory-no-vectors"] ? `, ${r.answered["memory-no-vectors"]} without vectors` : ""}; <b>{r.fallbacks}</b> fallback{r.fallbacks === 1 ? "" : "s"}
            {r.breakerOpenUntil ? `, breaker open until ${whenSeconds(new Date(r.breakerOpenUntil).toISOString())}` : ""}
            {r.lastError ? `; last: ${r.lastError}` : ""}.
          </p>
        ) : (
          <p className="mt-1 text-[0.95rem] text-ink-soft">No smart search has run on this server yet.</p>
        )}
        <RecallProbe />
      </Panel>
    </div>
  );
}

const usd = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `$${v.toFixed(d)}`);

const CLOUD: Record<string, string> = {
  "aws-eu-central-1": "AWS Frankfurt",
  "aws-eu-north-1": "AWS Stockholm",
  "do-fra": "DigitalOcean Frankfurt",
  "do-ams": "DigitalOcean Amsterdam",
  "google-europe-west1": "Google Cloud Belgium",
  "google-europe-north1": "Google Cloud Finland",
  "upcloud-fi-hel": "UpCloud Helsinki",
};
/** "startup-50-1024" -> "Startup plan", "free-1-1gb" -> "Free plan". */
const planWord = (p?: string | null) => (p ? `${p.split("-")[0].replace(/^./, (c) => c.toUpperCase())} plan` : "");
const where = (c: ServiceCard) => [planWord(c.plan), c.cloud ? (CLOUD[c.cloud] ?? c.cloud) : ""].filter(Boolean).join(", ");

function Body({ o }: { o: Overview }) {
  const s = (k: string) => o.services.find((x) => x.key === k);
  const up = o.services.filter((c) => c.reachable === true).length;
  const down = o.services.filter((c) => c.reachable === false);
  return (
    <>
      {o.missing.length > 0 && <p className="mb-5 rounded-lg bg-surface px-4 py-3 text-[0.92rem]">Not configured on this server: {o.missing.join("; ")}.</p>}
      <Watch o={o} />

      {/* The one thing to press, beside what it all costs. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-labelledby="send" className="on-dark flex flex-col justify-between gap-5 rounded-2xl bg-petrol-deep p-6 text-paper sm:p-7">
          <div>
            <h2 id="send" className="display text-[1.75rem] leading-[1.08] sm:text-[2rem]">
              An agent AimoPilot does not run, on Aiven, buying through the open door
            </h2>
            <p className="mt-2 max-w-[62ch] text-[1rem] leading-snug text-paper/85">
              A purchasing agent on Aiven Managed Agents, with its own model, connects to AimoPilot&apos;s MCP door and asks for 1 000 L of milk. It meets the same gate as every other agent, and its order stops for a person&apos;s sign-off. Every step shows here as it happens.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/ops/platform/agent" className={buttonClass("go", "lg")}>
              Send in an Aiven agent
            </Link>
            <Link href="/ops/platform/ask" className={buttonClass("ghost-dark", "md")}>
              Ask the platform
            </Link>
            <Link href="/ops/platform/stream" className={buttonClass("ghost-dark", "md")}>
              Watch the stream
            </Link>
          </div>
        </section>
        <Cost o={o} />
      </div>

      <Section
        title="Which service does which job"
        aside={
          <span className="tabular">
            {up} of {o.services.length} answering now{down.length ? `; not answering: ${down.map((d) => d.name).join(", ")}` : ""}
          </span>
        }
      >
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-line bg-paper p-4">
            <Diagram s={s} />
            <p className="mt-1 px-1 text-[0.85rem] text-ink-soft">A filled dot answers now; a crossed one does not; an outline is not configured. Times are one round trip from this server.</p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
            {o.services.map((c) => (
              <ServiceRow key={c.key} c={c} />
            ))}
          </ul>
        </div>
      </Section>

      <Section title="The copilot's view of the platform">
        <McpLine o={o} />
      </Section>

      <Section title="Considered and not used" aside="and why">
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {o.notUsed.map((n) => (
            <li key={n.what} className="grid gap-x-4 px-5 py-3 text-[0.92rem] md:grid-cols-[17rem_minmax(0,1fr)]">
              <span className="font-semibold">{n.what}</span>
              <span className="text-ink-soft">{n.why}</span>
            </li>
          ))}
        </ul>
        {o.grafanaUrl && (
          <p className="mt-3 text-[0.92rem]">
            The full Grafana dashboard (Aiven login):{" "}
            <a href={o.grafanaUrl} target="_blank" rel="noreferrer" className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
              AimoPilot overview
            </a>
            . The same questions, drawn inside the portal:{" "}
            <Link href="/ops/platform/observe" className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
              Observe
            </Link>
            .
          </p>
        )}
      </Section>
    </>
  );
}

/** One service: alive or not and how fast, its job, the number that proves it worked in the last hour. */
function ServiceRow({ c }: { c: ServiceCard }) {
  return (
    <li className="grid gap-x-4 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="display text-[1.2rem] leading-tight">{c.name}</span>
          <Status ok={c.reachable} label={c.reachable === null ? "not configured" : c.ms !== null ? `answers in ${c.ms} ms` : c.reachable ? "answers" : "not answering"} />
        </p>
        <p className="mt-0.5 text-[0.95rem] font-semibold leading-snug">{c.job}</p>
        <p className="mt-0.5 text-[0.85rem] text-ink-soft" title={[c.key, c.plan, c.cloud].filter(Boolean).join(", ")}>
          {[where(c), c.state && c.state !== "RUNNING" ? c.state.toLowerCase() : "", c.usdPerHour === undefined ? "" : c.usdPerHour === 0 ? "no charge" : `${usd(c.usdPerHour, 4)} an hour`]
            .filter(Boolean)
            .join(", ")
            .replace(/^./, (x) => x.toUpperCase())}
        </p>
        <Details summary="Why this service" className="mt-1">
          <p className="font-sans text-[0.88rem] leading-snug text-ink">{c.why}</p>
          {c.detail && <p className="font-sans text-[0.82rem]">{c.detail}</p>}
        </Details>
      </div>
      {c.lastHour.length > 0 && (
        <dl className="grid grid-cols-2 content-start gap-x-3 gap-y-2 rounded-lg bg-surface p-3">
          {c.lastHour.map((x) => (
            <div key={x.label}>
              <dd className="display text-[1.35rem] leading-none tabular">{x.value === null ? "–" : typeof x.value === "number" ? x.value.toLocaleString("fi-FI") : x.value}</dd>
              <dt className="text-[0.8rem] leading-tight text-ink-soft">{x.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Cost({ o }: { o: PlatformOverview }) {
  const c = o.cost;
  if (!c) return <Panel className="p-5 text-[0.95rem]">What it costs appears here once AIVEN_READONLY_TOKEN lets this server read plans and the balance from Aiven&apos;s API.</Panel>;
  const share = c.creditShareUsed ?? 0;
  return (
    <Panel className="p-5 sm:p-6">
      <h2 className="display text-[1.35rem]">What it costs</h2>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="display text-[2rem] leading-none tabular">{usd(c.runRateUsdPerHour, 4)}</p>
          <p className="mt-1 text-[0.84rem] leading-snug text-ink-soft">an hour now ({usd(c.perDay)} a day)</p>
        </div>
        <div>
          <p className="display text-[2rem] leading-none tabular">{usd(c.balanceUsd)}</p>
          <p className="mt-1 text-[0.84rem] leading-snug text-ink-soft">used so far, of the {usd(c.creditUsd, 0)} credit</p>
        </div>
        <div>
          <p className="display text-[2rem] leading-none tabular">{usd(c.projectedToSundayUsd)}</p>
          <p className="mt-1 text-[0.84rem] leading-snug text-ink-soft">by Sunday 18.00 at this rate</p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${(share * 100).toFixed(1)} % of the credit used`}>
        <span className="block h-full rounded-full bg-petrol" style={{ width: `${Math.min(100, Math.max(1, share * 100))}%` }} />
      </div>
      <p className="mt-2 text-[0.84rem] leading-snug text-ink-soft">
        {(share * 100).toFixed(1).replace(".", ",")} % of the credit used. {c.note}
      </p>
    </Panel>
  );
}

function McpLine({ o }: { o: PlatformOverview }) {
  const m = o.mcp;
  return (
    <Panel className="p-5 text-[0.95rem]">
      <p className="flex flex-wrap items-center gap-3">
        <span className="display text-[1.2rem]">Aiven MCP server</span>
        <Status ok={m.orgEnabled === false ? false : m.reachable} label={m.orgEnabled === false ? "switched off" : m.reachable ? `on, ${m.tools} tools` : "not answering"} />
      </p>
      {m.instruction ? <p className="mt-3 rounded-lg bg-surface px-4 py-3 font-semibold">{m.instruction}</p> : <p className="mt-1 text-ink-soft">Allowed for this organisation{m.orgReadOnly ? " (read-only)" : ""}; the copilot calls it with the read-only token. {m.sql === false ? m.sqlDetail : ""}</p>}
    </Panel>
  );
}

/** Which service does which job, as boxes and arrows, each with its live state. */
function Diagram({ s }: { s: (k: string) => ServiceCard | undefined }) {
  const node = (k: string, x: number, y: number, w: number, h: number, title: string, sub: string, big = false) => {
    const c = s(k);
    const tone = c?.reachable === true ? "var(--color-petrol)" : c?.reachable === false ? "var(--color-ink)" : "transparent";
    const ink = big ? "var(--color-paper)" : "var(--color-ink)";
    const soft = big ? "rgb(255 255 255 / 0.75)" : "var(--color-ink-soft)";
    return (
      <g key={k}>
        <rect x={x} y={y} width={w} height={h} rx="12" fill={big ? "var(--color-petrol-deep)" : "var(--color-paper)"} stroke={big ? "var(--color-petrol-deep)" : "var(--color-line-strong)"} strokeWidth={big ? 2 : 1.25} />
        <circle cx={x + w - 12} cy={y + 13} r="4.5" fill={big && c?.reachable ? "var(--color-lime)" : c?.reachable === true ? "var(--color-good)" : tone} stroke={big ? "var(--color-paper)" : c?.reachable === true ? "var(--color-good)" : "var(--color-ink-soft)"} strokeWidth="1" />
        {c?.reachable === false && <path d={`M${x + w - 14.2} ${y + 10.8} l4.4 4.4 M${x + w - 9.8} ${y + 10.8} l-4.4 4.4`} stroke="white" strokeWidth="1.3" />}
        <text x={x + 12} y={y + 20} fontSize={big ? 15 : 13} fontWeight="650" fill={ink}>
          {title}
        </text>
        <text x={x + 12} y={y + 36} fontSize="10.5" fill={soft}>
          {sub}
        </text>
        {c?.ms !== null && c?.ms !== undefined && (
          <text x={x + w - 18} y={y + h - 8} fontSize="10.5" textAnchor="end" fill={soft}>
            {c.ms} ms
          </text>
        )}
      </g>
    );
  };
  const arrow = (d: string, label?: string, lx?: number, ly?: number, dashed = false) => (
    <g>
      <path d={d} fill="none" stroke="var(--color-petrol)" strokeWidth="1.5" markerEnd="url(#arr)" strokeDasharray={dashed ? "4 3" : undefined} />
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
          <path d="M0 0 L10 5 L0 10 Z" fill="var(--color-petrol)" />
        </marker>
      </defs>
      {/* outside */}
      {node("managed-agents", 10, 20, 190, 52, "Managed Agent", "outside buyer, runs on Aiven")}
      <g>
        <rect x="10" y="92" width="190" height="44" rx="12" fill="none" stroke="var(--color-ink-soft)" strokeDasharray="3 3" />
        <text x="19" y="111" fontSize="12.5" fontWeight="700" fill="var(--color-ink)">
          Kitchens, phones
        </text>
        <text x="19" y="126" fontSize="10.5" fill="var(--color-ink-soft)">
          portal agent, sign-off by passkey
        </text>
      </g>
      {/* runtime */}
      {node("dock-app", 285, 20, 230, 116, "Aiven Runtime: AimoPilot", "the gate, MCP door, REST, portals", true)}
      <text x="294" y="80" fontSize="10.5" fill="var(--color-paper)">
        plain code checks every order
      </text>
      <text x="294" y="95" fontSize="10.5" fill="var(--color-paper)">
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
        sink to telemetry.events
      </text>
      {/* observe */}
      {node("dock-grafana", 285, 330, 230, 52, "Grafana", "dashboard: tables + Aiven API")}
      {node("aiven-mcp", 10, 330, 230, 52, "Aiven MCP server", "copilot: state, logs, metrics")}
      {arrow("M515 352 C 600 352, 640 120, 660 64", "reads as grafana_reader", 540, 320, true)}
      <g>
        <rect x="10" y="190" width="230" height="80" rx="12" fill="var(--color-lavender)" stroke="var(--color-lavender-mid)" strokeWidth="1.25" />
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


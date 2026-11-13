"use client";

import type { AgentRow } from "@/server/ops/views";
import { fi, num, when, whenSeconds } from "../../_ui/format";
import Link from "next/link";
import { Details, Empty, KV, Licence, LiveMark, LoadError, Loading, PageHead, ViaTag, useOps } from "../../_ui/kit";
import { FilterBar, useUrlState } from "../../_ui/filters";

const KIND: Record<AgentRow["kind"], string> = { demo: "Demo kitchen", visitor: "Visitor kitchen", outside: "Outside agent" };

export function AgentsScreen() {
  const live = useOps<{ at: string; licenceSource: string; agents: AgentRow[] }>("/ops-api/agents", { pollMs: 4000 });
  const d = live.data;
  const [q, setQ] = useUrlState("q", "");
  const [show, setShow] = useUrlState("show", "all");
  const needle = q.trim().toLowerCase();
  const rows = (d?.agents ?? []).filter((a) => (show === "all" || (show === "suspended" ? !!a.suspended : a.kind === show)) && (!needle || `${a.label} ${a.orgName} ${a.agentId}`.toLowerCase().includes(needle)));
  const n = (k: string) => (d?.agents ?? []).filter((a) => (k === "suspended" ? !!a.suspended : a.kind === k)).length;
  return (
    <>
      <PageHead
        title="Agents and licences"
        purpose="Every agent that has come to this gate: its crash-test licence when it has one, its record here, and what it may do alone right now, which is the kitchen's mandate capped by the licence."
        right={d && <LiveMark at={whenSeconds(d.at)} error={live.error} />}
      />
      <LoadError message={live.error} />
      {d && d.licenceSource === "none" && (
        <p className="mb-4 border-l-[6px] border-petrol bg-paper px-4 py-2.5 text-[0.92rem] leading-snug text-ink-soft">
          No crash-test ratings are published to this server yet, so every agent shows &quot;Not crash-tested yet&quot; and its mandate alone sets what it may do. Ratings appear here when the crash test writes them.
        </p>
      )}
      {!d ? (
        <Loading label="Reading the agents…" />
      ) : d.agents.length === 0 ? (
        <Empty title="No agent has come to the gate yet">An agent appears here once it presents a mandate at the door, whichever door it uses.</Empty>
      ) : (
        <>
          <FilterBar
            q={q}
            setQ={setQ}
            placeholder="Agent or organisation"
            options={[
              { id: "all", label: "All", count: d.agents.length },
              { id: "outside", label: "Outside agents", count: n("outside") },
              { id: "demo", label: "Demo kitchens", count: n("demo") },
              { id: "visitor", label: "Visitor kitchens", count: n("visitor") },
              { id: "suspended", label: "Suspended", count: n("suspended") },
            ]}
            value={show}
            setValue={setShow}
            result={`${rows.length} of ${d.agents.length}`}
          />
          {rows.length === 0 ? (
            <Empty title="No agent matches">Clear the search or choose All.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {rows.map((a) => (
                <AgentCard key={a.agentId} a={a} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

const LEVELS = ["L0", "L1", "L2", "L3"];

/** The licence as four steps from Learner to Autonomous, the earned ones filled. */
function LicenceSteps({ level }: { level?: string }) {
  const k = level ? LEVELS.indexOf(level) : -1;
  return (
    <span className="flex gap-[3px]" role="img" aria-label={level ? `Licence ${level} of L3` : "No licence yet"}>
      {LEVELS.map((l, i) => (
        <span key={l} className={`h-2 w-5 ${i <= k ? "bg-petrol" : "bg-mist ring-1 ring-inset ring-line"}`} />
      ))}
    </span>
  );
}

function AgentCard({ a }: { a: AgentRow }) {
  const r = a.record;
  return (
    <article className="flex flex-col bg-paper">
      <div aria-hidden className={a.suspended ? "hazard h-3" : "h-[3px] bg-petrol"} />
      <div className="px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display text-[1.45rem] leading-tight">{a.label}</h2>
            <p className="text-[0.9rem] text-ink-soft">
              {a.orgName}, {KIND[a.kind].toLowerCase()}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Licence licence={a.licence} />
            <LicenceSteps level={a.licence?.level} />
          </div>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
          {a.vias.length ? a.vias.map((v) => <ViaTag key={v} via={v} />) : <span className="text-[0.85rem] text-ink-soft">Not at the door since this server started</span>}
        </p>
        {a.suspended && (
          <p className="mt-2 bg-safety-ink px-3 py-2 text-[0.92rem] text-paper">
            <b className="text-safety">Suspended{a.suspended.scope === "org" ? " with its organisation" : ""}</b> {when(a.suspended.since)}: “{a.suspended.reason}”. Every call is refused until operations resumes it in{" "}
            <Link href="/ops/control" className="font-semibold underline underline-offset-2">
              Control
            </Link>
            .
          </p>
        )}
      </div>
      <dl className="grid grid-cols-3 border-y border-line/70 text-center sm:grid-cols-6">
        <Stat n={r.requests} label="requests" />
        <Stat n={r.alone} label="bought alone" />
        <Stat n={r.signOffs} label="needed a person" />
        <Stat n={r.committed} label="signed in all" />
        <Stat n={r.declined} label="declined" />
        <Stat n={r.refusals} label="refused" gate={r.refusals > 0} />
      </dl>
      <div className="flex-1 px-4 py-3 text-[0.92rem]">
        <p className="text-[0.85rem] font-semibold text-ink-soft">What it may do alone, now</p>
        <ul className="mt-1 space-y-1">
          {a.allows.map((x, i) => (
            <li key={i} className="leading-snug">
              {fi(x.line)}
              {x.detail && <span className="block text-[0.84rem] text-ink-soft">{fi(x.detail)}</span>}
            </li>
          ))}
        </ul>
        {a.licence?.why && <p className="mt-2 text-[0.85rem] text-ink-soft">{fi(a.licence.why)}</p>}
        {r.refusalsByRule.length > 0 && (
          <div className="mt-3">
            <p className="text-[0.85rem] font-semibold text-ink-soft">Refused by</p>
            <ul className="mt-1">
              {r.refusalsByRule.map((x) => (
                <li key={x.rule} className="flex justify-between gap-3 border-b border-line/50 py-0.5 last:border-0">
                  <span>{x.title}</span>
                  <span className="font-semibold tabular">{x.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-line/70 px-4 py-2">
        <Details summary="Ids and dates">
          <KV k="agent" v={a.agentId} />
          <KV k="org" v={a.orgId} />
          <KV k="first seen" v={when(a.firstAt)} />
          <KV k="last seen" v={when(a.lastAt)} />
          {a.expiresAt && <KV k="kitchen closes" v={when(a.expiresAt)} />}
        </Details>
      </div>
    </article>
  );
}

function Stat({ n, label, gate = false }: { n: number; label: string; gate?: boolean }) {
  return (
    <div className="border-line/70 px-2 py-2.5 [&:not(:last-child)]:border-r">
      <dt className="sr-only">{label}</dt>
      <dd className={`display text-[1.5rem] leading-none tabular ${gate ? "text-ink" : ""}`}>
        {gate ? <span className="bg-safety-ink px-1.5 text-safety">{num(n)}</span> : num(n)}
      </dd>
      <p className="mt-1 text-[0.76rem] leading-tight text-ink-soft">{label}</p>
    </div>
  );
}

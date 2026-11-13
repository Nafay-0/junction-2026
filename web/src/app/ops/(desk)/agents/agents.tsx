"use client";

import type { AgentRow } from "@/server/ops/views";
import { fi, num, when, whenSeconds } from "../../_ui/format";
import { Details, Empty, KV, Licence, LoadError, Loading, PageHead, Panel, ViaTag, useOps } from "../../_ui/kit";

const KIND: Record<AgentRow["kind"], string> = { demo: "Demo kitchen", visitor: "Visitor kitchen", outside: "Outside agent" };

export function AgentsScreen() {
  const live = useOps<{ at: string; licenceSource: string; agents: AgentRow[] }>("/ops-api/agents", { pollMs: 4000 });
  const d = live.data;
  return (
    <>
      <PageHead
        title="Agents and licences"
        purpose="Every agent that has come to this gate, its crash-test licence when it has one, its record here, and what it may do alone right now: the kitchen's mandate, capped by the licence."
        right={d && <span className="tabular">Updated {whenSeconds(d.at)}</span>}
      />
      <LoadError message={live.error} />
      {d && d.licenceSource === "none" && (
        <p className="mt-3 border-l-4 border-ink bg-paper px-3 py-2 text-[0.88rem]">
          Crash-test ratings are not published to this server yet, so every agent shows &quot;Not crash-tested yet&quot; and its mandate alone sets what it may do. Ratings appear here when the crash test writes them (DOCK_LICENCES_FILE, default .data/licences.json).
        </p>
      )}
      {!d ? (
        <Loading />
      ) : d.agents.length === 0 ? (
        <div className="mt-4">
          <Empty title="No agent yet" />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {d.agents.map((a) => (
            <AgentCard key={a.agentId} a={a} />
          ))}
        </div>
      )}
    </>
  );
}

function AgentCard({ a }: { a: AgentRow }) {
  const r = a.record;
  return (
    <Panel className={`flex flex-col ${a.suspended ? "border-2 border-ink shadow-[inset_6px_0_0_var(--color-safety)]" : ""}`}>
      <div className="border-b border-concrete px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[1.15rem] font-bold leading-tight">{a.label}</p>
            <p className="text-[0.84rem] text-ink-soft">
              {a.orgName}, {KIND[a.kind].toLowerCase()}
            </p>
          </div>
          <div className="text-right">
            <Licence licence={a.licence} />
            {a.suspended && <p className="mt-1 bg-safety px-1 text-[0.78rem] font-bold text-safety-ink">Suspended{a.suspended.scope === "org" ? " with its organisation" : ""}</p>}
          </div>
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
          {a.vias.length ? a.vias.map((v) => <ViaTag key={v} via={v} />) : <span className="text-[0.8rem] text-ink-soft">Not at the door since this server started</span>}
        </p>
      </div>
      <dl className="grid grid-cols-3 border-b border-concrete text-center">
        <Stat n={r.requests} label="requests" />
        <Stat n={r.alone} label="committed alone" />
        <Stat n={r.signOffs} label="needed a person" safety={r.signOffs > 0} />
        <Stat n={r.committed} label="committed in all" />
        <Stat n={r.declined} label="declined" />
        <Stat n={r.refusals} label="refused" safety={r.refusals > 0} />
      </dl>
      <div className="flex-1 px-4 py-3 text-[0.86rem]">
        {r.refusalsByRule.length > 0 && (
          <div className="mb-2">
            <p className="font-semibold">Refused by</p>
            <ul>
              {r.refusalsByRule.map((x) => (
                <li key={x.rule} className="flex justify-between gap-3">
                  <span>{x.title}</span>
                  <span className="tabular">{x.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="font-semibold">What it may do now</p>
        <ul className="mt-0.5 space-y-0.5">
          {a.allows.map((x, i) => (
            <li key={i} className="leading-snug">
              {fi(x.line)}
              {x.detail && <span className="block text-[0.78rem] text-ink-soft">{fi(x.detail)}</span>}
            </li>
          ))}
        </ul>
        {a.licence?.why && <p className="mt-2 text-[0.8rem] text-ink-soft">{a.licence.why}</p>}
        {a.suspended && (
          <p className="mt-2">
            Suspended {when(a.suspended.since)}: “{a.suspended.reason}”. Every call is refused until operations resumes it.
          </p>
        )}
      </div>
      <div className="border-t border-concrete px-4 py-1.5">
        <Details summary="Ids">
          <KV k="agent" v={a.agentId} />
          <KV k="org" v={a.orgId} />
          <KV k="first seen" v={when(a.firstAt)} />
          <KV k="last seen" v={when(a.lastAt)} />
          {a.expiresAt && <KV k="kitchen closes" v={when(a.expiresAt)} />}
        </Details>
      </div>
    </Panel>
  );
}

function Stat({ n, label, safety = false }: { n: number; label: string; safety?: boolean }) {
  return (
    <div className="border-concrete px-2 py-2 [&:not(:nth-child(3n))]:border-r [&:nth-child(-n+3)]:border-b">
      <dt className="sr-only">{label}</dt>
      <dd className="font-display text-[1.35rem] font-bold leading-none tabular">
        {safety ? <span className="bg-safety px-1 text-safety-ink">{num(n)}</span> : num(n)}
      </dd>
      <p className="mt-0.5 text-[0.74rem] leading-tight text-ink-soft">{label}</p>
    </div>
  );
}

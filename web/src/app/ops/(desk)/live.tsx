"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Overview } from "@/server/ops/views";
import { Target } from "../../_ui/target";
import { VIA, fi, money, num, since, when, whenSeconds, type Via } from "../_ui/format";
import { DoorGlyph, Empty, Licence, LoadError, Loading, Outcome, PageHead, Panel, Section, ViaTag, useNow, useOps } from "../_ui/kit";

const DOORS: Via[] = ["onsite", "mcp", "rest"];

export function LiveView() {
  const live = useOps<Overview>("/ops-api/overview", { pollMs: 2000 });
  const now = useNow();
  const o = live.data;
  return (
    <>
      <PageHead
        title="Live at the gate"
        purpose="Every purchasing agent at the door right now, whichever door it came through. All three doors lead to one gate: the same mandate check, the same rules in plain code, the same ledger."
        right={o && <span className="tabular">{live.streaming ? "Live" : "Polling"}, updated {whenSeconds(o.at)}</span>}
      />
      <LoadError message={live.error} />
      {!o ? <Loading /> : <Body o={o} now={now ?? Date.parse(o.at)} />}
    </>
  );
}

function Body({ o, now }: { o: Overview; now: number }) {
  const c = o.counters;
  return (
    <>
      <Section title="Three doors, one gate" aside={o.catalogue.kind === "valio" ? `Partner catalogue, ${num(o.catalogue.products)} products` : `Seed catalogue, ${num(o.catalogue.products)} products`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {DOORS.map((v) => (
            <div key={v} className="relative">
              <Panel className="px-4 py-3">
                <p className="flex items-center gap-2 font-display text-[1.15rem] font-bold">
                  <DoorGlyph via={v} size={12} />
                  {VIA[v].label}
                </p>
                <p className="mt-0.5 text-[0.82rem] text-ink-soft">{VIA[v].how}</p>
                <p className="mt-2 text-[0.88rem] tabular">
                  <b>{o.doors[v].agents}</b> agent{o.doors[v].agents === 1 ? "" : "s"}, <b>{num(o.doors[v].calls)}</b> calls
                  {o.doors[v].refused > 0 && (
                    <>
                      , <span className="bg-safety px-1 font-semibold text-safety-ink">{o.doors[v].refused} refused at the door</span>
                    </>
                  )}
                </p>
              </Panel>
              <span aria-hidden className="absolute left-1/2 top-full hidden h-3 w-0.5 -translate-x-1/2 bg-ink md:block" />
            </div>
          ))}
        </div>
        <div className="mt-3 border-2 border-ink bg-ink text-paper">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5">
            <p className="flex items-center gap-2 font-display text-[1.2rem] font-bold">
              <Target size={20} tone="chalk" /> The gate
            </p>
            <p className="text-[0.88rem] text-chalk-soft">Mandate signature, then every rule, then a named person above the mandate. The model is never trusted.</p>
            <p className="ml-auto text-[0.85rem] text-chalk-soft">
              {o.chain.ok ? `Ledger intact, ${num(o.chain.length)} entries` : <span className="bg-safety px-1 font-semibold text-safety-ink">Ledger chain broken: {o.chain.message}</span>}
            </p>
          </div>
          <div className="grid grid-cols-2 border-t border-steel-3 bg-paper text-ink sm:grid-cols-3 xl:grid-cols-6">
            <Cell n={c.requests} label="Requests" />
            <Cell n={c.byAgentAlone} label="Committed by the agent alone" />
            <Cell n={c.byPerson} label="Committed after a person signed off" />
            <Cell n={c.waiting} label="Waiting for a customer's sign-off" safety={c.waiting > 0} href="/ops/control" />
            <Cell n={c.refused} label="Refused, each with a named rule" safety={c.refused > 0} href="/ops/safeguards" />
            <Cell n={c.liveCalls} label="Calls to the live price service" href="/ops/safeguards#live" />
          </div>
        </div>
      </Section>

      <Section title="At the door now" aside={`Agents seen in the last 30 minutes${c.suspended ? `, ${c.suspended} suspension${c.suspended > 1 ? "s" : ""} in force` : ""}`}>
        {o.atDoor.length === 0 ? (
          <Empty title="No agent at the door">
            Nothing has called in the last 30 minutes. Open a kitchen (<Link className="underline" href="/k/kaari">/k/kaari</Link>), scan the join code on the wall, or point an MCP client at <code>/api/mcp</code>.
          </Empty>
        ) : (
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[0.88rem]">
              <thead className="border-b border-concrete-deep text-[0.78rem] text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-semibold">Agent</th>
                  <th className="px-3 py-2 font-semibold">Door</th>
                  <th className="px-3 py-2 font-semibold">Licence</th>
                  <th className="px-3 py-2 font-semibold">Doing now</th>
                  <th className="px-3 py-2 text-right font-semibold">Calls</th>
                  <th className="px-3 py-2 font-semibold">Last call</th>
                </tr>
              </thead>
              <tbody>
                {o.atDoor.map((a) => (
                  <tr key={a.agentId} className="border-b border-concrete last:border-0 align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold">{a.agentLabel}</p>
                      <p className="text-[0.8rem] text-ink-soft">{a.orgName}</p>
                    </td>
                    <td className="px-3 py-2">
                      {a.vias.map((v) => (
                        <ViaTag key={v} via={v} className="mr-3 block" />
                      ))}
                    </td>
                    <td className="px-3 py-2">
                      <Licence licence={a.licence} />
                    </td>
                    <td className="max-w-[34ch] px-3 py-2">
                      {a.suspended ? (
                        <p>
                          <span className="bg-safety px-1 font-semibold text-safety-ink">Suspended{a.suspended.scope === "org" ? " with its organisation" : ""}</span>{" "}
                          <span className="text-ink-soft">since {when(a.suspended.since)}: “{a.suspended.reason}”</span>
                        </p>
                      ) : a.current ? (
                        <Link href={`/ops/trace/${a.current.requestId}`} className="underline decoration-concrete-deep underline-offset-2 hover:decoration-ink">
                          {fi(a.current.doing)}
                        </Link>
                      ) : (
                        <span className="text-ink-soft">Connected, no request yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {num(a.calls)}
                      {a.refused > 0 && <span className="ml-1 bg-safety px-1 text-[0.8rem] font-semibold text-safety-ink">{a.refused} refused</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular text-ink-soft">{since(a.lastAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>

      <Section title="Requests" aside="Newest first. Open one to replay it step by step.">
        {o.sessions.length === 0 ? (
          <Empty title="No request yet">When an agent asks for something, it appears here with where it is and how it ended.</Empty>
        ) : (
          <Sessions rows={o.sessions} now={now} />
        )}
      </Section>
    </>
  );
}

function Cell({ n, label, safety = false, href }: { n: number; label: string; safety?: boolean; href?: string }) {
  const body = (
    <>
      <p className="flex items-center gap-2 font-display text-[1.9rem] font-bold leading-none tabular">
        {num(n)}
        {safety && <span aria-hidden className="inline-block h-2.5 w-2.5 bg-safety ring-1 ring-ink" />}
      </p>
      <p className="mt-1 text-[0.8rem] leading-snug text-ink-soft">{label}</p>
    </>
  );
  const cls = "block border-concrete-deep px-4 py-3 [&:not(:last-child)]:border-r";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-concrete`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Sessions({ rows, now }: { rows: Overview["sessions"]; now: number }) {
  const router = useRouter();
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-left text-[0.88rem]">
        <thead className="border-b border-concrete-deep text-[0.78rem] text-ink-soft">
          <tr>
            <th className="px-3 py-2 font-semibold">Started</th>
            <th className="px-3 py-2 font-semibold">Kitchen and agent</th>
            <th className="px-3 py-2 font-semibold">Door</th>
            <th className="px-3 py-2 font-semibold">Asked</th>
            <th className="px-3 py-2 font-semibold">Last step</th>
            <th className="px-3 py-2 font-semibold">Outcome</th>
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.requestId}
              onClick={() => router.push(`/ops/trace/${r.requestId}`)}
              className="cursor-pointer border-b border-concrete align-top last:border-0 hover:bg-concrete/60"
            >
              <td className="whitespace-nowrap px-3 py-2 tabular">
                <Link href={`/ops/trace/${r.requestId}`} className="font-semibold underline decoration-concrete-deep underline-offset-2" onClick={(e) => e.stopPropagation()}>
                  {when(r.startedAt)}
                </Link>
                <p className="text-[0.78rem] text-ink-soft">{since(r.lastAt, now)}</p>
              </td>
              <td className="px-3 py-2">
                <p className="font-semibold">{r.orgName}</p>
                <p className="text-[0.8rem] text-ink-soft">
                  {r.agentLabel}
                  {r.suspended && <span className="ml-1 bg-safety px-1 font-semibold text-safety-ink">suspended</span>}
                </p>
              </td>
              <td className="px-3 py-2">
                <ViaTag via={r.via} />
                <p className="mt-0.5">
                  <Licence licence={r.licence} />
                </p>
              </td>
              <td className="max-w-[30ch] px-3 py-2">“{fi(r.asked)}”</td>
              <td className="max-w-[34ch] px-3 py-2 text-ink-soft">{fi(r.doing)}</td>
              <td className="px-3 py-2">
                <Outcome kind={r.outcome.kind} label={fi(r.outcome.label)} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular">{r.totalCents !== undefined ? money(r.totalCents) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

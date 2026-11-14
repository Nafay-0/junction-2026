"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Overview } from "@/server/ops/views";
import { Target } from "../../_ui/target";
import { VIA, fi, money, num, since, when, whenSeconds, type Via } from "../_ui/format";
import { DoorGlyph, Empty, Licence, LiveMark, LoadError, Loading, Outcome, PageHead, Section, ViaTag, useNow, useOps } from "../_ui/kit";
import { Table } from "../_ui/parts";
import { FilterBar, useUrlState } from "../_ui/filters";
import { LIVE_TEXT } from "./live.text";
import { StartHere } from "../_ui/sample-bar";

const DOORS: Via[] = ["onsite", "mcp", "rest"];

export function LiveView() {
  const live = useOps<Overview>("/ops-api/overview", { pollMs: 2000 });
  const now = useNow();
  const o = live.data;
  return (
    <>
      <PageHead
        title={LIVE_TEXT.en.title}
        purpose={LIVE_TEXT.en.purpose}
        right={o && <LiveMark at={whenSeconds(o.at)} error={live.error} />}
      />
      <StartHere />
      <LoadError message={live.error} />
      {!o ? <Loading /> : <Body o={o} now={now ?? Date.parse(o.at)} />}
    </>
  );
}

function Body({ o, now }: { o: Overview; now: number }) {
  const c = o.counters;
  return (
    <>
      <DoorsToGate o={o} />

      <Section title="At the door now" aside={`Agents seen in the last 30 minutes${c.suspended ? `; ${c.suspended} suspension${c.suspended > 1 ? "s" : ""} in force` : ""}`}>
        {o.atDoor.length === 0 ? (
          <Empty
            title={LIVE_TEXT.en.emptyTitle}
            action={
              <>
                <Link className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol" href="/k/kaari">
                  Open Ravintola Kaari&apos;s shop
                </Link>
                <Link className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol" href="/wall">
                  Show the wall&apos;s join code
                </Link>
              </>
            }
          >
            {LIVE_TEXT.en.empty} To send one in, see <Link href="/try">Try it as an outside agent</Link>.
          </Empty>
        ) : (
          <Table label="Agents at the door">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Door</th>
                <th>Licence</th>
                <th>Doing now</th>
                <th className="text-right">Calls</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {o.atDoor.map((a) => (
                <tr key={a.agentId}>
                  <td>
                    <p className="font-semibold">{a.agentLabel === a.agentId ? "An unnamed agent" : a.agentLabel}</p>
                    <p className="text-[0.85rem] text-ink-soft">{a.orgName}</p>
                  </td>
                  <td>
                    {a.vias.map((v) => (
                      <ViaTag key={v} via={v} className="mr-3 block" />
                    ))}
                  </td>
                  <td>
                    <Licence licence={a.licence} />
                  </td>
                  <td className="max-w-[38ch]">
                    {a.suspended ? (
                      <p className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0"><Target size={15} tone="safety" /></span>
                        <span>
                          <b>Suspended{a.suspended.scope === "org" ? " with its organisation" : ""}</b> since {when(a.suspended.since)}: <span className="text-ink-soft">“{a.suspended.reason}”</span>{" "}
                          <Link href="/ops/control" className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4">
                            Control
                          </Link>
                        </span>
                      </p>
                    ) : a.current ? (
                      <Link href={`/ops/trace/${a.current.requestId}`} className="text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                        {fi(a.current.doing)}
                      </Link>
                    ) : (
                      <span className="text-ink-soft">Connected, no request yet</span>
                    )}
                  </td>
                  <td className="text-right tabular">
                    {num(a.calls)}
                    {a.refused > 0 && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-safety-ink px-2 text-[0.76rem] font-semibold leading-5 text-safety">{a.refused} refused</span>}
                  </td>
                  <td className="whitespace-nowrap text-ink-soft tabular">{since(a.lastAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Requests" aside="Newest first. Open one to replay it station by station.">
        {o.sessions.length === 0 ? (
          <Empty title={LIVE_TEXT.en.requestsEmptyTitle}>{LIVE_TEXT.en.requestsEmpty}</Empty>
        ) : (
          <Sessions rows={o.sessions} now={now} />
        )}
      </Section>
    </>
  );
}

// ---------- three doors, one gate ----------

/** Remembers a number and says, for a moment, that it went up: a door that was just used lights its path. */
function useBumped(n: number, ms = 1600): boolean {
  const prev = useRef(n);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (n > prev.current) {
      queueMicrotask(() => setOn(true));
      const t = setTimeout(() => setOn(false), ms);
      prev.current = n;
      return () => clearTimeout(t);
    }
    prev.current = n;
  }, [n, ms]);
  return on;
}

/**
 * The diagram: three doors on the left, one gate in the middle, what came out on the right. Lines carry the calls;
 * a door that was just used lights its line, so a judge sees an outside agent arrive at the same gate.
 */
function DoorsToGate({ o }: { o: Overview }) {
  const c = o.counters;
  const lit = { onsite: useBumped(o.doors.onsite.calls), mcp: useBumped(o.doors.mcp.calls), rest: useBumped(o.doors.rest.calls) };
  const outs: { n: number; label: string; tone: "plain" | "person" | "gate"; href: string }[] = [
    { n: c.byAgentAlone, label: "Bought by the agent alone, inside its mandate", tone: "plain", href: "/ops/audit" },
    { n: c.byPerson, label: "Bought after a named person signed off", tone: "plain", href: "/ops/audit" },
    { n: c.waiting, label: "Waiting for a person to sign off", tone: c.waiting ? "person" : "plain", href: "/ops/control#waiting" },
    { n: c.refused, label: "Refused, each with the rule that refused it", tone: c.refused ? "gate" : "plain", href: "/ops/safeguards" },
  ];
  const doorY = [50, 150, 250];
  const outY = [37.5, 112.5, 187.5, 262.5];
  return (
    <section aria-labelledby="doors" className="overflow-hidden rounded-xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5 sm:px-6">
        <h2 id="doors" className="display text-[1.35rem] sm:text-[1.45rem]">
          Three doors, one gate
        </h2>
        <p className="text-[0.86rem] text-ink-soft">
          {num(c.requests)} requests so far; {num(c.liveCalls)} calls to the live price service; {o.catalogue.kind === "valio" ? `the partner's catalogue, ${num(o.catalogue.products)} products` : `the seed catalogue, ${num(o.catalogue.products)} products`}
        </p>
      </div>
      <div className="grid gap-y-3 px-5 pb-6 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_64px_minmax(0,0.9fr)_64px_minmax(0,1fr)] lg:gap-y-0">
        {/* doors */}
        <ul className="grid grid-rows-3 gap-2.5">
          {DOORS.map((v) => {
            const d = o.doors[v];
            return (
              <li key={v} className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-300 motion-reduce:transition-none ${lit[v] ? "border-petrol bg-petrol-soft" : "border-line"}`}>
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${lit[v] ? "bg-petrol text-paper" : "bg-surface text-petrol"}`}>
                  <DoorGlyph via={v} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">{VIA[v].label}</span>
                  <span className="mt-0.5 block text-[0.82rem] leading-snug text-ink-soft">{VIA[v].how}</span>
                </span>
                <span className="shrink-0 text-right tabular">
                  <span className="display block text-[1.45rem] leading-none">{num(d.calls)}</span>
                  <span className="mt-0.5 block text-[0.74rem] text-ink-soft">
                    calls, {d.agents} agent{d.agents === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <svg viewBox="0 0 64 300" preserveAspectRatio="none" aria-hidden className="hidden h-full w-full lg:block">
          {DOORS.map((v, i) => (
            <path key={v} d={`M0 ${doorY[i]} C 36 ${doorY[i]}, 28 150, 64 150`} fill="none" strokeLinecap="round" stroke={lit[v] ? "var(--color-petrol)" : "var(--color-line-strong)"} strokeWidth={lit[v] ? 4 : Math.max(1.5, Math.min(5, 1 + Math.log2(1 + o.doors[v].calls) * 0.7))} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* the gate */}
        <div className="hazard-frame on-dark flex flex-col justify-center text-paper">
          <div className="px-5 py-5">
            <p className="flex items-center gap-2.5">
              <Target size={28} tone="safety" />
              <span className="display text-[1.7rem] leading-none">The gate</span>
            </p>
            <ol className="mt-4 space-y-2 text-[0.9rem] leading-snug text-paper/85">
              {["The mandate the kitchen signed, checked at the door.", "Every rule, in plain code, on the exact order.", "Above the mandate, a named person on their phone."].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check aria-hidden size={15} strokeWidth={2.6} className="mt-[0.15em] shrink-0 text-lime" />
                  {line}
                </li>
              ))}
            </ol>
            <p className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.82rem] font-medium ${o.chain.ok ? "bg-paper/10 text-paper" : "bg-safety text-safety-ink"}`}>
              {o.chain.ok ? <ShieldCheck aria-hidden size={15} className="text-lime" /> : <Target size={14} tone="safety" />}
              {o.chain.ok ? `Ledger intact, ${num(o.chain.length)} entries` : `Ledger chain broken: ${o.chain.message}`}
            </p>
          </div>
        </div>
        <svg viewBox="0 0 64 300" preserveAspectRatio="none" aria-hidden className="hidden h-full w-full lg:block">
          {outs.map((x, i) => (
            <path key={x.label} d={`M0 150 C 36 150, 28 ${outY[i]}, 64 ${outY[i]}`} fill="none" strokeLinecap="round" stroke={x.tone === "gate" ? "var(--color-safety-ink)" : x.tone === "person" ? "var(--color-safety)" : "var(--color-line-strong)"} strokeWidth={Math.max(1.5, Math.min(5, 1 + Math.log2(1 + x.n) * 0.7))} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* what came out */}
        <ul className="grid grid-rows-4 gap-2.5">
          {outs.map((x) => (
            <li key={x.label}>
              <Link
                href={x.href}
                className={`flex h-full items-center gap-3.5 rounded-lg px-3.5 py-2.5 transition-colors duration-150 ${x.tone === "gate" ? "bg-safety-ink text-paper hover:bg-ink" : x.tone === "person" ? "bg-safety-soft ring-1 ring-inset ring-safety/60 hover:bg-safety/30" : "bg-surface hover:bg-petrol-soft"}`}
              >
                <span className={`display w-12 shrink-0 text-right text-[1.6rem] leading-none tabular ${x.tone === "gate" ? "text-safety" : ""}`}>{num(x.n)}</span>
                <span className="text-[0.9rem] font-medium leading-snug">{x.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------- requests: search and filter at once, state in the URL ----------

const SHOW = [
  { id: "all", label: "All" },
  { id: "committed", label: "Signed" },
  { id: "waiting", label: "Waiting on a person" },
  { id: "refused", label: "Refused" },
  { id: "open", label: "Still moving" },
] as const;

function Sessions({ rows, now }: { rows: Overview["sessions"]; now: number }) {
  const router = useRouter();
  const [q, setQ] = useUrlState("q", "");
  const [show, setShow] = useUrlState("show", "all");
  const needle = q.trim().toLowerCase();
  const kindOf = (k: string) => (k === "declined" ? "refused" : k === "cancelled" ? "open" : k);
  const shown = rows.filter(
    (r) => (show === "all" || kindOf(r.outcome.kind) === show) && (!needle || `${r.orgName} ${r.agentLabel} ${r.asked} ${r.doing} ${r.outcome.label} ${r.requestId}`.toLowerCase().includes(needle)),
  );
  const counts = Object.fromEntries(SHOW.map((s) => [s.id, s.id === "all" ? rows.length : rows.filter((r) => kindOf(r.outcome.kind) === s.id).length]));
  return (
    <>
      <FilterBar
        q={q}
        setQ={setQ}
        placeholder="Kitchen, agent, words asked, outcome"
        options={SHOW.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] }))}
        value={show}
        setValue={setShow}
        result={`${shown.length} of ${rows.length}`}
      />
      {shown.length === 0 ? (
        <Empty title="Nothing matches">Clear the search or choose All to see every request.</Empty>
      ) : (
        <Table label="Requests">
          <thead>
            <tr>
              <th>Started</th>
              <th>Kitchen and agent</th>
              <th>Door</th>
              <th>Asked</th>
              <th>Last step</th>
              <th>Outcome</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.requestId} onClick={() => router.push(`/ops/trace/${r.requestId}`)} className="cursor-pointer hover:bg-mist">
                <td className="whitespace-nowrap tabular">
                  <Link href={`/ops/trace/${r.requestId}`} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol" onClick={(e) => e.stopPropagation()}>
                    {when(r.startedAt)}
                  </Link>
                  <p className="text-[0.82rem] text-ink-soft">{since(r.lastAt, now)}</p>
                </td>
                <td>
                  <p className="font-semibold">{r.orgName}</p>
                  <p className="text-[0.85rem] text-ink-soft">
                    {r.agentLabel}
                    {r.suspended && <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-safety px-2 text-[0.74rem] font-semibold leading-5 text-safety-ink">suspended</span>}
                  </p>
                </td>
                <td>
                  <ViaTag via={r.via} short />
                </td>
                <td className="max-w-[32ch]">“{fi(r.asked)}”</td>
                <td className="max-w-[34ch] text-ink-soft">{fi(r.doing)}</td>
                <td className="min-w-[14rem]">
                  <Outcome kind={r.outcome.kind} label={fi(r.outcome.label)} />
                </td>
                <td className="whitespace-nowrap text-right tabular">{r.totalCents !== undefined ? money(r.totalCents) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LagReport, StreamMessage } from "@/server/aiven/showcase/stream";
import { api } from "../../../../_client/api";
import { LoadError, PageHead, Panel, Section } from "../../../_ui/kit";
import { Mono, PlatformTabs, Status } from "../_parts/parts";

type Tail = { messages: StreamMessage[]; error: string | null; warming: boolean; lag: LagReport };

/**
 * The stream: dock.actions on Kafka as the gate produces it, read server side, with the telemetry sink's committed
 * offsets and lag per partition: events produced by the gate, consumed into PostgreSQL.
 */
export function StreamView() {
  const [msgs, setMsgs] = useState<StreamMessage[]>([]);
  const [lag, setLag] = useState<LagReport>();
  const [error, setError] = useState<string>();
  const [warming, setWarming] = useState(true);
  const [paused, setPaused] = useState(false);
  const last = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (paused) return;
    let stop = false;
    const tick = async () => {
      const r = await api<Tail>("GET", `/ops-api/platform/stream${last.current ? `?after=${last.current}` : ""}`);
      if (stop) return;
      if (!r.ok) {
        setError(r.error.message);
      } else {
        setError(r.data.error ?? undefined);
        setWarming(r.data.warming);
        setLag(r.data.lag);
        if (r.data.messages.length) {
          const tail = r.data.messages.at(-1)!;
          last.current = `${tail.partition}:${tail.offset}`;
          setMsgs((m) => [...m, ...r.data.messages].slice(-200));
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2_500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [paused]);

  const newest = [...msgs].reverse();
  return (
    <>
      <PageHead title="The stream" purpose="Every agent action and gate decision is one message on Kafka (topic dock.actions), keyed by order or request so one order stays in order. A consumer group writes each into PostgreSQL, where the dashboards read it. This page reads the topic itself, through the server." />
      <PlatformTabs />
      <LoadError message={error} />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <div className="flex items-center justify-between border-b border-concrete px-4 py-2">
            <p className="text-[0.86rem]">
              <b>Live tail</b> <span className="text-ink-soft">newest first, {msgs.length} shown{warming ? ", joining the topic…" : ""}</span>
            </p>
            <button type="button" onClick={() => setPaused((p) => !p)} className="text-[0.84rem] font-semibold underline underline-offset-2">
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
          <ol className="max-h-[70vh] divide-y divide-concrete overflow-y-auto">
            {newest.map((m) => (
              <li key={`${m.partition}:${m.offset}`} className={`grid grid-cols-[5.2rem_4.5rem_minmax(0,1fr)] gap-2 px-4 py-1.5 text-[0.82rem] ${m.kind === "gate.refused" ? "shadow-[inset_4px_0_0_var(--color-safety)]" : ""}`}>
                <span className="tabular text-ink-soft">{m.timestamp.slice(11, 23)}</span>
                <span className="font-mono text-[0.74rem] text-ink-soft" title="partition : offset">
                  p{m.partition}:{m.offset}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold">{m.kind}</span>
                  {m.event.rule && <span className="ml-1.5 font-mono text-[0.74rem]">{m.event.rule}</span>}
                  {m.event.agentId && <span className="ml-1.5 text-ink-soft">{m.event.agentId}</span>}
                  {m.event.requestId && (
                    <Link href={`/ops/trace/${m.event.requestId}`} className="ml-1.5 font-mono text-[0.72rem] underline decoration-concrete-deep underline-offset-2">
                      {m.event.requestId}
                    </Link>
                  )}
                  {m.event.summary && <span className="block truncate text-[0.78rem] text-ink-soft">{m.event.summary}</span>}
                </span>
              </li>
            ))}
            {!newest.length && <li className="px-4 py-6 text-[0.88rem] text-ink-soft">{warming ? "Joining dock.actions; the last messages of each partition appear in a few seconds." : "No messages yet. Send in an Aiven agent and watch them arrive."}</li>}
          </ol>
        </Panel>
        <aside className="space-y-3">
          <Panel className="px-4 py-3">
            <h2 className="font-display text-[1.05rem] font-bold">Consumer lag</h2>
            {lag ? (
              <>
                <p className="mt-1 flex items-center gap-2 text-[0.9rem]">
                  <Status ok={lag.totalLag === null ? null : lag.totalLag < 50} label={lag.totalLag === null ? "group has not committed yet" : `${lag.totalLag} behind`} />
                  <span className="text-ink-soft">group {lag.group}</span>
                </p>
                <table className="mt-2 w-full text-[0.82rem] tabular">
                  <thead>
                    <tr className="border-b border-ink text-left">
                      <th className="py-1">partition</th>
                      <th>end</th>
                      <th>committed</th>
                      <th>lag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lag.partitions.map((p) => (
                      <tr key={p.partition} className="border-b border-concrete">
                        <td className="py-1">{p.partition}</td>
                        <td>{p.end}</td>
                        <td>{p.committed ?? "–"}</td>
                        <td className="font-semibold">{p.lag ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[0.78rem] text-ink-soft">
                  {lag.totalMessages.toLocaleString("fi-FI")} messages on the topic. End = the next offset the gate will produce; committed = how far the sink has written into <Mono>telemetry.events</Mono>.
                </p>
              </>
            ) : (
              <p className="mt-1 text-[0.86rem] text-ink-soft">Reading offsets…</p>
            )}
          </Panel>
          <Panel className="px-4 py-3 text-[0.84rem] leading-snug">
            <h2 className="font-display text-[1.05rem] font-bold">Replay from the stream</h2>
            <p className="mt-1">
              The trace view reads a request&apos;s events back from Kafka in order, with each message&apos;s partition and offset beside its step (<Mono>/ops-api/platform/stream/request/&lt;id&gt;</Mono>). Any partition can also be read by offset range: <Mono>/ops-api/platform/stream/range?partition=1&amp;from=0&amp;to=50</Mono>.
            </p>
            <p className="mt-1 text-ink-soft">Free Kafka plan: 5 topics of 2 partitions, about 250 KiB/s; the producer paces itself at 150 KiB/s.</p>
          </Panel>
        </aside>
      </div>
      <Section title="What each message carries" aside="schema v1">
        <Panel className="px-4 py-3 text-[0.84rem]">
          <p>
            <Mono>v, eventId, at, kind, key, agentId, orgId, requestId, orderId, rule, value, ok, ledgerSeq, ledgerHash, summary</Mono>. <Mono>ledgerSeq</Mono> and <Mono>ledgerHash</Mono> point at the hash-chained ledger entry the event came from, so the stream and the audit record can be checked against each other. Intake steps that can quote a kitchen&apos;s memory are shown by kind only.
          </p>
        </Panel>
      </Section>
    </>
  );
}

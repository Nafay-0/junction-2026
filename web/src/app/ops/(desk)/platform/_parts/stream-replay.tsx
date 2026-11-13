"use client";

import { useState } from "react";
import type { StreamMessage } from "@/server/aiven/showcase/stream";
import { api } from "../../../../_client/api";
import { Button } from "../../../_ui/kit";

type Replay = { requestId: string; ledgerSteps: number; messages: StreamMessage[]; ranges: { partition: number; from: string; to: string }[]; complete: boolean };

/**
 * For the trace view: the same request read back from Kafka (dock.actions) in the gate's order, each step with the
 * partition and offset it sits at. The step the replay is on is marked, so the stream and the ledger can be compared.
 */
export function StreamReplay({ requestId, currentSeq }: { requestId: string; currentSeq?: number }) {
  const [data, setData] = useState<Replay>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  async function load() {
    setBusy(true);
    setProblem(undefined);
    const r = await api<Replay>("GET", `/ops-api/platform/stream/request/${requestId}`);
    setBusy(false);
    if (!r.ok) setProblem(r.error.message);
    else setData(r.data);
  }
  return (
    <div className="border-t-[3px] border-petrol bg-paper px-4 py-4">
      <h2 className="display text-[1.3rem]">The same steps on Kafka</h2>
      {!data ? (
        <>
          <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">Read this request back from Kafka (topic dock.actions), in order, with each message&apos;s partition and offset.</p>
          <Button className="mt-2" onClick={load} disabled={busy}>
            {busy ? "Reading from Kafka…" : "Read from the stream"}
          </Button>
          {problem && <p className="mt-1.5 text-[0.82rem]">{problem}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-[0.84rem]">
            <b>{data.messages.length}</b> messages for {data.ledgerSteps} ledger steps{data.complete ? "" : " (read stopped at the time limit)"}; read offsets {data.ranges.map((r) => `p${r.partition} ${r.from}–${r.to}`).join(", ")}.
          </p>
          <ol className="mt-1.5 max-h-[320px] space-y-0.5 overflow-y-auto text-[0.78rem]">
            {data.messages.map((m) => {
              const on = currentSeq !== undefined && m.event.ledgerSeq === currentSeq;
              return (
                <li key={`${m.partition}:${m.offset}`} className={`grid grid-cols-[3.6rem_minmax(0,1fr)_2.4rem] gap-1.5 px-1 ${on ? "bg-petrol text-paper" : ""}`}>
                  <span className="font-mono">
                    p{m.partition}:{m.offset}
                  </span>
                  <span className="truncate font-semibold">{m.kind}</span>
                  <span className="text-right tabular" title="ledger entry">
                    #{m.event.ledgerSeq ?? "–"}
                  </span>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={load} className="mt-1 text-[0.85rem] font-semibold text-petrol underline underline-offset-2">
            Read again
          </button>
        </>
      )}
    </div>
  );
}

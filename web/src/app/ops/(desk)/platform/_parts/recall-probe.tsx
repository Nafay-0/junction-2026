"use client";

import { useState } from "react";
import type { ProbeRun } from "@/server/search/probe-run";
import { api } from "../../../../_client/api";
import { whenSeconds } from "../../../_ui/format";
import { Button, useOps } from "../../../_ui/kit";

const ms = (v: number) => `${v.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ms`;

/** "Time both search backends": the last run on this server, and a button to run it again (one a minute). */
export function RecallProbe() {
  const live = useOps<{ last: ProbeRun | null }>("/ops-api/platform/recall-probe", { pollMs: 30_000 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [run, setRun] = useState<ProbeRun>();
  const last = run ?? live.data?.last ?? undefined;
  async function go() {
    setBusy(true);
    setErr(undefined);
    const r = await api<{ last: ProbeRun }>("POST", "/ops-api/platform/recall-probe");
    setBusy(false);
    if (r.ok) setRun(r.data.last);
    else setErr(r.error.message);
  }
  const x = last?.result;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.84rem] font-medium text-ink-soft">About 30 queries from the evaluation, through both, here; query embeddings only, no judge</p>
        <Button staff onClick={go} disabled={busy}>
          {busy ? "Timing…" : "Time both search backends"}
        </Button>
      </div>
      {err && <p className="mt-1 text-[0.88rem] font-semibold">{err}</p>}
      {x ? (
        <div className="mt-2 text-[0.9rem]">
          <p>
            <b>{x.reading}</b>
          </p>
          <table className="mt-1 w-full text-[0.86rem] tabular">
            <thead className="text-left text-ink-soft">
              <tr>
                <th className="font-medium">recall</th>
                <th className="font-medium">p50</th>
                <th className="font-medium">p90</th>
                <th className="font-medium">max</th>
                <th className="font-medium">over {x.deadlineMs} ms</th>
                <th className="font-medium">end to end p50 / p90</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>memory</td>
                <td>{ms(x.memory.p50)}</td>
                <td>{ms(x.memory.p90)}</td>
                <td>{ms(x.memory.max)}</td>
                <td>–</td>
                <td>
                  {ms(x.endToEnd.memory.p50)} / {ms(x.endToEnd.memory.p90)}
                </td>
              </tr>
              <tr>
                <td>OpenSearch</td>
                <td>{ms(x.opensearch.p50)}</td>
                <td>{ms(x.opensearch.p90)}</td>
                <td>{ms(x.opensearch.max)}</td>
                <td>
                  {x.opensearch.timedOut}
                  {x.opensearch.failed ? `, ${x.opensearch.failed} failed` : ""}
                </td>
                <td>
                  {ms(x.endToEnd.opensearch.p50)} / {ms(x.endToEnd.opensearch.p90)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[0.8rem] text-ink-soft">
            Ran {whenSeconds(x.at)} by {last!.by}, {x.queries} queries; setting in force: {last!.setting}. Candidate lists overlap {Math.round(x.overlap * 100)} %; candidates p50 {x.memory.candidates.p50} and {x.opensearch.candidates.p50}. End to end = embedding (p50 {ms(x.embed.p50)}) + recall + the judge&apos;s {ms(x.endToEnd.judgeMs)} ({x.endToEnd.judgeFrom}).
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[0.86rem] text-ink-soft">Not run on this server since it started.</p>
      )}
    </div>
  );
}

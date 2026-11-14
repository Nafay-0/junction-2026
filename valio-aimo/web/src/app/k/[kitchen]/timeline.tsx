"use client";

import { useState } from "react";
import { api } from "../../_client/api";
import { verifyChain, type ChainCheck } from "../../_client/verify-chain";
import { useFormat, useText } from "../../_i18n/provider";
import { clockSeconds, say } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { TIMELINE_TEXT } from "./timeline.text";
import { Button } from "./ui";
import type { Entry, LedgerReply } from "./types";

/** "What the agent did and why": this request's ledger entries in plain words, and a chain check run in the browser. */
export function Timeline({ entries, names, agentName, kitchen, check = true }: { entries: Entry[]; names: Record<string, string>; agentName: string; kitchen: string; check?: boolean }) {
  const tx = useText(TIMELINE_TEXT);
  const f = useFormat();
  return (
    <div>
      <ol className="divide-y divide-line">
        {entries.map((e) => {
          const reasons = Array.isArray(e.data.reasons) ? (e.data.reasons as unknown[]).map(String) : [];
          return (
            <li key={e.seq} className="grid grid-cols-[4.6rem_1fr] gap-x-3 py-2.5 sm:grid-cols-[5.2rem_9rem_1fr]">
              <span className="pt-px text-[0.9rem] text-ink-soft tabular">{clockSeconds(e.at)}</span>
              <span className="col-start-2 text-[0.9rem] font-semibold sm:col-start-auto sm:pt-px">{f.actor(e.actor, { agent: agentName })}</span>
              <div className="col-start-2 min-w-0 sm:col-start-auto">
                <p className="leading-snug">{say(e.summary, names)}</p>
                {reasons.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[0.95rem] leading-snug text-ink-soft">
                    {reasons.slice(0, 6).map((r, i) => (
                      <li key={i} className="pl-3 [text-indent:-0.75rem]">
                        – {say(r, names)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <details className="mt-2 text-[0.92rem]">
        <summary className="cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">{tx.raw}</summary>
        <div className="mt-2 max-h-80 overflow-auto bg-concrete p-3">
          {entries.map((e) => (
            <div key={e.seq} className="mb-2 break-all font-mono text-[0.78rem] leading-snug">
              #{e.seq} {e.type} {e.actor}
              <br />
              {e.summary}
              <br />
              hash {e.hash.slice(0, 24)}… prev {e.prevHash.slice(0, 12)}…
            </div>
          ))}
        </div>
      </details>
      {check && <ChainCheckBox kitchen={kitchen} />}
    </div>
  );
}

type Result = { check: ChainCheck; ms: number; tampered?: number };

function ChainCheckBox({ kitchen }: { kitchen: string }) {
  const tx = useText(TIMELINE_TEXT);
  const [busy, setBusy] = useState<"verify" | "tamper" | null>(null);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();

  async function run(tamper: boolean) {
    setBusy(tamper ? "tamper" : "verify");
    setError(undefined);
    const r = await api<LedgerReply>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen)}/call`, { method: "GET", path: "/api/v1/ledger" });
    if (!r.ok) {
      setError(r.error.message);
      setBusy(null);
      return;
    }
    const entries = structuredClone(r.data.entries);
    let tampered: number | undefined;
    if (tamper) {
      // Change one past gate decision in this browser's copy only, the way a quiet edit would.
      const victim = [...entries].reverse().find((e) => e.type === "decision") ?? entries.at(-1);
      if (victim) {
        victim.data = { ...victim.data, outcome: "auto_approve", reasons: ["Approved (edited afterwards)"] };
        tampered = victim.seq;
      }
    }
    const t0 = performance.now();
    const check = await verifyChain(entries);
    setResult({ check, ms: Math.max(1, Math.round(performance.now() - t0)), tampered });
    setBusy(null);
  }

  return (
    <div className="mt-4 border-t-[3px] border-petrol pt-3">
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={busy === "verify"} disabled={!!busy} onClick={() => void run(false)}>
          {tx.check}
        </Button>
        <Button kind="secondary" busy={busy === "tamper"} disabled={!!busy} onClick={() => void run(true)}>
          {tx.tamper}
        </Button>
      </div>
      <div aria-live="polite" className="min-h-[3.25rem] pt-2">
        {error && <p className="text-ink-soft">{tx.readFailed(error)}</p>}
        {result?.check.ok && (
          <p className="flex items-start gap-2 leading-snug">
            <Target size={22} tone="ink" className="mt-0.5 shrink-0" />
            <span>
              <strong>{tx.allOk(result.check.length)}</strong>
              {tx.allOkDetail(result.ms)}
            </span>
          </p>
        )}
        {result && !result.check.ok && (
          <p className="flex items-start gap-2 leading-snug">
            <Target size={22} tone="safety" className="mt-0.5 shrink-0" />
            <span>
              <strong>{tx.caught}</strong> {result.check.message}
              {result.tampered !== undefined && tx.tamperedNote}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

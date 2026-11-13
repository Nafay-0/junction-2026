"use client";

import { useState } from "react";
import type { LedgerEntry } from "@/core/ledger";
import { api } from "../../_client/api";
import { Target } from "../../_ui/target";
import { num } from "./format";
import { Button } from "./kit";
import { checkChain, type ChainResult } from "./verify-client";

type LedgerDump = { entries: (LedgerEntry & { withheld?: string })[]; withheld: number; server: { ok: boolean; length: number; message?: string } };

/**
 * "Check the chain": fetches the whole ledger and re-hashes it in this browser, without taking the server's word.
 * Entries kept with the kitchen are checked by link. Reports per entry, so a trace can mark each step.
 */
export function ChainCheck({ onResult, compact = false }: { onResult?: (r: ChainResult, entries: LedgerDump["entries"]) => void; compact?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; result?: ChainResult; server?: LedgerDump["server"]; error?: string }>({ busy: false });

  async function run() {
    setState({ busy: true });
    const r = await api<LedgerDump>("GET", "/ops-api/ledger");
    if (!r.ok) return setState({ busy: false, error: r.error.message });
    const result = await checkChain(r.data.entries);
    setState({ busy: false, result, server: r.data.server });
    onResult?.(result, r.data.entries);
  }

  const res = state.result;
  return (
    <div className={compact ? "" : "border-t-[3px] border-petrol bg-paper px-4 py-4"}>
      {!compact && <h2 className="display mb-1 text-[1.3rem]">The ledger&apos;s chain</h2>}
      {!compact && <p className="mb-2 text-[0.9rem] text-ink-soft">Every entry hashes the one before it. Re-hash the whole chain here, without taking the server&apos;s word for it.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={state.busy}>
          <Target size={14} tone="ink" className={state.busy ? "spin" : ""} />
          {state.busy ? "Checking…" : res ? "Check the chain again" : "Check the chain in this browser"}
        </Button>
        {res && (
          <p className="text-[0.92rem]" role="status">
            {res.ok ? (
              <>
                <b>Intact.</b> {num(res.length)} entries followed from the first: {num(res.recomputed)} re-hashed here
                {res.linked ? `, ${num(res.linked)} checked by link (content kept with the kitchen)` : ""}.
              </>
            ) : (
              <span className="bg-safety-ink px-1.5 font-semibold text-safety">Broken at entry {res.brokenAt}: {res.message}</span>
            )}
          </p>
        )}
        {state.error && <p className="text-[0.88rem]">Could not read the ledger: {state.error}</p>}
      </div>
      {res && !compact && (
        <p className="mt-1.5 break-all font-mono text-[0.72rem] text-ink-soft">
          SHA-256 over canonical JSON, each entry over the one before. Head {res.headHash?.slice(0, 16)}… Server says {state.server?.ok ? "intact" : `broken: ${state.server?.message}`}.
        </p>
      )}
    </div>
  );
}

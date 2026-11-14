"use client";

import Link from "next/link";
import { useState } from "react";
import type { AuditAnswer } from "@/server/ops/audit-search";
import { api } from "../../../_client/api";
import { whenSeconds } from "../../_ui/format";
import { Button, Section } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { SqlBox } from "../platform/_parts/parts";

const EXAMPLES = ["refusals for allergens by outside agents today", "sign-offs over the limit today", "refusals in the last hour", "corrections by kitchen agents today"];

/** The audit trail in words: OpenSearch first, the same filters in SQL when it is not there. */
export function AuditSearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<AuditAnswer>();
  const [err, setErr] = useState<string>();
  async function run(text: string) {
    if (!text.trim()) return;
    setQ(text);
    setBusy(true);
    setErr(undefined);
    const r = await api<AuditAnswer>("GET", `/ops-api/agents/search?q=${encodeURIComponent(text)}`);
    setBusy(false);
    if (r.ok) setA(r.data);
    else setErr(r.error.message);
  }
  return (
    <Section id="audit-search" title="Search the audit trail" aside="Codes, counts and times only: no buyer text is indexed">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <label htmlFor="audit-q" className="sr-only">
          Search the audit trail
        </label>
        <input id="audit-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="refusals for allergens by outside agents today" className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-[0.95rem]" />
        <Button type="submit" kind="primary" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </form>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.84rem] text-ink-soft">
        Try:
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="text-petrol underline decoration-petrol/30 underline-offset-4" onClick={() => void run(x)}>
            {x}
          </button>
        ))}
      </p>
      {err && <p className="mt-2 text-[0.9rem] font-semibold">{err}</p>}
      {a && (
        <div className="mt-3 space-y-2">
          <p className="text-[1rem]">
            <b>{a.answer}</b>
          </p>
          <p className="text-[0.84rem] text-ink-soft">
            Read as: {a.read.kinds.length ? a.read.kinds.join(", ") : "any event"}; rules {a.read.rules.length ? `with ${a.read.rules.join(" or ")}` : "any"}; {a.read.who}; {a.read.when}
            {a.read.text ? `; words "${a.read.text}"` : ""}. {a.pathNote} {a.ms} ms.
          </p>
          {a.hits.length > 0 && (
            <Table label="Matching events">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Rule</th>
                  <th>Agent</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {a.hits.slice(0, 15).map((h, i) => (
                  <tr key={i}>
                    <td className="tabular">{whenSeconds(h.ts)}</td>
                    <td>{h.kind}</td>
                    <td>{h.rule ?? "–"}</td>
                    <td>{h.agentLabel ?? h.agentId ?? "–"}</td>
                    <td>
                      {h.requestId ? (
                        <Link href={`/ops/trace/${h.requestId}`} className="text-petrol underline decoration-petrol/30 underline-offset-4">
                          Trace
                        </Link>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <SqlBox sql={a.query} summary={a.path === "opensearch" ? "The OpenSearch query" : "The SQL"} />
        </div>
      )}
    </Section>
  );
}

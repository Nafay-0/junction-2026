"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LauncherStatus, Run, RunMessage } from "@/server/aiven/showcase/launcher";
import type { StreamMessage } from "@/server/aiven/showcase/stream";
import { api } from "../../../../_client/api";
import { whenSeconds } from "../../../_ui/format";
import { Button, LoadError, Loading, PageHead, Panel, useOps } from "../../../_ui/kit";
import { OnAiven, PlatformTabs } from "../_parts/parts";

/**
 * Send in an Aiven agent: one action starts a buyer on Aiven's Managed Agents runtime with a plain-words task; staff
 * watch its tool calls arrive through Dock's MCP door, then open the request in the live view and trace.
 */
export function Launcher() {
  const status = useOps<LauncherStatus>("/ops-api/platform/agent", { pollMs: 4000 });
  const [runId, setRunId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const s = status.data;
  const current = runId ?? s?.runs[0]?.runId;

  async function start(preset: string) {
    setBusy(true);
    setProblem(undefined);
    const r = await api<{ run: Run }>("POST", "/ops-api/platform/agent", { preset });
    setBusy(false);
    if (!r.ok) setProblem(r.error.message);
    else setRunId(r.data.run.runId);
    status.refresh();
  }

  return (
    <>
      <PageHead title="Send in an Aiven agent" purpose="A purchasing agent that Dock does not run: it lives on Aiven's Managed Agents runtime, has its own model, and comes in through the MCP door with a mandate minted for this run. The gate treats it like any other buyer." right={<OnAiven />} />
      <PlatformTabs />
      <LoadError message={status.error} />
      {!s ? (
        <Loading />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-3">
            {s.presets.map((p) => (
              <Panel key={p.id} className="px-4 py-3">
                <p className="font-display text-[1.15rem] font-bold">{p.title}</p>
                <p className="mt-1 text-[0.9rem] leading-snug">&ldquo;{p.message}&rdquo;</p>
                <p className="mt-1 text-[0.82rem] text-ink-soft">Expect: {p.expect}</p>
                <Button kind="primary" className="mt-2" disabled={busy || Boolean(s.running)} onClick={() => start(p.id)}>
                  {s.blocked?.recording ? "Play the recording" : "Send it in"}
                </Button>
              </Panel>
            ))}
            {problem && <p className="border-l-4 border-safety bg-paper px-3 py-2 text-[0.88rem]">{problem}</p>}
            <Panel className="px-4 py-3 text-[0.84rem] leading-snug">
              <p>
                <b>{s.left}</b> of {s.perDay} runs left today on this server; one at a time, {s.gapS} s apart.
                {s.blocked && <span className="block font-semibold">{s.blocked.reason}{s.blocked.recording ? " Recorded runs play instead, marked as recordings." : ""}</span>}
              </p>
              <p className="mt-1.5 text-ink-soft">
                The agent: {s.agent.label} ({s.agent.id}), model {s.agent.model}. Its mandate is minted on this server for each run: {s.agent.org}, €1,000 per order alone, valid {s.agent.mandateMinutes} minutes, handed straight to Aiven&apos;s credential store; the signed token is never shown. It connects to {s.dockUrl.replace(/^https?:\/\//, "")}.
              </p>
              <p className="mt-1.5 text-ink-soft">{s.usageNote}</p>
              {!s.configured && <p className="mt-1.5 font-semibold">Not configured here ({s.missing.join(", ")}): only recordings play.</p>}
            </Panel>
          </div>
          <div>{current ? <RunView runId={current} dockUrl={s.dockUrl} /> : <EmptyRun />}</div>
        </div>
      )}
    </>
  );
}

function EmptyRun() {
  return (
    <Panel className="px-5 py-6">
      <p className="font-display text-[1.2rem] font-bold">No run yet</p>
      <p className="mt-1 text-[0.9rem] text-ink-soft">Pick a task on the left. Each step the agent takes on Aiven appears here as it happens: its tool calls into Dock and Dock&apos;s answers. About 30 seconds.</p>
    </Panel>
  );
}

function RunView({ runId, dockUrl }: { runId: string; dockUrl: string }) {
  const live = useOps<Run & { gate?: StreamMessage[] }>(`/ops-api/platform/agent/${runId}`, { pollMs: 1500 });
  const run = live.data;
  const [shown, setShown] = useState(0);
  // Recordings play back step by step, at most a second and a half apart.
  useEffect(() => {
    if (!run?.recorded || shown >= run.messages.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : 1400);
    return () => clearTimeout(t);
  }, [run, shown]);
  if (!run) return <Loading />;
  const messages = run.messages.slice(0, run.recorded ? shown : undefined);
  const sameHost = typeof window !== "undefined" && dockUrl.startsWith(window.location.origin);
  const traceHref = run.requestId ? `${sameHost || run.recorded ? "" : dockUrl}/ops/trace/${run.requestId}` : undefined;
  const ended = run.status === "done" || run.status === "failed";
  return (
    <Panel>
      <div className={`border-b border-concrete px-4 py-3 ${run.recorded ? "bg-concrete/60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          {run.recorded ? <span className="bg-ink px-1.5 py-0.5 text-[0.75rem] font-bold uppercase tracking-wide text-paper">Recording of a real run, {new Date(run.recordedAt!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : <OnAiven />}
          <span className="font-display text-[1.15rem] font-bold">{run.title}</span>
          <span className="text-[0.82rem] text-ink-soft">
            {run.recorded ? "played back" : run.status === "starting" ? "starting on Aiven…" : run.status === "running" ? "running on Aiven…" : run.status} · {run.model}
            {run.environment ? ` · ${run.environment}` : ""} · started {whenSeconds(run.startedAt)}
          </span>
        </div>
        <p className="mt-1 text-[0.9rem]">&ldquo;{run.question}&rdquo;</p>
        {run.error && <p className={`mt-1 text-[0.85rem] ${run.recorded ? "" : "bg-safety px-2 py-1 font-semibold text-safety-ink"}`}>{run.error}</p>}
      </div>
      <ol className="divide-y divide-concrete" aria-live="polite">
        {messages.map((m, i) => (
          <Message key={i} m={m} />
        ))}
        {!ended && !run.recorded && <li className="px-4 py-2 text-[0.85rem] text-ink-soft">The agent is working on Aiven; its own transcript arrives when it replies. Meanwhile, what the gate sees:</li>}
      </ol>
      {!run.recorded && (
        <div className="border-t border-concrete px-4 py-2">
          <p className="text-[0.8rem] font-semibold">At Dock&apos;s gate, live from Kafka (dock.actions, agent {run.gate === undefined ? "…" : "agent_laakso_aiven_01"})</p>
          {run.gate && run.gate.length ? (
            <ol className="mt-1 space-y-0.5 text-[0.8rem]">
              {run.gate.map((m) => (
                <li key={`${m.partition}:${m.offset}`} className={`grid grid-cols-[5.5rem_4.2rem_minmax(0,1fr)] gap-2 ${m.kind === "gate.refused" ? "bg-safety/60" : ""}`}>
                  <span className="tabular text-ink-soft">{m.timestamp.slice(11, 19)}</span>
                  <span className="font-mono text-[0.72rem] text-ink-soft">p{m.partition}:{m.offset}</span>
                  <span>
                    <b>{m.kind}</b>
                    {m.event.rule ? ` · ${m.event.rule}` : ""}
                    {m.event.summary ? <span className="text-ink-soft"> · {m.event.summary.slice(0, 120)}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-[0.8rem] text-ink-soft">No event from this agent on the topic yet.</p>
          )}
        </div>
      )}
      {(run.requestId || run.outcome) && (
        <div className="border-t-2 border-ink px-4 py-3 text-[0.9rem]">
          <p>
            <b>Outcome at the gate:</b> {outcomeWords(run.outcome)}
          </p>
          {run.requestId && (
            <p className="mt-1 flex flex-wrap gap-x-4">
              <a href={traceHref} className="font-semibold underline underline-offset-2">
                Open the trace of {run.requestId}
              </a>
              {!run.recorded && (
                <>
                  <Link href="/ops" className="underline underline-offset-2">
                    Live view
                  </Link>
                  <Link href="/ops/platform/stream" className="underline underline-offset-2">
                    Its events on Kafka
                  </Link>
                </>
              )}
            </p>
          )}
          {run.recorded && <p className="mt-1 text-[0.8rem] text-ink-soft">The trace of a recorded run is on the server it ran against; it may have restarted since.</p>}
        </div>
      )}
    </Panel>
  );
}

function outcomeWords(o?: string) {
  if (!o) return "not reached";
  if (o === "pending_approval") return "stopped for a named person's sign-off (over what the agent may spend alone).";
  if (o === "committed") return "committed within the mandate and signed.";
  if (o.startsWith("refused")) return `refused by the gate${o.includes(":") ? `, rule ${o.split(":")[1].trim()}` : ""}.`;
  return o;
}

function Message({ m }: { m: RunMessage }) {
  const tool = m.tool?.replace(/^dock-aiven_/, "").replace(/^dock_/, "");
  if (m.type === "tool_call")
    return (
      <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-1.5 text-[0.84rem]">
        <span className="tabular text-ink-soft">{m.at.slice(11, 19)}</span>
        <span>
          <span className="font-semibold">→ {tool}</span> <span className="break-all font-mono text-[0.74rem] text-ink-soft">{m.text.slice(0, 220)}</span>
        </span>
      </li>
    );
  if (m.type === "tool_return") {
    const refused = /"ok":false|policy_rejected|Error from MCP tool/.test(m.text);
    return (
      <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-1.5 text-[0.84rem] ${refused ? "shadow-[inset_4px_0_0_var(--color-safety)]" : ""}`}>
        <span className="tabular text-ink-soft">Dock</span>
        <span className="break-all font-mono text-[0.74rem]">{m.text.slice(0, 260)}</span>
      </li>
    );
  }
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-2 text-[0.9rem]">
      <span className="tabular text-ink-soft">{m.type === "user" ? "Buyer" : "Agent"}</span>
      <span className="whitespace-pre-wrap leading-snug">{m.text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").slice(0, 900)}</span>
    </li>
  );
}


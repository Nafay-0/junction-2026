"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LauncherStatus, Run, RunMessage } from "@/server/aiven/showcase/launcher";
import type { StreamMessage } from "@/server/aiven/showcase/stream";
import { api } from "../../../../_client/api";
import { clockSeconds, ruleTitle } from "../../../../_ui/plain";
import { fi, stamp, whenSeconds } from "../../../_ui/format";
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
      <PageHead title="Send in an Aiven agent" purpose="Send in a purchasing agent that AimoPilot does not run."
        about="A purchasing agent that AimoPilot does not run: it lives on Aiven's Managed Agents runtime, has its own model, and comes in through the MCP door with a mandate minted for this run. The gate treats it like any other buyer." right={<OnAiven />} />
      <PlatformTabs />
      <LoadError message={status.error} />
      {!s ? (
        <Loading />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-3">
            {s.presets.map((p, i) => (
              <Panel key={p.id} rule className="px-4 py-4">
                <p className="display text-[1.4rem] leading-tight">{p.title}</p>
                <p className="mt-2 rounded-lg bg-surface px-4 py-3 text-[0.98rem] leading-snug">&ldquo;{p.message}&rdquo;</p>
                <p className="mt-2 text-[0.88rem] text-ink-soft">What should happen: {fi(p.expect)}</p>
                <Button staff kind={i === 0 ? "go" : "primary"} size="md" className="mt-3" disabled={busy || Boolean(s.running)} onClick={() => start(p.id)}>
                  {busy ? "Starting on Aiven…" : s.blocked?.recording ? "Play the recording" : "Send in the agent"}
                </Button>
              </Panel>
            ))}
            {problem && <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-[0.92rem]">{problem}</p>}
            <Panel className="px-4 py-3 text-[0.9rem] leading-snug">
              <p>
                <b>{s.left}</b> of {s.perDay} runs left today on this server; one at a time, {s.gapS} s apart.
                {s.blocked && <span className="block font-semibold">{s.blocked.reason}{s.blocked.recording ? " Recorded runs play instead, marked as recordings." : ""}</span>}
              </p>
              <p className="mt-1.5 text-ink-soft">
                The agent: {s.agent.label} ({s.agent.id}), model {s.agent.model}. Its mandate is minted on this server for each run: {s.agent.org}, 1 000 € per order alone, valid {s.agent.mandateMinutes} minutes, handed straight to Aiven&apos;s credential store; the signed token is never shown. It connects to {s.dockUrl.replace(/^https?:\/\//, "")}.
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
    <Panel className="p-6">
      <p className="display text-[1.5rem]">No run yet</p>
      <p className="mt-1 max-w-[60ch] text-[0.98rem] text-ink-soft">Pick a task on the left. Each step the agent takes on Aiven appears here as it happens: its tool calls into AimoPilot and AimoPilot&apos;s answers. About 30 seconds.</p>
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
      <div className={`border-b border-line px-5 py-4 ${run.recorded ? "bg-surface/60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          {run.recorded ? <span className="border border-ink px-1.5 py-0.5 text-[0.82rem] font-semibold">Recording of a real run, {stamp(run.recordedAt!)}</span> : <OnAiven />}
          <span className="display text-[1.4rem]">{run.title}</span>
        </div>
        <p className="mt-1 flex items-center gap-2 text-[0.88rem] text-ink-soft">
          {!run.recorded && !(run.status === "done" || run.status === "failed") && <span aria-hidden className="breathe size-2.5 bg-petrol" />}
          {run.recorded ? "Played back" : run.status === "starting" ? "Starting on Aiven…" : run.status === "running" ? "Running on Aiven…" : run.status === "done" ? "Done" : run.status === "failed" ? "Failed" : run.status}, model {run.model}
          {run.environment ? `, ${run.environment}` : ""}, started {whenSeconds(run.startedAt)}
        </p>
        <p className="mt-2 rounded-lg bg-surface px-4 py-3 text-[0.98rem]">&ldquo;{run.question}&rdquo;</p>
        {run.error && <p className={`mt-2 text-[0.92rem] ${run.recorded ? "" : "rounded-lg bg-surface px-4 py-2.5 font-semibold"}`}>{run.error}</p>}
      </div>
      <ol className="divide-y divide-line/60" aria-live="polite">
        {messages.map((m, i) => (
          <Message key={i} m={m} />
        ))}
        {!ended && !run.recorded && <li className="px-4 py-2 text-[0.85rem] text-ink-soft">The agent is working on Aiven; its own transcript arrives when it replies. Meanwhile, what the gate sees:</li>}
      </ol>
      {!run.recorded && (
        <div className="border-t border-line bg-surface/60 px-5 py-4">
          <p className="text-[0.88rem] font-semibold">At AimoPilot&apos;s gate, live from Kafka (dock.actions, agent {run.gate === undefined ? "…" : "agent_laakso_aiven_01"})</p>
          {run.gate && run.gate.length ? (
            <ol className="mt-1.5 space-y-0.5 text-[0.88rem]">
              {run.gate.map((m) => (
                <li key={`${m.partition}:${m.offset}`} className={`grid grid-cols-[5.5rem_4.2rem_minmax(0,1fr)] gap-2 px-1 ${m.kind === "gate.refused" ? "bg-safety-ink text-paper" : ""}`}>
                  <span className="tabular text-ink-soft">{clockSeconds(m.timestamp)}</span>
                  <span className="font-mono text-[0.72rem] text-ink-soft">p{m.partition}:{m.offset}</span>
                  <span>
                    <b>{m.kind}</b>
                    {m.event.rule ? `, ${ruleTitle(m.event.rule).toLowerCase()}` : ""}
                    {m.event.summary ? <span className={m.kind === "gate.refused" ? "text-paper/80" : "text-ink-soft"}>: {fi(m.event.summary).slice(0, 120)}</span> : null}
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
        <div className={`border-t px-4 py-3 text-[0.95rem] ${run.outcome === "pending_approval" ? "border-t-0" : "border-line/70"}`}>
          {run.outcome === "pending_approval" && <div aria-hidden className="hazard -mx-4 -mt-3 mb-3 h-2.5" />}
          <p>
            <b>Outcome at the gate:</b> {outcomeWords(run.outcome)}
          </p>
          {run.requestId && (
            <p className="mt-1 flex flex-wrap gap-x-4">
              <a href={traceHref} className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                Replay its trace
              </a>
              {!run.recorded && (
                <>
                  <Link href="/ops" className="text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                    Live view
                  </Link>
                  <Link href="/ops/platform/stream" className="text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
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
  if (o.startsWith("refused")) return `refused by the gate${o.includes(":") ? `: ${ruleTitle(o.split(":")[1].trim()).toLowerCase()}` : ""}.`;
  return o;
}

function Message({ m }: { m: RunMessage }) {
  const tool = m.tool?.replace(/^dock-aiven_/, "").replace(/^dock_/, "");
  if (m.type === "tool_call")
    return (
      <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-1.5 text-[0.84rem]">
        <span className="tabular text-ink-soft">{clockSeconds(m.at)}</span>
        <span>
          <span className="font-semibold text-petrol">Calls {tool}</span> <span className="break-all font-mono text-[0.76rem] text-ink-soft">{m.text.slice(0, 220)}</span>
        </span>
      </li>
    );
  if (m.type === "tool_return") {
    const refused = /"ok":false|policy_rejected|Error from MCP tool/.test(m.text);
    return (
      <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-1.5 text-[0.88rem] ${refused ? "shadow-[inset_6px_0_0_var(--color-safety-ink)]" : ""}`}>
        <span className="tabular text-ink-soft">AimoPilot</span>
        <span className="break-all font-mono text-[0.76rem]">{m.text.slice(0, 260)}</span>
      </li>
    );
  }
  return (
    <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-4 py-2 text-[0.95rem] ${m.type === "user" ? "" : "bg-lavender/60"}`}>
      <span className={`font-semibold ${m.type === "user" ? "text-ink-soft" : "text-lavender-deep"}`}>{m.type === "user" ? "Buyer" : "Agent"}</span>
      <span className="whitespace-pre-wrap leading-snug">{m.text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").slice(0, 900)}</span>
    </li>
  );
}


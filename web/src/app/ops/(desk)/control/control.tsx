"use client";

import Link from "next/link";
import { useState } from "react";
import type { ControlView } from "@/server/ops/views";
import { api } from "../../../_client/api";
import { buttonClass } from "../../../_ui/kit";
import { clock } from "../../../_ui/plain";
import { fi, money, num, since, until, when, whenSeconds } from "../../_ui/format";
import { Button, Details, Empty, KV, LiveMark, LoadError, Loading, PageHead, Section, useNow, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { Target } from "../../../_ui/target";

type Suspension = ControlView["active"][number];

export function ControlScreen() {
  const live = useOps<ControlView>("/ops-api/control", { pollMs: 2000 });
  const now = useNow();
  const c = live.data;
  return (
    <>
      <PageHead
        title="Control"
        purpose="Stop an agent, or a whole organisation, with a reason: its next call over any door is refused, and the suspension is written to the ledger. Nothing is deleted; resume it here at any time."
        right={c && <LiveMark at={whenSeconds(c.at)} error={live.error} />}
      />
      <LoadError message={live.error} />
      {!c ? <Loading /> : <Body c={c} now={now ?? Date.parse(c.at)} refresh={live.refresh} />}
    </>
  );
}

function Body({ c, now, refresh }: { c: ControlView; now: number; refresh: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div>
        <Section title="Suspend" id="suspend">
          <SuspendForm
            agents={c.agents.filter((a) => !a.suspended).map((a) => ({ id: a.agentId, label: `${a.label}, ${a.orgName}${a.lastAt ? `, seen ${since(a.lastAt, now)}` : ""}` }))}
            orgs={c.orgs.filter((o) => !o.suspended).map((o) => ({ id: o.orgId, label: `${o.orgName}, ${o.agents} agent${o.agents === 1 ? "" : "s"}` }))}
            onDone={refresh}
          />
        </Section>

        <Section title="In force" aside={c.active.length ? `${c.active.length} suspension${c.active.length > 1 ? "s" : ""}` : undefined}>
          {c.active.length === 0 ? (
            <Empty title="No agent is suspended">Every agent with a valid mandate can call the gate. The gate still checks every order.</Empty>
          ) : (
            <ul className="space-y-3">
              {c.active.map((s) => (
                <ActiveRow key={s.suspensionId} s={s} now={now} onDone={refresh} />
              ))}
            </ul>
          )}
        </Section>

        {c.past.length > 0 && (
          <Section title="Resumed">
            <ol className="divide-y divide-line/70 bg-paper text-[0.92rem]">
              {c.past.map((s) => (
                <li key={s.suspensionId} className="grid gap-x-4 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <p>
                    <b>{s.label}</b> <span className="text-ink-soft">“{s.reason}”</span>
                  </p>
                  <p className="text-[0.85rem] text-ink-soft tabular sm:text-right">
                    Suspended {when(s.at)} by {s.by}; resumed {when(s.resumedAt)} by {s.resumedBy}
                    {s.resumeNote ? `: “${s.resumeNote}”` : ""}; {num(s.refusals)} call{s.refusals === 1 ? "" : "s"} refused meanwhile
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>

      <div>
        <Section id="waiting" title="Waiting for a customer's sign-off" aside={c.waiting.length ? `${c.waiting.length} order${c.waiting.length > 1 ? "s" : ""}` : undefined}>
          <div className="mb-3 border-l-[6px] border-petrol bg-paper px-4 py-3 text-[0.92rem] leading-snug">
            <p className="font-semibold">Operations never signs for a customer</p>
            <p className="mt-0.5 text-ink-soft">
              Staff here cannot approve or decline an order. Only the person the kitchen&apos;s mandate names can, on their own phone, and their proof covers exactly the order&apos;s lines and total. If the fixed price runs out first, the gate&apos;s re-check refuses the order and the agent asks for a new quote. A suspended agent&apos;s waiting orders stay the customer&apos;s to decide.
            </p>
          </div>
          {c.waiting.length === 0 ? (
            <Empty title="Nothing waiting">Orders over an agent&apos;s own limit, or with a substitute, wait here until the named person signs off.</Empty>
          ) : (
            <Table label="Orders waiting for a sign-off">
                <thead>
                  <tr>
                    <th>Kitchen</th>
                    <th>Who must sign</th>
                    <th className="text-right">Amount</th>
                    <th>Waited</th>
                    <th>Price holds</th>
                  </tr>
                </thead>
                <tbody>
                  {c.waiting.map((w) => {
                    const held = w.priceHeldUntil ? until(w.priceHeldUntil, now) : undefined;
                    return (
                      <tr key={w.approvalId}>
                        <td>
                          <p className="font-semibold">{w.orgName}</p>
                          <p className="text-[0.8rem] text-ink-soft">
                            {w.agentLabel}
                            {w.agentSuspended && <span className="ml-1.5 border border-safety-ink bg-safety px-1 text-[0.78rem] font-semibold text-safety-ink">agent suspended</span>}
                          </p>
                          {w.requestId && (
                            <Link href={`/ops/trace/${w.requestId}`} className="text-[0.85rem] font-semibold text-petrol underline underline-offset-2">
                              Open the trace
                            </Link>
                          )}
                        </td>
                        <td>
                          <p className="font-semibold">{w.approverName}</p>
                          <p className="text-[0.8rem] text-ink-soft">{w.approverRole}</p>
                          <Details summary="Why a person">
                            {w.reasons.map((r, i) => (
                              <p key={i} className="font-sans">
                                {fi(r)}
                              </p>
                            ))}
                          </Details>
                        </td>
                        <td className="whitespace-nowrap text-right font-semibold tabular">{money(w.totalCents)}</td>
                        <td className="whitespace-nowrap tabular">
                          <span className="inline-flex items-center gap-1.5 bg-safety px-1.5 font-semibold text-safety-ink">
                            <span aria-hidden className="breathe size-2 bg-safety-ink" />
                            {since(w.requestedAt, now).replace(" ago", "")}
                          </span>
                          <p className="text-[0.78rem] text-ink-soft">since {when(w.requestedAt)}</p>
                        </td>
                        <td className="tabular">
                          {held ? (
                            <>
                              <p className={held.expired ? "font-semibold" : ""}>{held.expired ? "Price expired" : held.text}</p>
                              <p className="text-[0.78rem] text-ink-soft">{held.expired ? "the re-check will refuse it" : `until ${clock(w.priceHeldUntil!)}`}</p>
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </Table>
          )}
        </Section>
        <p className="mt-4 text-[0.82rem] text-ink-soft">
          {c.mode === "demo"
            ? "Demo entry: anyone with this server's address can open operations. Set DOCK_OPS_PASSCODE before a public demo."
            : "Operations on this server needs the passcode."}
        </p>
      </div>
    </div>
  );
}

/**
 * Suspending is a two-step act: choose and give a reason, then read exactly what will happen and confirm. The
 * confirmation is the gate's own slab, because a suspension is a refusal the staff sets; it also says how to undo it.
 */
function SuspendForm({ agents, orgs, onDone }: { agents: { id: string; label: string }[]; orgs: { id: string; label: string }[]; onDone: () => void }) {
  const [scope, setScope] = useState<"agent" | "org">("agent");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const options = scope === "agent" ? agents : orgs;
  const chosen = options.find((o) => o.id === target) ?? options[0];

  async function suspend() {
    if (!chosen) return;
    setBusy(true);
    setMsg(undefined);
    const r = await api<{ suspension: Suspension }>("POST", "/ops-api/control", { action: "suspend", scope, target: chosen.id, reason });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error.message });
    setMsg({ ok: true, text: `Suspended ${r.data.suspension.label}. Its next call is refused; resume it below when you are ready.` });
    setReason("");
    setTarget("");
    onDone();
  }

  return (
    <div className="bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen && reason.trim()) setConfirming(true);
        }}
        className="px-4 py-4"
      >
        <div role="radiogroup" aria-label="What to suspend" className="flex flex-wrap gap-1">
          {(
            [
              ["agent", "One agent", agents.length],
              ["org", "A whole organisation", orgs.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={scope === id}
              onClick={() => {
                setScope(id);
                setTarget("");
                setConfirming(false);
              }}
              className={`min-h-9 px-3 text-[0.92rem] font-semibold ${scope === id ? "bg-petrol text-paper" : "border-2 border-line text-ink hover:border-petrol"}`}
            >
              {label} <span className={scope === id ? "text-paper/80" : "text-ink-soft"}>{n}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[0.88rem] text-ink-soft">
          {scope === "agent" ? "Stops this agent only. Other agents of the same kitchen keep working." : "Stops every agent that presents a mandate from this organisation, its own on-site agent included."}
        </p>
        {options.length === 0 ? (
          <p className="mt-3 text-[0.92rem] text-ink-soft">Nothing to suspend: no {scope === "agent" ? "agent" : "organisation"} has come to the gate yet, or every one is already suspended.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[0.88rem] font-semibold">{scope === "agent" ? "Agent" : "Organisation"}</span>
              <select
                value={chosen?.id ?? ""}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setConfirming(false);
                }}
                className="mt-1 min-h-11 w-full border-2 border-line bg-paper px-2 text-[0.95rem] focus:border-petrol"
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[0.88rem] font-semibold">Reason, shown to the agent and written to the ledger</span>
              <input
                required
                maxLength={300}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConfirming(false);
                }}
                placeholder="Ordering in a loop since 14.00"
                className="mt-1 min-h-11 w-full border-2 border-line bg-paper px-3 text-[0.95rem] placeholder:text-ink-soft focus:border-petrol focus:outline-none"
              />
            </label>
          </div>
        )}
        {options.length > 0 && !confirming && (
          <Button type="submit" kind="primary" size="md" disabled={!reason.trim()} className="mt-3">
            Review the suspension
          </Button>
        )}
      </form>
      {confirming && chosen && (
        <div role="alertdialog" aria-labelledby="confirm-title" className="on-dark barrier-left bg-safety-ink px-4 pb-4 pt-0 text-paper">
          <div aria-hidden className="hazard -mx-4 mb-3 h-3" />
          <p id="confirm-title" className="flex items-center gap-2.5">
            <Target size={28} tone="safety" />
            <span className="display text-[1.5rem] leading-tight text-safety">Suspend {chosen.label.split(",")[0]}?</span>
          </p>
          <ul className="mt-2 space-y-1 text-[0.95rem] leading-snug text-paper/90">
            <li>Its next call, over any door, is refused with your reason: “{reason.trim()}”.</li>
            <li>Orders already waiting for a sign-off stay the customer&apos;s to decide.</li>
            <li>Nothing is deleted. Resume it from this page at any time; both acts are written to the ledger.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button kind="stop" size="md" onClick={suspend} disabled={busy}>
              {busy ? "Suspending…" : scope === "agent" ? "Suspend the agent" : "Suspend the organisation"}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("ghost-dark", "md")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p role="status" className={`border-t border-line/70 px-4 py-2.5 text-[0.92rem] ${msg.ok ? "" : "font-semibold"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function ActiveRow({ s, now, onDone }: { s: Suspension; now: number; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  async function resume() {
    setBusy(true);
    const r = await api("POST", "/ops-api/control", { action: "resume", suspensionId: s.suspensionId, note });
    setBusy(false);
    if (!r.ok) return setErr(r.error.message);
    onDone();
  }
  return (
    <li className="on-dark bg-safety-ink text-paper">
      <div aria-hidden className="hazard h-2.5" />
      <div className="grid gap-4 px-4 py-3 2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <p className="flex items-center gap-2 text-[0.88rem] font-semibold text-safety">
            <Target size={18} tone="safety" />
            {s.scope === "agent" ? "Agent suspended" : "Organisation suspended"}
          </p>
          <p className="display mt-1 text-[1.5rem] leading-tight">{s.label}</p>
          <p className="mt-1 text-[1rem]">“{s.reason}”</p>
          <p className="mt-1 text-[0.88rem] text-paper/75 tabular">
            By {s.by}, {when(s.at)}, {since(s.at, now)}. {num(s.refusals)} call{s.refusals === 1 ? "" : "s"} refused since{s.lastRefusalAt ? `, the last ${since(s.lastRefusalAt, now)}` : ""}.
          </p>
          <div className="mt-1 [&_summary]:text-paper/70 [&_div]:text-paper/70">
            <Details summary="Ids">
              <KV k="suspension" v={s.suspensionId} />
              <KV k={s.scope} v={s.target} />
              <KV k="rule" v="operator_suspension" />
            </Details>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 2xl:flex-col 2xl:flex-nowrap 2xl:items-stretch 2xl:justify-center [&>*]:min-w-[12rem] [&>*]:flex-1 2xl:[&>*]:flex-none">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note for the record (optional)"
            aria-label="Note for the record"
            className="min-h-10 border-2 border-paper/30 bg-transparent px-2 text-[0.92rem] text-paper placeholder:text-paper/55 focus:border-paper focus:outline-none"
          />
          <button type="button" onClick={resume} disabled={busy} className={buttonClass("ghost-dark", "md", "w-full disabled:opacity-50")}>
            {busy ? "Resuming…" : "Resume"}
          </button>
          {err && <p className="text-[0.85rem]">{err}</p>}
        </div>
      </div>
    </li>
  );
}

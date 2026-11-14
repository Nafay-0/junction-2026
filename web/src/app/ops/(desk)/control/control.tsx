"use client";

import Link from "next/link";
import { useState } from "react";
import type { ControlView } from "@/server/ops/views";
import { api } from "../../../_client/api";
import { Check, ChevronRight, CircleAlert, CirclePlay, ShieldCheck } from "lucide-react";
import { Badge, Select, buttonClass } from "../../../_ui/kit";
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
            <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper text-[0.92rem]">
              {c.past.map((s) => (
                <li key={s.suspensionId} className="flex gap-3.5 px-5 py-3.5">
                  <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
                    <CirclePlay size={16} />
                  </span>
                  <div className="min-w-0">
                  <p>
                    <b className="font-semibold">{s.label}</b> <span className="text-ink-soft">“{s.reason}”</span>
                  </p>
                  <p className="mt-0.5 text-[0.85rem] text-ink-soft tabular">
                    Suspended {when(s.at)} by {s.by}; resumed {when(s.resumedAt)} by {s.resumedBy}
                    {s.resumeNote ? `: “${s.resumeNote}”` : ""}; {num(s.refusals)} call{s.refusals === 1 ? "" : "s"} refused meanwhile
                  </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>

      <div>
        <Section id="waiting" title="Waiting for a customer's sign-off" aside={c.waiting.length ? `${c.waiting.length} order${c.waiting.length > 1 ? "s" : ""}` : undefined}>
          <div className="mb-4 flex gap-3.5 rounded-lg bg-petrol-soft px-4 py-3.5 text-[0.92rem] leading-snug">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-petrol text-paper">
              <ShieldCheck size={16} />
            </span>
            <div className="min-w-0">
            <p className="font-semibold">Operations never signs for a customer</p>
            <p className="mt-1 text-ink-soft">
              Staff here cannot approve or decline an order. Only the person the kitchen&apos;s mandate names can, on their own phone, and their proof covers exactly the order&apos;s lines and total. If the fixed price runs out first, the gate&apos;s re-check refuses the order and the agent asks for a new quote. A suspended agent&apos;s waiting orders stay the customer&apos;s to decide.
            </p>
            </div>
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
                            {w.agentSuspended && (
                              <span className="ml-1.5">
                                <Badge tone="refused">agent suspended</Badge>
                              </span>
                            )}
                          </p>
                          {w.requestId && (
                            <Link href={`/ops/trace/${w.requestId}`} className="mt-1 inline-flex items-center gap-1 text-[0.85rem] font-medium text-petrol hover:underline">
                              Open the trace <ChevronRight aria-hidden size={14} />
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
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-safety-soft px-2.5 text-[0.86rem] font-semibold leading-6 text-safety-ink ring-1 ring-inset ring-safety/60">
                            <span aria-hidden className="breathe size-1.5 rounded-full bg-safety-ink" />
                            {since(w.requestedAt, now).replace(" ago", "")}
                          </span>
                          <p className="mt-0.5 text-[0.78rem] text-ink-soft">since {when(w.requestedAt)}</p>
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
            ? "Demo entry: anyone with this server's address can open operations. Set a passcode before a public demo."
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
    <div className="overflow-hidden rounded-xl border border-line bg-paper">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen && reason.trim()) setConfirming(true);
        }}
        className="p-5"
      >
        <div role="radiogroup" aria-label="What to suspend" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1">
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
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[0.9rem] font-medium transition-[background-color,color,box-shadow] duration-150 pointer-coarse:min-h-10 ${scope === id ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}
            >
              {label} <span className={`tabular text-[0.78rem] ${scope === id ? "text-ink-soft" : "text-ink-faint"}`}>{n}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[0.88rem] text-ink-soft">
          {scope === "agent" ? "Stops this agent only. Other agents of the same kitchen keep working." : "Stops every agent that presents a mandate from this organisation, its own on-site agent included."}
        </p>
        {options.length === 0 ? (
          <p className="mt-3 text-[0.92rem] text-ink-soft">Nothing to suspend: no {scope === "agent" ? "agent" : "organisation"} has come to the gate yet, or every one is already suspended.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            <Select
              label={scope === "agent" ? "Agent" : "Organisation"}
              value={chosen?.id ?? ""}
              onChange={(v) => {
                setTarget(v);
                setConfirming(false);
              }}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <label className="block">
              <span className="mb-1.5 block text-[0.875rem] font-medium">Reason, shown to the agent and written to the ledger</span>
              <input
                required
                maxLength={300}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConfirming(false);
                }}
                placeholder="Ordering in a loop since 14.00"
                className="field"
              />
            </label>
          </div>
        )}
        {options.length > 0 && !confirming && (
          <Button type="submit" kind="primary" size="md" disabled={!reason.trim()} className="mt-4">
            Review the suspension
          </Button>
        )}
      </form>
      {confirming && chosen && (
        <div role="alertdialog" aria-labelledby="confirm-title" className="hazard-frame on-dark lane-enter mx-3 mb-3 text-paper">
          <div className="px-4 pb-4 pt-3.5">
          <p id="confirm-title" className="flex items-center gap-2.5">
            <Target size={28} tone="safety" />
            <span className="display text-[1.5rem] leading-tight text-safety">Suspend {chosen.label.split(",")[0]}?</span>
          </p>
          <ul className="mt-3 space-y-1.5 text-[0.95rem] leading-snug text-paper/90">
            <li>Its next call, over any door, is refused with your reason: “{reason.trim()}”.</li>
            <li>Orders already waiting for a sign-off stay the customer&apos;s to decide.</li>
            <li>Nothing is deleted. Resume it from this page at any time; both acts are written to the ledger.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button kind="stop" size="md" onClick={suspend} disabled={busy}>
              {busy ? "Suspending…" : scope === "agent" ? "Suspend the agent" : "Suspend the organisation"}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("ghost-dark", "md")}>
              Cancel
            </button>
          </div>
          </div>
        </div>
      )}
      {msg && (
        <p role="status" className={`flex items-start gap-2.5 border-t px-5 py-3 text-[0.92rem] ${msg.ok ? "border-good/15 bg-good-soft" : "border-bad/20 bg-bad-soft font-semibold"}`}>
          {msg.ok ? <Check aria-hidden size={17} className="mt-0.5 shrink-0 text-good" strokeWidth={2.6} /> : <CircleAlert aria-hidden size={17} className="mt-0.5 shrink-0 text-bad" />}
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
    <li className="hazard-frame on-dark text-paper">
      <div className="grid gap-4 px-5 pb-5 pt-4 2xl:grid-cols-[minmax(0,1fr)_16rem]">
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
          <div className="mt-1.5">
            <Details summary="Ids" dark>
              <KV k="suspension" v={s.suspensionId} />
              <KV k={s.scope} v={s.target} />
              <KV k="rule" v="operator_suspension" />
            </Details>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 2xl:flex-col 2xl:flex-nowrap 2xl:items-stretch 2xl:justify-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note for the record (optional)"
            aria-label="Note for the record"
            className="min-h-11 min-w-0 flex-[2_1_14rem] rounded-md border border-paper/25 bg-paper/[0.06] px-3.5 text-[0.92rem] text-paper placeholder:text-paper/55 focus:border-lime focus:shadow-[0_0_0_3px_rgb(192_224_33/0.25)] focus:outline-none"
          />
          <button type="button" onClick={resume} disabled={busy} className={buttonClass("ghost-dark", "md", "flex-[1_1_7rem] disabled:opacity-50")}>
            {busy ? "Resuming…" : "Resume"}
          </button>
          {err && <p className="text-[0.85rem]">{err}</p>}
        </div>
      </div>
    </li>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import type { ControlView } from "@/server/ops/views";
import { api } from "../../../_client/api";
import { fi, money, num, since, until, when, whenSeconds } from "../../_ui/format";
import { Button, Details, Empty, KV, LoadError, Loading, PageHead, Panel, Section, useNow, useOps } from "../../_ui/kit";

type Suspension = ControlView["active"][number];

export function ControlScreen() {
  const live = useOps<ControlView>("/ops-api/control", { pollMs: 2000 });
  const now = useNow();
  const c = live.data;
  return (
    <>
      <PageHead
        title="Control"
        purpose="Stop an agent or a whole organisation with one action and a reason. It takes effect on the agent's next call, over every door, and is written to the ledger. Resume it the same way."
        right={c && <span className="tabular">Updated {whenSeconds(c.at)}</span>}
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
        <Section title="Suspend">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <SuspendForm
              scope="agent"
              title="One agent"
              hint="Stops this agent only. Other agents of the same kitchen keep working."
              options={c.agents.filter((a) => !a.suspended).map((a) => ({ id: a.agentId, label: `${a.label}, ${a.orgName}${a.lastAt ? ` (seen ${since(a.lastAt, now)})` : ""}` }))}
              onDone={refresh}
            />
            <SuspendForm
              scope="org"
              title="A whole organisation"
              hint="Stops every agent presenting a mandate from this organisation, including its on-site agent."
              options={c.orgs.filter((o) => !o.suspended).map((o) => ({ id: o.orgId, label: `${o.orgName} (${o.agents} agent${o.agents === 1 ? "" : "s"})` }))}
              onDone={refresh}
            />
          </div>
        </Section>

        <Section title="In force" aside={c.active.length ? `${c.active.length} suspension${c.active.length > 1 ? "s" : ""}` : undefined}>
          {c.active.length === 0 ? (
            <Empty title="No agent is suspended">Every agent with a valid mandate can call the gate. The gate still checks every order.</Empty>
          ) : (
            <ul className="space-y-2">
              {c.active.map((s) => (
                <ActiveRow key={s.suspensionId} s={s} now={now} onDone={refresh} />
              ))}
            </ul>
          )}
        </Section>

        {c.past.length > 0 && (
          <Section title="Resumed">
            <Panel>
              <ul className="divide-y divide-concrete text-[0.86rem]">
                {c.past.map((s) => (
                  <li key={s.suspensionId} className="px-4 py-2">
                    <b>{s.label}</b> <span className="text-ink-soft">suspended {when(s.at)} by {s.by}: “{s.reason}”. Resumed {when(s.resumedAt)} by {s.resumedBy}{s.resumeNote ? `: “${s.resumeNote}”` : ""}. {num(s.refusals)} calls refused meanwhile.</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </Section>
        )}
      </div>

      <div>
        <Section title="Waiting for a customer's sign-off" aside={c.waiting.length ? `${c.waiting.length} order${c.waiting.length > 1 ? "s" : ""}` : undefined}>
          <div className="mb-3 border-2 border-ink bg-paper px-4 py-3 text-[0.9rem] leading-snug">
            <p className="font-display text-[1.05rem] font-bold">A stated limit: operations never signs for a customer</p>
            <p className="mt-0.5">
              Staff here cannot approve or decline an order. Only the person the kitchen&apos;s mandate names can, on their own phone, and their proof covers exactly the order&apos;s lines and total. If the fixed price runs out first, the gate&apos;s re-check refuses the order and the agent asks for a new quote. A suspended agent&apos;s waiting orders stay the customer&apos;s to decide.
            </p>
          </div>
          {c.waiting.length === 0 ? (
            <Empty title="Nothing waiting">Orders over an agent&apos;s own limit, or with a substitute, wait here until the named person signs off.</Empty>
          ) : (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[0.86rem]">
                <thead className="border-b border-concrete-deep text-[0.76rem] text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Kitchen</th>
                    <th className="px-3 py-2 font-semibold">Who must sign</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Waited</th>
                    <th className="px-3 py-2 font-semibold">Price holds</th>
                  </tr>
                </thead>
                <tbody>
                  {c.waiting.map((w) => {
                    const held = w.priceHeldUntil ? until(w.priceHeldUntil, now) : undefined;
                    return (
                      <tr key={w.approvalId} className="border-b border-concrete align-top last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-semibold">{w.orgName}</p>
                          <p className="text-[0.8rem] text-ink-soft">
                            {w.agentLabel}
                            {w.agentSuspended && <span className="ml-1 bg-safety px-1 font-semibold text-safety-ink">agent suspended</span>}
                          </p>
                          {w.requestId && (
                            <Link href={`/ops/trace/${w.requestId}`} className="text-[0.8rem] underline underline-offset-2">
                              Trace
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-2">
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
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular">{money(w.totalCents)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular">
                          <span className="bg-safety px-1 font-semibold text-safety-ink">{since(w.requestedAt, now).replace(" ago", "")}</span>
                          <p className="text-[0.78rem] text-ink-soft">since {when(w.requestedAt)}</p>
                        </td>
                        <td className="px-3 py-2 tabular">
                          {held ? (
                            <>
                              <p className={held.expired ? "font-semibold" : ""}>{held.expired ? "Price expired" : held.text}</p>
                              <p className="text-[0.78rem] text-ink-soft">{held.expired ? "the re-check will refuse it" : `until ${when(w.priceHeldUntil)}`}</p>
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
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

function SuspendForm({ scope, title, hint, options, onDone }: { scope: "agent" | "org"; title: string; hint: string; options: { id: string; label: string }[]; onDone: () => void }) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const chosen = target || options[0]?.id || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    const r = await api<{ suspension: Suspension }>("POST", "/ops-api/control", { action: "suspend", scope, target: chosen, reason });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error.message });
    setMsg({ ok: true, text: `Suspended ${r.data.suspension.label}. Its next call is refused.` });
    setReason("");
    setTarget("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="border border-concrete-deep bg-paper px-4 py-3">
      <p className="font-display text-[1.05rem] font-bold">{title}</p>
      <p className="text-[0.82rem] text-ink-soft">{hint}</p>
      {options.length === 0 ? (
        <p className="mt-2 text-[0.86rem] text-ink-soft">Nothing to suspend: no {scope === "agent" ? "agent" : "organisation"} has come to the gate, or all are suspended.</p>
      ) : (
        <>
          <label className="mt-2 block text-[0.82rem] font-semibold" htmlFor={`target-${scope}`}>
            {scope === "agent" ? "Agent" : "Organisation"}
          </label>
          <select id={`target-${scope}`} value={chosen} onChange={(e) => setTarget(e.target.value)} className="mt-0.5 w-full border border-concrete-deep bg-paper px-2 py-1.5 text-[0.88rem]">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="mt-2 block text-[0.82rem] font-semibold" htmlFor={`reason-${scope}`}>
            Reason, shown to the agent and written to the ledger
          </label>
          <input
            id={`reason-${scope}`}
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Ordering in a loop since 14.00"
            className="mt-0.5 w-full border border-concrete-deep bg-paper px-2 py-1.5 text-[0.88rem]"
          />
          <Button type="submit" kind="primary" disabled={busy || !reason.trim()} className="mt-2.5">
            {busy ? "Suspending…" : scope === "agent" ? "Suspend agent" : "Suspend organisation"}
          </Button>
        </>
      )}
      {msg && (
        <p role="status" className={`mt-2 text-[0.86rem] ${msg.ok ? "" : "bg-safety px-2 py-1 font-semibold text-safety-ink"}`}>
          {msg.text}
        </p>
      )}
    </form>
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
    <li className="border-2 border-ink bg-paper shadow-[inset_6px_0_0_var(--color-safety)]">
      <div className="grid gap-3 px-4 py-3 pl-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="inline-block bg-safety px-1.5 text-[0.78rem] font-bold text-safety-ink">{s.scope === "agent" ? "Agent suspended" : "Organisation suspended"}</p>
          <p className="mt-1 font-display text-[1.1rem] font-bold leading-tight">{s.label}</p>
          <p className="mt-0.5 text-[0.9rem]">“{s.reason}”</p>
          <p className="mt-0.5 text-[0.82rem] text-ink-soft tabular">
            By {s.by}, {when(s.at)} ({since(s.at, now)}). {num(s.refusals)} call{s.refusals === 1 ? "" : "s"} refused{s.lastRefusalAt ? `, the last ${since(s.lastRefusalAt, now)}` : ""}.
          </p>
          <Details summary="Ids" className="mt-1">
            <KV k="suspension" v={s.suspensionId} />
            <KV k={s.scope} v={s.target} />
            <KV k="rule" v="operator_suspension" />
          </Details>
        </div>
        <div className="flex flex-col gap-1.5 md:w-[15rem]">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note for the record (optional)" aria-label="Note for the record" className="border border-concrete-deep px-2 py-1.5 text-[0.86rem]" />
          <Button onClick={resume} disabled={busy}>
            {busy ? "Resuming…" : "Resume"}
          </Button>
          {err && <p className="text-[0.82rem]">{err}</p>}
        </div>
      </div>
    </li>
  );
}

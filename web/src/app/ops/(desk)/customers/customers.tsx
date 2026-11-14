"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentRow } from "@/server/ops/views";
import { fi, when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { Check, Eye, Search, Sparkles } from "lucide-react";
import { Avatar, Tag, buttonClass } from "../../../_ui/kit";
import { groupOf, proposeCorrection, readMemory, type MemoryItem, type MemoryState } from "../../_ui/memory";

const SOURCE: Record<string, string> = { stated: "stated by", confirmed: "confirmed by", learned: "learned from orders" };

/**
 * What the wholesaler knows about a kitchen: only what the kitchen shares (diet and allergen rules, products, brands
 * and packs, delivery days and hours, substitutes, standing orders), each with where it came from. Staff can propose
 * a correction; the kitchen confirms it or not. Staff cannot edit a kitchen's rules or see its private items.
 */
export function CustomersScreen({ orgId }: { orgId?: string }) {
  const agents = useOps<{ agents: AgentRow[] }>("/ops-api/agents", { pollMs: 8000 });
  const [q, setQ] = useState("");
  const all = agents.data?.agents ?? [];
  const orgs = [...new Map(all.filter((a) => a.orgId !== "unknown").map((a) => [a.orgId, { orgId: a.orgId, orgName: a.orgName, kind: a.kind }])).values()];
  const current = orgs.find((o) => o.orgId === orgId) ?? (orgId ? { orgId, orgName: orgId, kind: "outside" as const } : orgs[0]);
  const needle = q.trim().toLowerCase();
  const listed = orgs.filter((o) => !needle || o.orgName.toLowerCase().includes(needle));
  return (
    <>
      <PageHead
        title="Customers"
        purpose="What each kitchen shares with us, and where we learned it."
        about="What do we know about this kitchen, and where did we learn it? Only what the kitchen shares, each item with who stated it or which orders taught it, and when it was last used. Corrections go to the kitchen to confirm."
      />
      <LoadError message={agents.error} />
      {!agents.data ? (
        <Loading label="Reading the kitchens…" />
      ) : orgs.length === 0 ? (
        <Empty title="No kitchen has come to the gate yet">A kitchen appears here once its agent presents a signed mandate at the door.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Kitchens" className="lg:sticky lg:top-[4.5rem] lg:self-start">
            <label className="relative block">
              <span className="sr-only">Find a kitchen</span>
              <Search aria-hidden size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Find a kitchen" className="field !rounded-full pl-10 !text-[0.95rem]" />
            </label>
            <ul className="mt-3 space-y-0.5 overflow-hidden rounded-xl border border-line bg-paper p-1.5">
              {listed.map((o) => {
                const on = o.orgId === current?.orgId;
                return (
                  <li key={o.orgId}>
                    <Link href={`/ops/customers/${o.orgId}`} aria-current={on ? "page" : undefined} className={`flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors ${on ? "bg-petrol-soft" : "hover:bg-mist"}`}>
                      <Avatar name={o.orgName} size={32} tone={on ? "dark" : "petrol"} className={on ? "!bg-petrol !text-paper" : ""} />
                      <span className="min-w-0">
                        <span className={`block truncate font-semibold leading-tight ${on ? "text-petrol-deep" : ""}`}>{o.orgName}</span>
                        <span className="block text-[0.8rem] text-ink-soft">{KIND_WORD[o.kind]}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {listed.length === 0 && <li className="px-3 py-2.5 text-[0.9rem] text-ink-soft">No kitchen matches.</li>}
            </ul>
          </nav>
          {current && <Kitchen key={current.orgId} orgId={current.orgId} name={current.orgName} kind={current.kind} agents={all.filter((a) => a.orgId === current.orgId)} />}
        </div>
      )}
    </>
  );
}

const KIND_WORD: Record<string, string> = { visitor: "Visitor kitchen", demo: "Demo kitchen", account: "Account kitchen", outside: "Outside organisation" };

function Kitchen({ orgId, name, kind, agents }: { orgId: string; name: string; kind: string; agents: AgentRow[] }) {
  const [m, setM] = useState<MemoryState>();
  useEffect(() => {
    let live = true;
    readMemory(orgId).then((r) => live && setM(r));
    return () => {
      live = false;
    };
  }, [orgId]);
  const items = m?.state === "ok" ? m.data.items : [];
  const stated = items.filter((i) => i.source.kind !== "learned").length;
  const learned = items.length - stated;
  const record = agents.reduce((acc, a) => ({ requests: acc.requests + a.record.requests, committed: acc.committed + a.record.committed, signOffs: acc.signOffs + a.record.signOffs }), { requests: 0, committed: 0, signOffs: 0 });
  return (
    <div className="min-w-0">
      <header className="overflow-hidden rounded-xl border border-line bg-paper">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 py-5 sm:px-6">
          <div>
            <h2 className="display text-[1.8rem] leading-none">{(m?.state === "ok" && m.data.name) || name}</h2>
            <p className="mt-1 text-[0.92rem] text-ink-soft">
              {KIND_WORD[kind]}; {agents.length} agent{agents.length === 1 ? "" : "s"} at the gate: {agents.map((a) => a.label).join(", ") || "none yet"}
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 sm:text-right">
            {(
              [
                [items.length, "shared with us"],
                [record.requests, "requests"],
                [record.committed, "orders signed"],
                [record.signOffs, "needed a person"],
              ] as const
            ).map(([n, l]) => (
              <div key={l}>
                <dd className="display text-[1.6rem] leading-none tabular">{n}</dd>
                <dt className="text-[0.8rem] text-ink-soft">{l}</dt>
              </div>
            ))}
          </dl>
        </div>
        {agents[0] && (
          <div className="border-t border-line bg-surface/60 px-5 py-4 sm:px-6">
            <p className="text-[0.84rem] font-medium text-ink-soft">What its agent may do alone, from the mandate it signed</p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-[0.92rem] leading-snug md:grid-cols-2">
              {agents[0].allows.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <Check aria-hidden size={14} strokeWidth={2.6} className="mt-[0.25em] shrink-0 text-good" />
                  {fi(x.line)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <p className="mt-4 flex gap-2.5 rounded-lg bg-lavender px-4 py-3 text-[0.9rem] leading-snug text-lavender-deep">
        <Eye aria-hidden size={17} className="mt-0.5 shrink-0" />
        Opening a kitchen here is recorded, and the kitchen sees who looked and when. Staff cannot change a kitchen&apos;s rules, and what the kitchen keeps private never reaches this page.
      </p>

      {!m ? (
        <Loading label="Reading what the kitchen shares…" />
      ) : m.state === "unavailable" ? (
        <div className="mt-4">
          <Empty title="The kitchen memory is not running on this server">
            When it runs, this page lists what {name} shares with the wholesaler (dietary and allergen rules, products, brands and packs, delivery days and receiving hours, substitutes accepted and rejected, standing orders), each with who stated it and when it was last used.
          </Empty>
        </div>
      ) : m.state === "error" ? (
        <LoadError message={m.message} />
      ) : (
        <>
          <Section title="What we know, and where we learned it" aside={items.length ? `${stated} stated by the kitchen, ${learned} learned from its orders` : undefined}>
            {items.length === 0 ? (
              <Empty title="This kitchen shares nothing with the wholesaler yet">Items appear here when the kitchen states a rule or a preference and chooses to share it, or when its orders show a pattern it lets the wholesaler see.</Empty>
            ) : (
              <MemoryTable orgId={orgId} items={items} />
            )}
          </Section>
          <Section title="Who from the wholesaler looked" aside="The kitchen sees this list too">
            {m.data.views.length === 0 ? (
              <p className="text-[0.92rem] text-ink-soft">This view is the first one recorded.</p>
            ) : (
              <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper text-[0.92rem]">
                {m.data.views.slice(0, 12).map((v, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 px-5 py-2.5">
                    <span className="font-semibold">{v.by}</span>
                    <span className="text-ink-soft tabular">{when(v.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function MemoryTable({ orgId, items }: { orgId: string; items: MemoryItem[] }) {
  const groups = new Map<string, MemoryItem[]>();
  for (const it of items) groups.set(groupOf(it.kind), [...(groups.get(groupOf(it.kind)) ?? []), it]);
  return (
    <Table label="What the kitchen shares">
      <thead>
        <tr>
          <th>What we know</th>
          <th>Where we learned it</th>
          <th>Last used</th>
          <th className="sr-only">Correct</th>
        </tr>
      </thead>
      {[...groups.entries()].map(([title, list]) => (
        <tbody key={title}>
          <tr>
            <td colSpan={4} className="bg-surface !py-2 text-[0.84rem] font-semibold text-petrol-deep">
              {title}
            </td>
          </tr>
          {list.map((it) => (
            <Item key={it.id} orgId={orgId} it={it} />
          ))}
        </tbody>
      ))}
    </Table>
  );
}

function Item({ orgId, it }: { orgId: string; it: MemoryItem }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string }>();
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(await proposeCorrection(orgId, { itemId: it.id, kind: it.kind, text, reason }));
  }
  const src = it.source;
  const learned = src.kind === "learned";
  return (
    <>
      <tr>
        <td className="font-semibold">
          <span className="flex gap-2">
            {learned ? <Sparkles aria-hidden size={14} className="mt-[0.25em] shrink-0 text-lavender-deep" /> : <span aria-hidden className="mt-[0.5em] size-2 shrink-0 rounded-full bg-petrol" />}
            {fi(it.text)}
          </span>
        </td>
        <td className="text-[0.9rem]">
          {learned ? (
            <Tag tone="agent">Learned from its orders</Tag>
          ) : (
            <span>
              {SOURCE[src.kind] ? SOURCE[src.kind].replace(/^./, (c) => c.toUpperCase()) : "From"} <b>{src.by ?? "the kitchen"}</b>
            </span>
          )}
          <span className="block text-[0.84rem] text-ink-soft">
            {src.at ? when(src.at) : "Date not recorded"}
            {src.via ? `, ${src.via}` : ""}
          </span>
        </td>
        <td className="whitespace-nowrap text-[0.9rem]">
          {it.lastUsedAt ? (
            it.lastUsedRequestId ? (
              <Link className="text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol" href={`/ops/trace/${it.lastUsedRequestId}`}>
                {when(it.lastUsedAt)}
              </Link>
            ) : (
              when(it.lastUsedAt)
            )
          ) : (
            <span className="text-ink-soft">Not used yet</span>
          )}
        </td>
        <td className="text-right">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass("secondary", "sm", "whitespace-nowrap")}>
            {open ? "Cancel" : "Propose a correction"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="bg-mist">
            <form onSubmit={send} className="grid gap-2.5 md:grid-cols-[1fr_1fr_auto]">
              <input required value={text} onChange={(e) => setText(e.target.value)} placeholder="What it should say" aria-label="Proposed text" className="field !text-[0.92rem]" />
              <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (the kitchen sees this)" aria-label="Reason" className="field !text-[0.92rem]" />
              <Button type="submit" kind="primary" size="md">
                Send to the kitchen
              </Button>
              {msg && <p className={`text-[0.88rem] md:col-span-3 ${msg.ok ? "" : "font-semibold"}`}>{msg.message}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

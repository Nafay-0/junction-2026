"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentRow } from "@/server/ops/views";
import { fi, when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
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
        purpose="What do we know about this kitchen, and where did we learn it? Only what the kitchen shares, each item with who stated it or which orders taught it, and when it was last used. Corrections go to the kitchen to confirm."
      />
      <LoadError message={agents.error} />
      {!agents.data ? (
        <Loading label="Reading the kitchens…" />
      ) : orgs.length === 0 ? (
        <Empty title="No kitchen has come to the gate yet">A kitchen appears here once its agent presents a signed mandate at the door.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Kitchens" className="lg:sticky lg:top-4 lg:self-start">
            <label className="flex min-h-10 items-center gap-2 border-2 border-line bg-paper px-2.5 focus-within:border-petrol">
              <span className="sr-only">Find a kitchen</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Find a kitchen" className="min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-ink-soft" />
            </label>
            <ul className="mt-2 bg-paper">
              {listed.map((o) => {
                const on = o.orgId === current?.orgId;
                return (
                  <li key={o.orgId}>
                    <Link href={`/ops/customers/${o.orgId}`} aria-current={on ? "page" : undefined} className={`relative block px-3 py-2.5 ${on ? "bg-petrol text-paper" : "hover:bg-petrol-soft"}`}>
                      {on && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-lime" />}
                      <span className="block font-semibold leading-tight">{o.orgName}</span>
                      <span className={`block text-[0.82rem] ${on ? "text-paper/80" : "text-ink-soft"}`}>{KIND_WORD[o.kind]}</span>
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

const KIND_WORD: Record<string, string> = { visitor: "Visitor kitchen", demo: "Demo kitchen", outside: "Outside organisation" };

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
      <header className="bg-paper">
        <div aria-hidden className="h-[3px] bg-petrol" />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 py-4">
          <div>
            <h2 className="display text-[2rem] leading-none">{(m?.state === "ok" && m.data.name) || name}</h2>
            <p className="mt-1 text-[0.92rem] text-ink-soft">
              {KIND_WORD[kind]}; {agents.length} agent{agents.length === 1 ? "" : "s"} at the gate: {agents.map((a) => a.label).join(", ") || "none yet"}
            </p>
          </div>
          <dl className="flex gap-6 text-right">
            {(
              [
                [items.length, "shared with us"],
                [record.requests, "requests"],
                [record.committed, "orders signed"],
                [record.signOffs, "needed a person"],
              ] as const
            ).map(([n, l]) => (
              <div key={l}>
                <dd className="display text-[1.7rem] leading-none tabular">{n}</dd>
                <dt className="text-[0.8rem] text-ink-soft">{l}</dt>
              </div>
            ))}
          </dl>
        </div>
        {agents[0] && (
          <div className="border-t border-line/70 px-5 py-3">
            <p className="text-[0.85rem] font-semibold text-ink-soft">What its agent may do alone, from the mandate it signed</p>
            <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-[0.92rem] leading-snug md:grid-cols-2">
              {agents[0].allows.map((x, i) => (
                <li key={i}>{fi(x.line)}</li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <p className="mt-3 border-l-[6px] border-petrol bg-paper px-4 py-2.5 text-[0.9rem] leading-snug text-ink-soft">
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
              <ol className="divide-y divide-line/70 bg-paper text-[0.92rem]">
                {m.data.views.slice(0, 12).map((v, i) => (
                  <li key={i} className="flex justify-between gap-4 px-4 py-2">
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
            <td colSpan={4} className="bg-mist !py-1.5 text-[0.85rem] font-semibold text-petrol">
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
            <span aria-hidden className={`mt-[0.45em] size-2 shrink-0 rotate-45 ${learned ? "bg-lavender-deep" : "bg-petrol"}`} />
            {fi(it.text)}
          </span>
        </td>
        <td className="text-[0.9rem]">
          {learned ? (
            <span className="bg-lavender px-1.5 py-px text-lavender-deep">Learned from its orders</span>
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
              <Link className="text-petrol underline underline-offset-2" href={`/ops/trace/${it.lastUsedRequestId}`}>
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
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="whitespace-nowrap text-[0.88rem] font-semibold text-petrol underline underline-offset-2">
            {open ? "Cancel" : "Propose a correction"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="bg-mist">
            <form onSubmit={send} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input required value={text} onChange={(e) => setText(e.target.value)} placeholder="What it should say" aria-label="Proposed text" className="min-h-10 border-2 border-line bg-paper px-2 text-[0.92rem] focus:border-petrol focus:outline-none" />
              <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (the kitchen sees this)" aria-label="Reason" className="min-h-10 border-2 border-line bg-paper px-2 text-[0.92rem] focus:border-petrol focus:outline-none" />
              <Button type="submit" kind="primary">
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

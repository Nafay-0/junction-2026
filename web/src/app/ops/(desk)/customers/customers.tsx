"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentRow } from "@/server/ops/views";
import { fi, when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, PageHead, Panel, Section, useOps } from "../../_ui/kit";
import { groupOf, proposeCorrection, readMemory, type MemoryItem, type MemoryState } from "../../_ui/memory";

const SOURCE: Record<string, string> = { stated: "stated by", confirmed: "confirmed by", learned: "learned from orders" };

/**
 * What the wholesaler knows about a kitchen: only what the kitchen shares (diet and allergen rules, products, brands
 * and packs, delivery days and hours, substitutes, standing orders), each with where it came from. Staff can propose
 * a correction; the kitchen confirms it or not. Staff cannot edit a kitchen's rules or see its private items.
 */
export function CustomersScreen({ orgId }: { orgId?: string }) {
  const agents = useOps<{ agents: AgentRow[] }>("/ops-api/agents", { pollMs: 8000 });
  const orgs = [...new Map((agents.data?.agents ?? []).filter((a) => a.orgId !== "unknown").map((a) => [a.orgId, { orgId: a.orgId, orgName: a.orgName, kind: a.kind }])).values()];
  const current = orgs.find((o) => o.orgId === orgId) ?? (orgId ? { orgId, orgName: orgId, kind: "outside" as const } : orgs[0]);
  return (
    <>
      <PageHead
        title="Customers"
        purpose="What the wholesaler knows about each kitchen, in plain words: only what the kitchen shares, each item with where it came from and when it was last used. Corrections go to the kitchen to confirm."
      />
      <LoadError message={agents.error} />
      <p className="mt-3 border-l-4 border-ink bg-paper px-3 py-2 text-[0.88rem]">
        Every time staff open a kitchen here, the view is recorded and the kitchen can see who looked and when. Staff cannot change a kitchen&apos;s rules, and items the kitchen keeps private never reach this page.
      </p>
      {!agents.data ? (
        <Loading />
      ) : orgs.length === 0 ? (
        <div className="mt-4">
          <Empty title="No kitchen has come to the gate yet" />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Kitchens">
            <Panel>
              <ul className="divide-y divide-concrete">
                {orgs.map((o) => (
                  <li key={o.orgId}>
                    <Link
                      href={`/ops/customers/${o.orgId}`}
                      aria-current={o.orgId === current?.orgId ? "page" : undefined}
                      className={`block px-3 py-2 text-[0.9rem] ${o.orgId === current?.orgId ? "bg-ink text-paper" : "hover:bg-concrete"}`}
                    >
                      <span className="font-semibold">{o.orgName}</span>
                      <span className={`block text-[0.76rem] ${o.orgId === current?.orgId ? "text-chalk-soft" : "text-ink-soft"}`}>{o.kind === "visitor" ? "Visitor kitchen" : o.kind === "demo" ? "Demo kitchen" : "Outside organisation"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </nav>
          {current && <Kitchen key={current.orgId} orgId={current.orgId} name={current.orgName} />}
        </div>
      )}
    </>
  );
}

function Kitchen({ orgId, name }: { orgId: string; name: string }) {
  const [m, setM] = useState<MemoryState>();
  useEffect(() => {
    let live = true;
    readMemory(orgId).then((r) => live && setM(r));
    return () => {
      live = false;
    };
  }, [orgId]);
  if (!m) return <Loading />;
  if (m.state === "unavailable")
    return (
      <Empty title={`${name}: memory not available yet`}>
        This server does not run the kitchen memory model yet. When it does, this page lists what {name} shares with the wholesaler (dietary and allergen rules, products, brands and packs, delivery days and receiving hours, substitutes accepted and rejected, standing orders), each with who stated it and when it was last used.
      </Empty>
    );
  if (m.state === "error") return <LoadError message={m.message} />;
  const groups = new Map<string, MemoryItem[]>();
  for (const it of m.data.items) groups.set(groupOf(it.kind), [...(groups.get(groupOf(it.kind)) ?? []), it]);
  return (
    <div>
      <h2 className="font-display text-[1.5rem] font-bold">{m.data.name ?? name}</h2>
      {m.data.items.length === 0 ? (
        <div className="mt-3">
          <Empty title="This kitchen shares nothing with the wholesaler yet" />
        </div>
      ) : (
        [...groups.entries()].map(([title, items]) => (
          <Section key={title} title={title}>
            <Panel>
              <ul className="divide-y divide-concrete">
                {items.map((it) => (
                  <Item key={it.id} orgId={orgId} it={it} />
                ))}
              </ul>
            </Panel>
          </Section>
        ))
      )}
      <Section title="Who from the wholesaler looked" aside="The kitchen sees this list too">
        {m.data.views.length === 0 ? (
          <p className="text-[0.88rem] text-ink-soft">This view is the first one recorded.</p>
        ) : (
          <Panel>
            <ul className="divide-y divide-concrete text-[0.86rem]">
              {m.data.views.slice(0, 12).map((v, i) => (
                <li key={i} className="flex justify-between px-4 py-1.5">
                  <span>{v.by}</span>
                  <span className="tabular text-ink-soft">{when(v.at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>
    </div>
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
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-semibold">{fi(it.text)}</p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[0.82rem] underline underline-offset-2">
          {open ? "Cancel" : "Propose a correction"}
        </button>
      </div>
      <p className="text-[0.82rem] text-ink-soft">
        {src.kind === "learned" ? "Learned from the kitchen's orders" : `${SOURCE[src.kind] ? SOURCE[src.kind].replace(/^./, (c) => c.toUpperCase()) : "From"} ${src.by ?? "the kitchen"}`}
        {src.at ? ` on ${when(src.at)}` : ""}
        {src.via ? `, ${src.via}` : ""}. {it.lastUsedAt ? <>Last used {when(it.lastUsedAt)}{it.lastUsedRequestId && <> on <Link className="underline" href={`/ops/trace/${it.lastUsedRequestId}`}>this request</Link></>}.</> : "Not used on an order yet."}
      </p>
      {open && (
        <form onSubmit={send} className="mt-2 grid gap-1.5 border-t border-concrete pt-2 md:grid-cols-[1fr_1fr_auto]">
          <input required value={text} onChange={(e) => setText(e.target.value)} placeholder="What it should say" aria-label="Proposed text" className="border border-concrete-deep px-2 py-1.5 text-[0.86rem]" />
          <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (the kitchen sees this)" aria-label="Reason" className="border border-concrete-deep px-2 py-1.5 text-[0.86rem]" />
          <Button type="submit" kind="primary">
            Send to the kitchen
          </Button>
          {msg && <p className={`text-[0.84rem] md:col-span-3 ${msg.ok ? "" : "font-semibold"}`}>{msg.message}</p>}
        </form>
      )}
    </li>
  );
}

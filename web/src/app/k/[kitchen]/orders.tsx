"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { day, money } from "../../_ui/plain";
import { authorisedText, linesText, whenText } from "./history";
import { usePortal } from "./portal";
import { Button } from "./ui";
import type { PortalOrder } from "./types";

/** Orders: everything this kitchen ordered or tried to, by the agent, from the basket, or from its history. */
const TABS: { id: string; label: string; test: (o: PortalOrder) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "waiting", label: "Waiting for sign-off", test: (o) => o.status === "pending_approval" },
  { id: "placed", label: "Placed", test: (o) => o.status === "committed" },
  { id: "not", label: "Not placed", test: (o) => o.status === "rejected" || o.status === "declined" },
  { id: "history", label: "Earlier history", test: (o) => o.status === "history" },
];

export function OrdersList() {
  const { overview, base, agent } = usePortal();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("show") ?? "all");
  const o = overview.data;
  const text = new Map((o?.requests ?? []).map((r) => [r.order?.orderId, r.text]));
  const reqOf = new Map((o?.requests ?? []).flatMap((r) => (r.order ? [[r.order.orderId, r] as const] : [])));
  const rows = (o?.orders ?? []).filter(TABS.find((t) => t.id === tab)?.test ?? (() => true));
  return (
    <div className="mt-5">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">Orders</h1>
      <p className="mt-1 max-w-[70ch] text-[1.02rem] leading-snug text-ink-soft">Every order the kitchen placed or tried to place: by its agent, from the basket, or by an outside agent with the same mandate.</p>
      <div role="tablist" aria-label="Show" className="mt-4 flex flex-wrap gap-1 border-b-2 border-petrol">
        {TABS.map((t) => {
          const n = (o?.orders ?? []).filter(t.test).length;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`min-h-11 px-3 ${tab === t.id ? "bg-petrol font-semibold text-paper" : "text-petrol hover:bg-paper"}`}>
              {t.label} <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {!o && !overview.error && <div className="mt-3 h-64 animate-pulse bg-concrete-deep/60" aria-label="Loading orders" />}
      {overview.error && !o && (
        <div role="alert" className="mt-3 bg-paper p-4">
          <p className="font-semibold">The orders did not load</p>
          <p className="text-ink-soft">{overview.error}</p>
          <Button className="mt-2" onClick={overview.refresh}>
            Try again
          </Button>
        </div>
      )}
      {o && rows.length === 0 && <p className="mt-3 bg-paper p-5 leading-snug text-ink-soft">{tab === "waiting" ? "Nothing is waiting for a sign-off. Orders the gate stops for a person appear here." : "No orders here yet. Orders placed by the agent, from the basket or by an outside agent with the same mandate appear here."}</p>}
      {o && rows.length > 0 && (
        <div className="overflow-x-auto bg-paper">
          <div aria-hidden className="h-[3px] bg-petrol" />
          <table className="w-full min-w-[60rem] text-left">
            <thead className="text-[0.85rem] text-ink-soft">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Placed</th>
                <th className="px-2 py-2 font-medium">What</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2 font-medium">Delivery</th>
                <th className="px-2 py-2 font-medium">Who let it through</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Repeat</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((x) => {
                const asked = text.get(x.orderId);
                const waiting = x.status === "pending_approval";
                return (
                  <tr key={x.orderId} className={`align-top ${waiting ? "bg-safety/15 shadow-[inset_6px_0_0_var(--color-safety-ink)]" : "hover:bg-mist"}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-[0.92rem] tabular">{whenText(x.createdAt)}</td>
                    <td className="px-2 py-3">
                      {x.status === "history" ? (
                        <span className="font-semibold">{linesText(x, 3)}</span>
                      ) : (
                        <Link href={`${base}/orders/${x.orderId}`} className="font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
                          {linesText(x, 3)}
                        </Link>
                      )}
                      {asked && <span className="block text-[0.9rem] text-ink-soft">{asked.startsWith("Basket") ? "Basket, ordered by hand" : `Asked: “${asked.length > 80 ? `${asked.slice(0, 77)}…` : asked}”`}</span>}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold tabular">{money(x.totalCents)}</td>
                    <td className="whitespace-nowrap px-2 py-3">{day(x.deliveryDate)}</td>
                    <td className={`px-2 py-3 text-[0.95rem] ${waiting ? "font-semibold" : ""}`}>{authorisedText(x)}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {reqOf.get(x.orderId) && (x.status === "committed" || x.status === "history") && (
                        <span className="flex gap-3">
                          <button type="button" className="min-h-9 text-[0.92rem] font-semibold text-petrol underline decoration-2 underline-offset-4" onClick={() => agent.send({ kind: "repeat", request: reqOf.get(x.orderId)! })}>
                            Repeat
                          </button>
                          <button
                            type="button"
                            className="min-h-9 text-[0.92rem] text-petrol underline underline-offset-4"
                            onClick={() => {
                              agent.setFollowUp(reqOf.get(x.orderId));
                              agent.focus();
                            }}
                          >
                            With a change
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

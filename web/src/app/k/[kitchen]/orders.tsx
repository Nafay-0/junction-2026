"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { day, eur } from "../../_ui/plain";
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
  const { overview, base } = usePortal();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("show") ?? "all");
  const o = overview.data;
  const text = new Map((o?.requests ?? []).map((r) => [r.order?.orderId, r.text]));
  const rows = (o?.orders ?? []).filter(TABS.find((t) => t.id === tab)?.test ?? (() => true));
  return (
    <div className="mt-5">
      <h1 className="font-display text-[2rem] font-bold leading-tight tracking-tight">Orders</h1>
      <p className="text-ink-soft">Every order the kitchen placed or tried to place: by its agent, from the basket, or by an outside agent with the same mandate.</p>
      <div role="tablist" aria-label="Show" className="mt-3 flex flex-wrap gap-1 border-b-[3px] border-ink">
        {TABS.map((t) => {
          const n = (o?.orders ?? []).filter(t.test).length;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`min-h-11 px-3 ${tab === t.id ? "bg-ink font-semibold text-paper" : "hover:bg-paper"}`}>
              {t.label} <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {!o && !overview.error && <div className="mt-3 h-64 animate-pulse bg-paper/60" aria-label="Loading orders" />}
      {overview.error && !o && (
        <div role="alert" className="mt-3 bg-paper p-4">
          <p className="font-semibold">The orders did not load</p>
          <p className="text-ink-soft">{overview.error}</p>
          <Button className="mt-2" onClick={overview.refresh}>
            Try again
          </Button>
        </div>
      )}
      {o && rows.length === 0 && <p className="mt-3 bg-paper p-4 text-ink-soft">No orders here yet.</p>}
      {o && rows.length > 0 && (
        <div className="overflow-x-auto bg-paper">
          <table className="w-full min-w-[52rem] text-left">
            <thead className="text-[0.85rem] text-ink-soft">
              <tr className="border-b border-ink/15">
                <th className="px-4 py-2 font-medium">Placed</th>
                <th className="px-2 py-2 font-medium">What</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2 font-medium">Delivery</th>
                <th className="px-4 py-2 font-medium">Who let it through</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((x) => {
                const asked = text.get(x.orderId);
                const waiting = x.status === "pending_approval";
                return (
                  <tr key={x.orderId} className={`align-top ${waiting ? "bg-safety/15" : ""}`}>
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
                    <td className="px-2 py-3 text-right font-semibold tabular">{eur(x.totalCents)}</td>
                    <td className="whitespace-nowrap px-2 py-3">{day(x.deliveryDate)}</td>
                    <td className={`px-4 py-3 text-[0.95rem] ${waiting ? "font-semibold" : ""}`}>{authorisedText(x)}</td>
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

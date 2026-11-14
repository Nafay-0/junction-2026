"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { money } from "../../_ui/plain";
import { authorisedText, linesText, whenText } from "./history";
import { ORDERS_TEXT } from "./orders.text";
import { usePortal } from "./portal";
import { Button } from "./ui";
import type { PortalOrder } from "./types";

/** Orders: everything this kitchen ordered or tried to, by the agent, from the basket, or from its history. */
const TABS: { id: string; test: (o: PortalOrder) => boolean }[] = [
  { id: "all", test: () => true },
  { id: "waiting", test: (o) => o.status === "pending_approval" },
  { id: "placed", test: (o) => o.status === "committed" },
  { id: "not", test: (o) => o.status === "rejected" || o.status === "declined" },
  { id: "history", test: (o) => o.status === "history" },
];

export function OrdersList() {
  const { overview, base, agent } = usePortal();
  const tx = useText(ORDERS_TEXT);
  const f = useFormat();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("show") ?? "all");
  const o = overview.data;
  const text = new Map((o?.requests ?? []).map((r) => [r.order?.orderId, r.text]));
  const reqOf = new Map((o?.requests ?? []).flatMap((r) => (r.order ? [[r.order.orderId, r] as const] : [])));
  const rows = (o?.orders ?? []).filter(TABS.find((t) => t.id === tab)?.test ?? (() => true));
  return (
    <div className="mt-5">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">{tx.title}</h1>
      <p className="mt-1 max-w-[70ch] text-[1.02rem] leading-snug text-ink-soft">{tx.intro}</p>
      <div role="tablist" aria-label={tx.show} className="mt-4 flex flex-wrap gap-1 border-b-2 border-petrol">
        {TABS.map((t) => {
          const n = (o?.orders ?? []).filter(t.test).length;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`min-h-11 px-3 ${tab === t.id ? "bg-petrol font-semibold text-paper" : "text-petrol hover:bg-paper"}`}>
              {tx.tabs[t.id]} <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {!o && !overview.error && <div className="mt-3 h-64 animate-pulse bg-concrete-deep/60" aria-label={tx.loading} />}
      {overview.error && !o && (
        <div role="alert" className="mt-3 bg-paper p-4">
          <p className="font-semibold">{tx.loadFailed}</p>
          <p className="text-ink-soft">{overview.error}</p>
          <Button className="mt-2" onClick={overview.refresh}>
            {tx.retry}
          </Button>
        </div>
      )}
      {o && rows.length === 0 && <p className="mt-3 bg-paper p-5 leading-snug text-ink-soft">{tab === "waiting" ? tx.noneWaiting : tx.none}</p>}
      {o && rows.length > 0 && (
        <div className="overflow-x-auto bg-paper">
          <div aria-hidden className="h-[3px] bg-petrol" />
          <table className="w-full min-w-[60rem] text-left">
            <thead className="text-[0.85rem] text-ink-soft">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">{tx.head.placed}</th>
                <th className="px-2 py-2 font-medium">{tx.head.what}</th>
                <th className="px-2 py-2 text-right font-medium">{tx.head.total}</th>
                <th className="px-2 py-2 font-medium">{tx.head.delivery}</th>
                <th className="px-2 py-2 font-medium">{tx.head.who}</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">{tx.head.repeat}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((x) => {
                const asked = text.get(x.orderId);
                const waiting = x.status === "pending_approval";
                return (
                  <tr key={x.orderId} className={`align-top ${waiting ? "bg-safety/15 shadow-[inset_6px_0_0_var(--color-safety-ink)]" : "hover:bg-mist"}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-[0.92rem] tabular">{whenText(x.createdAt, f.lang)}</td>
                    <td className="px-2 py-3">
                      {x.status === "history" ? (
                        <span className="font-semibold">{linesText(x, 3, f.lang)}</span>
                      ) : (
                        <Link href={`${base}/orders/${x.orderId}`} className="font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
                          {linesText(x, 3, f.lang)}
                        </Link>
                      )}
                      {asked && <span className="block text-[0.9rem] text-ink-soft">{asked.startsWith("Basket") ? tx.basket : tx.asked(asked.length > 80 ? `${asked.slice(0, 77)}…` : asked)}</span>}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold tabular">{money(x.totalCents)}</td>
                    <td className="whitespace-nowrap px-2 py-3">{f.day(x.deliveryDate)}</td>
                    <td className={`px-2 py-3 text-[0.95rem] ${waiting ? "font-semibold" : ""}`}>{authorisedText(x, f.lang)}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {reqOf.get(x.orderId) && (x.status === "committed" || x.status === "history") && (
                        <span className="flex gap-3">
                          <button type="button" className="min-h-9 text-[0.92rem] font-semibold text-petrol underline decoration-2 underline-offset-4" onClick={() => agent.send({ kind: "repeat", request: reqOf.get(x.orderId)! })}>
                            {tx.repeat}
                          </button>
                          <button
                            type="button"
                            className="min-h-9 text-[0.92rem] text-petrol underline underline-offset-4"
                            onClick={() => {
                              agent.setFollowUp(reqOf.get(x.orderId));
                              agent.focus();
                            }}
                          >
                            {tx.withChange}
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

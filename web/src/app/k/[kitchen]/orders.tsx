"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronRight, ClipboardList, Repeat, ShieldCheck } from "lucide-react";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday, money } from "../../_ui/plain";
import { Badge, Button, Card, Empty, ErrorPlate, IconDisc, PageHeader, Skeleton, Tabs, buttonClass, type BadgeTone } from "../../_ui/kit";
import { authorisedText, linesText } from "./history";
import { ORDERS_TEXT } from "./orders.text";
import { usePortal } from "./portal";
import type { PortalOrder, PortalRequest } from "./types";
import { useProductName } from "./names";
import { SamplePill } from "../../_ui/sample";

/** Orders: everything this kitchen ordered or tried to, by the agent, from the basket, or from its history. */
const TABS: { id: string; test: (o: PortalOrder) => boolean }[] = [
  { id: "all", test: () => true },
  { id: "waiting", test: (o) => o.status === "pending_approval" },
  { id: "placed", test: (o) => o.status === "committed" },
  { id: "not", test: (o) => o.status === "rejected" || o.status === "declined" },
  { id: "history", test: (o) => o.status === "history" },
];

const LOCALE = { en: "en-GB", fi: "fi-FI", sv: "sv-SE" } as const;

/** The status as a badge: the gate's tones only for a sign-off waiting and a refusal. */
function statusBadge(status: PortalOrder["status"]): BadgeTone | undefined {
  if (status === "pending_approval") return "waiting";
  if (status === "committed") return "good";
  if (status === "rejected") return "refused";
  return "neutral";
}

export function OrdersList() {
  const { overview, base } = usePortal();
  const tx = useText(ORDERS_TEXT);
  const f = useFormat();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("show") ?? "all");
  const o = overview.data;
  const all = o?.orders ?? [];
  const rows = all.filter(TABS.find((t) => t.id === tab)?.test ?? (() => true));
  const text = new Map((o?.requests ?? []).map((r) => [r.order?.orderId, r.text]));
  const reqOf = new Map((o?.requests ?? []).flatMap((r) => (r.order ? [[r.order.orderId, r] as const] : [])));

  // Rows grouped by the month they were placed in, newest first (the order the server sends them in).
  const month = new Intl.DateTimeFormat(LOCALE[f.lang], { month: "long", year: "numeric", timeZone: "Europe/Helsinki" });
  const groups: { key: string; label: string; rows: PortalOrder[] }[] = [];
  for (const x of rows) {
    const label = month.format(new Date(x.createdAt));
    const g = groups.at(-1);
    if (g && g.key === label) g.rows.push(x);
    else groups.push({ key: label, label: label.charAt(0).toUpperCase() + label.slice(1), rows: [x] });
  }

  return (
    <div className="mt-6 sm:mt-8">
      <PageHeader title={tx.title} lead={tx.intro} />
      <Tabs
        className="mt-6"
        label={tx.show}
        value={tab}
        onChange={setTab}
        options={TABS.map((t) => ({ id: t.id, label: tx.tabs[t.id], count: o ? all.filter(t.test).length : undefined }))}
      />

      {!o && !overview.error && (
        <Card className="mt-5">
          <ul className="divide-y divide-line" role="status" aria-label={tx.loading}>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <Skeleton className="h-12 w-14 shrink-0 !rounded-lg" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </span>
                <Skeleton className="h-5 w-16" />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {overview.error && !o && <ErrorPlate title={tx.loadFailed} message={overview.error} onRetry={overview.refresh} />}

      {o && rows.length === 0 && (
        <div className="mt-5">
          <Empty
            title={tab === "waiting" ? tx.emptyWaitingTitle : tx.emptyTitle}
            glyph={
              <IconDisc tone={tab === "waiting" ? "good" : "muted"}>
                {tab === "waiting" ? <ShieldCheck size={21} /> : <ClipboardList size={21} />}
              </IconDisc>
            }
            action={
              tab !== "waiting" ? (
                <Link href={`${base}/order`} className={buttonClass("primary", "sm")}>
                  {tx.orderNow}
                </Link>
              ) : undefined
            }
          >
            {tab === "waiting" ? tx.noneWaiting : tx.none}
          </Empty>
        </div>
      )}

      {o && rows.length > 0 && (
        <div className="mt-6 space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2.5 flex items-baseline justify-between gap-3 px-1 text-[0.92rem] font-semibold text-ink-soft">
                <span>{g.label}</span>
                <span className="font-normal tabular">{tx.inMonth(g.rows.length, money(g.rows.filter((r) => r.status === "committed" || r.status === "history").reduce((s, r) => s + r.totalCents, 0)))}</span>
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {g.rows.map((x) => (
                    <OrderRow key={x.orderId} x={x} asked={text.get(x.orderId)} request={reqOf.get(x.orderId)} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** One order as a row: the day it was placed, what, who let it through, the total and its status; repeat when it can be. */
function OrderRow({ x, asked, request }: { x: PortalOrder; asked?: string | null; request?: PortalRequest }) {
  const { base, agent } = usePortal();
  const tx = useText(ORDERS_TEXT);
  const f = useFormat();
  const pn = useProductName();
  const [weekday, ...rest] = f.day(helsinkiToday(new Date(x.createdAt))).split(" ");
  const date = rest.join(" ") || weekday;
  const time = clock(x.createdAt);
  const waiting = x.status === "pending_approval";
  const tone = statusBadge(x.status);
  const linked = x.status !== "history";
  const repeatable = !!request && (x.status === "committed" || x.status === "history");
  const what = linesText(x, 3, f.lang, pn);
  return (
    <li className={`group relative grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3.5 px-4 py-3.5 transition-colors duration-150 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto_7rem] sm:items-center sm:gap-x-5 sm:px-5 ${linked ? "hover:bg-mist" : ""} ${waiting ? "bg-safety-soft/60" : ""}`}>
      <span className={`row-span-2 flex flex-col items-center self-start rounded-lg py-1.5 sm:row-span-1 sm:self-center ${waiting ? "bg-safety text-safety-ink" : x.status === "history" ? "bg-surface text-ink-soft" : "bg-petrol-soft text-petrol-deep"}`}>
        <span className="sr-only">{tx.head.placed}: </span>
        <span className="text-[0.72rem] font-medium leading-tight">{weekday}</span>
        <span className="display text-[1.05rem] leading-tight tabular">{date}</span>
        <span className="text-[0.7rem] leading-tight tabular opacity-80">{time}</span>
      </span>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-semibold leading-snug">
            {linked ? (
              <Link href={`${base}/orders/${x.orderId}`} className="after:absolute after:inset-0 hover:text-petrol">
                {what}
              </Link>
            ) : (
              what
            )}
          </p>
          <span className="shrink-0 pt-px text-right font-semibold tabular sm:hidden">{money(x.totalCents)}</span>
        </div>
        {asked && <p className="mt-0.5 line-clamp-2 text-[0.9rem] leading-snug text-ink-soft">{asked.startsWith("Basket") ? tx.basket : tx.asked(asked.length > 80 ? `${asked.slice(0, 77)}…` : asked)}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.88rem] leading-snug text-ink-soft">
          <Badge tone={tone}>{tx.status[x.status] ?? x.status}</Badge>
          {(x.sample || x.orderId.startsWith("ord_sample_")) && <SamplePill lang={f.lang} />}
          <span>
            {tx.head.delivery} <span className="font-medium text-ink">{f.day(x.deliveryDate)}</span>
            {x.status !== "history" && (
              <>
                {", "}
                <span className={waiting ? "font-semibold text-ink" : ""}>{authorisedText(x, f.lang)}</span>
              </>
            )}
          </span>
        </p>
      </div>
      <div className="relative z-10 col-start-2 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden sm:col-start-3 sm:mt-0 sm:justify-end">
        {repeatable && (
          <>
            <Button kind="secondary" size="sm" onClick={() => agent.send({ kind: "repeat", request: request! })} ariaLabel={`${tx.repeat}: ${what}`}>
              <Repeat aria-hidden size={14} />
              {tx.repeat}
            </Button>
            <Button
              kind="quiet"
              className="!min-h-9 text-[0.9rem] pointer-coarse:!min-h-11"
              onClick={() => {
                agent.setFollowUp(request);
                agent.focus();
              }}
            >
              {tx.withChange}
            </Button>
          </>
        )}
      </div>
      <span className="hidden items-center justify-end gap-2 text-right font-semibold tabular sm:flex">
        {money(x.totalCents)}
        {linked ? <ChevronRight aria-hidden size={18} className="shrink-0 text-ink-faint transition-colors group-hover:text-petrol" /> : <span className="w-[18px]" />}
      </span>
    </li>
  );
}

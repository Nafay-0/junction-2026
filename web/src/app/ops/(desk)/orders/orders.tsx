"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrdersPage } from "@/server/ops/orders-view";
import { Badge } from "../../../_ui/kit";
import { day as dayWords } from "../../../_ui/plain";
import { STATUS_WORD, decidedWords, fi, money, since, statusTone, when, whenSeconds } from "../../_ui/format";
import { Button, Empty, LiveMark, LoadError, Loading, PageHead, useNow, useOps } from "../../_ui/kit";
import { useUrlState } from "../../_ui/filters";
import { Table } from "../../_ui/parts";

/** The source in a few words, for the list (the order's page says it in full). */
const SOURCE_SHORT: Record<string, string> = { conversation: "typed, in the conversation", voice: "by voice", photo: "from a photo", menu: "menu planner", assistant: "store assistant", store: "the store", mcp: "outside agent, MCP", rest: "outside agent, REST", connector: "connector address", aiven_agent: "Aiven Managed Agent", watch_renewal: "watch: renewal", watch_substitute: "watch: substitute", backup: "watch: backup used", offer: "accepted offer", presenter: "presenter show" };

/** Every order from every source, newest first, filtered and paged on the server. */
export function OrdersScreen() {
  const [q, setQ] = useUrlState("q", "");
  const [kitchen, setKitchen] = useUrlState("kitchen", "");
  const [agent, setAgent] = useUrlState("agent", "");
  const [source, setSource] = useUrlState("source", "");
  const [status, setStatus] = useUrlState("status", "");
  const [day, setDay] = useUrlState("day", "");
  const [page, setPage] = useUrlState("page", "1");
  const [typed, setTyped] = useState(q);
  const params = new URLSearchParams(Object.entries({ q, kitchen, agent, source, status, day, page }).filter(([, v]) => v)).toString();
  const live = useOps<OrdersPage>(`/ops-api/orders${params ? `?${params}` : ""}`, { pollMs: 5000 });
  const now = useNow();
  const d = live.data;
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage("1");
  };
  return (
    <>
      <PageHead
        title="Orders"
        purpose="Every order an agent placed, from every door, newest first. Open one for its whole timeline."
        right={d && <LiveMark at={whenSeconds(d.at)} error={live.error} />}
      />
      <form
        className="mb-4 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPage("1");
        }}
      >
        <label className="col-span-2 min-w-0 sm:flex-[2_1_16rem]">
          <span className="text-[0.8rem] font-medium text-ink-soft">Search</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Kitchen, product, or a question"
            title="An order id, a kitchen, a product, or in words: “refusals for allergens today”"
            className="field mt-1 w-full"
          />
        </label>
        <Pick label="Kitchen" value={kitchen} set={reset(setKitchen)} options={d?.facets.kitchens} />
        <Pick label="Agent" value={agent} set={reset(setAgent)} options={d?.facets.agents} />
        <Pick label="Door" value={source} set={reset(setSource)} options={d?.facets.sources} />
        <Pick label="Status" value={status} set={reset(setStatus)} options={d?.facets.statuses} />
        <label className="min-w-0 sm:flex-[0_1_10rem]">
          <span className="text-[0.8rem] font-medium text-ink-soft">Day</span>
          <input type="date" value={day} onChange={(e) => reset(setDay)(e.target.value)} className="field mt-1 w-full" title="Placed or delivered on this day" />
        </label>
        <span className="flex items-end gap-2">
          <Button type="submit" kind="primary" size="md">
            Search
          </Button>
          {(q || kitchen || agent || source || status || day) && (
            <Button
              size="md"
              onClick={() => {
                for (const set of [setQ, setKitchen, setAgent, setSource, setStatus, setDay]) set("");
                setTyped("");
                setPage("1");
              }}
            >
              Clear
            </Button>
          )}
        </span>
      </form>
      <LoadError message={live.error} />
      {d?.search && (
        <p className="mb-2 text-[0.88rem] text-ink-soft">
          {fi(d.search.answer)}
        </p>
      )}
      {!d ? (
        <Loading label="Reading the orders…" />
      ) : d.rows.length === 0 ? (
        <Empty title="No order matches">Clear the filters, or place an order from the store or an agent.</Empty>
      ) : (
        <>
          <p className="mb-2 text-[0.88rem] text-ink-soft">
            {d.total.toLocaleString("fi-FI")} order{d.total === 1 ? "" : "s"}
            {d.pages > 1 ? `, page ${d.page} of ${d.pages}` : ""}.
          </p>
          <Table label="Orders">
            <thead>
              <tr>
                <th>When</th>
                <th>Kitchen and door</th>
                <th>What</th>
                <th className="text-right">Total</th>
                <th>Delivery</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const how = decidedWords(r.decided);
                return (
                  <tr key={r.orderId}>
                    <td className="whitespace-nowrap tabular">
                      <Link href={`/ops/orders/${r.orderId}`} title={r.orderId} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                        {when(r.at)}
                      </Link>
                    </td>
                    <td className="min-w-[9rem] max-w-[14rem]">
                      <span className="block leading-snug">{r.orgName}</span>
                      <span className="block text-[0.8rem] leading-snug text-ink-soft" title={r.agentLabel}>
                        {SOURCE_SHORT[r.source] ?? fi(r.sourceText)}
                      </span>
                    </td>
                    <td className="min-w-[11rem] max-w-[22rem]" title={r.what}>
                      <span className="line-clamp-2 leading-snug">{r.what}</span>
                      {r.lineCount > 1 && <span className="block text-[0.8rem] text-ink-soft">{r.lineCount} lines</span>}
                    </td>
                    <td className="whitespace-nowrap text-right font-medium tabular">{money(r.totalCents)}</td>
                    <td className="whitespace-nowrap tabular">{r.deliveryDate ? dayWords(r.deliveryDate) : "–"}</td>
                    <td className="min-w-[10rem] max-w-[16rem]">
                      <div>
                        <Badge tone={statusTone(r.status)}>{STATUS_WORD[r.status] ?? fi(r.statusWords)}</Badge>
                      </div>
                      <span className="mt-1 block text-[0.8rem] leading-snug text-ink-soft">
                        {how.head}
                        {r.waitingSinceAt && now !== undefined ? `, ${since(r.waitingSinceAt, now)}` : ""}
                        {how.rule && <span className="block">{how.rule}</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {d.pages > 1 && (
            <nav aria-label="Pages" className="mt-3 flex items-center gap-2">
              <Button disabled={d.page <= 1} onClick={() => setPage(String(d.page - 1))}>
                Newer
              </Button>
              <span className="text-[0.88rem] text-ink-soft tabular">
                {d.page} / {d.pages}
              </span>
              <Button disabled={d.page >= d.pages} onClick={() => setPage(String(d.page + 1))}>
                Older
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function Pick({ label, value, set, options }: { label: string; value: string; set: (v: string) => void; options?: { id: string; label: string; n: number }[] }) {
  return (
    <label className="min-w-0 sm:flex-[1_1_10rem]">
      <span className="text-[0.8rem] font-medium text-ink-soft">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="field mt-1 w-full">
        <option value="">All</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} ({o.n})
          </option>
        ))}
      </select>
    </label>
  );
}

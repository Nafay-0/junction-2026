"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrderRow, OrdersPage } from "@/server/ops/orders-view";
import { Badge } from "../../../_ui/kit";
import { money, since, whenSeconds } from "../../_ui/format";
import { Button, Empty, LiveMark, LoadError, Loading, PageHead, useNow, useOps } from "../../_ui/kit";
import { useUrlState } from "../../_ui/filters";
import { Table } from "../../_ui/parts";

const STATUS_TONE: Record<OrderRow["status"], "waiting" | "good" | "refused" | "neutral"> = { pending_approval: "waiting", committed: "good", rejected: "refused", declined: "neutral", withdrawn: "neutral", expired: "neutral", replaced: "neutral" };
/** The source in a few words, for the list (the order's page says it in full). */
const SOURCE_SHORT: Record<string, string> = { conversation: "typed, in the conversation", voice: "by voice", photo: "from a photo", menu: "menu planner", assistant: "store assistant", store: "the store", mcp: "outside agent, MCP", rest: "outside agent, REST", connector: "connector address", aiven_agent: "Aiven Managed Agent", watch_renewal: "watch: renewal", watch_substitute: "watch: substitute", backup: "watch: backup used", offer: "accepted offer", presenter: "presenter show" };
const DECIDED_TONE: Record<OrderRow["decided"]["kind"], "good" | "waiting" | "refused" | "neutral"> = { alone: "good", person: "waiting", refused: "refused", open: "neutral" };

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
        purpose="Every order from every source, newest first: the kitchen's own agent typed or spoken, from a photo, an outside agent over MCP or REST, the Aiven agent, the watch, an accepted offer, a backup, the presenter show. Who placed it and through which door, how it was decided and where it stands now. Open one for its whole life."
        right={d && <LiveMark at={whenSeconds(d.at)} error={live.error} />}
      />
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPage("1");
        }}
      >
        <label className="min-w-0 flex-[2_1_16rem]">
          <span className="text-[0.8rem] font-medium text-ink-soft">Search: an id, a kitchen, a product, or in words (&quot;refusals for allergens today&quot;)</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="ord_…, Laakso, milk, sign-offs over the limit today" className="field mt-1 w-full" />
        </label>
        <Pick label="Kitchen" value={kitchen} set={reset(setKitchen)} options={d?.facets.kitchens} />
        <Pick label="Agent" value={agent} set={reset(setAgent)} options={d?.facets.agents} />
        <Pick label="Source and door" value={source} set={reset(setSource)} options={d?.facets.sources} />
        <Pick label="Status" value={status} set={reset(setStatus)} options={d?.facets.statuses} />
        <label className="flex-[0_1_10rem]">
          <span className="text-[0.8rem] font-medium text-ink-soft">Day (placed or delivered)</span>
          <input type="date" value={day} onChange={(e) => reset(setDay)(e.target.value)} className="field mt-1 w-full" />
        </label>
        <Button type="submit" kind="primary" size="md">
          Search
        </Button>
        {(q || kitchen || agent || source || status || day) && (
          <Button
            onClick={() => {
              for (const set of [setQ, setKitchen, setAgent, setSource, setStatus, setDay]) set("");
              setTyped("");
              setPage("1");
            }}
          >
            Clear
          </Button>
        )}
      </form>
      <LoadError message={live.error} />
      {d?.search && (
        <p className="mb-2 text-[0.88rem] text-ink-soft">
          The audit trail ({d.search.path}): {d.search.answer}
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
                <th>Kitchen</th>
                <th>Placed by</th>
                <th>What</th>
                <th className="text-right">Total</th>
                <th>Delivery</th>
                <th>Decided</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.orderId}>
                  <td className="whitespace-nowrap tabular">
                    <Link href={`/ops/orders/${r.orderId}`} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                      {whenSeconds(r.at)}
                    </Link>
                    <span className="block text-[0.78rem] text-ink-soft">{r.orderId}</span>
                  </td>
                  <td className="min-w-[8rem]">{r.orgName}</td>
                  <td className="min-w-[10rem] max-w-[15rem]">
                    <span className="line-clamp-2">{r.agentLabel}</span>
                    <span className="block text-[0.8rem] leading-snug text-ink-soft">{SOURCE_SHORT[r.source] ?? r.sourceText}</span>
                  </td>
                  <td className="min-w-[12rem] max-w-[20rem]" title={r.what}>
                    <span className="line-clamp-2">{r.what}</span>
                    <span className="block text-[0.8rem] text-ink-soft">
                      {r.lineCount} line{r.lineCount === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="text-right tabular">{money(r.totalCents)}</td>
                  <td className="whitespace-nowrap tabular">{r.deliveryDate ?? "–"}</td>
                  <td className="max-w-[14rem]">
                    <Badge tone={DECIDED_TONE[r.decided.kind]}>{r.decided.kind === "alone" ? "Agent alone" : r.decided.kind === "person" ? "To a person" : r.decided.kind === "refused" ? "Refused" : "Open"}</Badge>
                    <span className="block text-[0.8rem] text-ink-soft">{r.decided.words}</span>
                  </td>
                  <td className="max-w-[13rem]">
                    <Badge tone={STATUS_TONE[r.status]}>{r.statusWords}</Badge>
                    {r.waitingSinceAt && now !== undefined && <span className="block text-[0.8rem] text-ink-soft">for {since(r.waitingSinceAt, now)}</span>}
                  </td>
                </tr>
              ))}
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
    <label className="min-w-0 flex-[1_1_10rem]">
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

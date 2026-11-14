"use client";

import * as React from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartNoAxesColumn, Cpu, Globe, MessagesSquare, Monitor, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/db/admin";
import { Empty, PageHeading, Panel } from "./admin-shell";
import { count, dayLabel, share, usd } from "./format";

/* What the money went on, in the order the bars are stacked. One colour each, everywhere on the page. */
const SPEND = [
  { key: "modelUsd", name: "Model", color: "var(--chart-1)" },
  { key: "workerUsd", name: "Sub-agents", color: "var(--chart-3)" },
  { key: "exaUsd", name: "Exa", color: "var(--chart-2)" },
] as const;

const total = (s: { modelUsd: number; workerUsd: number; exaUsd: number }) => s.modelUsd + s.workerUsd + s.exaUsd;

/** The admin's overview: who there is, how much the app is used, and what that costs. */
export function OverviewScreen({ data }: { data: Overview }) {
  const spent = total(data.period);
  const quiet = data.period.requests === 0;
  const range = `the last ${data.days} days`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="Overview"
        lead="Who is here, how much they use it, and what it costs."
        action={
          <div role="group" aria-label="Period" className="flex items-center gap-1 rounded-full border border-border bg-card p-1 text-[0.8rem] shadow-card">
            {[14, 30].map((days) => (
              <Link
                key={days}
                href={days === 14 ? "/admin" : `/admin?days=${days}`}
                scroll={false}
                aria-current={data.days === days ? "true" : undefined}
                className={cn("flex h-7 items-center rounded-full px-3 font-medium transition-colors", data.days === days ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {days} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Figure icon={<Users />} label="Accounts" value={count(data.accounts.total)} note={data.accounts.blocked > 0 ? `${data.accounts.blocked} blocked` : "none blocked"} />
        <Figure icon={<Users />} label="Active this week" value={count(data.accounts.active7d)} note="signed in during the last 7 days" />
        <Figure
          icon={<MessagesSquare />}
          label="Conversations"
          value={count(data.conversations.total)}
          note={data.conversations.total > 0 ? `${count(data.conversations.web)} on the web, ${count(data.conversations.desktop)} in the desktop app` : "none saved yet"}
        />
        <Figure icon={<Cpu />} label="Requests" value={count(data.period.requests)} note={`to a model, in ${range}`} />
        <Figure icon={<ChartNoAxesColumn />} label="Tokens" value={count(data.period.tokens)} note={`in and out, sub-agents included, in ${range}`} />
        <Figure label="Cost" value={usd(spent)} note={`in ${range}. ${usd(total(data.allTime))} since the start`} accent />
      </div>

      <Daily data={data} quiet={quiet} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Where the money goes" note={`In ${range}.`}>
          {quiet ? (
            <Empty icon={<ChartNoAxesColumn />} title="Nothing spent in this period">
              The split between the model, its sub-agents and Exa appears here as soon as someone asks for something.
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={SPEND.map((s) => `${s.name} ${usd(data.period[s.key])}`).join(", ")}>
                {SPEND.map((s) => (
                  <span key={s.key} style={{ width: `${share(data.period[s.key], spent)}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
                ))}
              </div>
              <ul className="flex flex-col gap-2.5">
                {SPEND.map((s) => (
                  <li key={s.key} className="flex items-center gap-2.5 text-[0.86rem]">
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                    <span className="flex-1">{s.name}</span>
                    <span className="nums text-muted-foreground">{Math.round(share(data.period[s.key], spent))}%</span>
                    <span className="nums w-20 text-right font-medium">{usd(data.period[s.key])}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-border pt-3 text-[0.78rem] leading-snug text-muted-foreground">
                {count(data.period.exaCalls)} Exa calls. {data.period.activeAccounts === 1 ? "One account" : `${count(data.period.activeAccounts)} accounts`} asked for something.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Web and desktop app" note={`Requests in ${range}, by where they were made.`}>
          {quiet ? (
            <Empty icon={<Monitor />} title="No requests in this period">
              The web can search, read and show. The desktop app can also act in its live browser. Their share of the use appears here.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-4">
              {data.byClient.map((c) => (
                <li key={c.client} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-[0.86rem]">
                    <span className="flex size-6 items-center justify-center rounded-md bg-brand-soft text-brand [&_svg]:size-3.5">{c.client === "desktop" ? <Monitor /> : <Globe />}</span>
                    <span className="flex-1 font-medium">{c.client === "desktop" ? "Desktop app" : "Web"}</span>
                    <span className="nums text-muted-foreground">{count(c.requests)} requests</span>
                    <span className="nums w-20 text-right font-medium">{usd(c.costUsd)}</span>
                  </div>
                  <Meter value={share(c.requests, data.period.requests)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="By model" note={`In ${range}.`}>
          {data.byModel.length === 0 ? (
            <Empty icon={<Cpu />} title="No model has been used in this period">
              Each model people pick is listed here with its requests, tokens and cost.
            </Empty>
          ) : (
            <Rows
              head={["Model", "Requests", "Tokens", "Cost"]}
              rows={data.byModel.map((m) => ({ key: m.label, name: m.label, cells: [count(m.requests), count(m.tokens), usd(m.costUsd)], weight: share(m.costUsd, spent) }))}
            />
          )}
        </Panel>

        <Panel title="Heaviest users" note={`By cost, in ${range}.`} action={<Link href="/admin/accounts" className="text-[0.8rem] font-medium text-brand underline-offset-4 hover:underline">All accounts</Link>}>
          {data.topAccounts.length === 0 ? (
            <Empty icon={<Users />} title="Nobody has used it in this period">
              The accounts that cost the most are listed here.
            </Empty>
          ) : (
            <Rows
              head={["Account", "Requests", "Tokens", "Cost"]}
              rows={data.topAccounts.map((a, i) => ({ key: a.id ?? `gone-${i}`, name: a.name, sub: a.email, cells: [count(a.requests), count(a.tokens), usd(a.costUsd)], weight: share(a.costUsd, spent) }))}
            />
          )}
        </Panel>
      </div>

      <p className="text-[0.74rem] text-subtle">Days are counted in UTC. Costs are estimates at list prices.</p>
    </div>
  );
}

function Figure({ icon, label, value, note, accent }: { icon?: React.ReactNode; label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border bg-card/80 p-4 shadow-card backdrop-blur-sm", accent ? "border-brand/30" : "border-border")}>
      <div className="flex items-center gap-2 text-[0.76rem] font-medium tracking-wide text-muted-foreground">
        {icon ? <span className="text-subtle [&_svg]:size-3.5">{icon}</span> : <span className="size-2 rounded-full bg-brand" />}
        {label}
      </div>
      {/* Figures are set in the interface type: in the serif, a 1 reads as an l. */}
      <div className={cn("nums mt-2.5 text-[1.7rem] leading-none font-semibold tracking-tight sm:text-[1.95rem]", accent && "text-brand")}>{value}</div>
      <p className="mt-2 text-[0.74rem] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(value, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

/** A small table whose first column is a name and whose rows carry a bar for their share of the cost. */
function Rows({ head, rows }: { head: [string, string, string, string]; rows: Array<{ key: string; name: string; sub?: string; cells: [string, string, string]; weight: number }> }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[19rem] border-separate border-spacing-0 text-[0.84rem]">
        <thead>
          <tr className="text-left text-[0.7rem] font-medium tracking-wider text-subtle uppercase">
            <th className="px-1 pb-2 font-medium">{head[0]}</th>
            <th className="hidden px-2 pb-2 text-right font-medium sm:table-cell">{head[1]}</th>
            <th className="px-2 pb-2 text-right font-medium">{head[2]}</th>
            <th className="px-1 pb-2 text-right font-medium">{head[3]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="w-full max-w-0 border-t border-border px-1 py-2.5">
                <div className="truncate font-medium">{row.name}</div>
                {row.sub ? <div className="truncate text-[0.74rem] text-muted-foreground">{row.sub}</div> : null}
                <div className="mt-1.5">
                  <Meter value={row.weight} />
                </div>
              </td>
              <td className="nums hidden w-20 border-t border-border px-2 py-2.5 text-right align-top text-muted-foreground sm:table-cell">{row.cells[0]}</td>
              <td className="nums w-16 border-t border-border px-2 py-2.5 text-right align-top text-muted-foreground">{row.cells[1]}</td>
              <td className="nums w-20 border-t border-border px-1 py-2.5 text-right align-top font-medium">{row.cells[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────── The chart ───────────────────────── */

type Measure = "cost" | "requests" | "tokens";
const MEASURES: Array<{ id: Measure; label: string }> = [
  { id: "cost", label: "Cost" },
  { id: "requests", label: "Requests" },
  { id: "tokens", label: "Tokens" },
];
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };

function Daily({ data, quiet }: { data: Overview; quiet: boolean }) {
  const [measure, setMeasure] = React.useState<Measure>("cost");
  const rows = React.useMemo(() => data.daily.map((d) => ({ ...d, label: dayLabel(d.day) })), [data.daily]);
  const format = measure === "cost" ? usd : count;
  const bars = measure === "cost" ? SPEND.map((s) => ({ key: s.key as string, name: s.name, color: s.color })) : [{ key: measure, name: measure === "requests" ? "Requests" : "Tokens", color: "var(--chart-1)" }];

  return (
    <Panel
      title="Day by day"
      note={measure === "cost" ? "What each day cost, split into the model, its sub-agents and Exa." : measure === "requests" ? "Requests to a model each day." : "Tokens in and out each day, sub-agents included."}
      action={
        <div role="group" aria-label="What the chart shows" className="flex items-center gap-1 rounded-full border border-border bg-background p-1 text-[0.78rem]">
          {MEASURES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={measure === m.id}
              onClick={() => setMeasure(m.id)}
              className={cn("h-7 rounded-full px-3 font-medium transition-colors", measure === m.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      {quiet ? (
        <Empty icon={<ChartNoAxesColumn />} title={`Nothing has been asked in the last ${data.days} days`}>
          Each day gets a bar here as soon as someone hands over a task.
        </Empty>
      ) : (
        <div role="figure" aria-label={`${MEASURES.find((m) => m.id === measure)?.label} per day`} className="select-none [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
          {measure === "cost" ? (
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.76rem] text-muted-foreground">
              {SPEND.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="h-[240px] sm:h-[280px]">
            <BarChart data={rows} responsive style={{ width: "100%", height: "100%" }} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="label" axisLine={{ stroke: "var(--border)" }} tickLine={false} tick={AXIS_TICK} tickMargin={8} minTickGap={18} interval="preserveStartEnd" />
              <YAxis width={measure === "cost" ? 52 : 40} axisLine={false} tickLine={false} tick={AXIS_TICK} tickCount={4} tickFormatter={(v: number) => (measure === "cost" ? (v === 0 ? "$0" : usd(v)) : count(v))} allowDecimals={measure === "cost"} />
              <Tooltip
                isAnimationActive={false}
                cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="pointer-events-none min-w-[10rem] rounded-lg border border-border bg-popover px-2.5 py-2 text-[0.75rem] text-popover-foreground shadow-float">
                      <div className="mb-1.5 font-medium">{String(label)}</div>
                      <div className="flex flex-col gap-1">
                        {payload.map((p) => (
                          <div key={String(p.dataKey)} className="flex items-center gap-2">
                            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                            <span className="flex-1 text-muted-foreground">{p.name}</span>
                            <span className="nums font-medium">{format(Number(p.value ?? 0))}</span>
                          </div>
                        ))}
                        {payload.length > 1 ? (
                          <div className="mt-1 flex items-center gap-2 border-t border-border pt-1.5">
                            <span className="flex-1 text-muted-foreground">Together</span>
                            <span className="nums font-medium">{format(payload.reduce((n, p) => n + Number(p.value ?? 0), 0))}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null
                }
              />
              {bars.map((bar, i) => (
                <Bar
                  key={bar.key}
                  dataKey={bar.key}
                  name={bar.name}
                  stackId="day"
                  fill={bar.color}
                  radius={i === bars.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={38}
                  stroke={bars.length > 1 ? "var(--card)" : undefined}
                  strokeWidth={bars.length > 1 ? 1 : 0}
                  isAnimationActive
                  animationDuration={450}
                  animationEasing="ease-out"
                />
              ))}
            </BarChart>
          </div>
        </div>
      )}
    </Panel>
  );
}

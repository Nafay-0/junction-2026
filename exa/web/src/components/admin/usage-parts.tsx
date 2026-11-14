"use client";

import * as React from "react";
import { History } from "lucide-react";
import { SPEND_LABELS, totalSpend, type Spend } from "@/lib/agent/stats";
import type { ModeUsage, ModelUsage } from "@/lib/db/admin";
import { ModeIcon } from "@/components/butler/mode-icon";
import { count, share, usd } from "./format";

/*
 * The pieces the admin's overview and one account's usage are both made of: what the money went
 * on, by kind, and the small tables by mode and by model.
 */

/** The four kinds of cost, in the order the bars are stacked. One colour each, everywhere in the admin area. */
const COLORS: Record<keyof Spend, string> = { llm: "var(--chart-1)", exa: "var(--chart-2)", voice: "var(--chart-3)", decisions: "var(--chart-4)" };
export const SPEND_KINDS = SPEND_LABELS.map(({ key, label }) => ({ key, name: label, color: COLORS[key] }));

/** What each kind covers, for the line under a split. */
export const SPEND_MEANING = "LLMs are the answering models and their sub-agents, Exa is search and reading, Voice is live calls and voice input, Decisions is checking pages against wishes.";

export { totalSpend };

/** A bar cut into the four kinds, and a line for each: its share and its cost. */
export function SpendSplit({ spend }: { spend: Spend }) {
  const spent = totalSpend(spend);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={SPEND_KINDS.map((s) => `${s.name} ${usd(spend[s.key])}`).join(", ")}>
        {SPEND_KINDS.map((s) => (
          <span key={s.key} style={{ width: `${share(spend[s.key], spent)}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <ul className="flex flex-col gap-2.5">
        {SPEND_KINDS.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-[0.86rem]">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="flex-1">{s.name}</span>
            <span className="nums text-muted-foreground">{Math.round(share(spend[s.key], spent))}%</span>
            <span className="nums w-20 text-right font-medium">{usd(spend[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Meter({ value, tone = "brand" }: { value: number; tone?: "brand" | "danger" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-[width] duration-500 ${tone === "danger" ? "bg-destructive" : "bg-brand"}`} style={{ width: `${Math.max(value, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export type RowOf = { key: string; name: string; sub?: string; icon?: React.ReactNode; cells: [string, string, string]; weight: number };

/** A small table whose first column is a name and whose rows carry a bar for their share of the cost. */
export function Rows({ head, rows }: { head: [string, string, string, string]; rows: RowOf[] }) {
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
                <div className="flex min-w-0 items-center gap-2">
                  {row.icon ? <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand [&_svg]:size-3">{row.icon}</span> : null}
                  <span className="truncate font-medium">{row.name}</span>
                </div>
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

/** The lines of a "by mode" table: each mode with its icon, then voice, then what came before modes. */
export function modeRowsOf(rows: ModeUsage[], spent: number): RowOf[] {
  return rows.map((m) => ({
    key: m.mode,
    name: m.label,
    sub: m.mode === "voice" ? "Live calls, voice input and the tools a call ran" : m.mode === "before" ? "Typed requests on models that stand behind no mode" : undefined,
    icon: m.mode === "before" ? <History aria-hidden /> : <ModeIcon mode={m.mode} />,
    cells: [count(m.requests), count(m.tokens), usd(m.costUsd)],
    weight: share(m.costUsd, spent),
  }));
}

/** The lines of a "by model" table: the admin sees which model did the work. */
export function modelRowsOf(rows: ModelUsage[], spent: number): RowOf[] {
  return rows.map((m) => ({ key: m.label, name: m.label, cells: [count(m.requests), count(m.tokens), usd(m.costUsd)], weight: share(m.costUsd, spent) }));
}

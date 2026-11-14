"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Cloud, X } from "lucide-react";
import type { ReactNode } from "react";
import { RULE_TITLE, clockSeconds } from "../../../../_ui/plain";
import { fi, stamp } from "../../../_ui/format";

/**
 * Building blocks of the Platform section (what runs on Aiven), in the shared system: petrol for what runs and flows,
 * the gate's black for refusals, lime only on the one action (sending in an agent).
 */
const TABS = [
  { href: "/ops/platform", label: "The platform", what: "Which service does which job, live" },
  { href: "/ops/platform/agent", label: "Send in an Aiven agent", what: "A buyer that runs on Aiven" },
  { href: "/ops/platform/ask", label: "Ask the platform", what: "Answers computed from the data" },
  { href: "/ops/platform/observe", label: "Observe", what: "The dashboard, inside the portal" },
  { href: "/ops/platform/stream", label: "The stream", what: "Kafka, live, with consumer lag" },
];

export function PlatformTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Platform" className="mb-6 flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 sm:inline-flex">
      {TABS.map((t) => {
        const on = t.href === "/ops/platform" ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} title={t.what} className={`flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[0.9rem] font-medium transition-[background-color,color,box-shadow] duration-150 pointer-coarse:min-h-10 ${on ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}>
            {t.href === "/ops/platform/agent" && <span aria-hidden className="size-2 rounded-full bg-lime ring-2 ring-lime/30" />}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function OnAiven({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-petrol-soft px-2.5 text-[0.76rem] font-medium leading-6 text-petrol-deep ${className}`} title="Runs on Aiven">
      <Cloud aria-hidden size={12} strokeWidth={2.2} />
      On Aiven
    </span>
  );
}

/** Up, down, or not configured: a petrol square when it answers, a crossed one when it does not, an outline when off. */
export function Status({ ok, label }: { ok: boolean | null | undefined; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.8rem] font-semibold leading-6 ${ok === true ? "bg-good-soft text-good" : ok === false ? "bg-bad-soft text-bad" : "bg-surface text-ink-soft"}`}>
      {ok === false ? <X aria-hidden size={12} strokeWidth={3} /> : <span aria-hidden className={`inline-block size-1.5 rounded-full ${ok === true ? "bg-good" : "border border-current"}`} />}
      {label ?? (ok === true ? "answers" : ok === false ? "not answering" : "not configured")}
    </span>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[0.78rem] ${className}`}>{children}</code>;
}

/** Rows as a small table: what a query returned, shown as it came back. */
export function Rows({ columns, rows, max = 12, empty = "No rows." }: { columns: string[]; rows: Record<string, unknown>[]; max?: number; empty?: string }) {
  if (!rows.length) return <p className="text-[0.84rem] text-ink-soft">{empty}</p>;
  const cols = columns.length ? columns : Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper">
      <table className="w-full border-collapse text-left text-[0.88rem] tabular">
        <thead>
          <tr className="border-b border-line bg-surface/60">
            {cols.map((c) => (
              <th key={c} scope="col" title={c} className="whitespace-nowrap px-3 py-2 text-[0.8rem] font-semibold text-ink-soft">
                {columnWord(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {cols.map((c) => (
                <td key={c} className="max-w-[38ch] truncate px-3 py-1.5 align-top" title={fmtCell(r[c])}>
                  {fmtCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="border-t border-line px-3 py-1.5 text-[0.76rem] text-ink-soft">and {rows.length - max} more rows</p>}
    </div>
  );
}

const COLUMN: Record<string, string> = {
  agent_id: "Agent",
  value_eur: "Value, €",
  signoffs: "Sign-offs",
  ts: "When",
  at: "When",
  usd: "US dollars",
  ok: "Worked",
  checked_at: "Checked",
  preset: "Task",
  run: "Run",
  ms: "Milliseconds",
  kind: "Kind",
  source: "Source",
};

/** A SQL column name as a table header: "agent_id" -> "Agent", "partner_calls" -> "Partner calls". The raw name is the header's title. */
export function columnWord(c: string): string {
  return COLUMN[c] ?? c.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase());
}

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("fi-FI") : v.toLocaleString("fi-FI", { maximumFractionDigits: 3 });
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return `${stamp(s)}.${clockSeconds(s).slice(-2)}`;
  if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(s) && RULE_TITLE[s]) return RULE_TITLE[s];
  return /^(?:agent|model|featherless|req|ord)[_:]/.test(s) ? s : fi(s);
}

/** Bars over time, stacked. Plain SVG; each series a shade of ink, refusals in safety yellow. */
export function Bars({ rows, series, height = 120, label }: { rows: Record<string, unknown>[]; series: { key: string; label: string; tone: "ink" | "soft" | "pale" | "safety" }[]; height?: number; label: string }) {
  // Petrol shades for what flowed through; the gate's black for refusals.
  const fill = { ink: "var(--color-petrol)", soft: "color-mix(in srgb, var(--color-petrol) 50%, white)", pale: "var(--color-line)", safety: "var(--color-safety-ink)" };
  const totals = rows.map((r) => series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0));
  const max = Math.max(1, ...totals);
  const w = 600;
  const bw = rows.length ? w / rows.length : w;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-[120px] w-full" role="img" aria-label={label}>
        <line x1="0" y1={height - 0.5} x2={w} y2={height - 0.5} stroke="var(--color-line)" strokeWidth="1" />
        {rows.map((r, i) => {
          let y = height;
          return (
            <g key={i}>
              <title>{`${fmtCell(r.t)}: ${series.map((s) => `${s.label} ${Number(r[s.key]) || 0}`).join(", ")}`}</title>
              {series.map((s) => {
                const v = Number(r[s.key]) || 0;
                const h = (v / max) * (height - 6);
                y -= h;
                return v ? <rect key={s.key} x={i * bw + bw * 0.12} y={y} width={Math.max(1, bw * 0.76)} height={h} rx={Math.min(3, bw * 0.2)} fill={fill[s.tone]} /> : null;
              })}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-[0.82rem] text-ink-soft">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rounded-xs" style={{ background: fill[s.tone] }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto">highest bar {max}</span>
      </figcaption>
    </figure>
  );
}

/** A horizontal bar per row: label, count. */
export function HBars({ rows, labelKey, valueKey, safety = false }: { rows: Record<string, unknown>[]; labelKey: string; valueKey: string; safety?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <p className="text-[0.84rem] text-ink-soft">None in this window.</p>;
  return (
    <ul className="space-y-1">
      {rows.slice(0, 8).map((r) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <li key={String(r[labelKey])} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3rem] items-center gap-2 text-[0.9rem]">
            <span className="truncate" title={String(r[labelKey])}>
              {RULE_TITLE[String(r[labelKey])] ?? String(r[labelKey]).replaceAll("_", " ")}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-surface">
              <span className={`block h-full rounded-full ${safety ? "bg-safety-ink" : "bg-petrol"}`} style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold tabular">{v}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SqlBox({ sql, summary = "The query" }: { sql: string; summary?: string }) {
  return (
    <details className="group mt-2.5 text-[0.78rem]">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-full text-[0.84rem] text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden size={14} className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        {summary}
      </summary>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface px-3 py-2.5 font-mono text-[0.76rem] leading-snug">{sql}</pre>
    </details>
  );
}

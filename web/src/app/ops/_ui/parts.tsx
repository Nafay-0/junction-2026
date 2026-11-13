"use client";

import type { ReactNode } from "react";
import { Target } from "../../_ui/target";
import { fi, num } from "./format";

/**
 * Pieces the operations side needs that the shared system does not have yet: a dense table, an outcome stamp,
 * a counted bar, the catalogue funnel and the gate's inspection grid. Same tokens, same square geometry.
 * Listed for the system's owner in web/docs/DESIGN-OPS.md.
 */

// ---------- dense table ----------

/** A dense table on paper: petrol header rule, hairline rows, a petrol-soft wash on hover when rows are links. */
export function Table({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={`overflow-x-auto bg-paper ${className}`}>
      <table aria-label={label} className="w-full border-collapse text-left text-[0.92rem] [&_td]:border-t [&_td]:border-line/70 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:px-3 [&_th]:pb-2 [&_th]:pt-3 [&_th]:text-[0.8rem] [&_th]:whitespace-nowrap [&_th]:font-semibold [&_th]:text-ink-soft [&_thead]:border-b-2 [&_thead]:border-petrol">
        {children}
      </table>
    </div>
  );
}

// ---------- outcome stamp ----------

/**
 * The outcome of a request or order as a stamp in the display face. A signed order: petrol. Waiting on a person:
 * the hazard frame (a person must act). Refused or declined: the black slab with yellow type (the gate stopped it).
 */
export function Stamp({ kind, label, animate = false, className = "" }: { kind: string; label: string; animate?: boolean; className?: string }) {
  const look =
    kind === "committed"
      ? "border-[3px] border-petrol text-petrol"
      : kind === "waiting"
        ? "hazard-frame text-safety"
        : kind === "refused" || kind === "declined"
          ? "bg-safety-ink text-safety"
          : "border-[3px] border-dashed border-ink-soft text-ink-soft";
  return (
    <span className={`inline-flex max-w-[22rem] items-center gap-2.5 px-3 py-2 ${look} ${animate ? "stamp" : "-rotate-1"} ${className}`}>
      {kind === "committed" ? <span aria-hidden className="size-3 shrink-0 bg-petrol" /> : kind === "waiting" || kind === "refused" || kind === "declined" ? <Target size={22} tone="safety" /> : null}
      <span className="display text-[1.25rem] leading-[1.05]">{fi(label)}</span>
    </span>
  );
}

// ---------- a counted bar ----------

/** A count with a bar scaled against the largest in its group, for "ruled out, and why" and rule tallies. */
export function CountBar({ count, max, label, sub, tone = "petrol" }: { count: number; max: number; label: ReactNode; sub?: ReactNode; tone?: "petrol" | "ink" | "safety" }) {
  const w = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  const bar = tone === "safety" ? "bg-safety" : tone === "ink" ? "bg-ink" : "bg-petrol";
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span className="display text-right text-[1.35rem] tabular">{num(count)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-2.5 shrink-0 ${bar}`} style={{ width: `${w * 0.6}%` }} />
        </div>
        <p className="mt-0.5 text-[0.92rem] font-semibold leading-snug">{label}</p>
        {sub && <p className="text-[0.82rem] leading-snug text-ink-soft">{sub}</p>}
      </div>
    </div>
  );
}

// ---------- the catalogue funnel ----------

/**
 * How few products reached the partner's metered live service: the whole catalogue, what was looked at in master
 * data (free), and what got a live price check. Widths are on a log scale so three products still show, and the
 * figure carries the truth.
 */
export function Funnel({ catalogue, considered, priced, compact = false }: { catalogue?: number; considered?: number; priced?: number; compact?: boolean }) {
  const top = Math.max(catalogue ?? 0, considered ?? 0, priced ?? 0, 1);
  const w = (n?: number) => (n === undefined ? 0 : n <= 0 ? 0 : Math.max(1.5, (Math.log10(n + 1) / Math.log10(top + 1)) * 100));
  const rows: { n?: number; label: string; tone: string }[] = [
    { n: catalogue, label: "in the catalogue", tone: "bg-line" },
    { n: considered, label: "looked at in master data, free", tone: "bg-petrol/45" },
    { n: priced, label: "sent for a live price check", tone: "bg-petrol" },
  ];
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline gap-2">
            <span className={`display tabular ${compact ? "text-[1.35rem]" : "text-[1.7rem]"} ${r.n === undefined ? "text-ink-soft" : ""}`}>{r.n === undefined ? "–" : num(r.n)}</span>
            <span className="text-[0.86rem] text-ink-soft">{r.label}</span>
          </div>
          <div className="mt-1 h-2 bg-mist">
            <div className={`h-full ${r.tone} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${w(r.n)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- the gate's inspection grid ----------

export type GateCheck = { rule: string; title: string; outcome: string; reason?: string };

/**
 * Every check the gate ran, as one grid: what stopped or escalated first and large, with its reason; then a tile per
 * passed check. Read at a glance: a grid of petrol ticks with one yellow or black tile is "one rule caught it".
 */
export function CheckGrid({ checks, showPassReasons = false }: { checks: GateCheck[]; showPassReasons?: boolean }) {
  const hits = checks.filter((c) => c.outcome !== "pass");
  const passes = checks.filter((c) => c.outcome === "pass");
  return (
    <div>
      {hits.length > 0 && (
        <ul className="mb-3 space-y-2">
          {hits.map((c) => (
            <li key={c.rule} className={`grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] ${c.outcome === "fail" ? "bg-safety-ink text-paper" : "border-l-[10px] border-safety bg-paper ring-1 ring-ink/15"}`}>
              <span className={`display self-start text-[1.15rem] ${c.outcome === "fail" ? "text-safety" : "text-ink"}`}>{c.outcome === "fail" ? "Refused" : "Sent to a person"}</span>
              <span>
                <span className="block font-semibold">{c.title}</span>
                {c.reason && <span className={`mt-0.5 block text-[0.92rem] leading-snug ${c.outcome === "fail" ? "text-paper/85" : "text-ink-soft"}`}>{fi(c.reason)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 2xl:grid-cols-3" aria-label={`${passes.length} checks passed`}>
        {passes.map((c) => (
          <li key={c.rule} title={c.reason ? fi(c.reason) : undefined} className="flex items-start gap-2 bg-mist px-2.5 py-1.5 text-[0.88rem] leading-snug">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="mt-[0.2em] shrink-0 text-petrol">
              <rect x="0" y="0" width="14" height="14" fill="currentColor" />
              <path d="M3.5 7.2 L6 9.6 L10.6 4.6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="square" />
            </svg>
            <span className="min-w-0">
              {c.title}
              {showPassReasons && c.reason && <span className="block text-[0.8rem] text-ink-soft">{fi(c.reason)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

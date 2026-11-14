"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Target } from "../../_ui/target";
import { fi, num } from "./format";

/**
 * Pieces the operations side adds to the shared system: the data table, an outcome stamp, a counted bar, the
 * catalogue funnel and the gate's inspection grid. Same tokens, same shapes (web/docs/DESIGN.md).
 */

// ---------- dense table ----------

/**
 * The data table: a card with hairline rows and sentence-case headings. On a phone every row becomes a small card
 * and each cell is labelled with its column's heading (copied here into data-label; the look is `.dt` in globals.css).
 */
export function Table({ children, className = "", label, inset = false }: { children: ReactNode; className?: string; label?: string; /** Inside a card: the inner-panel radius, so a card does not hold a card. */ inset?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    const heads = Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    t.querySelectorAll("tbody tr").forEach((tr) =>
      Array.from(tr.children).forEach((td, i) => {
        // A cell that spans columns names itself (data-own-label), so a phone does not label it with the wrong heading.
        if (td.hasAttribute("data-own-label")) return;
        if (heads[i] && td.getAttribute("data-label") !== heads[i]) td.setAttribute("data-label", heads[i]);
      }),
    );
  });
  return (
    <div className={`overflow-x-auto border border-line bg-paper ${inset ? "rounded-lg" : "rounded-xl"} ${className}`}>
      <table ref={ref} aria-label={label} className="dt">
        {children}
      </table>
    </div>
  );
}

// ---------- outcome stamp ----------

/**
 * The outcome of a request or order, in the display face. Signed: a calm green pill with a tick. Waiting on a person:
 * the gate's slab with its hazard band (a person must act). Refused or declined: the slab, yellow type (the gate
 * stopped it). Anything still moving: a dashed pill.
 */
export function Stamp({ kind, label, animate = false, className = "" }: { kind: string; label: string; animate?: boolean; className?: string }) {
  const gate = kind === "waiting" || kind === "refused" || kind === "declined";
  const look =
    kind === "committed"
      ? "rounded-full bg-good-soft text-good ring-1 ring-inset ring-good/25 px-4 py-2"
      : gate
        ? `hazard-frame on-dark !rounded-lg px-4 pb-2.5 pt-[calc(0.625rem+6px)] text-safety`
        : "rounded-full border border-dashed border-line-strong px-4 py-2 text-ink-soft";
  return (
    <span className={`inline-flex max-w-[24rem] items-center gap-2.5 ${look} ${animate ? "stamp" : ""} ${className}`}>
      {kind === "committed" ? (
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-good text-paper">
          <Check size={15} strokeWidth={3} />
        </span>
      ) : gate ? (
        <Target size={22} tone="safety" />
      ) : null}
      <span className="display text-[1.12rem] leading-[1.15]">{fi(label)}</span>
    </span>
  );
}

// ---------- a counted bar ----------

/** A count with a bar scaled against the largest in its group, for "ruled out, and why" and rule tallies. */
export function CountBar({ count, max, label, sub, tone = "petrol" }: { count: number; max: number; label: ReactNode; sub?: ReactNode; tone?: "petrol" | "ink" | "safety" }) {
  const w = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  const bar = tone === "safety" ? "bg-safety" : tone === "ink" ? "bg-ink-soft/70" : "bg-petrol";
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span className="display text-right text-[1.25rem] tabular">{num(count)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-1.5 shrink-0 rounded-full ${bar}`} style={{ width: `${w * 0.7}%` }} />
        </div>
        <p className="mt-1 text-[0.92rem] font-medium leading-snug">{label}</p>
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
    { n: catalogue, label: "in the catalogue", tone: "bg-line-strong" },
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
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface">
            <div className={`h-full rounded-full ${r.tone} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${w(r.n)}%` }} />
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
 * passed check. Read at a glance: a grid of green ticks with one yellow or dark tile is "one rule caught it".
 * `dark` sets it on the gate's slab; `stagger` lets the checks arrive one by one (a replay reaching the gate).
 */
export function CheckGrid({ checks, showPassReasons = false, dark = false, stagger = false }: { checks: GateCheck[]; showPassReasons?: boolean; dark?: boolean; stagger?: boolean }) {
  const hits = checks.filter((c) => c.outcome !== "pass");
  const passes = checks.filter((c) => c.outcome === "pass");
  const delay = (i: number) => (stagger ? { animationDelay: `${120 + i * 45}ms`, animationFillMode: "both" as const } : undefined);
  return (
    <div>
      {hits.length > 0 && (
        <ul className="mb-3 space-y-2">
          {hits.map((c, i) => {
            const fail = c.outcome === "fail";
            const look = dark ? (fail ? "bg-safety text-safety-ink" : "bg-paper/8 ring-1 ring-inset ring-safety/70") : fail ? "bg-safety-ink text-paper" : "bg-safety-soft ring-1 ring-inset ring-safety/60";
            return (
              <li key={c.rule} style={delay(passes.length + i)} className={`grid gap-x-4 gap-y-1 rounded-lg px-4 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] ${look} ${stagger ? "lane-enter" : ""}`}>
                <span className={`display flex items-center gap-2 self-start text-[1.15rem] ${dark ? (fail ? "" : "text-safety") : fail ? "text-safety" : "text-ink"}`}>
                  {!dark && <Target size={18} tone="safety" />}
                  {fail ? "Refused" : "Sent to a person"}
                </span>
                <span>
                  <span className="block font-semibold leading-snug">{c.title}</span>
                  {c.reason && <span className={`mt-0.5 block text-[0.92rem] leading-snug ${dark ? (fail ? "text-safety-ink/80" : "text-paper/80") : fail ? "text-paper/85" : "text-ink-soft"}`}>{fi(c.reason)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3" aria-label={`${passes.length} checks passed`}>
        {passes.map((c, i) => (
          <li
            key={c.rule}
            title={c.reason ? fi(c.reason) : undefined}
            style={delay(i)}
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-[0.88rem] leading-snug ${dark ? "bg-paper/6 text-paper/90" : "bg-surface"} ${stagger ? "lane-enter" : ""}`}
          >
            <Check aria-hidden size={15} strokeWidth={2.6} className={`mt-[0.15em] shrink-0 ${dark ? "text-lime" : "text-good"}`} />
            <span className="min-w-0">
              {c.title}
              {showPassReasons && c.reason && <span className={`block text-[0.8rem] ${dark ? "text-paper/60" : "text-ink-soft"}`}>{fi(c.reason)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Check, Info, LayoutList, Minus, Scale, Sparkles, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComparisonData, WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame } from "./frame";

const YES = new Set(["yes", "included", "true", "available", "supported", "unlimited"]);
const NO = new Set(["no", "not included", "false", "none", "not available", "unsupported", "n/a", "-", "—"]);

type Verdict = "yes" | "no" | null;

/** Decides whether a cell reads as a plain yes or no, so it can carry an icon. */
function verdictOf(value: string | undefined): Verdict {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/[.!]$/, "");
  if (YES.has(v) || /^(yes|included)\b[,:( ]/.test(v)) return "yes";
  if (NO.has(v) || /^(no|not included)\b[,:( ]/.test(v)) return "no";
  return null;
}

function Cell({ value }: { value: string | undefined }) {
  const verdict = verdictOf(value);
  if (value === undefined || value === "") return <span className="text-subtle">–</span>;
  if (verdict === "yes") {
    return (
      <span className="inline-flex items-start gap-1.5">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Check className="size-3" strokeWidth={2.75} aria-hidden />
        </span>
        <span>{value}</span>
      </span>
    );
  }
  if (verdict === "no") {
    return (
      <span className="inline-flex items-start gap-1.5 text-muted-foreground">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-subtle">
          <Minus className="size-3" strokeWidth={2.75} aria-hidden />
        </span>
        <span>{value}</span>
      </span>
    );
  }
  return <span>{value}</span>;
}

/** Width of an element, tracked with a ResizeObserver. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function Comparison({ data, loading }: WidgetProps<ComparisonData>) {
  const columns = React.useMemo(() => data.columns ?? [], [data.columns]);
  const rows = React.useMemo(() => data.rows ?? [], [data.rows]);
  const winner =
    typeof data.winner === "number" && data.winner >= 0 && data.winner < columns.length ? data.winner : undefined;

  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 480;
  // A table needs room for the criteria and every option side by side. A narrow column (a phone,
  // or the chat beside the live browser) has it for neither three options nor two: there the
  // options are stacked as cards, and the table is one tap away.
  const canStack = narrow && columns.length >= 2;
  const [viewChoice, setViewChoice] = React.useState<"table" | "cards" | null>(null);
  const view = canStack ? (viewChoice ?? "cards") : "table";

  const sameRows = React.useMemo(
    () =>
      rows.filter(
        (r) => columns.length > 1 && r.values?.length >= columns.length && r.values.every((v) => v.trim() === r.values[0].trim()),
      ).length,
    [rows, columns.length],
  );
  const [diffOnly, setDiffOnly] = React.useState(false);
  const shownRows = React.useMemo(
    () =>
      diffOnly
        ? rows.filter((r) => !(r.values?.length >= columns.length && r.values.every((v) => v.trim() === r.values[0].trim())))
        : rows,
    [rows, diffOnly, columns.length],
  );

  const showSkeleton = loading && (columns.length === 0 || rows.length === 0);

  const aside =
    !data.error && !showSkeleton ? (
      <div className="flex items-center gap-1.5">
        {sameRows > 0 ? (
          <button
            type="button"
            onClick={() => setDiffOnly((v) => !v)}
            aria-pressed={diffOnly}
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-2.5 text-[0.75rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              diffOnly
                ? "border-brand/40 bg-brand-soft text-brand"
                : "border-border text-muted-foreground hover:border-ring/40 hover:text-foreground",
            )}
          >
            {diffOnly ? "Differences" : "All rows"}
          </button>
        ) : null}
        {canStack ? (
          <div role="group" aria-label="View" className="flex items-center rounded-full border border-border p-0.5">
            {(
              [
                { id: "cards", icon: LayoutList, label: "Card view" },
                { id: "table", icon: Table2, label: "Table view" },
              ] as const
            ).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={view === id}
                onClick={() => setViewChoice(id)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  view === id ? "bg-muted text-foreground" : "text-subtle hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  const subtitle =
    columns.length > 0
      ? `${columns.length} options · ${rows.length} ${rows.length === 1 ? "criterion" : "criteria"}`
      : undefined;

  return (
    <WidgetFrame
      icon={<Scale />}
      title={data.title || "Comparison"}
      subtitle={subtitle}
      aside={aside}
      sources={data.sources}
      loading={loading}
      stage={data.stage}
      flush
    >
      <div ref={wrapRef}>
        {data.error ? (
          <div className="px-4 pb-4 sm:px-5">
            <WidgetError message={data.error} />
          </div>
        ) : showSkeleton ? (
          <ComparisonSkeleton columns={Math.max(columns.length, 3)} />
        ) : view === "cards" ? (
          <StackedView columns={columns} rows={shownRows} winner={winner} />
        ) : (
          <TableView columns={columns} rows={shownRows} winner={winner} />
        )}

        {data.note && !data.error ? (
          <p className="flex items-start gap-2 border-t border-border/70 px-4 py-3 text-[0.82rem] leading-relaxed text-muted-foreground sm:px-5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
            <span>{data.note}</span>
          </p>
        ) : null}
      </div>
    </WidgetFrame>
  );
}

function TableView({
  columns,
  rows,
  winner,
}: {
  columns: string[];
  rows: ComparisonData["rows"];
  winner?: number;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  const measure = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure, columns.length, rows.length]);

  const lastRow = rows.length - 1;

  return (
    <div className="relative">
      <div ref={scrollRef} onScroll={measure} className="overflow-x-auto overscroll-x-contain pb-1">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[0.85rem]">
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(
                  "sticky left-0 z-20 min-w-[8.5rem] bg-card pt-2 pr-3 pb-2.5 pl-4 text-left align-bottom text-[0.72rem] font-medium tracking-wide text-subtle uppercase transition-shadow sm:pl-5",
                  edges.start && "shadow-[6px_0_10px_-8px_color-mix(in_oklch,var(--foreground)_30%,transparent)]",
                )}
              >
                Criteria
              </th>
              {columns.map((col, i) => {
                const isWinner = i === winner;
                return (
                  <th
                    key={`${col}-${i}`}
                    scope="col"
                    className={cn(
                      "min-w-[8.5rem] max-w-[14rem] px-3 pt-2 pb-2.5 text-left align-bottom font-medium",
                      i === columns.length - 1 && "pr-4 sm:pr-5",
                      isWinner && "rounded-t-xl bg-brand-soft/60",
                    )}
                  >
                    {isWinner ? (
                      <span className="mb-1 inline-flex items-center gap-1 text-[0.68rem] font-semibold tracking-wide text-brand uppercase">
                        <Sparkles className="size-3" aria-hidden />
                        Recommended
                      </span>
                    ) : null}
                    <span className="block text-[0.88rem] leading-snug text-foreground">{col}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <motion.tr
                key={`${row.label}-${r}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(r, 10) * 0.04, ease: "easeOut" }}
                className="group/row"
              >
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-t border-border/70 bg-card py-2.5 pr-3 pl-4 text-left align-top font-normal text-muted-foreground transition-[background-color,box-shadow] group-hover/row:bg-surface sm:pl-5",
                    edges.start && "shadow-[6px_0_10px_-8px_color-mix(in_oklch,var(--foreground)_30%,transparent)]",
                  )}
                >
                  {row.label}
                </th>
                {columns.map((_, c) => {
                  const isWinner = c === winner;
                  return (
                    <td
                      key={c}
                      className={cn(
                        "border-t border-border/70 px-3 py-2.5 align-top leading-snug transition-colors",
                        c === columns.length - 1 && "pr-4 sm:pr-5",
                        isWinner
                          ? "bg-brand-soft/60 font-medium group-hover/row:bg-brand-soft"
                          : "group-hover/row:bg-surface",
                        isWinner && r === lastRow && "rounded-b-xl",
                      )}
                    >
                      <Cell value={row.values?.[c]} />
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent transition-opacity duration-300",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function StackedView({
  columns,
  rows,
  winner,
}: {
  columns: string[];
  rows: ComparisonData["rows"];
  winner?: number;
}) {
  // The recommended option leads.
  const order = columns.map((_, i) => i);
  if (winner !== undefined) order.sort((a, b) => (a === winner ? -1 : b === winner ? 1 : a - b));

  return (
    <ul className="flex flex-col gap-2.5 px-4 pb-4">
      {order.map((c, i) => {
        const isWinner = c === winner;
        return (
          <motion.li
            key={`${columns[c]}-${c}`}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
            className={cn(
              "overflow-hidden rounded-xl border",
              isWinner ? "border-brand/35 bg-brand-soft/40" : "border-border bg-surface/50",
            )}
          >
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
              <span className="min-w-0 truncate text-[0.9rem] font-medium">{columns[c]}</span>
              {isWinner ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-[0.68rem] font-semibold tracking-wide text-brand uppercase">
                  <Sparkles className="size-3" aria-hidden />
                  Recommended
                </span>
              ) : null}
            </div>
            <dl className="divide-y divide-border/60 px-3.5 pb-1">
              {rows.map((row, r) => (
                <div key={`${row.label}-${r}`} className="flex items-start justify-between gap-4 py-2 text-[0.84rem]">
                  <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                  <dd className="min-w-0 text-right leading-snug">
                    <Cell value={row.values?.[c]} />
                  </dd>
                </div>
              ))}
            </dl>
          </motion.li>
        );
      })}
    </ul>
  );
}

function ComparisonSkeleton({ columns }: { columns: number }) {
  return (
    <div className="px-4 pb-4 sm:px-5" aria-hidden>
      <div className="flex items-end gap-3 pb-3">
        <div className="w-24 shrink-0" />
        <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, i) => (
            <Shimmer key={i} className="h-4" />
          ))}
        </div>
      </div>
      {Array.from({ length: 5 }, (_, r) => (
        <div key={r} className="flex items-center gap-3 border-t border-border/70 py-3">
          <Shimmer className="h-3 w-24 shrink-0" />
          <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, i) => (
              <Shimmer key={i} className={cn("h-3", (r + i) % 3 === 0 ? "w-2/3" : "w-full")} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

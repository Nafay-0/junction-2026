"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ExternalLink, Vote } from "lucide-react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { MarketOutcome, PredictionMarketData, WidgetProps } from "@/lib/widgets/types";
import { domainOf } from "@/lib/widgets/types";
import { LiveDot, Shimmer, WidgetError, WidgetFrame, formatDate } from "./frame";
import { ChartShimmer, ChartTip, EmptyNote, Ticker, formatTime, timeTicks } from "./stocks";
import { formatUpdated, useLive, useNow } from "./use-live";

const POLL_MS = 20_000;
const CHART_HEIGHT = 200;
const TOP = 5;
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-5)", "var(--chart-4)"];

const NO_OUTCOMES: MarketOutcome[] = [];

type Ranked = MarketOutcome & { key: string; change: number; color?: string };

/* ───────────────────────── Widget ───────────────────────── */

export function PredictionMarket({ data, loading }: WidgetProps<PredictionMarketData>) {
  const slug = data?.slug;
  const url = slug && !loading && !data?.error ? `/api/live/market?slug=${encodeURIComponent(slug)}` : null;
  const { observe, ...live } = useLive<PredictionMarketData>(url, { intervalMs: POLL_MS, accept: isMarket });

  const polled = live.data && live.data.outcomes.length > 0 ? live.data : null;
  const baseOutcomes = Array.isArray(data?.outcomes) ? data.outcomes : NO_OUTCOMES;
  const outcomes = React.useMemo(() => (polled ? mergeOutcomes(baseOutcomes, polled.outcomes) : baseOutcomes), [polled, baseOutcomes]);
  const title = data?.title || polled?.title || "Prediction market";
  const marketUrl = data?.url || polled?.url || "";
  const image = data?.image || polled?.image;
  const volume = polled?.volume ?? data?.volume;
  const endDate = data?.endDate || polled?.endDate;
  const historyLabel = polled?.historyLabel || data?.historyLabel;

  // Colours stay attached to an outcome's name, so a reshuffle on a poll does not repaint the lines.
  const propOutcomes = data?.outcomes;
  const propNames = React.useMemo(
    () => rank(Array.isArray(propOutcomes) ? propOutcomes : []).map((o) => o.name),
    [propOutcomes],
  );
  const ranked = React.useMemo(() => {
    const list = rank(outcomes);
    const used = new Set<number>();
    const top = list.slice(0, TOP);
    const colorOf = new Map<string, string>();
    for (const o of top) {
      const i = propNames.indexOf(o.name);
      if (i >= 0 && i < COLORS.length && !used.has(i)) {
        used.add(i);
        colorOf.set(o.name, COLORS[i]);
      }
    }
    for (const o of top) {
      if (colorOf.has(o.name)) continue;
      const free = COLORS.findIndex((_, i) => !used.has(i));
      if (free >= 0) {
        used.add(free);
        colorOf.set(o.name, COLORS[free]);
      }
    }
    return list.map((o) => ({ ...o, color: colorOf.get(o.name) }));
  }, [outcomes, propNames]);

  const charted = React.useMemo(() => ranked.filter((o) => o.color && o.history.length > 1), [ranked]);
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const toggle = React.useCallback(
    (name: string) =>
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      }),
    [],
  );

  const now = useNow(1000, live.updatedAt !== null);
  const footerNote = live.updatedAt ? formatUpdated(live.updatedAt, now) : historyLabel || undefined;
  const subtitleParts = [
    volume !== undefined && Number.isFinite(volume) ? `${formatCompactUsd(volume)} vol` : null,
    endDate ? `Ends ${formatDate(endDate)}` : null,
  ].filter(Boolean);

  const visibleRows = showAll ? ranked : ranked.slice(0, TOP);

  return (
    <div ref={observe}>
      <WidgetFrame
        icon={<MarketThumb image={image} />}
        title={title}
        subtitle={subtitleParts.length ? subtitleParts.join(" · ") : undefined}
        aside={
          <>
            {live.active ? <LiveDot /> : null}
            {marketUrl ? (
              <a
                href={marketUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open on ${domainOf(marketUrl)}`}
                className="-mr-2 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </>
        }
        sources={data?.sources}
        footerNote={footerNote}
        loading={loading}
        stage={data?.stage}
      >
        {data?.error ? (
          <WidgetError message={data.error} />
        ) : ranked.length === 0 ? (
          loading ? (
            <MarketSkeleton />
          ) : (
            <EmptyNote>No outcomes came back for this market.</EmptyNote>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {charted.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[0.82rem] text-muted-foreground">Chance over time</p>
                  {historyLabel ? <p className="text-[0.75rem] text-subtle">{historyLabel}</p> : null}
                </div>
                <OddsChart outcomes={charted} hidden={hidden} highlighted={highlighted} />
              </div>
            ) : null}

            <div className="flex flex-col">
              <ul className="-mx-2 flex flex-col" aria-label="Outcomes">
                <AnimatePresence>
                  {visibleRows.map((o, i) => (
                    <motion.li
                      key={o.key}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{
                        opacity: { duration: 0.3, ease: "easeOut", delay: rowDelay(i) },
                        y: { duration: 0.3, ease: "easeOut", delay: rowDelay(i) },
                        layout: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] },
                      }}
                    >
                      <OutcomeRow
                        outcome={o}
                        hidden={hidden.has(o.name)}
                        dimmed={highlighted !== null && highlighted !== o.name}
                        onToggle={o.color && o.history.length > 1 ? toggle : undefined}
                        onHighlight={o.color && o.history.length > 1 ? setHighlighted : undefined}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {ranked.length > TOP ? (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                  className="mt-1 flex h-10 items-center justify-center gap-1.5 self-start rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {showAll ? "Show fewer" : `Show all ${ranked.length}`}
                  <ChevronDown className={cn("size-4 transition-transform duration-300", showAll && "rotate-180")} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        )}
      </WidgetFrame>
    </div>
  );
}

/* ───────────────────────── Rows ───────────────────────── */

function OutcomeRow({
  outcome,
  hidden,
  dimmed,
  onToggle,
  onHighlight,
}: {
  outcome: Ranked;
  hidden: boolean;
  dimmed: boolean;
  onToggle?: (name: string) => void;
  onHighlight?: (name: string | null) => void;
}) {
  const pct = outcome.probability * 100;
  const interactive = Boolean(onToggle);
  const content = (
    <>
      <span
        className={cn(
          "mt-1.5 size-2.5 shrink-0 rounded-full border-2 transition-colors",
          !outcome.color && "border-transparent bg-transparent",
        )}
        style={
          outcome.color
            ? { borderColor: outcome.color, background: hidden ? "transparent" : outcome.color }
            : undefined
        }
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-[0.88rem] font-medium transition-colors", hidden && "text-muted-foreground")}>
            {outcome.name}
          </span>
          <span className="shrink-0 font-display text-[1.45rem] leading-none nums">
            <Ticker value={pct} format={formatPercent} />
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: outcome.color ?? "var(--muted-foreground)", opacity: outcome.color ? 1 : 0.45 }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0.5, Math.min(100, pct))}%` }}
              transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </span>
          <ChangeLabel change={outcome.change} />
        </span>
      </span>
    </>
  );

  const base = cn(
    "flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition-[background-color,opacity] duration-200",
    dimmed && "opacity-55",
  );

  if (!interactive) return <div className={base}>{content}</div>;
  return (
    <button
      type="button"
      aria-pressed={!hidden}
      aria-label={`${outcome.name}, ${formatPercent(pct)}. ${hidden ? "Show" : "Hide"} on chart`}
      onClick={() => onToggle?.(outcome.name)}
      onMouseEnter={() => onHighlight?.(outcome.name)}
      onMouseLeave={() => onHighlight?.(null)}
      onFocus={() => onHighlight?.(outcome.name)}
      onBlur={() => onHighlight?.(null)}
      className={cn(base, "outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50")}
    >
      {content}
    </button>
  );
}

function ChangeLabel({ change }: { change: number }) {
  const pts = change * 100;
  const flat = Math.abs(pts) < 0.05;
  return (
    <span
      className={cn(
        "w-[4.75rem] shrink-0 text-right text-[0.75rem] font-medium nums",
        flat ? "text-subtle" : pts > 0 ? "text-up" : "text-down",
      )}
    >
      {flat ? "0.0 pts" : `${pts > 0 ? "+" : "-"}${Math.abs(pts).toFixed(1)} pts`}
    </span>
  );
}

function MarketThumb({ image }: { image?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!image || failed) return <Vote />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-7 rounded-lg object-cover"
    />
  );
}

/* ───────────────────────── Chart ───────────────────────── */

type OddsRow = { t: number } & Record<string, number | undefined>;

const OddsChart = React.memo(function OddsChart({
  outcomes,
  hidden,
  highlighted,
}: {
  outcomes: Ranked[];
  hidden: Set<string>;
  highlighted: string | null;
}) {
  const rows = React.useMemo(() => {
    const map = new Map<number, OddsRow>();
    for (const o of outcomes) {
      for (const p of o.history) {
        const row = map.get(p.t) ?? ({ t: p.t } as OddsRow);
        row[o.key] = p.v * 100;
        map.set(p.t, row);
      }
    }
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [outcomes]);

  const first = rows[0]?.t ?? 0;
  const last = rows[rows.length - 1]?.t ?? 0;
  const span = last - first;
  const xTicks = React.useMemo(() => timeTicks(first, last, 4), [first, last]);

  const yMax = React.useMemo(() => {
    let max = 0;
    for (const r of rows) {
      for (const o of outcomes) {
        if (hidden.has(o.name)) continue;
        const v = r[o.key];
        if (v !== undefined && v > max) max = v;
      }
    }
    const step = max > 50 ? 20 : 10;
    return Math.min(100, Math.max(step, Math.ceil((max + 2) / step) * step));
  }, [rows, outcomes, hidden]);
  const yTicks = React.useMemo(() => {
    const step = yMax > 50 ? 20 : yMax > 20 ? 10 : 5;
    const out: number[] = [];
    for (let v = 0; v <= yMax + 0.001; v += step) out.push(v);
    return out;
  }, [yMax]);

  return (
    <div className="-mx-1 select-none [&_.recharts-surface]:outline-none" style={{ height: CHART_HEIGHT }}>
      <LineChart
        data={rows}
        responsive
        style={{ width: "100%", height: CHART_HEIGHT }}
        margin={{ top: 8, right: 2, bottom: 0, left: 2 }}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[first, last]}
          ticks={xTicks}
          tickFormatter={(t: number) => formatTime(t, span)}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          orientation="right"
          domain={[0, yMax]}
          ticks={yTicks}
          width={40}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          allowDataOverflow
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.6, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as OddsRow | undefined;
            if (!active || !row) return null;
            const items = outcomes
              .filter((o) => !hidden.has(o.name) && row[o.key] !== undefined)
              .map((o) => ({ name: o.name, color: o.color, v: row[o.key] as number }))
              .sort((a, b) => b.v - a.v);
            if (items.length === 0) return null;
            return (
              <ChartTip>
                <span className="text-muted-foreground nums">{formatTime(row.t, span, undefined, true)}</span>
                {items.map((x) => (
                  <span key={x.name} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: x.color }} />
                    <span className="max-w-40 flex-1 truncate">{x.name}</span>
                    <span className="pl-2 font-medium nums">{formatPercent(x.v)}</span>
                  </span>
                ))}
              </ChartTip>
            );
          }}
        />
        {outcomes.map((o) => (
          <Line
            key={o.key}
            type="monotone"
            dataKey={o.key}
            name={o.name}
            hide={hidden.has(o.name)}
            stroke={o.color}
            strokeWidth={highlighted === o.name ? 2.5 : 1.75}
            strokeOpacity={highlighted && highlighted !== o.name ? 0.18 : 1}
            dot={false}
            activeDot={{ r: 3.5, fill: o.color, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls
            isAnimationActive
            animationDuration={450}
            animationEasing="ease-out"
            style={{ transition: "stroke-opacity 200ms ease, stroke-width 200ms ease" }}
          />
        ))}
      </LineChart>
    </div>
  );
});

/* ───────────────────────── Skeleton ───────────────────────── */

function MarketSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex justify-between">
        <Shimmer className="h-3.5 w-28" />
        <Shimmer className="h-3.5 w-20" />
      </div>
      <ChartShimmer height={CHART_HEIGHT} />
      <div className="flex flex-col gap-4">
        {[0.7, 0.55, 0.35, 0.25].map((w, i) => (
          <div key={i} className="flex items-start gap-3">
            <Shimmer className="mt-1 size-2.5 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex justify-between">
                <Shimmer className="h-4 w-36" />
                <Shimmer className="h-6 w-12" />
              </div>
              <div style={{ width: `${w * 100}%` }}>
                <Shimmer className="h-1.5 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function rowDelay(i: number) {
  return i < TOP ? i * 0.04 : (i - TOP) * 0.03;
}

/** Polled odds win, but an outcome keeps its earlier history when the poll sends none. */
function mergeOutcomes(base: MarketOutcome[], polled: MarketOutcome[]): MarketOutcome[] {
  const byName = new Map(base.map((o) => [o.name, o]));
  return polled.map((o) => {
    const prev = byName.get(o.name);
    if (!prev) return o;
    return {
      ...o,
      history: Array.isArray(o.history) && o.history.length > 1 ? o.history : prev.history,
      change: o.change ?? prev.change,
      volume: o.volume ?? prev.volume,
    };
  });
}

function isMarket(v: unknown): v is PredictionMarketData {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<PredictionMarketData>;
  return Array.isArray(m.outcomes) && m.outcomes.every((o) => o && typeof o.name === "string" && Number.isFinite(o.probability));
}

function rank(outcomes: MarketOutcome[]): Ranked[] {
  const seen = new Map<string, number>();
  return outcomes
    .filter((o) => o && typeof o.name === "string" && Number.isFinite(o.probability))
    .map((o) => {
      const history = Array.isArray(o.history)
        ? o.history.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
        : [];
      const derived = history.length > 1 ? o.probability - history[0].v : 0;
      const n = seen.get(o.name) ?? 0;
      seen.set(o.name, n + 1);
      return {
        ...o,
        history,
        change: Number.isFinite(o.change) ? (o.change as number) : derived,
        key: `o${n ? `${slugKey(o.name)}_${n}` : slugKey(o.name)}`,
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

/** A dataKey that is safe for recharts (no dots or brackets, which it reads as paths). */
function slugKey(name: string) {
  return name.replace(/[^a-zA-Z0-9]+/g, "_");
}

function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return "-";
  if (pct > 0 && pct < 0.5) return "<1%";
  if (pct > 99.5 && pct < 100) return ">99%";
  return `${Math.round(pct)}%`;
}

export function formatCompactUsd(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(v);
}

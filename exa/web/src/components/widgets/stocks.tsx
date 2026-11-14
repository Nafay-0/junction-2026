"use client";

import * as React from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { ArrowDownRight, ArrowUpRight, ChartLine, ExternalLink, GitCompareArrows } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MouseHandlerDataParam } from "recharts/types/synchronisation/types";
import { cn } from "@/lib/utils";
import type { PricePoint, StockQuote, StocksData, WidgetProps } from "@/lib/widgets/types";
import { LiveDot, Shimmer, WidgetError, WidgetFrame } from "./frame";
import { formatUpdated, useChangeFlash, useLiveMany, useNow } from "./use-live";

const POLL_MS = 30_000;
const CHART_HEIGHT = 200;
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-5)", "var(--chart-4)"];

/* ───────────────────────── Widget ───────────────────────── */

export function Stocks({ data, loading }: WidgetProps<StocksData>) {
  const rawQuotes = data?.quotes;
  const propQuotes = React.useMemo(() => (Array.isArray(rawQuotes) ? rawQuotes.filter(isQuote) : []), [rawQuotes]);
  const symbolKey = propQuotes.map((q) => q.symbol).join(",");
  const urls = React.useMemo(
    () => (symbolKey ? symbolKey.split(",").map((s) => `/api/live/stock?symbol=${encodeURIComponent(s)}`) : []),
    [symbolKey],
  );
  const { observe, ...live } = useLiveMany<StockQuote>(urls, {
    intervalMs: POLL_MS,
    enabled: !loading && !data?.error,
    accept: isQuote,
  });
  const quotes = React.useMemo(
    () => propQuotes.map((q, i) => mergeQuote(q, live.data[i] ?? null)),
    [propQuotes, live.data],
  );

  const [view, setView] = React.useState<string>("");
  const active = view === "compare" && quotes.length > 1 ? "compare" : (quotes.find((q) => q.symbol === view) ?? quotes[0])?.symbol;
  const current = quotes.find((q) => q.symbol === active);

  const now = useNow(1000, live.updatedAt !== null);
  const footerNote = live.updatedAt
    ? formatUpdated(live.updatedAt, now)
    : current
      ? `As of ${current.asOf}`
      : quotes[0]
        ? `As of ${quotes[0].asOf}`
        : undefined;

  const title =
    quotes.length === 1 ? quotes[0].name || quotes[0].symbol : quotes.length > 1 ? quotes.map((q) => q.symbol).join(", ") : "Stocks";
  const subtitle =
    quotes.length === 1
      ? `${quotes[0].symbol} · ${quotes[0].seriesLabel}`
      : quotes.length > 1
        ? `${quotes.length} quotes · ${quotes[0].seriesLabel}`
        : undefined;

  return (
    <div ref={observe}>
      <WidgetFrame
        icon={<ChartLine />}
        title={title}
        subtitle={subtitle}
        aside={live.active ? <LiveDot /> : null}
        sources={data?.sources}
        footerNote={footerNote}
        loading={loading}
        stage={data?.stage}
      >
        {data?.error ? (
          <WidgetError message={data.error} />
        ) : quotes.length === 0 ? (
          loading ? (
            <StocksSkeleton />
          ) : (
            <EmptyNote>No quotes came back for this request.</EmptyNote>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {quotes.length > 1 ? <SymbolTabs quotes={quotes} active={active ?? ""} onChange={setView} /> : null}
            {active === "compare" ? (
              <CompareView quotes={quotes} />
            ) : current ? (
              <QuotePanel key={current.symbol} quote={current} />
            ) : null}
          </div>
        )}
      </WidgetFrame>
    </div>
  );
}

/* ───────────────────────── Tabs ───────────────────────── */

function SymbolTabs({
  quotes,
  active,
  onChange,
}: {
  quotes: StockQuote[];
  active: string;
  onChange: (id: string) => void;
}) {
  const ids = [...quotes.map((q) => q.symbol), "compare"];
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const layoutId = React.useId();

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(ids[next]);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Symbol"
      className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
    >
      {ids.map((id, i) => {
        const q = quotes.find((x) => x.symbol === id);
        const selected = id === active;
        const up = (q?.change ?? 0) >= 0;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex h-10 shrink-0 snap-start items-center gap-2 rounded-full px-3.5 text-[0.82rem] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected ? "text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full border border-border bg-surface shadow-card"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              {q ? (
                <>
                  <span>{q.symbol}</span>
                  <span className={cn("nums text-[0.75rem]", up ? "text-up" : "text-down")}>
                    {formatSignedPercent(q.changePercent)}
                  </span>
                </>
              ) : (
                <>
                  <GitCompareArrows className="size-3.5" aria-hidden />
                  <span>Compare</span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Single quote ───────────────────────── */

function QuotePanel({ quote }: { quote: StockQuote }) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const flash = useChangeFlash(quote.price);
  const series = quote.series;
  const hovered = hoverIndex !== null ? series[hoverIndex] : undefined;
  const base = quote.previousClose ?? series[0]?.v;

  const price = hovered ? hovered.v : quote.price;
  const change = hovered && base !== undefined ? hovered.v - base : quote.change;
  const changePercent = hovered && base ? ((hovered.v - base) / base) * 100 : quote.changePercent;
  const up = change >= 0;
  const trendUp = quote.change >= 0;
  const tz = zoneFor(quote.currency);
  const span = series.length > 1 ? series[series.length - 1].t - series[0].t : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.78rem] text-muted-foreground">
            <span className="font-medium text-foreground">{quote.symbol}</span>
            {quote.name ? <span> · {quote.name}</span> : null}
          </p>
          <p
            className={cn(
              "mt-0.5 font-display text-[1.95rem] leading-[1.1] nums",
              flash.dir === "up"
                ? "text-up transition-none"
                : flash.dir === "down"
                  ? "text-down transition-none"
                  : "text-foreground transition-colors duration-700",
            )}
          >
            <Ticker value={price} format={priceFormatter(quote.currency)} instant={hoverIndex !== null} />
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.82rem]">
            <span className={cn("inline-flex items-center gap-0.5 font-medium nums", up ? "text-up" : "text-down")}>
              {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
              {formatSigned(change, quote.currency)} ({formatSignedPercent(changePercent)})
            </span>
            <span className="text-muted-foreground nums">
              {hovered ? formatTime(hovered.t, span, tz, true) : `As of ${quote.asOf}`}
            </span>
          </div>
        </div>
        {quote.url ? (
          <a
            href={quote.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${quote.symbol} quote page`}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null}
      </div>

      {series.length > 1 ? (
        <PriceChart
          series={series}
          previousClose={quote.previousClose}
          currency={quote.currency}
          color={trendUp ? "var(--up)" : "var(--down)"}
          pulseKey={flash.n}
          onHover={setHoverIndex}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-xl border border-dashed border-border text-[0.8rem] text-muted-foreground"
          style={{ height: CHART_HEIGHT }}
        >
          No chart data for this period
        </div>
      )}

      <StatsRow quote={quote} />
    </div>
  );
}

function StatsRow({ quote }: { quote: StockQuote }) {
  const stats: Array<[string, number | undefined]> = [
    ["Open", quote.open],
    ["High", quote.high],
    ["Low", quote.low],
    ["Prev close", quote.previousClose],
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label} className="bg-card px-3 py-2.5">
          <dt className="text-[0.72rem] text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-[0.88rem] font-medium nums">
            {value !== undefined && Number.isFinite(value) ? formatPrice(value, quote.currency) : <span className="text-subtle">-</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const PriceChart = React.memo(function PriceChart({
  series,
  previousClose,
  currency,
  color,
  pulseKey,
  onHover,
}: {
  series: PricePoint[];
  previousClose?: number;
  currency: string;
  color: string;
  pulseKey: number;
  onHover: (index: number | null) => void;
}) {
  const gradientId = useSvgId("price-fill");
  const tz = zoneFor(currency);
  const first = series[0];
  const last = series[series.length - 1];
  const span = last.t - first.t;
  const xTicks = React.useMemo(() => timeTicks(first.t, last.t, 4), [first.t, last.t]);
  const yDomain = React.useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of series) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }
    if (previousClose !== undefined) {
      min = Math.min(min, previousClose);
      max = Math.max(max, previousClose);
    }
    const pad = (max - min || Math.abs(max) * 0.01 || 1) * 0.12;
    return [min - pad, max + pad] as [number, number];
  }, [series, previousClose]);
  const yTicks = React.useMemo(() => niceTicks(yDomain[0], yDomain[1], 4), [yDomain]);
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDecimals = yStep >= 1 ? 0 : yStep >= 0.1 ? 1 : 2;

  const handleMove = React.useCallback(
    (state: MouseHandlerDataParam) => {
      const i = state?.isTooltipActive ? Number(state.activeTooltipIndex) : NaN;
      onHover(Number.isFinite(i) ? i : null);
    },
    [onHover],
  );
  const handleLeave = React.useCallback(() => onHover(null), [onHover]);

  return (
    <div className="-mx-1 select-none [&_.recharts-surface]:outline-none" style={{ height: CHART_HEIGHT }}>
      <AreaChart
        data={series}
        responsive
        style={{ width: "100%", height: CHART_HEIGHT }}
        margin={{ top: 10, right: 2, bottom: 0, left: 2 }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onTouchMove={handleMove}
        onTouchEnd={handleLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="70%" stopColor={color} stopOpacity={0.05} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[first.t, last.t]}
          ticks={xTicks}
          tickFormatter={(t: number) => formatTime(t, span, tz)}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          orientation="right"
          domain={yDomain}
          ticks={yTicks}
          width={yDecimals ? 50 : 40}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => v.toFixed(yDecimals)}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          allowDataOverflow
        />
        {previousClose !== undefined ? (
          <ReferenceLine
            y={previousClose}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.55}
            strokeDasharray="3 4"
            ifOverflow="extendDomain"
            label={{
              value: `Prev close ${previousClose.toFixed(2)}`,
              position: "insideTopLeft",
              fill: "var(--muted-foreground)",
              fontSize: 10.5,
            }}
          />
        ) : null}
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.6, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as PricePoint | undefined;
            if (!active || !p) return null;
            return (
              <ChartTip>
                <span className="font-medium text-foreground nums">{formatPrice(p.v, currency)}</span>
                <span className="text-muted-foreground nums">{formatTime(p.t, span, tz, true)}</span>
              </ChartTip>
            );
          }}
        />
        <Area
          type="linear"
          dataKey="v"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#${gradientId})`}
          baseValue="dataMin"
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive
          animationDuration={450}
          animationEasing="ease-out"
        />
        <ReferenceDot
          x={last.t}
          y={last.v}
          ifOverflow="visible"
          shape={(props) => <LastPoint cx={props.cx} cy={props.cy} color={color} pulseKey={pulseKey} />}
        />
      </AreaChart>
    </div>
  );
});

/** The latest price: a solid dot that glides to its new spot and sends out a ring when it changes. */
function LastPoint({ cx, cy, color, pulseKey }: { cx?: number; cy?: number; color: string; pulseKey: number }) {
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
  return (
    <g pointerEvents="none">
      {pulseKey > 0 ? (
        <motion.circle
          key={pulseKey}
          cx={cx}
          cy={cy}
          fill={color}
          initial={{ r: 3.5, opacity: 0.45 }}
          animate={{ r: 16, opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      ) : null}
      <motion.circle
        initial={false}
        animate={{ cx, cy }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        r={3.5}
        fill={color}
        stroke="var(--card)"
        strokeWidth={2}
      />
    </g>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

function CompareView({ quotes }: { quotes: StockQuote[] }) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [hoverRow, setHoverRow] = React.useState<CompareRow | null>(null);

  const withSeries = React.useMemo(() => quotes.filter((q) => q.series.length > 1), [quotes]);
  const rows = React.useMemo(() => buildCompareRows(withSeries), [withSeries]);
  const color = (sym: string) => SERIES_COLORS[quotes.findIndex((q) => q.symbol === sym) % SERIES_COLORS.length];
  const symbols = React.useMemo(() => withSeries.map((q) => q.symbol), [withSeries]);
  const colors = React.useMemo(
    () => symbols.map((s) => SERIES_COLORS[quotes.findIndex((q) => q.symbol === s) % SERIES_COLORS.length]),
    [symbols, quotes],
  );
  const lastPct = (q: StockQuote) => {
    const first = q.series[0]?.v;
    const last = q.series[q.series.length - 1]?.v;
    return first ? (last / first - 1) * 100 : 0;
  };

  const toggle = (sym: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else if (next.size < withSeries.length - 1) next.add(sym);
      return next;
    });

  if (withSeries.length < 2) {
    return <EmptyNote>Need chart data for at least two symbols to compare.</EmptyNote>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.82rem] text-muted-foreground">Change since first point</p>
        <p className="text-[0.75rem] text-subtle">{quotes[0].seriesLabel}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Series">
        {withSeries.map((q) => {
          const off = hidden.has(q.symbol);
          const pct = hoverRow ? (hoverRow[q.symbol] as number | undefined) : lastPct(q);
          return (
            <button
              key={q.symbol}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(q.symbol)}
              onMouseEnter={() => setHovered(q.symbol)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(q.symbol)}
              onBlur={() => setHovered(null)}
              className={cn(
                "flex h-10 items-center gap-2 rounded-full border border-border px-3 text-[0.8rem] transition-all outline-none hover:border-ring/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                off && "opacity-45",
              )}
            >
              <span className="size-2 rounded-full" style={{ background: color(q.symbol) }} />
              <span className="font-medium">{q.symbol}</span>
              <span
                className={cn(
                  "nums",
                  pct === undefined ? "text-subtle" : pct >= 0 ? "text-up" : "text-down",
                )}
              >
                {pct === undefined ? "-" : formatSignedPercent(pct)}
              </span>
            </button>
          );
        })}
      </div>
      <CompareChart
        rows={rows}
        symbols={symbols}
        colors={colors}
        hidden={hidden}
        highlighted={hovered}
        currency={quotes[0].currency}
        onHoverRow={setHoverRow}
      />
    </div>
  );
}

type CompareRow = { t: number } & Record<string, number | undefined>;

function buildCompareRows(quotes: StockQuote[]): CompareRow[] {
  const map = new Map<number, CompareRow>();
  for (const q of quotes) {
    const base = q.series[0]?.v;
    if (!base) continue;
    for (const p of q.series) {
      const row = map.get(p.t) ?? ({ t: p.t } as CompareRow);
      row[q.symbol] = (p.v / base - 1) * 100;
      map.set(p.t, row);
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

const CompareChart = React.memo(function CompareChart({
  rows,
  symbols,
  colors,
  hidden,
  highlighted,
  currency,
  onHoverRow,
}: {
  rows: CompareRow[];
  symbols: string[];
  colors: string[];
  hidden: Set<string>;
  highlighted: string | null;
  currency: string;
  onHoverRow: (row: CompareRow | null) => void;
}) {
  const tz = zoneFor(currency);
  const first = rows[0]?.t ?? 0;
  const last = rows[rows.length - 1]?.t ?? 0;
  const span = last - first;
  const xTicks = React.useMemo(() => timeTicks(first, last, 4), [first, last]);

  const handleMove = React.useCallback(
    (state: MouseHandlerDataParam) => {
      const i = state?.isTooltipActive ? Number(state.activeTooltipIndex) : NaN;
      onHoverRow(Number.isFinite(i) ? (rows[i] ?? null) : null);
    },
    [onHoverRow, rows],
  );
  const handleLeave = React.useCallback(() => onHoverRow(null), [onHoverRow]);

  return (
    <div className="-mx-1 select-none [&_.recharts-surface]:outline-none" style={{ height: CHART_HEIGHT + 20 }}>
      <LineChart
        data={rows}
        responsive
        style={{ width: "100%", height: CHART_HEIGHT + 20 }}
        margin={{ top: 10, right: 2, bottom: 0, left: 2 }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onTouchMove={handleMove}
        onTouchEnd={handleLeave}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[first, last]}
          ticks={xTicks}
          tickFormatter={(t: number) => formatTime(t, span, tz)}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          orientation="right"
          tickCount={5}
          width={48}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="3 4" />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.6, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as CompareRow | undefined;
            if (!active || !row) return null;
            const items = symbols
              .map((s, i) => ({ s, v: row[s], c: colors[i] }))
              .filter((x) => x.v !== undefined && !hidden.has(x.s))
              .sort((a, b) => (b.v as number) - (a.v as number));
            return (
              <ChartTip>
                <span className="text-muted-foreground nums">{formatTime(row.t, span, tz, true)}</span>
                {items.map((x) => (
                  <span key={x.s} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: x.c }} />
                    <span className="flex-1 font-medium">{x.s}</span>
                    <span className={cn("nums", (x.v as number) >= 0 ? "text-up" : "text-down")}>
                      {formatSignedPercent(x.v as number)}
                    </span>
                  </span>
                ))}
              </ChartTip>
            );
          }}
        />
        {symbols.map((s, i) => (
          <Line
            key={s}
            type="linear"
            dataKey={s}
            name={s}
            hide={hidden.has(s)}
            stroke={colors[i]}
            strokeWidth={highlighted === s ? 2.25 : 1.75}
            strokeOpacity={highlighted && highlighted !== s ? 0.2 : 1}
            dot={false}
            activeDot={{ r: 3.5, fill: colors[i], stroke: "var(--card)", strokeWidth: 2 }}
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

/* ───────────────────────── Skeleton and shared bits ───────────────────────── */

function StocksSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex gap-1.5">
        <Shimmer className="h-10 w-28 rounded-full" />
        <Shimmer className="h-10 w-28 rounded-full" />
        <Shimmer className="h-10 w-24 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Shimmer className="h-3.5 w-40" />
        <Shimmer className="h-9 w-36" />
        <Shimmer className="h-3.5 w-48" />
      </div>
      <ChartShimmer height={CHART_HEIGHT} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Shimmer key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

const SKELETON_LINE = [62, 58, 64, 55, 49, 53, 44, 47, 40, 45, 38, 33, 37, 30, 34, 27, 31, 24, 28, 22];

/** A chart-shaped loading placeholder: faint gridlines and a shimmering area silhouette. */
export function ChartShimmer({ height = CHART_HEIGHT, className }: { height?: number; className?: string }) {
  const step = 100 / (SKELETON_LINE.length - 1);
  const line = SKELETON_LINE.map((y, i) => `${(i * step).toFixed(2)}% ${y}%`).join(", ");
  const band = [
    ...SKELETON_LINE.map((y, i) => `${(i * step).toFixed(2)}% ${y - 1.2}%`),
    ...SKELETON_LINE.map((y, i) => `${(100 - i * step).toFixed(2)}% ${SKELETON_LINE[SKELETON_LINE.length - 1 - i] + 1.2}%`),
  ].join(", ");
  return (
    <div className={cn("relative overflow-hidden rounded-xl", className)} style={{ height }} aria-hidden>
      {[0.25, 0.5, 0.75].map((f) => (
        <div key={f} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${f * 100}%` }} />
      ))}
      <div className="shimmer absolute inset-0 opacity-50" style={{ clipPath: `polygon(${line}, 100% 100%, 0% 100%)` }} />
      <div className="shimmer absolute inset-0" style={{ clipPath: `polygon(${band})` }} />
    </div>
  );
}

/**
 * A number that glides to new values (a short spring) and snaps instantly when `instant` is set,
 * for example while a chart hover is driving it.
 */
export function Ticker({
  value,
  format,
  instant,
  className,
}: {
  value: number;
  format: (v: number) => string;
  instant?: boolean;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 170, damping: 26, mass: 0.7 });
  const formatRef = React.useRef(format);
  React.useEffect(() => {
    formatRef.current = format;
  }, [format]);
  React.useEffect(() => {
    if (instant) spring.jump(value);
    else spring.set(value);
  }, [value, instant, spring]);
  const text = useTransform(spring, (v) => formatRef.current(v));
  return <motion.span className={cn("nums", className)}>{text}</motion.span>;
}

export function ChartTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-28 flex-col gap-1 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[0.76rem] text-popover-foreground shadow-float">
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[0.85rem] text-muted-foreground">
      {children}
    </p>
  );
}

/* ───────────────────────── Data helpers ───────────────────────── */

function isQuote(v: unknown): v is StockQuote {
  if (!v || typeof v !== "object") return false;
  const q = v as Partial<StockQuote>;
  return typeof q.symbol === "string" && typeof q.price === "number" && Number.isFinite(q.price);
}

/** Polled data wins, but never with less than we already have. */
function mergeQuote(base: StockQuote, polled: StockQuote | null): StockQuote {
  const b = normalise(base);
  if (!polled || polled.symbol.toUpperCase() !== b.symbol.toUpperCase()) return b;
  const p = normalise(polled);
  return {
    ...b,
    ...p,
    name: p.name || b.name,
    url: p.url || b.url,
    seriesLabel: p.seriesLabel || b.seriesLabel,
    series: p.series.length > 1 ? p.series : b.series,
  };
}

function normalise(q: StockQuote): StockQuote {
  const series = Array.isArray(q.series)
    ? q.series.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
    : [];
  return {
    ...q,
    name: q.name ?? "",
    currency: q.currency || "USD",
    change: Number.isFinite(q.change) ? q.change : 0,
    changePercent: Number.isFinite(q.changePercent) ? q.changePercent : 0,
    asOf: q.asOf ?? "",
    seriesLabel: q.seriesLabel ?? "",
    series,
  };
}

function useSvgId(prefix: string) {
  return `${prefix}-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/* ───────────────────────── Formatting ───────────────────────── */

const priceFormatters = new Map<string, (v: number) => string>();

function priceFormatter(currency: string) {
  let f = priceFormatters.get(currency);
  if (!f) {
    let nf: Intl.NumberFormat;
    try {
      nf = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    f = (v: number) => nf.format(v);
    priceFormatters.set(currency, f);
  }
  return f;
}

export function formatPrice(v: number, currency = "USD") {
  return priceFormatter(currency)(v);
}

function formatSigned(v: number, currency: string) {
  const s = formatPrice(Math.abs(v), currency);
  return `${v < 0 ? "-" : "+"}${s}`;
}

function formatSignedPercent(v: number) {
  if (!Number.isFinite(v)) return "-";
  return `${v < 0 ? "-" : "+"}${Math.abs(v).toFixed(2)}%`;
}

/** US listings read best in exchange time; everything else in the reader's own zone. */
function zoneFor(currency: string): string | undefined {
  return currency === "USD" ? "America/New_York" : undefined;
}

export function formatTime(t: number, span: number, timeZone?: string, long = false): string {
  const d = new Date(t);
  try {
    if (span <= 2 * 86_400_000) {
      const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
      return long && timeZone === "America/New_York" ? `${time} ET` : time;
    }
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(long || span > 400 * 86_400_000 ? { year: "numeric" } : {}),
      timeZone,
    });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** Round price ticks (steps of 1, 2, 2.5 or 5 times a power of ten) strictly inside the domain. */
function niceTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (!(range > 0)) return [min];
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v < max; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const TICK_STEPS = [
  5, 15, 30, 60, 120, 180, 360, 720, 1440, 2 * 1440, 7 * 1440, 14 * 1440, 30 * 1440, 91 * 1440, 182 * 1440, 365 * 1440,
].map((m) => m * 60_000);

/** A few evenly spaced, round ticks (on the hour, on the day) between `from` and `to`. */
export function timeTicks(from: number, to: number, max: number): number[] {
  const span = to - from;
  if (!(span > 0)) return [from];
  const step = TICK_STEPS.find((s) => span / s <= max) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    if (t - from > span * 0.04 && to - t > span * 0.04) ticks.push(t);
  }
  return ticks.length ? ticks : [from + span / 2];
}

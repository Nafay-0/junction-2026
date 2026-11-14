"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PieSectorShapeProps } from "recharts/types/polar/Pie";
import { ChartNoAxesColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomBlock, CustomChartType } from "@/lib/widgets/types";

/* ───────────────────────── Data clean-up ───────────────────────── */

const CHART_TYPES: CustomChartType[] = ["pie", "donut", "bar", "stackedBar", "horizontalBar", "line", "area", "scatter", "radar"];

type CleanSeries = { key: string; name: string; values: Array<number | null>; index: number };
type Clean = { labels: string[]; series: CleanSeries[]; unit: string };

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[\s,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clean(block: CustomBlock): Clean {
  const rawLabels = Array.isArray(block.labels) ? block.labels : [];
  const labels = rawLabels.map((l) => (typeof l === "string" ? l : typeof l === "number" ? String(l) : ""));
  const rawSeries = Array.isArray(block.series) ? block.series : [];
  const series: CleanSeries[] = [];
  rawSeries.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const vals = Array.isArray(s.values) ? s.values : [];
    series.push({
      key: `s${i}`,
      name: typeof s.name === "string" && s.name.trim() ? s.name : `Series ${i + 1}`,
      values: labels.map((_, j) => toNumber(vals[j])),
      index: series.length,
    });
  });
  const unit = typeof block.unit === "string" ? block.unit.trim() : "";
  return { labels, series: series.filter((s) => s.values.some((v) => v !== null)), unit };
}

/** True when a chart block has enough data to draw something meaningful. */
export function chartHasData(block: CustomBlock): boolean {
  const c = clean(block);
  if (c.labels.length === 0 || c.series.length === 0) return false;
  const type = normaliseType(block.chartType);
  if (type === "scatter") return c.labels.some((l) => toNumber(l) !== null);
  if (type === "pie" || type === "donut") return c.series[0].values.some((v) => v !== null && v > 0);
  return true;
}

function normaliseType(t: unknown): CustomChartType {
  return CHART_TYPES.includes(t as CustomChartType) ? (t as CustomChartType) : "bar";
}

/* ───────────────────────── Colour and number formatting ───────────────────────── */

type Paint = { color: string; opacity: number };

function paint(i: number): Paint {
  const n = (((i % 5) + 5) % 5) + 1;
  const cycle = Math.floor(i / 5);
  return { color: `var(--chart-${n})`, opacity: cycle === 0 ? 1 : Math.max(0.35, 1 - cycle * 0.35) };
}

const PREFIX_UNITS = new Set(["€", "$", "£", "¥", "₹", "₩", "₽", "₺", "₪", "₦", "฿", "US$", "A$", "C$"]);
const TIGHT_UNITS = new Set(["%", "°", "°C", "°F", "‰", "x", "×"]);

function withUnit(num: string, unit: string): string {
  if (!unit) return num;
  if (PREFIX_UNITS.has(unit)) {
    return num.startsWith("-") ? `−${unit}${num.slice(1)}` : `${unit}${num}`;
  }
  return TIGHT_UNITS.has(unit) ? `${num}${unit}` : `${num} ${unit}`;
}

/**
 * 1,500 as "1.5k", 3,400,000 as "3.4M". Written by hand rather than with Intl's compact notation,
 * which spells the suffix differently in Node and in browsers ("1K" against "1k") and so would
 * render one thing on the server and another in the browser.
 */
function short(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number, suffix: string) => `${sign}${(Math.round(v * 10) / 10).toString().replace(/\.0$/, "")}${suffix}`;
  if (abs >= 1e12) return fmt(abs / 1e12, "T");
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  return fmt(abs / 1e3, "k");
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return short(n);
  if (abs >= 100 || Number.isInteger(n)) return Math.round(n).toLocaleString("en-GB");
  return n.toLocaleString("en-GB", { maximumFractionDigits: abs >= 10 ? 1 : 2 });
}

function full(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return short(n);
  return n.toLocaleString("en-GB", { maximumFractionDigits: abs >= 100 ? 0 : 2 });
}

export function formatValue(n: number | null | undefined, unit: string, mode: "compact" | "full" = "full"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return withUnit(mode === "compact" ? compact(n) : full(n), unit);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/* ───────────────────────── Shared pieces ───────────────────────── */

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };
const ANIM = { isAnimationActive: true, animationDuration: 550, animationEasing: "ease-out" as const };

function ChartTip({ title, rows }: { title?: string; rows: Array<{ name: string; value: string; paint: Paint }> }) {
  return (
    <div className="pointer-events-none min-w-[9rem] max-w-[16rem] rounded-lg border border-border bg-popover px-2.5 py-2 text-[0.75rem] text-popover-foreground shadow-float">
      {title ? <div className="mb-1.5 truncate font-medium text-foreground">{title}</div> : null}
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={`${r.name}-${i}`} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: r.paint.color, opacity: r.paint.opacity }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.name}</span>
            <span className="nums font-medium text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeriesLegend({
  series,
  hidden,
  onToggle,
}: {
  series: CleanSeries[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Series">
      {series.map((s) => {
        const off = hidden.has(s.key);
        const p = paint(s.index);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(s.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[0.75rem] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              off ? "text-subtle" : "text-foreground",
            )}
          >
            <span
              className="size-2 rounded-full transition-opacity"
              style={{ background: off ? "transparent" : p.color, opacity: p.opacity, boxShadow: `inset 0 0 0 1.5px ${p.color}` }}
            />
            <span className={cn("max-w-[10rem] truncate", off && "line-through decoration-subtle/70")}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function useHiddenSeries(series: CleanSeries[]) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const toggle = React.useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else if (series.filter((s) => !next.has(s.key)).length > 1) next.add(key);
        return next;
      });
    },
    [series],
  );
  return { hidden, toggle };
}

function yAxisWidth(values: number[], unit: string): number {
  if (values.length === 0) return 36;
  const max = Math.max(...values.map(Math.abs));
  const sample = formatValue(max, unit, "compact");
  return Math.min(68, Math.max(30, sample.length * 6.6 + 10));
}

export function ChartEmpty({ height = 200 }: { height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/50 text-[0.82rem] text-muted-foreground"
      style={{ height }}
    >
      <ChartNoAxesColumn className="size-5 text-subtle" aria-hidden />
      Not enough data to draw this
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex flex-col justify-end gap-3" style={{ height }} aria-hidden>
      <div className="flex flex-1 items-end gap-2 px-1">
        {[46, 72, 58, 88, 64, 78, 52].map((h, i) => (
          <div key={i} className="shimmer flex-1 rounded-t-md" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="flex justify-between px-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-2.5 w-10 rounded" />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Entry ───────────────────────── */

export function CustomChart({ block }: { block: CustomBlock }) {
  const type = normaliseType(block.chartType);
  const data = React.useMemo(() => clean(block), [block]);
  if (!chartHasData(block)) return <ChartEmpty />;
  const label = block.title ? `${block.title} chart` : "Chart";
  return (
    <div role="figure" aria-label={label} className="select-none [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
      {type === "pie" || type === "donut" ? (
        <PieBlock data={data} donut={type === "donut"} />
      ) : type === "scatter" ? (
        <ScatterBlock data={data} />
      ) : type === "radar" ? (
        <RadarBlock data={data} />
      ) : type === "line" || type === "area" ? (
        <LineAreaBlock data={data} area={type === "area"} />
      ) : (
        <BarBlock data={data} mode={type === "stackedBar" ? "stacked" : type === "horizontalBar" ? "horizontal" : "grouped"} />
      )}
    </div>
  );
}

/* ───────────────────────── Pie and donut ───────────────────────── */

function PieBlock({ data, donut }: { data: Clean; donut: boolean }) {
  const [active, setActive] = React.useState<number | null>(null);
  const s = data.series[0];
  const slices = React.useMemo(
    () =>
      data.labels
        .map((label, i) => ({ name: label || `Item ${i + 1}`, value: s.values[i], colorIndex: i }))
        .filter((d): d is { name: string; value: number; colorIndex: number } => d.value !== null && d.value > 0),
    [data.labels, s],
  );
  const total = slices.reduce((sum, d) => sum + d.value, 0);
  const activeSlice = active !== null ? slices[active] : undefined;

  const shape = React.useCallback(
    (props: PieSectorShapeProps) => {
      const isOn = active === props.index;
      const dim = active !== null && !isOn;
      const outer = Number(props.outerRadius) || 0;
      return (
        <Sector
          {...props}
          outerRadius={isOn ? outer + 5 : outer}
          fillOpacity={(dim ? 0.28 : 1) * (Number(props.fillOpacity) || 1)}
          stroke="var(--card)"
          strokeWidth={2}
          style={{ transition: "fill-opacity 180ms ease-out", outline: "none" }}
        />
      );
    },
    [active],
  );

  return (
    <div className="@container">
      <div className="flex flex-col items-stretch gap-4 @[480px]:flex-row @[480px]:items-center @[480px]:gap-6">
        <div className="relative mx-auto aspect-square w-full max-w-[240px] shrink-0 @[480px]:mx-0 @[480px]:max-w-[260px]">
          <PieChart responsive style={{ width: "100%", height: "100%" }} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
            <Pie
              data={slices.map((d) => {
                const p = paint(d.colorIndex);
                return { ...d, fill: p.color, fillOpacity: p.opacity };
              })}
              dataKey="value"
              nameKey="name"
              innerRadius={donut ? "64%" : 0}
              outerRadius="92%"
              paddingAngle={donut && slices.length > 1 ? 1.5 : 0}
              cornerRadius={donut ? 4 : 0}
              startAngle={90}
              endAngle={-270}
              stroke="var(--card)"
              shape={shape}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
              rootTabIndex={-1}
              {...ANIM}
              animationDuration={650}
            />
            {!donut ? (
              <Tooltip
                isAnimationActive={false}
                content={({ active: on, payload }) => {
                  const d = payload?.[0]?.payload as { name: string; value: number; colorIndex: number } | undefined;
                  if (!on || !d) return null;
                  return (
                    <ChartTip
                      rows={[
                        {
                          name: d.name,
                          value: `${formatValue(d.value, data.unit)} · ${pct(d.value, total)}`,
                          paint: paint(d.colorIndex),
                        },
                      ]}
                    />
                  );
                }}
              />
            ) : null}
          </PieChart>
          {donut ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="max-w-[55%] truncate text-[0.72rem] text-muted-foreground">{activeSlice ? activeSlice.name : "Total"}</span>
              <span className="nums font-display text-[1.45rem] leading-tight text-foreground">
                {/* The centre is the headline number: written out in full unless it is very large. */}
                {formatValue(activeSlice ? activeSlice.value : total, data.unit, Math.abs(activeSlice ? activeSlice.value : total) >= 100_000 ? "compact" : "full")}
              </span>
              {activeSlice ? <span className="nums text-[0.72rem] text-muted-foreground">{pct(activeSlice.value, total)}</span> : null}
            </div>
          ) : null}
        </div>

        <ul className="flex min-w-0 flex-1 flex-col gap-0.5" onMouseLeave={() => setActive(null)}>
          {slices.map((d, i) => {
            const p = paint(d.colorIndex);
            const dim = active !== null && active !== i;
            return (
              <li key={`${d.name}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "grid w-full grid-cols-[auto_minmax(0,1fr)_auto_3rem] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[0.82rem] transition-[background-color,opacity] duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                    dim && "opacity-45",
                    active === i && "bg-muted",
                  )}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: p.color, opacity: p.opacity }} />
                  <span className="truncate text-foreground">{d.name}</span>
                  <span className="nums font-medium text-foreground">{formatValue(d.value, data.unit)}</span>
                  <span className="nums text-right text-muted-foreground">{pct(d.value, total)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function pct(v: number, total: number): string {
  if (!total) return "0%";
  const p = (v / total) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

/* ───────────────────────── Cartesian helpers ───────────────────────── */

type Row = Record<string, string | number | null>;

function toRows(data: Clean): Row[] {
  return data.labels.map((label, i) => {
    const row: Row = { label: label || `${i + 1}` };
    for (const s of data.series) row[s.key] = s.values[i];
    return row;
  });
}

function seriesTooltip(data: Clean, hidden: Set<string>) {
  const TooltipContent = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const row = payload?.[0]?.payload as Row | undefined;
    if (!active || !row) return null;
    const visible = data.series.filter((s) => !hidden.has(s.key));
    return (
      <ChartTip
        title={String(row.label ?? "")}
        rows={visible.map((s) => ({
          name: s.name,
          value: formatValue(typeof row[s.key] === "number" ? (row[s.key] as number) : null, data.unit),
          paint: paint(s.index),
        }))}
      />
    );
  };
  return TooltipContent;
}

function visibleValues(data: Clean, hidden: Set<string>, stacked = false): number[] {
  const vis = data.series.filter((s) => !hidden.has(s.key));
  if (stacked) {
    return data.labels.map((_, i) => vis.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  }
  return vis.flatMap((s) => s.values.filter((v): v is number => v !== null));
}

const CHART_HEIGHT = 260;
const MARGIN = { top: 8, right: 4, bottom: 0, left: 0 };

/* ───────────────────────── Bars ───────────────────────── */

function BarBlock({ data, mode }: { data: Clean; mode: "grouped" | "stacked" | "horizontal" }) {
  const { hidden, toggle } = useHiddenSeries(data.series);
  const rows = React.useMemo(() => toRows(data), [data]);
  const multi = data.series.length > 1;
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const stacked = mode === "stacked";
  const values = visibleValues(data, hidden, stacked);
  const Content = seriesTooltip(data, hidden);
  const tickFmt = (v: number) => formatValue(v, data.unit, "compact");
  const cursor = { fill: "var(--muted)", fillOpacity: 0.7 };
  const valueDomain: [number | "auto", "auto"] = [values.some((v) => v < 0) ? "auto" : 0, "auto"];

  if (mode === "horizontal") {
    const longest = Math.max(...rows.map((r) => String(r.label).length));
    const catWidth = Math.min(132, Math.max(48, longest * 6.4 + 8));
    const barSize = visible.length > 1 ? 10 : 16;
    const height = Math.min(520, Math.max(160, rows.length * (visible.length > 1 ? 22 + visible.length * 10 : 34) + 36));
    return (
      <div>
        {multi ? <SeriesLegend series={data.series} hidden={hidden} onToggle={toggle} /> : null}
        <div style={{ height }}>
          <BarChart
            data={rows}
            layout="vertical"
            responsive
            style={{ width: "100%", height: "100%" }}
            margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="22%"
            barGap={2}
          >
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              tickFormatter={tickFmt}
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK}
              tickCount={4}
              tickMargin={6}
              domain={valueDomain}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={catWidth}
              axisLine={false}
              tickLine={false}
              tick={{ ...AXIS_TICK, fill: "var(--foreground)", fontSize: 11.5 }}
              tickFormatter={(l: string) => truncate(String(l), 22)}
              interval={0}
            />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Content active={p.active} payload={p.payload} />} />
            {visible.map((s) => {
              const pnt = paint(s.index);
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  fill={pnt.color}
                  fillOpacity={pnt.opacity}
                  radius={[0, 4, 4, 0]}
                  barSize={barSize}
                  {...ANIM}
                />
              );
            })}
          </BarChart>
        </div>
      </div>
    );
  }

  const many = rows.length > 8;
  return (
    <div>
      {multi ? <SeriesLegend series={data.series} hidden={hidden} onToggle={toggle} /> : null}
      <div style={{ height: CHART_HEIGHT }}>
        <BarChart
          data={rows}
          responsive
          style={{ width: "100%", height: "100%" }}
          margin={MARGIN}
          barCategoryGap={visible.length > 1 && !stacked ? "20%" : "28%"}
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis
            dataKey="label"
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tick={AXIS_TICK}
            tickMargin={8}
            minTickGap={many ? 8 : 4}
            interval="preserveStartEnd"
            tickFormatter={(l: string) => truncate(String(l), many ? 6 : 12)}
          />
          <YAxis
            width={yAxisWidth(values, data.unit)}
            axisLine={false}
            tickLine={false}
            tick={AXIS_TICK}
            tickCount={4}
            tickFormatter={tickFmt}
            domain={valueDomain}
          />
          <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Content active={p.active} payload={p.payload} />} />
          {visible.map((s, i) => {
            const pnt = paint(s.index);
            const top = !stacked || i === visible.length - 1;
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId={stacked ? "stack" : undefined}
                fill={pnt.color}
                fillOpacity={pnt.opacity}
                radius={top ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={stacked || visible.length === 1 ? 44 : 22}
                stroke={stacked ? "var(--card)" : undefined}
                strokeWidth={stacked ? 1 : 0}
                {...ANIM}
              />
            );
          })}
        </BarChart>
      </div>
    </div>
  );
}

/* ───────────────────────── Lines and areas ───────────────────────── */

function LineAreaBlock({ data, area }: { data: Clean; area: boolean }) {
  const { hidden, toggle } = useHiddenSeries(data.series);
  const rows = React.useMemo(() => toRows(data), [data]);
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const multi = data.series.length > 1;
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const values = visibleValues(data, hidden);
  const Content = seriesTooltip(data, hidden);
  const min = values.length ? Math.min(...values) : 0;
  const many = rows.length > 8;
  const cursor = { stroke: "var(--muted-foreground)", strokeOpacity: 0.55, strokeWidth: 1, strokeDasharray: "3 3" };
  const xAxis = (
    <XAxis
      dataKey="label"
      axisLine={false}
      tickLine={false}
      tick={AXIS_TICK}
      tickMargin={8}
      minTickGap={16}
      interval="preserveStartEnd"
      tickFormatter={(l: string) => truncate(String(l), many ? 7 : 12)}
      padding={{ left: 6, right: 6 }}
    />
  );
  const yAxis = (
    <YAxis
      width={yAxisWidth(values, data.unit)}
      axisLine={false}
      tickLine={false}
      tick={AXIS_TICK}
      tickCount={4}
      tickFormatter={(v: number) => formatValue(v, data.unit, "compact")}
      domain={[min >= 0 ? 0 : "auto", "auto"]}
    />
  );
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />;
  const tooltip = <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Content active={p.active} payload={p.payload} />} />;

  return (
    <div>
      {multi ? <SeriesLegend series={data.series} hidden={hidden} onToggle={toggle} /> : null}
      <div style={{ height: CHART_HEIGHT }}>
        {area ? (
          <AreaChart data={rows} responsive style={{ width: "100%", height: "100%" }} margin={MARGIN}>
            <defs>
              {data.series.map((s) => {
                const p = paint(s.index);
                return (
                  <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.26 * p.opacity} />
                    <stop offset="75%" stopColor={p.color} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {visible.map((s) => {
              const p = paint(s.index);
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={p.color}
                  strokeOpacity={p.opacity}
                  strokeWidth={1.75}
                  fill={`url(#${uid}-${s.key})`}
                  dot={false}
                  activeDot={{ r: 4, fill: p.color, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls
                  {...ANIM}
                />
              );
            })}
          </AreaChart>
        ) : (
          <LineChart data={rows} responsive style={{ width: "100%", height: "100%" }} margin={MARGIN}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {visible.map((s) => {
              const p = paint(s.index);
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={p.color}
                  strokeOpacity={p.opacity}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: p.color, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls
                  {...ANIM}
                />
              );
            })}
          </LineChart>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Scatter ───────────────────────── */

type Point = { x: number; y: number; name: string; colorIndex: number };

function ScatterBlock({ data }: { data: Clean }) {
  const { hidden, toggle } = useHiddenSeries(data.series);
  const multi = data.series.length > 1;
  const points = React.useMemo(() => {
    const xs = data.labels.map((l) => toNumber(l));
    return data.series.map((s) =>
      s.values
        .map((y, i) => ({ x: xs[i], y, name: s.name, colorIndex: s.index }))
        .filter((p): p is Point => p.x !== null && p.y !== null),
    );
  }, [data]);
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const ys = visible.flatMap((s) => points[s.index].map((p) => p.y));

  return (
    <div>
      {multi ? <SeriesLegend series={data.series} hidden={hidden} onToggle={toggle} /> : null}
      <div style={{ height: CHART_HEIGHT }}>
        <ScatterChart responsive style={{ width: "100%", height: "100%" }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            name="x"
            domain={["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            tick={AXIS_TICK}
            tickMargin={8}
            tickCount={5}
            tickFormatter={(v: number) => compact(v)}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="y"
            domain={["auto", "auto"]}
            width={yAxisWidth(ys, data.unit)}
            axisLine={false}
            tickLine={false}
            tick={AXIS_TICK}
            tickCount={4}
            tickFormatter={(v: number) => formatValue(v, data.unit, "compact")}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.45, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              if (!active || !p) return null;
              return (
                <ChartTip
                  title={p.name}
                  rows={[
                    { name: "x", value: full(p.x), paint: { color: "transparent", opacity: 0 } },
                    { name: "y", value: formatValue(p.y, data.unit), paint: paint(p.colorIndex) },
                  ]}
                />
              );
            }}
          />
          {visible.map((s) => {
            const p = paint(s.index);
            return (
              <Scatter
                key={s.key}
                name={s.name}
                data={points[s.index]}
                fill={p.color}
                fillOpacity={0.78 * p.opacity}
                stroke="var(--card)"
                strokeWidth={1.5}
                {...ANIM}
              />
            );
          })}
        </ScatterChart>
      </div>
    </div>
  );
}

/* ───────────────────────── Radar ───────────────────────── */

function RadarBlock({ data }: { data: Clean }) {
  const { hidden, toggle } = useHiddenSeries(data.series);
  const rows = React.useMemo(() => toRows(data), [data]);
  const multi = data.series.length > 1;
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const Content = seriesTooltip(data, hidden);
  return (
    <div>
      {multi ? <SeriesLegend series={data.series} hidden={hidden} onToggle={toggle} /> : null}
      <div style={{ height: 280 }}>
        <RadarChart data={rows} responsive style={{ width: "100%", height: "100%" }} outerRadius="72%" margin={{ top: 4, right: 12, bottom: 4, left: 12 }}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="label" tick={{ ...AXIS_TICK, fill: "var(--foreground)" }} tickFormatter={(l: string) => truncate(String(l), 14)} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={[0, "auto"]} />
          <Tooltip isAnimationActive={false} content={(p) => <Content active={p.active} payload={p.payload} />} />
          {visible.map((s) => {
            const p = paint(s.index);
            return (
              <Radar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={p.color}
                strokeOpacity={p.opacity}
                strokeWidth={1.75}
                fill={p.color}
                fillOpacity={0.14 * p.opacity}
                dot={false}
                activeDot={{ r: 3.5, fill: p.color, stroke: "var(--card)", strokeWidth: 2 }}
                {...ANIM}
              />
            );
          })}
        </RadarChart>
      </div>
    </div>
  );
}

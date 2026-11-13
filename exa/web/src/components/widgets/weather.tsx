"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  ChevronDown,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Sun,
  Umbrella,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeatherData, WeatherDay, WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame } from "@/components/widgets/frame";

const COLLAPSED_DAYS = 7;
const MAX_DAYS = 14;
const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ───────────────────────── Helpers ───────────────────────── */

type Look = { Icon: LucideIcon; tone: string };

/** Picks an icon (and its colour) from keywords in the condition text. Order matters: "snow showers" is snow, not rain. */
function lookFor(condition: string | undefined): Look {
  const c = (condition ?? "").toLowerCase();
  if (/thunder|storm|lightning/.test(c)) return { Icon: CloudLightning, tone: "text-chart-5" };
  if (/snow|sleet|flurr|blizzard|ice|hail/.test(c)) return { Icon: CloudSnow, tone: "text-chart-3" };
  if (/drizzle/.test(c)) return { Icon: CloudDrizzle, tone: "text-chart-3" };
  if (/rain|shower/.test(c)) return { Icon: CloudRain, tone: "text-chart-3" };
  if (/fog|mist|haze|smog/.test(c)) return { Icon: CloudFog, tone: "text-muted-foreground" };
  if (/partly|mostly sunny|sunny intervals|sun and cloud|partly sunny/.test(c)) return { Icon: CloudSun, tone: "text-brass" };
  if (/sun|clear|bright/.test(c)) return { Icon: Sun, tone: "text-brass" };
  return { Icon: Cloud, tone: "text-muted-foreground" };
}

const COMPASS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Degrees the arrow should point: wind is named for where it comes from, so it blows the opposite way. */
function windArrow(direction?: string): number | null {
  if (!direction) return null;
  const d = COMPASS[direction.trim().toUpperCase()];
  return d === undefined ? null : (d + 180) % 360;
}

function parseDate(iso: string): Date | null {
  // A bare ISO date is parsed as UTC by Date; read it as a local calendar day instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const noopSubscribe = () => () => {};
/** Today's local date, read only on the client so server and client markup agree. */
function useTodayIso(): string | null {
  return React.useSyncExternalStore(noopSubscribe, () => localIso(new Date()), () => null);
}

function weekday(iso: string, style: "short" | "long" = "short"): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString("en-GB", { weekday: style }) : iso;
}

function dayMonth(iso: string): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
}

const deg = (n: number) => `${Math.round(n)}°`;

/* ───────────────────────── Pieces ───────────────────────── */

/** Low-to-high bar on a track that spans the whole period's range. */
function RangeBar({ day, min, max, className }: { day: WeatherDay; min: number; max: number; className?: string }) {
  const span = Math.max(max - min, 1);
  const left = ((day.lowC - min) / span) * 100;
  const width = Math.max(((day.highC - day.lowC) / span) * 100, 6);
  return (
    <div
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={`Low ${deg(day.lowC)}, high ${deg(day.highC)}`}
    >
      <motion.div
        className="absolute inset-y-0 rounded-full bg-linear-to-r from-chart-3 to-chart-2"
        initial={{ opacity: 0, scaleX: 0.4 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        style={{ left: `${Math.min(left, 100 - width)}%`, width: `${width}%`, transformOrigin: "left center" }}
      />
    </div>
  );
}

function WindReading({ day, className }: { day: WeatherDay; className?: string }) {
  if (day.windKph === undefined) return <span className={cn("text-subtle", className)}>–</span>;
  const rot = windArrow(day.windDirection);
  return (
    <span
      className={cn("inline-flex items-center gap-1 nums", className)}
      title={day.windDirection ? `Wind from ${day.windDirection}` : undefined}
    >
      {rot !== null ? (
        <ArrowUp className="size-3 shrink-0 text-subtle" style={{ transform: `rotate(${rot}deg)` }} aria-hidden />
      ) : (
        <Wind className="size-3 shrink-0 text-subtle" aria-hidden />
      )}
      {Math.round(day.windKph)}
      <span className="text-subtle">km/h</span>
    </span>
  );
}

function RainChance({ value, className }: { value?: number; className?: string }) {
  if (value === undefined) return <span className={cn("text-subtle", className)}>–</span>;
  const wet = value >= 50;
  return (
    <span className={cn("inline-flex items-center gap-1 nums", wet ? "text-chart-3" : "text-muted-foreground", className)}>
      <Droplets className={cn("size-3 shrink-0", wet ? "" : "text-subtle")} aria-hidden />
      {Math.round(value)}%
    </span>
  );
}

function Today({ day, isToday }: { day: WeatherDay; isToday: boolean }) {
  const { Icon, tone } = lookFor(day.condition);
  return (
    <div className="flex items-center gap-4 sm:gap-5">
      <motion.span
        key={day.condition}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-surface hairline sm:size-[4.5rem]"
      >
        <Icon className={cn("size-9 sm:size-10", tone)} strokeWidth={1.5} aria-hidden />
      </motion.span>

      <div className="min-w-0 flex-1">
        <p className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">
          {isToday ? "Today" : weekday(day.date, "long")}
          <span className="text-subtle normal-case"> · {dayMonth(day.date)}</span>
        </p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-display text-[2.6rem] leading-none text-foreground nums sm:text-5xl">{deg(day.highC)}</span>
          <span className="font-display text-2xl leading-none text-muted-foreground nums">{deg(day.lowC)}</span>
        </div>
        <p className="mt-1.5 truncate text-[0.9rem] text-foreground">{day.condition}</p>
      </div>

      <dl className="hidden shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-1.5 text-[0.8rem] min-[420px]:grid">
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <Umbrella className="size-3.5 text-subtle" aria-hidden />
          Rain
        </dt>
        <dd className="text-right text-foreground nums">
          {day.rainChance !== undefined ? `${Math.round(day.rainChance)}%` : "–"}
          {day.precipMm !== undefined && day.precipMm > 0 ? (
            <span className="text-muted-foreground"> · {day.precipMm.toFixed(1)} mm</span>
          ) : null}
        </dd>
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <Wind className="size-3.5 text-subtle" aria-hidden />
          Wind
        </dt>
        <dd className="text-right text-foreground nums">
          {day.windKph !== undefined ? `${Math.round(day.windKph)} km/h` : "–"}
          {day.windDirection ? <span className="text-muted-foreground"> {day.windDirection}</span> : null}
        </dd>
      </dl>
    </div>
  );
}

/** Compact rain and wind line for narrow screens, where the side list is hidden. */
function TodayMeta({ day }: { day: WeatherDay }) {
  return (
    <div className="mt-3 flex items-center gap-4 text-[0.78rem] text-muted-foreground min-[420px]:hidden">
      <RainChance value={day.rainChance} />
      {day.precipMm !== undefined && day.precipMm > 0 ? <span className="nums">{day.precipMm.toFixed(1)} mm</span> : null}
      <WindReading day={day} />
    </div>
  );
}

/* ───────────────────────── Skeleton ───────────────────────── */

function WeatherSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex items-center gap-4">
        <Shimmer className="size-16 rounded-2xl sm:size-[4.5rem]" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-10 w-32" />
          <Shimmer className="h-3.5 w-20" />
        </div>
      </div>
      <div className="mt-5 hidden space-y-1 sm:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 px-2">
            <Shimmer className="h-3.5 w-10" />
            <Shimmer className="size-5 rounded-full" />
            <Shimmer className="h-3 w-10" />
            <Shimmer className="h-1.5 flex-1 rounded-full" />
            <Shimmer className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2 overflow-hidden sm:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-36 w-[5.5rem] shrink-0 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Widget ───────────────────────── */

export function Weather({ data, loading }: WidgetProps<WeatherData>) {
  const [expanded, setExpanded] = React.useState(false);
  const todayIso = useTodayIso();

  const days = React.useMemo(() => (data.days ?? []).slice(0, MAX_DAYS), [data.days]);
  const [first, ...rest] = days;
  const shownRest = expanded ? rest : rest.slice(0, COLLAPSED_DAYS - 1);
  const canExpand = rest.length > COLLAPSED_DAYS - 1;

  const { min, max } = React.useMemo(() => {
    if (days.length === 0) return { min: 0, max: 1 };
    return {
      min: Math.min(...days.map((d) => d.lowC)),
      max: Math.max(...days.map((d) => d.highC)),
    };
  }, [days]);

  const subtitle =
    days.length > 0
      ? `${days.length}-day forecast · ${deg(min)} to ${deg(max)}`
      : loading
        ? undefined
        : "No forecast available";

  return (
    <WidgetFrame
      icon={<CloudSun />}
      title={data.location || "Weather"}
      subtitle={subtitle}
      loading={loading}
      stage={data.stage}
      sources={data.sources}
      footerNote={days.length > 0 ? "Celsius · wind in km/h" : undefined}
    >
      {data.error ? (
        <WidgetError message={data.error} />
      ) : !first ? (
        loading ? (
          <WeatherSkeleton />
        ) : (
          <p className="rounded-xl bg-surface px-4 py-6 text-center text-[0.85rem] text-muted-foreground hairline">
            The forecast for this location is not available right now.
          </p>
        )
      ) : (
        <>
          <Today day={first} isToday={todayIso === first.date} />
          <TodayMeta day={first} />

          {rest.length > 0 ? (
            <>
              {/* Wide screens: one row per day. */}
              <ul className="mt-4 hidden border-t border-border/70 pt-2 sm:block" aria-label="Forecast">
                <AnimatePresence initial={true}>
                  {shownRest.map((day, i) => {
                    const { Icon, tone } = lookFor(day.condition);
                    return (
                      <motion.li
                        key={day.date}
                        layout="position"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
                        transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 12) * 0.03 }}
                        className="grid h-11 grid-cols-[4.5rem_1.5rem_3.25rem_2.25rem_minmax(0,1fr)_2.25rem_5.5rem] items-center gap-x-3 rounded-lg px-2 text-[0.85rem] transition-colors hover:bg-muted/60"
                        title={day.condition}
                      >
                        <span className="flex items-baseline gap-1.5">
                          <span className="font-medium text-foreground">{todayIso === day.date ? "Today" : weekday(day.date)}</span>
                          <span className="text-[0.72rem] text-subtle nums">{dayMonth(day.date).split(" ")[0]}</span>
                        </span>
                        <Icon className={cn("size-[1.15rem]", tone)} strokeWidth={1.75} aria-label={day.condition} />
                        <RainChance value={day.rainChance} className="text-[0.78rem]" />
                        <span className="text-right text-muted-foreground nums">{deg(day.lowC)}</span>
                        <RangeBar day={day} min={min} max={max} />
                        <span className="font-medium text-foreground nums">{deg(day.highC)}</span>
                        <WindReading day={day} className="justify-end text-[0.78rem] text-muted-foreground" />
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>

              {/* Small screens: a strip of day tiles that snaps as it scrolls. */}
              <ul
                className="-mx-4 mt-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:hidden"
                aria-label="Forecast"
              >
                {shownRest.map((day, i) => {
                  const { Icon, tone } = lookFor(day.condition);
                  return (
                    <motion.li
                      key={day.date}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 12) * 0.03 }}
                      className="flex w-[5.75rem] shrink-0 snap-start flex-col items-center rounded-xl bg-surface px-2.5 py-3 text-center hairline"
                      title={day.condition}
                    >
                      <span className="text-[0.8rem] font-medium text-foreground">
                        {todayIso === day.date ? "Today" : weekday(day.date)}
                      </span>
                      <span className="text-[0.7rem] text-subtle nums">{dayMonth(day.date)}</span>
                      <Icon className={cn("my-2 size-6", tone)} strokeWidth={1.6} aria-label={day.condition} />
                      <span className="flex w-full items-baseline justify-between text-[0.8rem] nums">
                        <span className="text-muted-foreground">{deg(day.lowC)}</span>
                        <span className="font-medium text-foreground">{deg(day.highC)}</span>
                      </span>
                      <RangeBar day={day} min={min} max={max} className="mt-1.5" />
                      <span className="mt-2.5 flex flex-col items-center gap-1 text-[0.72rem]">
                        <RainChance value={day.rainChance} />
                        <WindReading day={day} className="text-muted-foreground" />
                      </span>
                    </motion.li>
                  );
                })}
              </ul>

              {canExpand ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:-ml-1"
                >
                  {expanded ? "Show fewer days" : `Show ${days.length} days`}
                  <ChevronDown className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")} aria-hidden />
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}

"use client";

import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlightLeg, FlightOption, FlightsData, WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame, formatMoney } from "@/components/widgets/frame";

type SortKey = "cheapest" | "fastest" | "earliest";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "cheapest", label: "Cheapest" },
  { key: "fastest", label: "Fastest" },
  { key: "earliest", label: "Earliest" },
];

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Flights({ data, loading }: WidgetProps<FlightsData>) {
  const [sort, setSort] = React.useState<SortKey>("cheapest");
  const [selected, setSelected] = React.useState<string | null>(null);

  const options = React.useMemo(() => (data?.options ?? []).filter(Boolean), [data?.options]);
  const sorted = React.useMemo(() => sortOptions(options, sort), [options, sort]);
  const cheapestPrice = React.useMemo(
    () => (options.length ? Math.min(...options.map((o) => o.price)) : undefined),
    [options],
  );
  const currency = options[0]?.currency ?? "EUR";

  const title =
    data?.origin && data?.destination ? `${data.origin} to ${data.destination}` : "Flights";
  const subtitle = [
    dateRange(data?.departDate, data?.returnDate),
    data?.adults ? `${data.adults} ${data.adults === 1 ? "adult" : "adults"}` : null,
    data?.returnDate ? "Round trip" : data?.departDate ? "One way" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const showSkeleton = loading && options.length === 0;

  return (
    <WidgetFrame
      icon={<Plane />}
      title={title}
      subtitle={subtitle || undefined}
      loading={loading}
      stage={data?.stage}
      sources={data?.sources}
      footerNote={
        options.length > 0
          ? `${options.length} ${options.length === 1 ? "fare" : "fares"} · prices for ${data?.adults ?? 1} ${(data?.adults ?? 1) === 1 ? "adult" : "adults"}, incl. taxes`
          : undefined
      }
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[0.8rem] text-muted-foreground">
              {cheapestPrice !== undefined ? (
                <span className="truncate">
                  From{" "}
                  <span className="nums font-medium text-brand">{formatMoney(cheapestPrice, currency)}</span>
                </span>
              ) : loading ? (
                <Shimmer className="h-4 w-24" />
              ) : null}
            </div>
            <Segmented
              label="Sort fares"
              value={sort}
              options={SORTS}
              onChange={setSort}
              disabled={options.length < 2}
            />
          </div>

          {showSkeleton ? (
            <FlightSkeletonList count={3} roundTrip={Boolean(data?.returnDate)} />
          ) : options.length === 0 ? (
            <EmptyFlights />
          ) : (
            <LayoutGroup>
              <ul className="flex flex-col gap-2.5" aria-label="Flight options">
                {sorted.map((option, i) => (
                  <FareCard
                    key={option.id}
                    option={option}
                    index={i}
                    adults={data?.adults ?? 1}
                    isCheapest={option.price === cheapestPrice}
                    expanded={selected === option.id}
                    onToggle={() => setSelected((s) => (s === option.id ? null : option.id))}
                  />
                ))}
                {loading ? (
                  <motion.li layout="position" key="__loading" className="list-none">
                    <FlightSkeleton roundTrip={Boolean(data?.returnDate)} />
                  </motion.li>
                ) : null}
              </ul>
            </LayoutGroup>
          )}

          {data?.note && !showSkeleton ? (
            <p className="text-[0.8rem] leading-relaxed text-muted-foreground">{data.note}</p>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  );
}

/* ───────────────────────── Fare card ───────────────────────── */

function FareCard({
  option,
  index,
  adults,
  isCheapest,
  expanded,
  onToggle,
}: {
  option: FlightOption;
  index: number;
  adults: number;
  isCheapest: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailsId = React.useId();
  const code = carrierCode(option);

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        layout: { duration: 0.35, ease: EASE },
        opacity: { duration: 0.3, delay: Math.min(index, 6) * 0.05, ease: "easeOut" },
        y: { duration: 0.3, delay: Math.min(index, 6) * 0.05, ease: "easeOut" },
      }}
      className={cn(
        "list-none overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] duration-200",
        expanded
          ? "border-ring/60 shadow-float"
          : "border-border hover:border-ring/40 hover:shadow-card",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="group/fare block w-full px-3.5 pt-3 pb-3 text-left outline-none focus-visible:bg-accent/40 sm:px-4"
      >
        <div className="flex items-start gap-3">
          <Monogram name={option.airline} code={code} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[0.9rem] font-medium tracking-tight">{option.airline}</span>
              {option.tag ? <FareTag tag={option.tag} /> : null}
            </div>
            <p className="truncate text-[0.75rem] text-muted-foreground">
              {legSummary(option)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span
              className={cn(
                "nums text-[1.2rem] leading-6 font-semibold tracking-tight",
                isCheapest ? "text-brand" : "text-foreground",
              )}
            >
              {formatMoney(option.price, option.currency)}
            </span>
            <span className="text-[0.7rem] text-muted-foreground">
              {option.inbound ? "round trip" : "one way"}
              {adults > 1 ? `, ${adults} adults` : ""}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          <LegRow leg={option.outbound} label="Out" />
          {option.inbound ? <LegRow leg={option.inbound} label="Back" /> : null}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[0.72rem] text-muted-foreground">{option.fareNote}</span>
          <span className="flex shrink-0 items-center gap-1 text-[0.72rem] font-medium text-muted-foreground transition-colors group-hover/fare:text-foreground">
            {expanded ? "Hide details" : "Details"}
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")}
              aria-hidden
            />
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={detailsId}
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/70 bg-surface/60 px-3.5 py-3 sm:px-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <LegDetail leg={option.outbound} label="Outbound" airline={option.airline} />
                {option.inbound ? (
                  <LegDetail leg={option.inbound} label="Return" airline={option.airline} />
                ) : null}
              </dl>
              {option.fareNote ? (
                <p className="mt-3 rounded-lg bg-muted/70 px-2.5 py-2 text-[0.75rem] leading-snug text-muted-foreground">
                  {option.fareNote}
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="nums text-[0.95rem] font-semibold">{formatMoney(option.price, option.currency)}</p>
                  <p className="truncate text-[0.72rem] text-muted-foreground">
                    Total for {adults} {adults === 1 ? "adult" : "adults"}
                    {option.bookingUrl ? ` · on ${hostOf(option.bookingUrl)}` : ""}
                  </p>
                </div>
                {option.bookingUrl ? (
                  <a
                    href={option.bookingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Book
                    <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                ) : (
                  <span className="text-[0.75rem] text-subtle">No booking link</span>
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function LegRow({ leg, label }: { leg: FlightLeg; label: string }) {
  if (!leg) return null;
  const dayShift = dayDiff(leg.departAt, leg.arriveAt);
  const stopsLabel = leg.stops === 0 ? "Direct" : `${leg.stops} ${leg.stops === 1 ? "stop" : "stops"}`;
  return (
    <div className="grid grid-cols-[2.25rem_auto_1fr_auto] items-center gap-x-2.5 sm:grid-cols-[2.75rem_auto_1fr_auto] sm:gap-x-3">
      <span className="text-[0.68rem] font-medium tracking-wide text-subtle uppercase">{label}</span>
      <TimeCode time={timeOf(leg.departAt)} code={leg.from} />
      <div className="flex min-w-0 flex-col items-center gap-0.5 px-0.5">
        <span className="nums text-[0.7rem] leading-4 text-muted-foreground">
          {leg.durationMinutes ? formatDuration(leg.durationMinutes) : " "}
        </span>
        <div className="relative flex h-2 w-full items-center" aria-hidden>
          <span className="size-1.5 shrink-0 rounded-full border border-subtle bg-card" />
          <span className="h-px flex-1 bg-border" />
          {leg.stops > 0
            ? Array.from({ length: Math.min(leg.stops, 2) }).map((_, i) => (
                <React.Fragment key={i}>
                  <span className="size-1.5 shrink-0 rounded-full bg-brass" />
                  <span className="h-px flex-1 bg-border" />
                </React.Fragment>
              ))
            : null}
          <span className="size-1.5 shrink-0 rounded-full bg-subtle" />
        </div>
        <span className={cn("text-[0.7rem] leading-4", leg.stops === 0 ? "text-brand" : "text-brass")}>
          {stopsLabel}
        </span>
      </div>
      <TimeCode time={timeOf(leg.arriveAt)} code={leg.to} align="end" dayShift={dayShift} />
    </div>
  );
}

function TimeCode({
  time,
  code,
  align = "start",
  dayShift = 0,
}: {
  time: string;
  code: string;
  align?: "start" | "end";
  dayShift?: number;
}) {
  return (
    <div className={cn("flex flex-col", align === "end" ? "items-end" : "items-start")}>
      <span className="nums flex items-start text-[0.95rem] leading-5 font-semibold tracking-tight">
        {time}
        {dayShift > 0 ? (
          <sup
            className="nums top-0 ml-0.5 text-[0.6rem] leading-3 font-semibold text-brass"
            title={`Arrives ${dayShift === 1 ? "the next day" : `${dayShift} days later`}`}
          >
            +{dayShift}
          </sup>
        ) : null}
      </span>
      <span className="text-[0.72rem] leading-4 font-medium tracking-wide text-muted-foreground">{code}</span>
    </div>
  );
}

function LegDetail({ leg, label, airline }: { leg: FlightLeg; label: string; airline: string }) {
  const Icon = label === "Return" ? PlaneLanding : PlaneTakeoff;
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 text-[0.8rem] leading-snug">
        <dt className="font-medium">
          {label} · {longDate(leg.departAt)}
        </dt>
        <dd className="nums text-muted-foreground">
          {leg.from} {timeOf(leg.departAt)} to {leg.to} {timeOf(leg.arriveAt)}
          {dayDiff(leg.departAt, leg.arriveAt) > 0 ? ` (+${dayDiff(leg.departAt, leg.arriveAt)})` : ""}
        </dd>
        <dd className="text-muted-foreground">
          {[
            leg.airline && leg.airline !== airline ? leg.airline : null,
            leg.flightNumber,
            leg.durationMinutes ? formatDuration(leg.durationMinutes) : null,
            leg.stops === 0 ? "Direct" : `${leg.stops} ${leg.stops === 1 ? "stop" : "stops"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </dd>
      </div>
    </div>
  );
}

function FareTag({ tag }: { tag: string }) {
  const t = tag.toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.68rem] font-medium",
        t.includes("cheap")
          ? "bg-brand-soft text-brand"
          : t.includes("fast")
            ? "bg-muted text-foreground"
            : "border border-brass/40 text-brass",
      )}
    >
      {tag}
    </span>
  );
}

const MONO_TONES = ["--chart-1", "--chart-3", "--chart-4", "--chart-5", "--chart-2"];

function Monogram({ name, code }: { name: string; code: string }) {
  const tone = MONO_TONES[hash(name) % MONO_TONES.length];
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[0.72rem] font-semibold tracking-wide"
      style={{
        backgroundColor: `color-mix(in oklch, var(${tone}) 15%, transparent)`,
        color: `var(${tone})`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, var(${tone}) 22%, transparent)`,
      }}
    >
      {code}
    </span>
  );
}

/* ───────────────────────── Sort control ───────────────────────── */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative flex shrink-0 items-center rounded-full bg-muted p-0.5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "relative h-8 rounded-full px-3 text-[0.76rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-card shadow-card hairline"
                transition={{ duration: 0.3, ease: EASE }}
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Loading and empty ───────────────────────── */

function FlightSkeletonList({ count, roundTrip }: { count: number; roundTrip: boolean }) {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <FlightSkeleton key={i} roundTrip={roundTrip} />
      ))}
    </div>
  );
}

function FlightSkeleton({ roundTrip }: { roundTrip: boolean }) {
  return (
    <div className="rounded-xl border border-border px-3.5 py-3 sm:px-4" aria-hidden>
      <div className="flex items-start gap-3">
        <Shimmer className="size-9 rounded-lg" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <Shimmer className="h-3.5 w-28" />
          <Shimmer className="h-3 w-40" />
        </div>
        <Shimmer className="h-6 w-16" />
      </div>
      <div className="mt-3.5 space-y-3">
        {Array.from({ length: roundTrip ? 2 : 1 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Shimmer className="h-3 w-7" />
            <Shimmer className="h-8 w-11" />
            <Shimmer className="h-px flex-1" />
            <Shimmer className="h-8 w-11" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyFlights() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Plane className="size-4" aria-hidden />
      </span>
      <p className="text-[0.85rem] font-medium">No fares found</p>
      <p className="max-w-64 text-[0.78rem] text-muted-foreground">
        Try nearby dates or another airport and ask again.
      </p>
    </div>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function sortOptions(options: FlightOption[], sort: SortKey): FlightOption[] {
  const copy = [...options];
  if (sort === "cheapest") copy.sort((a, b) => a.price - b.price);
  if (sort === "fastest") copy.sort((a, b) => totalMinutes(a) - totalMinutes(b) || a.price - b.price);
  if (sort === "earliest")
    copy.sort((a, b) => (a.outbound?.departAt ?? "").localeCompare(b.outbound?.departAt ?? "") || a.price - b.price);
  return copy;
}

function totalMinutes(o: FlightOption): number {
  const out = o.outbound?.durationMinutes ?? Number.POSITIVE_INFINITY;
  const back = o.inbound ? (o.inbound.durationMinutes ?? Number.POSITIVE_INFINITY) : 0;
  return out + back;
}

function legSummary(o: FlightOption): string {
  const legs = [o.outbound, o.inbound].filter(Boolean) as FlightLeg[];
  const allDirect = legs.every((l) => l.stops === 0);
  const total = legs.reduce((s, l) => s + (l.durationMinutes ?? 0), 0);
  const parts = [allDirect ? "Direct both ways" : legs.length > 1 ? "With connections" : "With a connection"];
  if (o.inbound && total > 0) parts.push(`${formatDuration(total)} in the air`);
  else if (!o.inbound && o.outbound?.durationMinutes) parts.push(formatDuration(o.outbound.durationMinutes));
  if (legs.length === 1 && allDirect) parts[0] = "Direct";
  return parts.join(" · ");
}

function carrierCode(o: FlightOption): string {
  const fn = o.outbound?.flightNumber?.trim();
  const m = fn?.match(/^([A-Z0-9]{2})\s?\d/i);
  if (m) return m[1].toUpperCase();
  const words = o.airline.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return o.airline.slice(0, 2).toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** "2026-12-05T07:35" -> "07:35", without timezone conversion. */
function timeOf(iso: string): string {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "--:--";
}

function datePart(iso: string): Date | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dayDiff(a: string, b: string): number {
  const da = datePart(a);
  const db = datePart(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = datePart(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function longDate(iso: string): string {
  const d = datePart(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function dateRange(from?: string, to?: string): string | null {
  const a = shortDate(from);
  const b = shortDate(to);
  if (a && b) return `${a} to ${b}`;
  return a;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

"use client";

import * as React from "react";
import { LayoutGroup, motion } from "motion/react";
import { ArrowUpRight, BedDouble, MapPin, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HotelOption, HotelsData, WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame, formatMoney } from "@/components/widgets/frame";

type SortKey = "recommended" | "price" | "rating";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "recommended", label: "Recommended" },
  { key: "price", label: "Price" },
  { key: "rating", label: "Rating" },
];

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Hotels({ data, loading }: WidgetProps<HotelsData>) {
  const [sort, setSort] = React.useState<SortKey>("recommended");

  const options = React.useMemo(() => (data?.options ?? []).filter(Boolean), [data?.options]);
  const sorted = React.useMemo(() => sortHotels(options, sort), [options, sort]);
  const lowest = React.useMemo(
    () => (options.length ? Math.min(...options.map((o) => o.pricePerNight)) : undefined),
    [options],
  );
  const nights = nightsBetween(data?.checkIn, data?.checkOut);
  const currency = options[0]?.currency ?? "EUR";

  const subtitle = [
    dateRange(data?.checkIn, data?.checkOut),
    nights ? `${nights} ${nights === 1 ? "night" : "nights"}` : null,
    data?.guests ? `${data.guests} ${data.guests === 1 ? "guest" : "guests"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const showSkeleton = loading && options.length === 0;

  return (
    <WidgetFrame
      icon={<BedDouble />}
      title={data?.location ? `Hotels in ${data.location}` : "Hotels"}
      subtitle={subtitle || undefined}
      loading={loading}
      stage={data?.stage}
      sources={data?.sources}
      footerNote={
        options.length > 0 ? `Prices per room, incl. taxes${nights ? ` · total for ${nights} ${nights === 1 ? "night" : "nights"}` : ""}` : undefined
      }
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[0.8rem] text-muted-foreground">
              {lowest !== undefined ? (
                <>
                  <span className="nums">{options.length}</span> {options.length === 1 ? "stay" : "stays"} · from{" "}
                  <span className="nums font-medium text-brand">{formatMoney(lowest, currency)}</span>
                  <span className="hidden min-[400px]:inline"> a night</span>
                </>
              ) : loading ? (
                <Shimmer className="h-4 w-28" />
              ) : null}
            </div>
            <Segmented
              label="Sort hotels"
              value={sort}
              options={SORTS}
              onChange={setSort}
              disabled={options.length < 2}
            />
          </div>

          {showSkeleton ? (
            <Strip>
              {Array.from({ length: 4 }).map((_, i) => (
                <HotelSkeleton key={i} />
              ))}
            </Strip>
          ) : options.length === 0 ? (
            <EmptyHotels />
          ) : (
            <LayoutGroup>
              <Strip>
                {sorted.map((h, i) => (
                  <HotelCard
                    key={h.id}
                    hotel={h}
                    index={i}
                    nights={nights}
                    isLowest={h.pricePerNight === lowest && options.length > 1}
                  />
                ))}
                {loading ? <HotelSkeleton /> : null}
              </Strip>
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

/** Snap-scroll strip on phones, a two-column grid from 640px. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className={cn(
        "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1",
        "[&>li]:w-[78%] [&>li]:max-w-80 [&>li]:shrink-0 [&>li]:snap-start",
        "sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 sm:[&>li]:w-auto sm:[&>li]:max-w-none",
      )}
    >
      {children}
    </ul>
  );
}

/* ───────────────────────── Card ───────────────────────── */

function HotelCard({
  hotel,
  index,
  nights,
  isLowest,
}: {
  hotel: HotelOption;
  index: number;
  nights: number | null;
  isLowest: boolean;
}) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const amenities = hotel.amenities ?? [];
  const extra = amenities.length - 4;
  const total = hotel.totalPrice ?? (nights ? hotel.pricePerNight * nights : undefined);
  const mapsUrl =
    hotel.lat !== undefined && hotel.lng !== undefined
      ? `https://www.google.com/maps/search/?api=1&query=${hotel.lat},${hotel.lng}`
      : undefined;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        layout: { duration: 0.4, ease: EASE },
        opacity: { duration: 0.3, delay: Math.min(index, 6) * 0.05, ease: "easeOut" },
        y: { duration: 0.3, delay: Math.min(index, 6) * 0.05, ease: "easeOut" },
      }}
      className="group/hotel flex list-none flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-200 hover:border-ring/40 hover:shadow-float"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {hotel.image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hotel.image}
            alt={hotel.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="size-full object-cover transition-transform duration-500 ease-out group-hover/hotel:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-linear-to-br from-muted to-surface text-subtle">
            <BedDouble className="size-6" aria-hidden />
            <span className="text-[0.7rem]">No photo</span>
          </div>
        )}
        {hotel.tag ? (
          <span className="absolute top-2.5 left-2.5 inline-flex h-6 items-center rounded-full bg-card/90 px-2.5 text-[0.7rem] font-medium text-foreground shadow-card backdrop-blur-sm">
            {hotel.tag}
          </span>
        ) : null}
        {hotel.rating !== undefined ? (
          <span
            className="absolute right-2.5 bottom-2.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-card/90 pr-2.5 pl-1 text-[0.7rem] shadow-card backdrop-blur-sm"
            aria-label={`Guest rating ${hotel.rating.toFixed(1)} out of 10`}
          >
            <span className="nums inline-flex h-5 min-w-8 items-center justify-center rounded-full bg-primary px-1.5 text-[0.72rem] font-semibold text-primary-foreground">
              {hotel.rating.toFixed(1)}
            </span>
            <span className="font-medium text-foreground">{ratingWord(hotel.rating)}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="line-clamp-1 text-[0.92rem] leading-5 font-medium tracking-tight">{hotel.name}</h4>
            {hotel.stars ? <Stars count={hotel.stars} /> : null}
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.75rem] text-muted-foreground">
            {hotel.area || hotel.address ? (
              mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  aria-label={`Open ${hotel.name} in Google Maps`}
                >
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{hotel.area || hotel.address}</span>
                </a>
              ) : (
                <>
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{hotel.area || hotel.address}</span>
                </>
              )
            ) : null}
            {hotel.reviewCount ? (
              <span className="nums shrink-0 text-subtle">
                {hotel.area || hotel.address ? "· " : ""}
                {hotel.reviewCount.toLocaleString("en-GB")} reviews
              </span>
            ) : null}
          </p>
        </div>

        {amenities.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Amenities">
            {amenities.slice(0, 4).map((a) => (
              <li
                key={a}
                className="inline-flex h-6 items-center rounded-full border border-border bg-surface px-2 text-[0.7rem] text-muted-foreground"
              >
                {a}
              </li>
            ))}
            {extra > 0 ? (
              <li
                className="nums inline-flex h-6 items-center rounded-full px-1.5 text-[0.7rem] text-subtle"
                title={amenities.slice(4).join(", ")}
              >
                +{extra}
              </li>
            ) : null}
          </ul>
        ) : null}

        {hotel.note ? (
          <p className="line-clamp-2 border-l-2 border-brand/40 pl-2 text-[0.78rem] leading-snug text-muted-foreground">
            {hotel.note}
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/70 pt-2.5">
          <div className="min-w-0">
            <p className="flex items-baseline gap-1">
              <span
                className={cn(
                  "nums text-[1.2rem] leading-6 font-semibold tracking-tight",
                  isLowest ? "text-brand" : "text-foreground",
                )}
              >
                {formatMoney(hotel.pricePerNight, hotel.currency)}
              </span>
              <span className="text-[0.72rem] text-muted-foreground">/ night</span>
            </p>
            {total !== undefined ? (
              <p className="nums truncate text-[0.72rem] text-muted-foreground">
                {formatMoney(total, hotel.currency)} total
              </p>
            ) : null}
          </div>
          {hotel.bookingUrl ? (
            <a
              href={hotel.bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-primary px-3.5 text-[0.82rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              View deal
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

function Stars({ count }: { count: number }) {
  const n = Math.max(0, Math.min(5, Math.round(count)));
  return (
    <span className="flex shrink-0 items-center gap-px pt-1 text-brass" aria-label={`${n}-star hotel`} role="img">
      {Array.from({ length: n }).map((_, i) => (
        <Star key={i} className="size-2.5 fill-current" aria-hidden />
      ))}
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
              "relative h-8 rounded-full px-2.5 text-[0.76rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:px-3",
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

function HotelSkeleton() {
  return (
    <li className="list-none overflow-hidden rounded-xl border border-border" aria-hidden>
      <Shimmer className="aspect-[16/10] rounded-none" />
      <div className="space-y-2.5 p-3.5">
        <div className="space-y-1.5">
          <Shimmer className="h-4 w-3/5" />
          <Shimmer className="h-3 w-2/5" />
        </div>
        <div className="flex gap-1.5">
          <Shimmer className="h-6 w-14 rounded-full" />
          <Shimmer className="h-6 w-16 rounded-full" />
          <Shimmer className="h-6 w-12 rounded-full" />
        </div>
        <div className="flex items-end justify-between border-t border-border/70 pt-2.5">
          <div className="space-y-1.5">
            <Shimmer className="h-5 w-20" />
            <Shimmer className="h-3 w-14" />
          </div>
          <Shimmer className="h-10 w-24 rounded-lg" />
        </div>
      </div>
    </li>
  );
}

function EmptyHotels() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BedDouble className="size-4" aria-hidden />
      </span>
      <p className="text-[0.85rem] font-medium">No rooms available</p>
      <p className="max-w-64 text-[0.78rem] text-muted-foreground">
        Try other dates or a wider area and ask again.
      </p>
    </div>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function sortHotels(options: HotelOption[], sort: SortKey): HotelOption[] {
  if (sort === "recommended") return options;
  const copy = [...options];
  if (sort === "price") copy.sort((a, b) => a.pricePerNight - b.pricePerNight);
  if (sort === "rating") copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.pricePerNight - b.pricePerNight);
  return copy;
}

function ratingWord(r: number): string {
  if (r >= 9) return "Exceptional";
  if (r >= 8.5) return "Excellent";
  if (r >= 8) return "Very good";
  if (r >= 7) return "Good";
  if (r >= 6) return "Pleasant";
  return "Reviews";
}

function datePart(iso?: string): Date | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function nightsBetween(a?: string, b?: string): number | null {
  const da = datePart(a);
  const db = datePart(b);
  if (!da || !db) return null;
  const n = Math.round((db.getTime() - da.getTime()) / 86_400_000);
  return n > 0 ? n : null;
}

function dateRange(a?: string, b?: string): string | null {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const da = datePart(a);
  const db = datePart(b);
  if (da && db) return `${fmt(da)} to ${fmt(db)}`;
  if (da) return fmt(da);
  return null;
}

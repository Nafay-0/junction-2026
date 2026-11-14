"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "motion/react";
import {
  Clock,
  ExternalLink,
  Globe,
  MapPin,
  Maximize2,
  Minus,
  Navigation,
  Phone,
  Plus,
  Scan,
  Star,
  X,
} from "lucide-react";
import type { MapRef } from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import { domainOf, type Place, type PlacesData, type WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame } from "@/components/widgets/frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const HELSINKI = { longitude: 24.9384, latitude: 60.1699, zoom: 12 };
const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ───────────────────────── Small hooks and helpers ───────────────────────── */

function subscribeHtmlClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** The theme from next-themes, falling back to the `.dark` class on <html> when no provider is mounted. */
function useIsDark(): boolean {
  const { resolvedTheme } = useTheme();
  const domDark = React.useSyncExternalStore(
    subscribeHtmlClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return resolvedTheme ? resolvedTheme === "dark" : domDark;
}

const noopSubscribe = () => () => {};
/** Today's weekday (0 is Sunday), only on the client so the server markup never guesses. */
function useWeekday(): number {
  return React.useSyncExternalStore(noopSubscribe, () => new Date().getDay(), () => -1);
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function isToday(day: string, weekday: number): boolean {
  return weekday >= 0 && day.trim().slice(0, 3).toLowerCase() === WEEKDAYS[weekday];
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type StatusTone = "open" | "closed" | "neutral";
function statusTone(status?: string): StatusTone {
  const s = (status ?? "").toLowerCase();
  if (!s) return "neutral";
  if (s.includes("closed")) return "closed";
  if (s.includes("open")) return "open";
  return "neutral";
}

type Origin = PlacesData["origin"];

/** The user's own position, when shared: read by the map (a "you are here" dot) and the directions links. */
const OriginContext = React.createContext<Origin>(undefined);

const directionsUrl = (p: Place, origin?: Origin) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}${origin ? `&origin=${origin.lat},${origin.lng}` : ""}`;

const formatDistance = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function hasCoords(p: Place): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/* ───────────────────────── The map itself (client only) ───────────────────────── */

type CanvasProps = {
  places: Place[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  dark: boolean;
  /** Inline maps ask for two fingers or a modifier key so they do not trap page scroll. */
  cooperative?: boolean;
  onExpand?: () => void;
};

function MapShimmer() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface">
      <div className="shimmer absolute inset-0" />
      <MapPin className="relative size-6 animate-pulse text-subtle" aria-hidden />
    </div>
  );
}

function ControlButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

const controlGroup = "flex flex-col overflow-hidden rounded-lg bg-card/95 shadow-card hairline backdrop-blur-sm";

const MapCanvas = dynamic(
  () =>
    Promise.all([import("react-map-gl/maplibre"), import("maplibre-gl")]).then(([mod, maplibre]) => {
      const { Map: MapGL, Marker, AttributionControl } = mod;
      // MapLibre 6 runs its tile worker as a separate script. The bundler cannot resolve that file
      // on its own, so scripts/copy-map-worker.mjs copies it to /public and it is named here.
      maplibre.setWorkerUrl("/maplibre-gl-worker.mjs");

      function Canvas({ places, selectedId, hoveredId, onSelect, onHover, dark, cooperative, onExpand }: CanvasProps) {
        const mapRef = React.useRef<MapRef>(null);
        const [ready, setReady] = React.useState(false);
        const fittedOnce = React.useRef(false);

        const located = React.useMemo(() => places.filter(hasCoords), [places]);
        const origin = React.useContext(OriginContext);

        // Key the bounds on the coordinates, so new array identities with the same places do not refit.
        // The user's own position is part of the view when it is known.
        const boundsKey = [...located.map((p) => `${p.lng},${p.lat}`), ...(origin && located.length ? [`${origin.lng},${origin.lat}`] : [])].join(";");
        const bounds = React.useMemo<[[number, number], [number, number]] | null>(() => {
          if (!boundsKey) return null;
          const pts = boundsKey.split(";").map((s) => s.split(",").map(Number));
          const lngs = pts.map((p) => p[0]);
          const lats = pts.map((p) => p[1]);
          return [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ];
        }, [boundsKey]);

        const fitAll = React.useCallback(
          (instant = false) => {
            const map = mapRef.current;
            if (!map || !bounds) return;
            const width = map.getContainer().clientWidth;
            const pad = width < 420 ? 40 : 64;
            map.fitBounds(bounds, {
              padding: { top: pad, bottom: pad, left: pad, right: pad + 24 },
              maxZoom: 15,
              duration: instant || prefersReducedMotion() ? 0 : 500,
            });
          },
          [bounds],
        );

        // Fit on load and whenever the set of places changes.
        React.useEffect(() => {
          if (!ready || !bounds) return;
          fitAll(!fittedOnce.current);
          fittedOnce.current = true;
        }, [ready, bounds, fitAll]);

        // Fly to the selected place.
        const selected = located.find((p) => p.id === selectedId);
        const selLng = selected?.lng;
        const selLat = selected?.lat;
        React.useEffect(() => {
          const map = mapRef.current;
          if (!ready || !map || selLng === undefined || selLat === undefined) return;
          map.flyTo({
            center: [selLng, selLat],
            zoom: Math.max(map.getZoom(), 15),
            duration: prefersReducedMotion() ? 0 : 600,
            essential: true,
          });
        }, [ready, selLng, selLat]);

        return (
          <div
            className={cn(
              "absolute inset-0",
              // Quiet, theme-aware attribution and gesture hint.
              "[&_.maplibregl-ctrl-attrib]:bg-card/85! [&_.maplibregl-ctrl-attrib]:text-[0.65rem] [&_.maplibregl-ctrl-attrib]:text-muted-foreground [&_.maplibregl-ctrl-attrib]:backdrop-blur-sm",
              "[&_.maplibregl-ctrl-attrib_a]:text-muted-foreground! [&_.maplibregl-ctrl-attrib.maplibregl-compact]:min-h-6 [&_.maplibregl-ctrl-attrib.maplibregl-compact]:rounded-full",
              "[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl]:m-2!",
              "dark:[&_.maplibregl-ctrl-attrib-button]:invert",
              "[&_.maplibregl-cooperative-gesture-screen]:text-[0.85rem] [&_.maplibregl-cooperative-gesture-screen]:font-medium",
            )}
          >
            <MapGL
              ref={mapRef}
              mapLib={maplibre}
              initialViewState={
                bounds
                  ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 15 } }
                  : HELSINKI
              }
              mapStyle={dark ? STYLE_DARK : STYLE_LIGHT}
              attributionControl={false}
              cooperativeGestures={cooperative}
              dragRotate={false}
              pitchWithRotate={false}
              touchPitch={false}
              onLoad={() => setReady(true)}
              style={{ width: "100%", height: "100%" }}
            >
              <AttributionControl compact position="bottom-right" />
              {origin ? (
                <Marker longitude={origin.lng} latitude={origin.lat} anchor="center" style={{ zIndex: 5 }}>
                  <span className="relative flex size-5 items-center justify-center" title={origin.label ? `You are here: ${origin.label}` : "You are here"} aria-label="Your location">
                    <span className="absolute size-5 animate-ping rounded-full bg-chart-3/40" />
                    <span className="relative size-3.5 rounded-full border-2 border-card bg-chart-3 shadow-float" />
                  </span>
                </Marker>
              ) : null}
              {located.map((p) => {
                const index = places.indexOf(p) + 1;
                const isSelected = p.id === selectedId;
                const isHovered = p.id === hoveredId && !isSelected;
                return (
                  <Marker
                    key={p.id}
                    longitude={p.lng}
                    latitude={p.lat}
                    anchor="bottom"
                    style={{ zIndex: isSelected ? 30 : isHovered ? 20 : 10 }}
                  >
                    <button
                      type="button"
                      aria-label={`${index}. ${p.name}`}
                      aria-pressed={isSelected}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(p.id);
                      }}
                      onMouseEnter={() => onHover(p.id)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(p.id)}
                      onBlur={() => onHover(null)}
                      className={cn(
                        "group/pin flex origin-bottom flex-col items-center outline-none transition-transform duration-200 ease-out",
                        "focus-visible:[&>span:first-child]:ring-3 focus-visible:[&>span:first-child]:ring-ring/60",
                        isSelected ? "scale-[1.3]" : isHovered ? "scale-[1.15]" : "scale-100 hover:scale-[1.15]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full border-2 text-[0.72rem] font-semibold shadow-float nums transition-colors duration-200",
                          isSelected
                            ? "border-card bg-brand text-primary-foreground"
                            : isHovered
                              ? "border-brand bg-brand-soft text-brand"
                              : "border-brand bg-card text-brand",
                        )}
                      >
                        {index}
                      </span>
                      <span
                        className={cn(
                          "-mt-[5px] size-2 rotate-45 border-r-2 border-b-2 transition-colors duration-200",
                          isSelected ? "border-card bg-brand" : isHovered ? "border-brand bg-brand-soft" : "border-brand bg-card",
                        )}
                        aria-hidden
                      />
                    </button>
                  </Marker>
                );
              })}
            </MapGL>

            <div className="pointer-events-none absolute top-2.5 right-2.5 flex flex-col gap-2 [&>*]:pointer-events-auto">
              {onExpand ? (
                <div className={controlGroup}>
                  <ControlButton label="Expand map" onClick={onExpand}>
                    <Maximize2 />
                  </ControlButton>
                </div>
              ) : null}
              {located.length > 1 ? (
                <div className={controlGroup}>
                  <ControlButton label="Show all places" onClick={() => fitAll()}>
                    <Scan />
                  </ControlButton>
                </div>
              ) : null}
              <div className={cn(controlGroup, "hidden divide-y divide-border sm:flex")}>
                <ControlButton label="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: 250 })}>
                  <Plus />
                </ControlButton>
                <ControlButton label="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: 250 })}>
                  <Minus />
                </ControlButton>
              </div>
            </div>

            <div
              className={cn(
                "pointer-events-none absolute inset-0 transition-opacity duration-500",
                ready ? "opacity-0" : "opacity-100",
              )}
              aria-hidden
            >
              <MapShimmer />
            </div>
          </div>
        );
      }
      return Canvas;
    }),
  { ssr: false, loading: () => <MapShimmer /> },
);

/* ───────────────────────── Place pieces ───────────────────────── */

function Rating({ place, className }: { place: Place; className?: string }) {
  if (place.rating === undefined) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 nums", className)}>
      <Star className="size-3 fill-current text-brass" aria-hidden />
      <span className="font-medium text-foreground">{place.rating.toFixed(1)}</span>
      {place.reviewCount !== undefined ? (
        <span className="text-muted-foreground">({place.reviewCount.toLocaleString("en-GB")})</span>
      ) : null}
      <span className="sr-only">out of 5</span>
    </span>
  );
}

function Status({ status, className }: { status?: string; className?: string }) {
  if (!status) return null;
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        tone === "open" ? "text-up" : tone === "closed" ? "text-down" : "text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "open" ? "bg-up" : tone === "closed" ? "bg-down" : "bg-subtle",
        )}
        aria-hidden
      />
      {status}
    </span>
  );
}

function Thumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = React.useState<string | null>(null);
  if (!src || failed === src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("shrink-0 bg-muted object-cover", className)}
    />
  );
}

function IndexBadge({ n, active, className }: { n: number; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[0.65rem] font-semibold nums transition-colors duration-200",
        active ? "border-brand bg-brand text-primary-foreground" : "border-brand/70 text-brand",
        className,
      )}
      aria-hidden
    >
      {n}
    </span>
  );
}

function PlaceCard({
  place,
  index,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  place: Place;
  index: number;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
}) {
  const meta = [place.category, place.area].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={selected}
      className={cn(
        "group/card flex h-full w-full gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow] duration-200 outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "bg-brand-soft/70 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--brand)_45%,transparent)]"
          : hovered
            ? "bg-muted/70 hairline"
            : "bg-card hairline hover:bg-muted/70",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start gap-2">
          <IndexBadge n={index} active={selected || hovered} className="mt-px" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9rem] leading-5 font-medium text-foreground">{place.name}</span>
            {meta ? <span className="block truncate text-[0.75rem] leading-4 text-muted-foreground">{meta}</span> : null}
          </span>
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-7 text-[0.75rem]">
          <Rating place={place} />
          <Status status={place.status} />
          {place.distanceM !== undefined ? <span className="nums text-muted-foreground">{formatDistance(place.distanceM)} away</span> : null}
        </span>
        {place.address ? (
          <span className="mt-1 truncate pl-7 text-[0.75rem] text-muted-foreground">{place.address}</span>
        ) : null}
        {place.note ? (
          <span className="mt-2 ml-7 line-clamp-2 border-l-2 border-brand/35 pl-2 text-[0.78rem] leading-snug text-foreground/85">
            {place.note}
          </span>
        ) : null}
      </span>
      <Thumb
        src={place.image}
        alt={place.name}
        className="size-[4.25rem] rounded-lg hairline transition-transform duration-300 group-hover/card:scale-[1.03]"
      />
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="flex gap-3 rounded-xl p-3 hairline" aria-hidden>
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Shimmer className="size-5 rounded-full" />
          <Shimmer className="h-3.5 w-28" />
        </div>
        <Shimmer className="ml-7 h-3 w-20" />
        <Shimmer className="ml-7 h-3 w-32" />
      </div>
      <Shimmer className="size-[4.25rem] rounded-lg" />
    </div>
  );
}

function ActionLink({
  href,
  icon,
  children,
  primary,
  external = true,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  primary?: boolean;
  external?: boolean;
}) {
  return (
    <Button asChild variant={primary ? "default" : "outline"} className="h-10 justify-start gap-2 rounded-lg px-3 text-[0.82rem]">
      <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {icon}
        <span className="truncate">{children}</span>
      </a>
    </Button>
  );
}

function PlaceActions({ place, className }: { place: Place; className?: string }) {
  const origin = React.useContext(OriginContext);
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      <ActionLink href={directionsUrl(place, origin)} icon={<Navigation />} primary>
        Directions
      </ActionLink>
      {place.phone ? (
        <ActionLink href={telHref(place.phone)} icon={<Phone />} external={false}>
          Call
        </ActionLink>
      ) : null}
      {place.website ? (
        <ActionLink href={place.website} icon={<Globe />}>
          Website
        </ActionLink>
      ) : null}
      {place.url ? (
        <ActionLink href={place.url} icon={<ExternalLink />}>
          {domainOf(place.url)}
        </ActionLink>
      ) : null}
    </div>
  );
}

function Hours({ hours, weekday }: { hours: NonNullable<Place["hours"]>; weekday: number }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">
        <Clock className="size-3.5" aria-hidden />
        Opening hours
      </p>
      <dl className="grid grid-cols-[auto_1fr] text-[0.8rem]">
        {hours.map((h) => {
          const today = isToday(h.day, weekday);
          return (
            <div
              key={h.day}
              className={cn(
                "col-span-2 grid grid-cols-subgrid items-center gap-x-6 rounded-md px-2 py-1",
                today ? "bg-brand-soft font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <dt className="flex items-center gap-2">
                {h.day}
                {today ? <span className="text-[0.68rem] font-medium text-brand">Today</span> : null}
              </dt>
              <dd className={cn("text-right nums", h.hours.toLowerCase().includes("closed") && !today && "text-subtle")}>
                {h.hours}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function PlaceDetail({ place, index, onClose }: { place: Place; index: number; onClose: () => void }) {
  const weekday = useWeekday();
  const hasHours = place.hours && place.hours.length > 0;
  return (
    <motion.div
      key={place.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.3, ease: EASE }}
      className="px-4 py-4 sm:px-5"
    >
      <div className="flex items-start gap-3">
        <IndexBadge n={index} active className="mt-0.5 size-6 text-[0.72rem]" />
        <div className="min-w-0 flex-1">
          <h4 className="text-[0.95rem] leading-6 font-medium tracking-tight text-foreground">{place.name}</h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.78rem] text-muted-foreground">
            {place.category ? <span>{place.category}</span> : null}
            <Rating place={place} />
            <Status status={place.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mt-1 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className={cn("mt-3 grid gap-4", hasHours && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6")}>
        <div className="min-w-0 space-y-3">
          {place.description ? <p className="text-[0.85rem] leading-relaxed text-foreground/90">{place.description}</p> : null}
          {place.address ? (
            <p className="flex items-start gap-1.5 text-[0.8rem] text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
              {place.address}
            </p>
          ) : null}
          <PlaceActions place={place} />
        </div>
        {hasHours ? <Hours hours={place.hours!} weekday={weekday} /> : null}
      </div>
    </motion.div>
  );
}

/* ───────────────────────── Expanded view ───────────────────────── */

function ExpandedMap({
  open,
  onOpenChange,
  data,
  places,
  selected,
  selectedIndex,
  hoveredId,
  onSelect,
  onHover,
  dark,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PlacesData;
  places: Place[];
  selected: Place | undefined;
  selectedIndex: number;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  dark: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,780px)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 shadow-float sm:max-w-5xl">
        <div className="border-b border-border/70 px-4 py-3 pr-12 sm:px-5">
          <DialogTitle className="truncate text-[0.95rem] font-medium tracking-tight">{data.query || "Places"}</DialogTitle>
          <DialogDescription className="truncate text-[0.8rem] text-muted-foreground">
            {places.length} {places.length === 1 ? "place" : "places"}
            {data.area ? ` · ${data.area}` : ""}
          </DialogDescription>
        </div>
        <div className="relative min-h-0 flex-1">
          {open ? (
            <MapCanvas
              places={places}
              selectedId={selected?.id ?? null}
              hoveredId={hoveredId}
              onSelect={onSelect}
              onHover={onHover}
              dark={dark}
            />
          ) : null}
          <AnimatePresence>
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
                transition={{ duration: 0.3, ease: EASE }}
                className="absolute inset-x-3 bottom-3 rounded-xl bg-card/95 p-3 shadow-float hairline backdrop-blur-md sm:right-auto sm:w-[22rem]"
              >
                <div className="flex gap-3">
                  <Thumb src={selected.image} alt={selected.name} className="size-14 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <IndexBadge n={selectedIndex} active />
                      <p className="truncate text-[0.9rem] font-medium text-foreground">{selected.name}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.75rem]">
                      <Rating place={selected} />
                      <Status status={selected.status} />
                    </div>
                    {selected.note ? (
                      <p className="mt-1 line-clamp-2 text-[0.78rem] leading-snug text-muted-foreground">{selected.note}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(null)}
                    aria-label="Close details"
                    className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <PlaceActions place={selected} className="mt-3" />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Widget ───────────────────────── */

export function PlacesMap(props: WidgetProps<PlacesData>) {
  return (
    <OriginContext.Provider value={props.data.origin}>
      <PlacesMapInner {...props} />
    </OriginContext.Provider>
  );
}

function PlacesMapInner({ data, loading }: WidgetProps<PlacesData>) {
  const dark = useIsDark();
  const places = React.useMemo(() => data.places ?? [], [data.places]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  const listRef = React.useRef<HTMLUListElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLLIElement>());

  const selectedIndex = places.findIndex((p) => p.id === selectedId);
  const selected = selectedIndex >= 0 ? places[selectedIndex] : undefined;

  /** Bring a card into view inside the list (vertical on wide screens, the strip on narrow ones) without moving the page. */
  const revealCard = React.useCallback((id: string) => {
    const list = listRef.current;
    const card = cardRefs.current.get(id);
    if (!list || !card) return;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const lr = list.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    if (list.scrollWidth > list.clientWidth + 1) {
      list.scrollTo({ left: list.scrollLeft + (cr.left - lr.left) - 12, behavior });
    } else if (list.scrollHeight > list.clientHeight + 1) {
      const above = cr.top < lr.top + 8;
      const below = cr.bottom > lr.bottom - 8;
      if (above || below) list.scrollTo({ top: list.scrollTop + (cr.top - lr.top) - 12, behavior });
    }
  }, []);

  const selectFromMap = React.useCallback(
    (id: string) => {
      setSelectedId(id);
      revealCard(id);
    },
    [revealCard],
  );

  const toggleFromCard = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  const count = places.length;
  const subtitle = count > 0 ? `${count} ${count === 1 ? "place" : "places"}${data.area ? ` · ${data.area}` : ""}` : data.area;
  const showSkeleton = loading && count === 0;

  return (
    <WidgetFrame
      icon={<MapPin />}
      title={data.query || "Places"}
      subtitle={subtitle}
      loading={loading}
      stage={data.stage}
      sources={data.sources}
      footerNote={count > 0 ? "Select a pin or a card for hours and directions" : undefined}
      flush
    >
      {data.error ? (
        <div className="px-4 pb-4 sm:px-5">
          <WidgetError message={data.error} />
        </div>
      ) : !loading && count === 0 ? (
        <div className="mx-4 mb-4 flex flex-col items-center gap-2 rounded-xl bg-surface px-4 py-10 text-center hairline sm:mx-5">
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MapPin className="size-5" aria-hidden />
          </span>
          <p className="text-[0.9rem] font-medium text-foreground">No places found</p>
          <p className="max-w-xs text-[0.8rem] text-muted-foreground">
            Nothing matched{data.area ? ` around ${data.area}` : ""}. Try a wider area or a different kind of place.
          </p>
        </div>
      ) : (
        <>
          <div className="border-t border-border/70 sm:grid sm:h-[420px] sm:grid-rows-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            {/* Map: on top on narrow screens, on the right on wide ones. */}
            <div className="relative h-60 overflow-hidden bg-surface sm:order-2 sm:h-full sm:border-l sm:border-border/70">
              {showSkeleton ? (
                <MapShimmer />
              ) : (
                <MapCanvas
                  places={places}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  onSelect={selectFromMap}
                  onHover={setHoveredId}
                  dark={dark}
                  cooperative
                  onExpand={() => setExpanded(true)}
                />
              )}
            </div>

            {/* Cards: a snap strip on narrow screens, a scrolling column on wide ones. */}
            <ul
              ref={listRef}
              aria-label="Places"
              className={cn(
                "flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto border-t border-border/70 p-3",
                "sm:order-1 sm:min-h-0 sm:snap-none sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-t-0",
              )}
            >
              {showSkeleton
                ? Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="w-[17.5rem] shrink-0 sm:w-auto">
                      <CardSkeleton />
                    </li>
                  ))
                : places.map((p, i) => (
                    <motion.li
                      key={p.id}
                      ref={(el) => {
                        if (el) cardRefs.current.set(p.id, el);
                        else cardRefs.current.delete(p.id);
                      }}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 8) * 0.04 }}
                      className="w-[17.5rem] shrink-0 snap-start sm:w-auto"
                    >
                      <PlaceCard
                        place={p}
                        index={i + 1}
                        selected={p.id === selectedId}
                        hovered={p.id === hoveredId}
                        onSelect={() => toggleFromCard(p.id)}
                        onHover={(on) => setHoveredId(on ? p.id : null)}
                      />
                    </motion.li>
                  ))}
              {loading && count > 0 ? (
                <li className="w-[17.5rem] shrink-0 sm:w-auto">
                  <CardSkeleton />
                </li>
              ) : null}
            </ul>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div
                key="detail"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="overflow-hidden border-t border-border/70"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <PlaceDetail key={selected.id} place={selected} index={selectedIndex + 1} onClose={() => setSelectedId(null)} />
                </AnimatePresence>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <ExpandedMap
            open={expanded}
            onOpenChange={setExpanded}
            data={data}
            places={places}
            selected={selected}
            selectedIndex={selectedIndex + 1}
            hoveredId={hoveredId}
            onSelect={(id) => (id ? setSelectedId(id) : setSelectedId(null))}
            onHover={setHoveredId}
            dark={dark}
          />
        </>
      )}
    </WidgetFrame>
  );
}

"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, ImageIcon, ImageOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { faviconOf, type ImageItem, type ImagesData, type Source, type WidgetProps } from "@/lib/widgets/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Favicon, Shimmer, WidgetError, WidgetFrame, dedupeSources } from "./frame";

const INITIAL_COUNT = 12;
const GAP = 6;
/** How long the gallery waits for image sizes before laying out with a default shape. */
const MEASURE_TIMEOUT_MS = 2000;
const DEFAULT_RATIO = 4 / 3;
/** Placeholder shapes for the skeleton, so it reads as a masonry wall rather than a grid. */
const SKELETON_RATIOS = [1.4, 0.78, 1, 1.25, 0.72, 1.5, 0.9, 1.15];

type Ratio = number | "error";

export function Images({ data, loading }: WidgetProps<ImagesData>) {
  const images = React.useMemo(() => dedupeImages(data?.images ?? []), [data?.images]);
  const [failed, setFailed] = React.useState<Set<string>>(() => new Set());
  const ratios = useImageRatios(images.map((i) => i.url));
  const [expanded, setExpanded] = React.useState(false);
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  // Only the measured prefix is laid out, so tiles already on screen never move when later ones arrive.
  const { usable, pending } = React.useMemo(() => {
    const out: ImageItem[] = [];
    let pendingCount = 0;
    for (const img of images) {
      const r = ratios[img.url];
      if (r === undefined) {
        pendingCount = images.length - images.indexOf(img);
        break;
      }
      if (r !== "error" && !failed.has(img.url)) out.push(img);
    }
    return { usable: out, pending: pendingCount };
  }, [images, ratios, failed]);
  const shown = expanded ? usable : usable.slice(0, INITIAL_COUNT);
  const hiddenCount = usable.length - shown.length;

  const markFailed = React.useCallback((url: string) => {
    setFailed((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const sources = React.useMemo(() => {
    const fromPages: Source[] = usable.map((img) => ({
      url: img.pageUrl,
      title: img.title,
      domain: img.domain,
      favicon: faviconOf(img.pageUrl),
    }));
    return dedupeSources([...(data?.sources ?? []), ...fromPages]);
  }, [data?.sources, usable]);

  const siteCount = new Set(usable.map((i) => i.domain)).size;
  const showSkeleton = usable.length === 0 && (loading || pending > 0);
  const allFailed = !loading && pending === 0 && images.length > 0 && usable.length === 0;

  const subtitle =
    usable.length > 0
      ? `${usable.length} ${usable.length === 1 ? "image" : "images"} from ${siteCount} ${siteCount === 1 ? "site" : "sites"}`
      : undefined;

  return (
    <WidgetFrame
      icon={<ImageIcon />}
      title={data?.query ? data.query : "Images"}
      subtitle={subtitle}
      loading={loading}
      stage={data?.stage}
      sources={sources}
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : showSkeleton ? (
        <GallerySkeleton count={Math.min(images.length || 8, INITIAL_COUNT)} />
      ) : allFailed || (!loading && usable.length === 0) ? (
        <EmptyState allFailed={allFailed} />
      ) : (
        <>
          <Masonry images={shown} ratios={ratios} onOpen={setOpenIndex} onFail={markFailed} />
          {usable.length > INITIAL_COUNT ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                {expanded ? "Show fewer" : <span className="nums">Show all {usable.length}</span>}
                <ChevronDown className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")} />
              </button>
            </div>
          ) : null}
          {hiddenCount > 0 ? <span className="sr-only">{hiddenCount} more images hidden</span> : null}
        </>
      )}

      <Lightbox
        images={shown}
        index={openIndex}
        onIndexChange={setOpenIndex}
        onFail={markFailed}
      />
    </WidgetFrame>
  );
}

/* ───────────────────────── Measuring ───────────────────────── */

/**
 * Probes each image off-screen to learn its aspect ratio before it is laid out, so a tile never
 * changes size once shown. Sizes are kept across updates, so images that stream in later only append.
 * After a timeout, images still unmeasured get a default shape (and crop with object-cover); a size
 * that arrives later is ignored, but a late failure still removes the tile.
 */
function useImageRatios(urls: string[]) {
  const key = urls.join("\n");
  const [ratios, setRatios] = React.useState<Record<string, Ratio>>({});

  React.useEffect(() => {
    const list = key ? key.split("\n") : [];
    let cancelled = false;
    const probes = list.map((url) => {
      const img = new window.Image();
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : DEFAULT_RATIO;
        setRatios((r) => (r[url] !== undefined ? r : { ...r, [url]: ratio }));
      };
      img.onerror = () => {
        if (cancelled) return;
        setRatios((r) => (r[url] === "error" ? r : { ...r, [url]: "error" }));
      };
      img.src = url;
      return img;
    });
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setRatios((r) => {
        const missing = list.filter((u) => r[u] === undefined);
        if (missing.length === 0) return r;
        const next = { ...r };
        for (const u of missing) next[u] = DEFAULT_RATIO;
        return next;
      });
    }, MEASURE_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const p of probes) {
        p.onload = null;
        p.onerror = null;
      }
    };
  }, [key]);

  return ratios;
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function columnsFor(width: number) {
  if (width < 440) return 2;
  if (width < 600) return 3;
  return 4;
}

type Tile = { x: number; y: number; w: number; h: number };

/** Shortest-column masonry. Ratios are clamped so a panorama or a tall poster cannot dominate. */
function layoutMasonry(ratios: number[], width: number): { tiles: Tile[]; height: number } {
  const cols = columnsFor(width);
  const colW = (width - GAP * (cols - 1)) / cols;
  const heights = new Array<number>(cols).fill(0);
  const tiles = ratios.map((r) => {
    const ratio = Math.min(Math.max(r, 0.62), 1.9);
    const h = Math.round(colW / ratio);
    let col = 0;
    for (let c = 1; c < cols; c++) if (heights[c] < heights[col] - 1) col = c;
    const tile = { x: col * (colW + GAP), y: heights[col], w: colW, h };
    heights[col] += h + GAP;
    return tile;
  });
  return { tiles, height: Math.max(0, Math.max(...heights) - GAP) };
}

/* ───────────────────────── Gallery ───────────────────────── */

function Masonry({
  images,
  ratios,
  onOpen,
  onFail,
}: {
  images: ImageItem[];
  ratios: Record<string, Ratio>;
  onOpen: (index: number) => void;
  onFail: (url: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const layout = React.useMemo(
    () =>
      width > 0
        ? layoutMasonry(
            images.map((img) => {
              const r = ratios[img.url];
              return typeof r === "number" ? r : DEFAULT_RATIO;
            }),
            width,
          )
        : null,
    [images, ratios, width],
  );

  return (
    <div
      ref={ref}
      className="relative w-full transition-[height] duration-300 ease-out"
      style={{ height: layout ? layout.height : 240 }}
    >
      {layout
        ? images.map((img, i) => (
            <GalleryTile
              key={img.url}
              image={img}
              tile={layout.tiles[i]}
              order={i}
              onOpen={() => onOpen(i)}
              onFail={() => onFail(img.url)}
            />
          ))
        : null}
    </div>
  );
}

function GalleryTile({
  image,
  tile,
  order,
  onOpen,
  onFail,
}: {
  image: ImageItem;
  tile: Tile;
  order: number;
  onOpen: () => void;
  onFail: () => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const label = image.title || `Image from ${image.domain}`;
  return (
    <div
      className="absolute top-0 left-0 transition-[transform,width,height] duration-300 ease-out"
      style={{ transform: `translate(${tile.x}px, ${tile.y}px)`, width: tile.w, height: tile.h }}
    >
    <motion.button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${label}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: Math.min(order, 11) * 0.03 }}
      className="group/tile relative block size-full overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      {!loaded ? <Shimmer className="absolute inset-0 rounded-none" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={label}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={onFail}
        className={cn(
          "absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500 ease-out group-hover/tile:scale-[1.03]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="pointer-events-none absolute inset-0 rounded-xl hairline" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1 flex-col items-start gap-1 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pt-8 pb-2 text-left opacity-0 transition-[opacity,transform] duration-300 ease-out group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-y-0 group-focus-visible/tile:opacity-100">
        {image.title ? (
          <span className="line-clamp-2 text-[0.78rem] leading-snug font-medium text-white">{image.title}</span>
        ) : null}
        <span className="flex max-w-full items-center gap-1.5 text-[0.7rem] text-white/80">
          <Favicon source={{ domain: image.domain, favicon: faviconOf(image.pageUrl) }} className="size-3.5" />
          <span className="truncate">{image.domain}</span>
        </span>
      </span>
    </motion.button>
    </div>
  );
}

function GallerySkeleton({ count }: { count: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const ratios = Array.from({ length: Math.max(count, 4) }, (_, i) => SKELETON_RATIOS[i % SKELETON_RATIOS.length]);
  const layout = width > 0 ? layoutMasonry(ratios, width) : null;
  return (
    <div ref={ref} aria-hidden className="relative w-full" style={{ height: layout ? layout.height : 240 }}>
      {layout?.tiles.map((t, i) => (
        <div
          key={i}
          className="shimmer absolute top-0 left-0 rounded-xl"
          style={{ transform: `translate(${t.x}px, ${t.y}px)`, width: t.w, height: t.h }}
        />
      ))}
    </div>
  );
}

function EmptyState({ allFailed }: { allFailed: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <ImageOff className="size-5 text-subtle" />
      <p className="text-[0.85rem] text-muted-foreground">
        {allFailed ? "The images could not be loaded from their sites." : "No images found for this search."}
      </p>
    </div>
  );
}

/* ───────────────────────── Lightbox ───────────────────────── */

function Lightbox({
  images,
  index,
  onIndexChange,
  onFail,
}: {
  images: ImageItem[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
  onFail: (url: string) => void;
}) {
  const open = index !== null && images.length > 0;
  const current = open ? Math.min(index, images.length - 1) : 0;
  const image = images[current];
  const [direction, setDirection] = React.useState(0);
  const thumbRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const many = images.length > 1;

  const go = React.useCallback(
    (delta: number) => {
      if (!images.length) return;
      setDirection(delta);
      onIndexChange((current + delta + images.length) % images.length);
    },
    [current, images.length, onIndexChange],
  );

  const jump = (i: number) => {
    setDirection(i > current ? 1 : -1);
    onIndexChange(i);
  };

  React.useEffect(() => {
    if (!open) return;
    thumbRefs.current[current]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [open, current]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onIndexChange(null))}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
        className="max-w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl bg-popover p-0 shadow-float sm:max-w-3xl"
      >
        {image ? (
          <>
            <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate font-sans text-[0.95rem] leading-6 font-medium tracking-tight">
                  {image.title || image.domain}
                </DialogTitle>
                <DialogDescription className="mt-0.5 flex items-center gap-1.5 text-[0.78rem]">
                  <Favicon source={{ domain: image.domain, favicon: faviconOf(image.pageUrl) }} className="size-3.5" />
                  <span className="truncate">{image.domain}</span>
                  {many ? (
                    <span className="nums shrink-0 text-subtle">
                      · {current + 1} of {images.length}
                    </span>
                  ) : null}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => onIndexChange(null)}
                aria-label="Close"
                className="-mt-1 -mr-1.5 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>

            <div
              className="relative h-[min(58vh,520px)] touch-pan-y overflow-hidden bg-surface select-none"
              onTouchStart={(e) => {
                const t = e.touches[0];
                touchStart.current = { x: t.clientX, y: t.clientY };
              }}
              onTouchEnd={(e) => {
                const start = touchStart.current;
                touchStart.current = null;
                const t = e.changedTouches[0];
                if (!start || !t || !many) return;
                const dx = t.clientX - start.x;
                const dy = t.clientY - start.y;
                if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
              }}
            >
              <AnimatePresence initial={false} custom={direction} mode="popLayout">
                <LightboxImage key={image.url} image={image} direction={direction} onFail={() => onFail(image.url)} />
              </AnimatePresence>

              {many ? (
                <>
                  <NavButton side="left" onClick={() => go(-1)} />
                  <NavButton side="right" onClick={() => go(1)} />
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center">
              {many ? (
                <div className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
                  <div className="flex w-max gap-1.5">
                    {images.map((img, i) => (
                      <button
                        key={img.url}
                        ref={(el) => {
                          thumbRefs.current[i] = el;
                        }}
                        type="button"
                        onClick={() => jump(i)}
                        aria-label={`Show image ${i + 1}${img.title ? `: ${img.title}` : ""}`}
                        aria-current={i === current ? "true" : undefined}
                        className={cn(
                          "relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted outline-none transition-[opacity,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                          i === current
                            ? "opacity-100 ring-2 ring-brand ring-offset-2 ring-offset-popover"
                            : "opacity-55 hover:opacity-100",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          draggable={false}
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                          className="size-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1" />
              )}
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:flex-none"
                >
                  <ImageIcon className="size-3.5" />
                  Open image
                </a>
                <a
                  href={image.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[0.8rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-popover focus-visible:outline-none sm:flex-none"
                >
                  Visit page
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            </div>
          </>
        ) : (
          <DialogTitle className="sr-only">Image</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}

const LightboxImage = React.forwardRef<
  HTMLDivElement,
  { image: ImageItem; direction: number; onFail: () => void }
>(function LightboxImage({ image, direction, onFail }, ref) {
  const [state, setState] = React.useState<"loading" | "loaded" | "error">("loading");
  return (
    <motion.div
      ref={ref}
      custom={direction}
      initial={{ opacity: 0, x: direction * 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction * -24 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="absolute inset-0 flex items-center justify-center p-3 sm:p-4"
    >
      {state === "loading" ? <Shimmer className="absolute inset-3 rounded-xl sm:inset-4" /> : null}
      {state === "error" ? (
        <div className="flex flex-col items-center gap-2 text-[0.85rem] text-muted-foreground">
          <ImageOff className="size-5 text-subtle" />
          This image is no longer available.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={image.title || `Image from ${image.domain}`}
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState("loaded")}
          onError={() => {
            setState("error");
            onFail();
          }}
          className={cn(
            "relative max-h-full max-w-full rounded-lg object-contain shadow-card transition-opacity duration-300",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </motion.div>
  );
});

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/85 text-foreground shadow-float backdrop-blur transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function dedupeImages(images: ImageItem[]): ImageItem[] {
  const seen = new Set<string>();
  return images.filter((img) => {
    if (!img?.url || seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });
}

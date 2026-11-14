"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import manifest from "./art-manifest.json";
import categoryArt from "./art-map.json";

/**
 * The generated pictures (see `web/docs/DESIGN.md` §6): food on a deep petrol ground, made with OpenAI's image
 * model from the prompts in `scripts/art/prompts.json`. Served as AVIF with a WebP fallback at fixed widths from
 * `public/art/`, with the box sized from the manifest's aspect so nothing shifts, a placeholder in the picture's own
 * average colour, and lazy loading below the fold. If a picture is missing or fails, `fallback` (the drawn pack) shows.
 */

type Entry = { kind: "tile" | "department" | "hero"; widths: number[]; aspect: number; color: string };
const ART = manifest as unknown as Record<string, Entry>;
const BY_CATEGORY = categoryArt as Record<string, string>;

/** For a seed catalogue without the partner's category codes: the product family slug. */
const BY_SLUG: Record<string, string> = {
  milk: "tile-milk-carton",
  plant_drink: "tile-milk-carton",
  cream: "tile-cream-carton",
  plant_cream: "tile-cream-carton",
  yoghurt: "tile-yoghurt-tub",
  quark: "tile-yoghurt-tub",
  sour_cream: "tile-yoghurt-tub",
  cheese: "tile-cheese-block",
  butter: "tile-butter",
};

const LIQUID_DAIRY = new Set(["tile-milk-carton", "tile-cream-carton"]);

/**
 * Which illustration a product's tile shows: by the partner's category code, else by family. A large liquid pack
 * (10 L and up, not a case of cartons) is a bag-in-box whatever its category.
 */
export function artKeyFor(p: { category?: string; categoryCode?: string }, bagInBox = false): string | undefined {
  const k = (p.categoryCode && BY_CATEGORY[p.categoryCode]) || (p.category ? BY_SLUG[p.category] : undefined);
  if (bagInBox && (!k || LIQUID_DAIRY.has(k))) return "tile-bag-in-box";
  return k && ART[k] ? k : undefined;
}

export function departmentArt(deptId: string): string | undefined {
  const k = `dept-${deptId.replace(/^d/, "")}`;
  return ART[k] ? k : deptId === "d32" ? "dept-30" : undefined;
}

export function hasArt(key: string | undefined): key is string {
  return !!key && !!ART[key];
}

function srcSet(key: string, widths: number[], ext: "avif" | "webp") {
  return widths.map((w) => `/art/${key}-${w}.${ext} ${w}w`).join(", ");
}

/**
 * A generated picture. `sizes` is the rendered width (e.g. "(min-width: 1024px) 18rem, 45vw"). `cover` fills a box
 * of another shape (the parent sets it) instead of keeping the picture's own aspect.
 */
export function Art({
  k,
  sizes,
  priority = false,
  cover = false,
  className = "",
  imgClassName = "",
  fallback = null,
  position = "50% 50%",
}: {
  k: string;
  sizes: string;
  priority?: boolean;
  cover?: boolean;
  className?: string;
  imgClassName?: string;
  fallback?: ReactNode;
  position?: string;
}) {
  const e = ART[k];
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An error that fired before hydration has no React handler: check once.
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) queueMicrotask(() => setFailed(true));
  }, []);
  if (!e || failed) return <>{fallback}</>;
  const largest = e.widths.at(-1)!;
  return (
    <picture className={`block overflow-hidden ${cover ? "h-full w-full" : ""} ${className}`} style={{ background: e.color, aspectRatio: cover ? undefined : String(e.aspect) }}>
      <source type="image/avif" srcSet={srcSet(k, e.widths, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(k, e.widths, "webp")} sizes={sizes} />
      <img
        ref={img}
        src={`/art/${k}-${e.widths[Math.min(1, e.widths.length - 1)]}.webp`}
        width={largest}
        height={Math.round(largest / e.aspect)}
        alt=""
        aria-hidden
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onError={() => setFailed(true)}
        className={`block h-full w-full object-cover ${imgClassName}`}
        style={{ objectPosition: position }}
      />
    </picture>
  );
}

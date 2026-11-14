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
  plant_drink: "tile-plant-drink",
  cream: "tile-cream-cooking",
  plant_cream: "tile-cream-cooking",
  yoghurt: "tile-yoghurt-tub",
  quark: "tile-yoghurt-tub",
  sour_cream: "tile-yoghurt-tub",
  cheese: "tile-cheese-block",
  butter: "tile-butter",
};

/** What the tile's picture is chosen from: master data only, never a live call. */
export type ArtProduct = {
  name: string;
  names?: { fi?: string; sv?: string; en?: string };
  category?: string;
  categoryCode?: string;
  attributes?: string[];
  kinds?: string[];
  unit?: string;
  packSize?: number;
  packContent?: { perSalesUnit: { L?: number; kg?: number }; baseUnitsPerSalesUnit: number | null };
};

/** One sales unit's shape: how many items, and how much each holds (L or kg). */
function packShape(p: ArtProduct): { items: number; perItem?: number } {
  const pc = p.packContent;
  const total = pc ? (pc.perSalesUnit.L ?? pc.perSalesUnit.kg) : p.unit !== "pcs" ? p.packSize : undefined;
  const items = Math.max(1, pc?.baseUnitsPerSalesUnit ?? 1);
  return { items, perItem: total !== undefined ? total / items : undefined };
}

/** single carton, a case of cartons, or a bag-in-box (5 L and up per item). */
function format(p: ArtProduct): "1l" | "case" | "bib" {
  const { items, perItem } = packShape(p);
  if (perItem !== undefined && perItem >= 5) return "bib";
  return items >= 2 ? "case" : "1l";
}

/**
 * Finland's milk colours (a national convention, not a brand's): red for whole, blue for semi-skimmed and 1-2.5 %,
 * light blue for skimmed. From the fat attribute the partner's data carries, else from the name.
 */
function milkColour(p: ArtProduct): "red" | "blue" | "light" | undefined {
  const a = p.attributes ?? [];
  if (a.includes("fat_free")) return "light";
  for (const x of a) {
    const m = /^fat_(\d+)(?:_(\d+))?$/.exec(x);
    if (m) {
      const v = Number(`${m[1]}.${m[2] ?? 0}`);
      return v < 0.6 ? "light" : v < 2.8 ? "blue" : "red";
    }
  }
  const n = `${p.name} ${p.names?.fi ?? ""}`.toLowerCase();
  if (/täys|whole|helmjölk/.test(n)) return "red";
  if (/rasvaton|skim|fettfri/.test(n)) return "light";
  if (/kevyt|semi|ykkös|lätt/.test(n)) return "blue";
  return undefined;
}

const has = (p: ArtProduct, k: string) => (p.kinds ?? []).includes(k);
const named = (p: ArtProduct, re: RegExp) => re.test(`${p.name} ${p.names?.fi ?? ""} ${p.names?.en ?? ""}`.toLowerCase());

/**
 * Which illustration a product's tile shows. The category picks the kind of picture; within the big dairy groups
 * the product's own data picks the variant a kitchen reads at a glance: milk by fat colour and pack format, cream by
 * use and pack, yoghurt by size, cheese by form. Every picture is an illustration of the kind, never this product.
 */
export function artFor(p: ArtProduct): string | undefined {
  const code = p.categoryCode ?? "";
  const k = (code && BY_CATEGORY[code]) || (p.category ? BY_SLUG[p.category] : undefined);
  const fmt = format(p);
  const { items, perItem } = packShape(p);

  if (k === "tile-milk-carton") {
    if (has(p, "yoghurt")) return "tile-yoghurt-cups";
    if (has(p, "coffee")) return "tile-coffee-dairy";
    if (has(p, "fermented")) return "tile-milk-fermented";
    const c = milkColour(p);
    return c ? `tile-milk-${fmt}-${c}` : fmt === "bib" ? "tile-bag-in-box" : "tile-milk-carton";
  }
  if (k === "tile-plant-drink" || code === "10402") return fmt === "bib" ? "tile-bag-in-box" : "tile-plant-drink";
  if (k === "tile-cream-carton" || k === "tile-cream-cooking") {
    if (has(p, "coffee") || named(p, /kahvi|coffee|caf[eé]|kaffe/)) return "tile-coffee-dairy";
    if (fmt === "bib") return "tile-bag-in-box";
    if (items >= 5 && perItem !== undefined && perItem <= 0.35) return "tile-cream-small";
    if (named(p, /vispi|kuohu|whip|vaahto|spray|dolce|vispgrädde/)) return "tile-cream-whipping";
    return "tile-cream-cooking";
  }
  if (k === "tile-yoghurt-tub") {
    if (perItem !== undefined && perItem >= 2) return "tile-yoghurt-bucket";
    if (items >= 4 && perItem !== undefined && perItem <= 0.25) return "tile-yoghurt-cups";
    return "tile-yoghurt-tub";
  }
  if (k === "tile-cheese-block") {
    if (named(p, /raaste|grated|riven/)) return "tile-cheese-grated";
    if (named(p, /viipal|slice|skivad/)) return "tile-cheese-sliced";
    if (named(p, /brie|camembert|sinihom|aura|blue|gorgonzola|vuohen|goat|chèvre/)) return "tile-cheese-specialty";
    if (named(p, /feta|salaattijuusto|halloumi/)) return "tile-cheese-feta";
    if (named(p, /tuorejuusto|cream cheese|mascarpone|färskost/)) return "tile-cheese-soft";
    // Semi-hard cheese by the piece a kitchen buys: a whole wheel, a case of small pieces, or a block.
    const whole = /\bn\.?\s?(\d+(?:[.,]\d+)?)\s?kg/i.exec(p.name); // "Gouda vanha n.4kg": about a 4 kg wheel, sold by the kilo
    if ((perItem !== undefined && perItem >= 2.5) || (whole && Number(whole[1].replace(",", ".")) >= 2.5)) return "tile-cheese-wheel";
    if (items >= 4 && perItem !== undefined && perItem <= 0.6) return "tile-cheese-pieces";
  }
  if (k === "tile-drinks" && named(p, /tölkki|\bcan\b|burk|0[,.]33 ?l|33 ?cl/)) return "tile-drink-cans";
  if (!k) return undefined;
  return ART[k] ? k : undefined;
}

/** @deprecated kept for callers that only know the category; use `artFor`. */
export function artKeyFor(p: { category?: string; categoryCode?: string }, bagInBox = false): string | undefined {
  return artFor({ name: "", ...p, unit: bagInBox ? "L" : undefined, packSize: bagInBox ? 10 : undefined });
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

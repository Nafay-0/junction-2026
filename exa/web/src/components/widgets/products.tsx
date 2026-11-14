"use client";

import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowUpRight, Columns3, LayoutGrid, Package, ShoppingBag, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product, ProductsData, WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame, formatMoney } from "@/components/widgets/frame";

type View = "cards" | "compare";
type SortKey = "match" | "price" | "rating";

const VIEWS: Array<{ key: View; label: string; icon: React.ReactNode }> = [
  { key: "cards", label: "Cards", icon: <LayoutGrid className="size-3.5" aria-hidden /> },
  { key: "compare", label: "Compare", icon: <Columns3 className="size-3.5" aria-hidden /> },
];

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "match", label: "Best match" },
  { key: "price", label: "Price" },
  { key: "rating", label: "Rating" },
];

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Products({ data, loading }: WidgetProps<ProductsData>) {
  const [view, setView] = React.useState<View>("cards");
  const [sort, setSort] = React.useState<SortKey>("match");

  const products = React.useMemo(() => (data?.products ?? []).filter(Boolean), [data?.products]);
  const sorted = React.useMemo(() => sortProducts(products, sort), [products, sort]);
  const bestPriceId = React.useMemo(() => lowestPriced(products)?.id, [products]);
  const merchants = React.useMemo(() => new Set(products.map((p) => p.merchant)).size, [products]);

  const subtitle =
    products.length > 0
      ? `${products.length} ${products.length === 1 ? "product" : "products"} · ${merchants} ${merchants === 1 ? "shop" : "shops"}`
      : undefined;

  const showSkeleton = loading && products.length === 0;

  return (
    <WidgetFrame
      icon={<ShoppingBag />}
      title={data?.query ? capitalize(data.query) : "Products"}
      subtitle={subtitle}
      loading={loading}
      stage={data?.stage}
      sources={data?.sources}
      footerNote={products.length > 0 ? "Prices and stock as listed by each shop" : undefined}
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : (
        <div className="flex flex-col gap-3">
          {data?.verdict ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex gap-2.5 rounded-xl bg-brand-soft/70 px-3 py-2.5 hairline"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-card/70 text-brand">
                <Sparkles className="size-3" aria-hidden />
              </span>
              <p className="text-[0.84rem] leading-snug text-foreground">
                <span className="font-medium text-brand">Verdict </span>
                {data.verdict}
              </p>
            </motion.div>
          ) : showSkeleton ? (
            <Shimmer className="h-11 w-full rounded-xl" />
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Segmented label="View" value={view} options={VIEWS} onChange={setView} iconOnlyBelow disabled={products.length === 0} />
            <Segmented label="Sort products" value={sort} options={SORTS} onChange={setSort} disabled={products.length < 2} />
          </div>

          {showSkeleton ? (
            <ProductSkeletonGrid />
          ) : products.length === 0 ? (
            <EmptyProducts />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {view === "cards" ? (
                <motion.div
                  key="cards"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <LayoutGroup>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {sorted.map((p, i) => (
                        <ProductCard key={p.id} product={p} index={i} isBestPrice={p.id === bestPriceId && products.length > 1} />
                      ))}
                      {loading ? <ProductSkeleton /> : null}
                    </ul>
                  </LayoutGroup>
                </motion.div>
              ) : (
                <motion.div
                  key="compare"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <CompareTable products={sorted} bestPriceId={products.length > 1 ? bestPriceId : undefined} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}

/* ───────────────────────── Cards ───────────────────────── */

function ProductCard({ product: p, index, isBestPrice }: { product: Product; index: number; isBestPrice: boolean }) {
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
      className="group/product flex list-none gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 transition-[border-color,box-shadow] duration-200 hover:border-ring/40 hover:shadow-float sm:flex-col sm:gap-0 sm:p-0"
    >
      <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:aspect-[4/3] sm:size-auto sm:w-full sm:rounded-none">
        <ProductImage src={p.image} alt={p.title} className="transition-transform duration-500 ease-out group-hover/product:scale-[1.03]" />
        {p.tag ? (
          <span className="absolute top-2.5 left-2.5 hidden h-6 items-center rounded-full bg-card/90 px-2.5 text-[0.7rem] font-medium shadow-card backdrop-blur-sm sm:inline-flex">
            {p.tag}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:p-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {p.brand ? (
              <span className="truncate text-[0.68rem] font-medium tracking-wide text-subtle uppercase">{p.brand}</span>
            ) : null}
            {p.tag ? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-brand-soft px-2 text-[0.66rem] font-medium text-brand sm:hidden">
                {p.tag}
              </span>
            ) : null}
          </div>
          <h4 className="mt-0.5 line-clamp-2 text-[0.88rem] leading-snug font-medium tracking-tight">{p.title}</h4>
          {p.rating !== undefined ? (
            <div className="mt-1 flex items-center gap-1.5">
              <RatingStars value={p.rating} />
              <span className="nums text-[0.72rem] text-muted-foreground">
                {p.rating.toFixed(1)}
                {p.reviewCount ? ` (${p.reviewCount.toLocaleString("en-GB")})` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <Price product={p} best={isBestPrice} />
          {p.availability ? <Availability value={p.availability} /> : null}
        </div>

        {p.note ? (
          <p className="line-clamp-2 border-l-2 border-brand/40 pl-2 text-[0.76rem] leading-snug text-muted-foreground">
            {p.note}
          </p>
        ) : null}

        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[0.8rem] font-medium transition-colors outline-none hover:border-ring/40 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="truncate">View at {p.merchant}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      </div>
    </motion.li>
  );
}

function Price({ product: p, best, compact }: { product: Product; best?: boolean; compact?: boolean }) {
  if (p.price === undefined || p.price === null) {
    return (
      <a
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className="text-[0.85rem] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        See price
      </a>
    );
  }
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span
        className={cn(
          "nums font-semibold tracking-tight",
          compact ? "text-[0.95rem]" : "text-[1.15rem] leading-6",
          best ? "text-brand" : "text-foreground",
        )}
      >
        {formatMoney(p.price, p.currency ?? "EUR", p.price % 1 === 0 ? 0 : 2)}
      </span>
      {best ? <span className="text-[0.68rem] font-medium whitespace-nowrap text-brand">Lowest</span> : null}
    </span>
  );
}

function Availability({ value }: { value: string }) {
  const v = value.toLowerCase();
  const inStock = /in stock|available|varastossa|ships/.test(v) && !/out of|not available|unavailable/.test(v);
  const out = /out of stock|sold out|unavailable|not available/.test(v);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-[0.72rem]",
        inStock ? "text-up" : out ? "text-down" : "text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", inStock ? "bg-up" : out ? "bg-down" : "bg-brass")} />
      <span className="truncate">{value}</span>
    </span>
  );
}

function RatingStars({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={cn("relative inline-flex shrink-0", className)} role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <span className="flex gap-px text-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="size-3 fill-current" aria-hidden />
        ))}
      </span>
      <span className="absolute inset-y-0 left-0 flex gap-px overflow-hidden text-brass" style={{ width: `${pct}%` }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="size-3 shrink-0 fill-current" aria-hidden />
        ))}
      </span>
    </span>
  );
}

function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <div className="flex size-full items-center justify-center bg-linear-to-br from-muted to-surface text-subtle">
        <Package className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("size-full object-cover", className)}
    />
  );
}

/* ───────────────────────── Compare ───────────────────────── */

function CompareTable({ products, bestPriceId }: { products: Product[]; bestPriceId?: string }) {
  const specLabels = React.useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const p of products) for (const s of p.specs ?? []) {
      if (!s?.label || seen.has(s.label)) continue;
      seen.add(s.label);
      labels.push(s.label);
    }
    return labels;
  }, [products]);

  const bestRating = Math.max(...products.map((p) => p.rating ?? -1));

  const rowLabel =
    "sticky left-0 z-10 w-28 min-w-28 border-r border-border/70 bg-card px-3 py-2.5 text-left align-top text-[0.74rem] font-medium text-muted-foreground transition-colors group-hover/row:bg-surface sm:w-32 sm:min-w-32";
  const cell = "min-w-38 px-3 py-2.5 align-top text-[0.8rem] transition-colors group-hover/row:bg-surface";

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Product comparison</caption>
          <thead>
            <tr className="border-b border-border/70">
              <th scope="col" className={cn(rowLabel, "align-bottom")}>
                <span className="sr-only">Feature</span>
              </th>
              {products.map((p) => (
                <th key={p.id} scope="col" className="min-w-38 px-3 pt-3 pb-2.5 align-top font-normal">
                  <div className="flex flex-col gap-2">
                    <div className="relative size-14 overflow-hidden rounded-lg bg-muted">
                      <ProductImage src={p.image} alt="" />
                    </div>
                    <div className="min-w-0">
                      {p.brand ? (
                        <p className="truncate text-[0.66rem] font-medium tracking-wide text-subtle uppercase">{p.brand}</p>
                      ) : null}
                      <p className="line-clamp-2 text-[0.8rem] leading-snug font-medium">{p.title}</p>
                      {p.tag ? (
                        <span className="mt-1 inline-flex h-5 items-center rounded-full bg-brand-soft px-2 text-[0.66rem] font-medium text-brand">
                          {p.tag}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            <tr className="group/row">
              <th scope="row" className={rowLabel}>Price</th>
              {products.map((p) => (
                <td
                  key={p.id}
                  className={cn(cell, p.id === bestPriceId && "bg-brand-soft/50 group-hover/row:bg-brand-soft/70")}
                >
                  <Price product={p} best={p.id === bestPriceId} compact />
                </td>
              ))}
            </tr>
            <tr className="group/row">
              <th scope="row" className={rowLabel}>Rating</th>
              {products.map((p) => (
                <td key={p.id} className={cell}>
                  {p.rating !== undefined ? (
                    <span className="flex flex-col gap-0.5">
                      <span className={cn("nums inline-flex items-center gap-1 font-medium", p.rating === bestRating && products.length > 1 && "text-brass")}>
                        <Star className="size-3 fill-current text-brass" aria-hidden />
                        {p.rating.toFixed(1)}
                      </span>
                      {p.reviewCount ? (
                        <span className="nums text-[0.7rem] text-muted-foreground">
                          {p.reviewCount.toLocaleString("en-GB")} reviews
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <Missing />
                  )}
                </td>
              ))}
            </tr>
            <tr className="group/row">
              <th scope="row" className={rowLabel}>Shop</th>
              {products.map((p) => (
                <td key={p.id} className={cell}>
                  <span className="flex flex-col gap-0.5">
                    <span className="truncate">{p.merchant}</span>
                    {p.availability ? <Availability value={p.availability} /> : null}
                  </span>
                </td>
              ))}
            </tr>
            {specLabels.map((label) => (
              <tr key={label} className="group/row">
                <th scope="row" className={rowLabel}>{label}</th>
                {products.map((p) => {
                  const v = p.specs?.find((s) => s.label === label)?.value;
                  return (
                    <td key={p.id} className={cn(cell, "nums")}>
                      {v ? v : <Missing />}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className={cn(rowLabel, "group-hover/row:bg-card")}>
                <span className="sr-only">Links</span>
              </th>
              {products.map((p) => (
                <td key={p.id} className="px-3 py-3 align-top">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${p.title} at ${p.merchant}`}
                    className="inline-flex h-10 w-full items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.76rem] font-medium transition-colors outline-none hover:border-ring/40 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
                  >
                    <span className="truncate">View</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </a>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Missing() {
  return (
    <span className="text-subtle" aria-label="Not listed">
      –
    </span>
  );
}

/* ───────────────────────── Segmented control ───────────────────────── */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  iconOnlyBelow,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string; icon?: React.ReactNode }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Hide the labels on narrow screens and show only the icons. */
  iconOnlyBelow?: boolean;
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
            aria-label={o.label}
            onClick={() => onChange(o.key)}
            className={cn(
              "relative flex h-8 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[0.76rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:px-3",
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
            {o.icon ? <span className="relative">{o.icon}</span> : null}
            <span className={cn("relative", iconOnlyBelow && o.icon && "hidden min-[420px]:inline")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Loading and empty ───────────────────────── */

function ProductSkeletonGrid() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <ProductSkeleton key={i} />
      ))}
    </ul>
  );
}

function ProductSkeleton() {
  return (
    <li className="flex list-none gap-3 overflow-hidden rounded-xl border border-border p-3 sm:flex-col sm:gap-0 sm:p-0" aria-hidden>
      <Shimmer className="size-24 shrink-0 rounded-lg sm:aspect-[4/3] sm:size-auto sm:w-full sm:rounded-none" />
      <div className="flex flex-1 flex-col gap-2 sm:p-3.5">
        <Shimmer className="h-3 w-16" />
        <Shimmer className="h-4 w-4/5" />
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-5 w-20" />
        <Shimmer className="mt-1 h-10 w-full rounded-lg" />
      </div>
    </li>
  );
}

function EmptyProducts() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShoppingBag className="size-4" aria-hidden />
      </span>
      <p className="text-[0.85rem] font-medium">No products found</p>
      <p className="max-w-64 text-[0.78rem] text-muted-foreground">Try a broader search or another shop.</p>
    </div>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function sortProducts(products: Product[], sort: SortKey): Product[] {
  if (sort === "match") return products;
  const copy = [...products];
  if (sort === "price")
    copy.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  if (sort === "rating")
    copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  return copy;
}

function lowestPriced(products: Product[]): Product | undefined {
  let best: Product | undefined;
  for (const p of products) {
    if (p.price === undefined || p.price === null) continue;
    if (!best || p.price < (best.price as number)) best = p;
  }
  return best;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

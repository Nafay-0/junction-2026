"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/widgets/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Shared chrome for every widget, so they read as one family:
 * a card with a quiet header (icon, title, subtitle, optional right slot),
 * a body, and a footer that always shows where the data came from.
 */
export function WidgetFrame({
  icon,
  title,
  subtitle,
  aside,
  sources,
  footerNote,
  loading,
  stage,
  flush,
  className,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right side of the header: a toggle, a live badge, a count. */
  aside?: React.ReactNode;
  sources?: Source[];
  /** Small text on the left of the footer, for example "Prices checked 2 minutes ago". */
  footerNote?: React.ReactNode;
  loading?: boolean;
  /** What the tool is doing right now; shown under the title while loading. */
  stage?: string;
  /** Remove body padding (for maps and images that touch the card edge). */
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "group/widget relative w-full animate-rise overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-card",
        className,
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-3 sm:px-5">
        {icon ? (
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.95rem] leading-6 font-medium tracking-tight">{title}</h3>
          {loading && stage ? (
            <p className="text-shimmer truncate text-[0.8rem] leading-5">{stage}</p>
          ) : subtitle ? (
            <p className="truncate text-[0.8rem] leading-5 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>

      {loading ? <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden"><div className="h-px w-1/3 animate-sweep bg-brand" /></div> : null}

      <div className={cn(flush ? "" : "px-4 pb-4 sm:px-5")}>{children}</div>

      {(sources && sources.length > 0) || footerNote ? (
        <footer className="flex items-center justify-between gap-3 border-t border-border/70 bg-surface/60 px-4 py-2 sm:px-5">
          <span className="min-w-0 truncate text-[0.75rem] text-muted-foreground">{footerNote}</span>
          {sources && sources.length > 0 ? <SourceChips sources={sources} /> : null}
        </footer>
      ) : null}
    </section>
  );
}

/** A stack of favicons that opens the full source list. Use it wherever data needs attribution. */
export function SourceChips({ sources, max = 4, className }: { sources: Source[]; max?: number; className?: string }) {
  const unique = React.useMemo(() => dedupeSources(sources), [sources]);
  if (unique.length === 0) return null;
  const shown = unique.slice(0, max);
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-1 text-[0.72rem] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground",
          className,
        )}
        aria-label={`${unique.length} sources`}
      >
        <span className="flex -space-x-1.5">
          {shown.map((s) => (
            <Favicon key={s.url} source={s} className="size-4 ring-2 ring-card" />
          ))}
        </span>
        <span className="nums">
          {unique.length} {unique.length === 1 ? "source" : "sources"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <SourceList sources={unique} />
      </PopoverContent>
    </Popover>
  );
}

export function SourceList({ sources, className }: { sources: Source[]; className?: string }) {
  return (
    <ul className={cn("max-h-80 divide-y divide-border overflow-y-auto", className)}>
      {sources.map((s) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="group/src flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/60"
          >
            <Favicon source={s} className="mt-0.5 size-4" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[0.82rem] leading-snug font-medium">{s.title || s.domain}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-muted-foreground">
                <span className="truncate">{s.domain}</span>
                {s.publishedDate ? <span className="shrink-0">· {formatDate(s.publishedDate)}</span> : null}
              </span>
              {s.snippet ? (
                <span className="mt-1 line-clamp-3 border-l-2 border-brand/40 pl-2 text-[0.75rem] leading-snug text-muted-foreground">
                  {s.snippet}
                </span>
              ) : null}
            </span>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover/src:opacity-100" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Favicon({ source, className }: { source: Pick<Source, "favicon" | "domain">; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!source.favicon || failed) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold text-muted-foreground uppercase",
          className,
        )}
      >
        {source.domain.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source.favicon}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-card object-contain", className)}
    />
  );
}

/** Placeholder block with a moving sheen. Compose these into a skeleton that matches the widget's final shape. */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} />;
}

/** A small "Live" marker with a pulsing dot. */
export function LiveDot({ label = "Live", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.72rem] font-medium text-brand", className)}>
      <span className="size-1.5 animate-pulse-dot rounded-full bg-brand" />
      {label}
    </span>
  );
}

/** Shown inside a widget when its tool failed. */
export function WidgetError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-[0.85rem] text-destructive">
      {message}
    </p>
  );
}

export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatMoney(amount: number, currency = "EUR", maximumFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits }).format(amount);
  } catch {
    return `${amount.toFixed(maximumFractionDigits)} ${currency}`;
  }
}

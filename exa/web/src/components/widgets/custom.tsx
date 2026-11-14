"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  Info,
  LayoutDashboard,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomBlock, CustomButton, CustomData, CustomItem, WidgetProps } from "@/lib/widgets/types";
import { Markdown } from "@/components/butler/markdown";
import { Shimmer, WidgetError, WidgetFrame } from "./frame";
import { ChartSkeleton, CustomChart, chartHasData } from "./custom-chart";
import { CustomHtml } from "./custom-html";

/**
 * The open-ended widget: the model composes it from a list of blocks when no fixed widget fits.
 * Every field may be missing or half-written while the model streams, so each block cleans its
 * own input and renders nothing (or a placeholder) rather than throwing.
 */
export function Custom({ data, loading, onAsk }: WidgetProps<CustomData> & { onAsk?: (prompt: string) => void }) {
  const rawBlocks = data?.blocks;
  const blocks = React.useMemo(() => (Array.isArray(rawBlocks) ? rawBlocks : []), [rawBlocks]);
  const layout = React.useMemo(() => planLayout(blocks, !!loading), [blocks, loading]);
  const title = str(data?.title) || (loading ? "Putting this together" : "Custom view");

  return (
    <WidgetFrame
      icon={<LayoutDashboard />}
      title={title}
      subtitle={str(data?.subtitle) || undefined}
      sources={Array.isArray(data?.sources) ? data.sources : undefined}
      loading={loading}
      stage={data?.stage}
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : layout.length === 0 ? (
        loading ? (
          <LoadingSkeleton />
        ) : (
          <p className="py-6 text-center text-[0.85rem] text-muted-foreground">Nothing to show yet.</p>
        )
      ) : (
        <div className="grid grid-cols-12 gap-x-4 gap-y-5">
          {layout.map((entry) => (
            <motion.div
              key={entry.index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut", delay: Math.min(entry.index * 0.04, 0.24) }}
              className={cn("@container col-span-12 flex min-w-0 flex-col", entry.half && "sm:col-span-6")}
            >
              {entry.title || entry.reserveTitle ? (
                <h4
                  className={cn(
                    "mb-2 min-h-5 truncate text-[0.8rem] leading-5 font-medium text-muted-foreground",
                    !entry.title && "max-sm:hidden",
                  )}
                >
                  {entry.title || " "}
                </h4>
              ) : null}
              <div className="min-w-0 flex-1">
                {entry.pending ? (
                  <BlockPlaceholder block={entry.block} />
                ) : (
                  <BlockView block={entry.block} onAsk={onAsk} streaming={entry.streaming} />
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

/* ───────────────────────── Layout ───────────────────────── */

type Entry = {
  index: number;
  block: CustomBlock;
  half: boolean;
  title: string;
  /** The neighbour on the same row has a title: keep an empty title line so both blocks start level. */
  reserveTitle: boolean;
  /** Last block while streaming, not yet showable: draw a placeholder. */
  pending: boolean;
  /** Last block while streaming and showable: text may still be arriving. */
  streaming: boolean;
};

function planLayout(blocks: CustomBlock[], loading: boolean): Entry[] {
  const entries: Entry[] = [];
  blocks.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const isLast = index === blocks.length - 1;
    const live = loading && isLast;
    const ready = isReady(raw);
    if (!ready && !live) return;
    if (!KNOWN.has(raw.type) && !live) return;
    entries.push({
      index,
      block: raw,
      half: raw.width === "half",
      title: str(raw.title),
      reserveTitle: false,
      pending: live && (!ready || raw.type === "html"),
      streaming: live && ready,
    });
  });

  // Pair consecutive half blocks. A half block with no partner takes the full row,
  // so a lone half never leaves a hole beside it.
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    if (!a.half) continue;
    const b = entries[i + 1];
    if (b && b.half) {
      if (a.title || b.title) {
        a.reserveTitle = true;
        b.reserveTitle = true;
      }
      i++;
    } else if (!(loading && i === entries.length - 1)) {
      a.half = false;
    }
  }
  return entries;
}

const KNOWN = new Set<CustomBlock["type"]>(["text", "stats", "chart", "table", "list", "progress", "image", "buttons", "callout", "html"]);

/** Whether a block has enough content to draw. */
function isReady(b: CustomBlock): boolean {
  switch (b.type) {
    case "text":
    case "callout":
      return str(b.text).trim().length > 0;
    case "stats":
    case "list":
    case "progress":
      return cleanItems(b.items).length > 0;
    case "chart":
      return chartHasData(b);
    case "table":
      return cleanColumns(b.columns).length > 0 || cleanRows(b.rows).length > 0;
    case "image":
      return isHttp(str(b.url));
    case "buttons":
      return cleanButtons(b.buttons).length > 0;
    case "html":
      return str(b.html).trim().length > 0;
    default:
      return false;
  }
}

/* ───────────────────────── Input clean-up ───────────────────────── */

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

type Item = { label: string; value: string; detail: string; href: string; trend?: "up" | "down" | "flat"; good?: boolean; percent: number | null };

function cleanItems(items: unknown): Item[] {
  if (!Array.isArray(items)) return [];
  const out: Item[] = [];
  for (const raw of items as Array<Partial<CustomItem> | null>) {
    if (!raw || typeof raw !== "object") continue;
    const label = str(raw.label).trim();
    const value = str(raw.value).trim();
    if (!label && !value) continue;
    const href = str(raw.href).trim();
    const p = typeof raw.percent === "number" ? raw.percent : Number(raw.percent);
    out.push({
      label,
      value,
      detail: str(raw.detail).trim(),
      href: isHttp(href) ? href : "",
      trend: raw.trend === "up" || raw.trend === "down" || raw.trend === "flat" ? raw.trend : undefined,
      good: typeof raw.good === "boolean" ? raw.good : undefined,
      percent: Number.isFinite(p) ? p : null,
    });
  }
  return out;
}

function cleanColumns(columns: unknown): string[] {
  return Array.isArray(columns) ? columns.map((c) => str(c)) : [];
}

function cleanRows(rows: unknown): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((c) => str(c)));
}

function cleanButtons(buttons: unknown): CustomButton[] {
  if (!Array.isArray(buttons)) return [];
  const out: CustomButton[] = [];
  for (const raw of buttons as Array<Partial<CustomButton> | null>) {
    if (!raw || typeof raw !== "object") continue;
    const label = str(raw.label).trim();
    if (!label) continue;
    const action = raw.action === "link" || raw.action === "copy" ? raw.action : "ask";
    out.push({ label, action, value: str(raw.value), primary: raw.primary === true });
  }
  return out;
}

/* ───────────────────────── Blocks ───────────────────────── */

function BlockView({ block, onAsk, streaming }: { block: CustomBlock; onAsk?: (p: string) => void; streaming?: boolean }) {
  switch (block.type) {
    case "text":
      return <Markdown streaming={streaming}>{str(block.text)}</Markdown>;
    case "callout":
      return <Callout text={str(block.text)} tone={block.tone} />;
    case "stats":
      return <Stats items={cleanItems(block.items)} />;
    case "list":
      return <List items={cleanItems(block.items)} listStyle={block.listStyle} />;
    case "progress":
      return <Progress items={cleanItems(block.items)} />;
    case "table":
      return <Table columns={cleanColumns(block.columns)} rows={cleanRows(block.rows)} />;
    case "image":
      return <ImageBlock url={str(block.url)} caption={str(block.caption)} alt={str(block.title) || str(block.caption)} />;
    case "buttons":
      return <Buttons buttons={cleanButtons(block.buttons)} onAsk={onAsk} />;
    case "chart":
      return <CustomChart block={block} />;
    case "html":
      return <CustomHtml block={block} onAsk={onAsk} />;
    default:
      return null;
  }
}

function BlockPlaceholder({ block }: { block: CustomBlock }) {
  switch (block.type) {
    case "chart":
      return <ChartSkeleton height={block.chartType === "pie" || block.chartType === "donut" ? 220 : 260} />;
    case "html":
      return <CustomHtml block={block} pending />;
    case "stats":
      return (
        <div className="grid grid-cols-2 gap-2 @[480px]:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      );
    case "image":
      return <Shimmer className="h-48 rounded-xl" />;
    case "buttons":
      return (
        <div className="flex gap-2">
          <Shimmer className="h-10 w-36 rounded-full" />
          <Shimmer className="h-10 w-28 rounded-full" />
        </div>
      );
    case "table":
    case "list":
    case "progress":
      return (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} className="h-4" />
          ))}
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-2">
          <Shimmer className="h-3.5 w-11/12" />
          <Shimmer className="h-3.5 w-3/4" />
        </div>
      );
  }
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
      <ChartSkeleton height={200} />
    </div>
  );
}

/* Callout */

const TONES = {
  info: { icon: Info, box: "border-brand/20 bg-brand-soft/70", icon_: "text-brand" },
  success: { icon: CircleCheck, box: "border-up/20 bg-up/8", icon_: "text-up" },
  warning: { icon: TriangleAlert, box: "border-brass/30 bg-brass/10", icon_: "text-brass" },
} as const;

function Callout({ text, tone }: { text: string; tone?: CustomBlock["tone"] }) {
  const t = TONES[tone === "success" || tone === "warning" ? tone : "info"];
  const Icon = t.icon;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3", t.box)} role="note">
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.icon_)} aria-hidden />
      <p className="text-[0.86rem] leading-relaxed text-foreground">{text}</p>
    </div>
  );
}

/* Stats */

const STAT_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @[480px]:grid-cols-3",
  4: "grid-cols-2 @[560px]:grid-cols-4",
};

function Stats({ items }: { items: Item[] }) {
  const n = items.length;
  // Six or nine tiles read better in rows of three; everything else fills rows of four.
  const cols = n >= 4 ? (n % 3 === 0 && n % 4 !== 0 ? STAT_COLS[3] : STAT_COLS[4]) : STAT_COLS[n];
  return (
    <div className={cn("grid gap-2", cols)}>
      {items.map((it, i) => {
        const short = it.value.length <= 9;
        const body = (
          <>
            <span className="truncate text-[0.75rem] leading-4 text-muted-foreground">{it.label}</span>
            <span
              className={cn(
                "nums mt-1.5 text-foreground",
                short ? "font-display text-[1.45rem] leading-8" : "line-clamp-2 text-[0.98rem] leading-6 font-medium",
              )}
            >
              {it.value || "–"}
            </span>
            {it.detail || it.trend ? (
              <span className="mt-1 flex min-w-0 items-center gap-1 text-[0.74rem] leading-4 text-muted-foreground">
                {it.trend ? <TrendIcon trend={it.trend} good={it.good} /> : null}
                <span className={cn("truncate", trendTone(it.trend, it.good))}>
                  {it.detail}
                </span>
              </span>
            ) : null}
          </>
        );
        const cls = "flex min-w-0 flex-col rounded-xl bg-surface px-3 py-2.5 hairline";
        return it.href ? (
          <a
            key={i}
            href={it.href}
            target="_blank"
            rel="noreferrer"
            className={cn(cls, "group/stat transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring")}
          >
            {body}
          </a>
        ) : (
          <div key={i} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** The arrow shows the direction; the colour shows whether that is good news (a rise in unemployment is red). */
function trendTone(trend: Item["trend"], good?: boolean): string {
  if (!trend || trend === "flat") return "";
  return (good ?? trend === "up") ? "text-up" : "text-down";
}

function TrendIcon({ trend, good }: { trend: "up" | "down" | "flat"; good?: boolean }) {
  const tone = trendTone(trend, good);
  if (trend === "up") return <ArrowUpRight className={cn("size-3.5 shrink-0", tone)} aria-label="Up" />;
  if (trend === "down") return <ArrowDownRight className={cn("size-3.5 shrink-0", tone)} aria-label="Down" />;
  return <ArrowRight className="size-3.5 shrink-0 text-subtle" aria-label="No change" />;
}

/* List */

function List({ items, listStyle }: { items: Item[]; listStyle?: CustomBlock["listStyle"] }) {
  const style = listStyle === "numbers" || listStyle === "checks" || listStyle === "timeline" ? listStyle : "bullets";
  if (style === "timeline") return <Timeline items={items} />;
  const Tag = style === "numbers" ? "ol" : "ul";
  return (
    <Tag className="flex flex-col">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3 border-b border-border/60 py-2 last:border-b-0 first:pt-0.5 last:pb-0.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {style === "numbers" ? (
              <span className="nums flex size-5 items-center justify-center rounded-full bg-muted text-[0.7rem] font-medium text-muted-foreground">
                {i + 1}
              </span>
            ) : style === "checks" ? (
              <Check className="size-4 text-brand" aria-hidden />
            ) : (
              <span className="size-1.5 rounded-full bg-subtle" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <ItemLabel item={it} className="text-[0.87rem] leading-5 text-foreground" />
            {it.detail ? <p className="mt-0.5 text-[0.78rem] leading-snug text-muted-foreground">{it.detail}</p> : null}
          </div>
          {it.value ? <span className="nums shrink-0 pl-2 text-[0.85rem] leading-5 font-medium text-foreground">{it.value}</span> : null}
        </li>
      ))}
    </Tag>
  );
}

function ItemLabel({ item, className, text }: { item: Item; className?: string; text?: string }) {
  const content = text ?? item.label;
  if (!item.href) return <p className={className}>{content}</p>;
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group/link inline-flex max-w-full items-baseline gap-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="min-w-0">{content}</span>
      <ExternalLink className="size-3 shrink-0 translate-y-0.5 text-subtle transition-colors group-hover/link:text-foreground" aria-hidden />
    </a>
  );
}

function Timeline({ items }: { items: Item[] }) {
  return (
    <ol className="relative flex flex-col">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const headline = it.value || it.label;
        const when = it.value ? it.label : "";
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            <div className="relative flex w-3 shrink-0 justify-center">
              {!last ? <span className="absolute top-3.5 -bottom-5 w-px bg-border" aria-hidden /> : null}
              <span
                className={cn(
                  "relative mt-1 size-2.5 rounded-full ring-4 ring-card",
                  i === 0 ? "bg-brand" : "border-[1.5px] border-brand bg-card",
                )}
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1">
              {when ? <p className="nums text-[0.74rem] leading-4 font-medium text-muted-foreground">{when}</p> : null}
              <ItemLabel item={it} text={headline} className={cn("text-[0.88rem] leading-5 font-medium text-foreground", when && "mt-0.5")} />
              {it.detail ? <p className="mt-0.5 text-[0.8rem] leading-snug text-muted-foreground">{it.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* Progress */

function Progress({ items }: { items: Item[] }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((it, i) => {
        const p = Math.min(100, Math.max(0, it.percent ?? 0));
        const full = (it.percent ?? 0) >= 100;
        return (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3">
              <ItemLabel item={it} className="min-w-0 truncate text-[0.85rem] leading-5 text-foreground" />
              <span className="nums shrink-0 text-[0.8rem] text-muted-foreground">{it.value || `${Math.round(p)}%`}</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p)}
              aria-label={it.label || undefined}
            >
              <motion.div
                className={cn("h-full rounded-full", full ? "bg-brass" : "bg-brand")}
                initial={{ width: 0 }}
                animate={{ width: `${p}%` }}
                transition={{ duration: 0.5, ease: "easeOut", delay: Math.min(i * 0.05, 0.25) }}
              />
            </div>
            {it.detail ? <p className="mt-1 text-[0.76rem] leading-snug text-muted-foreground">{it.detail}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* Table */

const ROW_CAP = 12;
const NUMERIC = /^[+\-−~≈]?\s*(?:[€$£¥₹]|US\$)?\s*\d[\d\s.,]*(?:\s*(?:%|[a-zA-Z€$£°/]{1,5}))?$/;

function looksNumeric(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length < 24 && NUMERIC.test(t);
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [all, setAll] = React.useState(false);
  const width = Math.max(columns.length, ...rows.map((r) => r.length), 0);
  const numericCol = React.useMemo(
    () =>
      Array.from({ length: width }, (_, c) => {
        const cells = rows.map((r) => r[c] ?? "").filter((v) => v.trim() !== "");
        return cells.length > 0 && cells.filter(looksNumeric).length / cells.length >= 0.6 && c > 0;
      }),
    [rows, width],
  );
  if (width === 0) return null;
  const shown = all ? rows : rows.slice(0, ROW_CAP);

  return (
    <div>
      <div className="max-h-[440px] overflow-auto rounded-xl border border-border">
        <table className="w-full border-separate border-spacing-0 text-[0.84rem]">
          {columns.length > 0 ? (
            <thead>
              <tr>
                {Array.from({ length: width }, (_, c) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-[0.75rem] font-medium whitespace-nowrap text-muted-foreground",
                      numericCol[c] ? "text-right" : "text-left",
                    )}
                  >
                    {columns[c] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="transition-colors hover:bg-muted/50">
                {Array.from({ length: width }, (_, c) => (
                  <td
                    key={c}
                    className={cn(
                      "border-b border-border/60 px-3 py-2 align-top text-foreground",
                      i === shown.length - 1 && "border-b-0",
                      numericCol[c] ? "nums text-right whitespace-nowrap" : "text-left",
                      c === 0 && "font-medium",
                    )}
                  >
                    {r[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > ROW_CAP ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-2 inline-flex h-10 items-center rounded-full px-3 text-[0.8rem] font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-ring"
        >
          {all ? "Show fewer rows" : <span className="nums">Show all {rows.length} rows</span>}
        </button>
      ) : null}
    </div>
  );
}

/* Image */

function ImageBlock({ url, caption, alt }: { url: string; caption: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed || !isHttp(url)) return null;
  return (
    <figure>
      <div className="flex items-center justify-center overflow-hidden rounded-xl bg-surface hairline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt || "Image"}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-[360px] w-full object-contain"
        />
      </div>
      {caption ? <figcaption className="mt-2 text-[0.78rem] leading-snug text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

/* Buttons */

function Buttons({ buttons, onAsk }: { buttons: CustomButton[]; onAsk?: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((b, i) => (
        <ActionButton key={i} button={b} onAsk={onAsk} />
      ))}
    </div>
  );
}

function ActionButton({ button, onAsk }: { button: CustomButton; onAsk?: (p: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const cls = cn(
    "inline-flex h-10 max-w-full items-center gap-2 rounded-full px-4 text-[0.85rem] font-medium transition-[background-color,border-color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    button.primary
      ? "bg-primary text-primary-foreground shadow-card hover:bg-primary/90"
      : "border border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted",
  );
  const iconCls = cn("size-4 shrink-0", button.primary ? "opacity-90" : "text-muted-foreground");
  const label = <span className="truncate">{button.label}</span>;

  if (button.action === "link") {
    const ok = isHttp(button.value);
    if (!ok) {
      return (
        <button type="button" disabled className={cls}>
          {label}
          <ExternalLink className={iconCls} aria-hidden />
        </button>
      );
    }
    return (
      <a href={button.value.trim()} target="_blank" rel="noreferrer" className={cls}>
        {label}
        <ExternalLink className={iconCls} aria-hidden />
      </a>
    );
  }

  if (button.action === "copy") {
    return (
      <button
        type="button"
        className={cls}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(button.value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked: leave the label as it is.
          }
        }}
      >
        {copied ? <Check className={cn(iconCls, !button.primary && "text-brand")} aria-hidden /> : <Copy className={iconCls} aria-hidden />}
        <span className="truncate" aria-live="polite">
          {copied ? "Copied" : button.label}
        </span>
      </button>
    );
  }

  const prompt = button.value.trim() || button.label;
  return (
    <button type="button" disabled={!onAsk} onClick={() => onAsk?.(prompt)} className={cls}>
      <Sparkles className={iconCls} aria-hidden />
      {label}
    </button>
  );
}

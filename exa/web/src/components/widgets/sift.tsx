"use client";

import * as React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Check, ChevronDown, ListFilter, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIFT_SURE, type SiftData, type SiftItem, type SiftVerdict, type WidgetProps } from "@/lib/widgets/types";
import { Favicon, formatDate, Shimmer, WidgetError, WidgetFrame } from "./frame";

/*
 * The match grid: every page that was found, checked against every wish. One row per page, one
 * mark per wish: yes, no, or "the page does not say", solid when the judge is sure and outlined
 * when it is only probable. Best fit first. Tapping a wish keeps only the pages that meet it.
 *
 * With room, it is a table. In a narrow column (a phone, the chat beside the live browser) each
 * page becomes a card and its marks become labelled chips, so nothing has to scroll sideways.
 */

type Wish = SiftData["wishes"][number];

const EASE = [0.2, 0.8, 0.2, 1] as const;
const UNKNOWN: SiftVerdict = { answer: "unknown", confidence: 0 };

const met = (item: SiftItem) => (item.verdicts ?? []).filter((v) => v.answer === "yes").length;
const percent = (v: SiftVerdict) => `${Math.round(v.confidence * 100)}%`;

/** "Yes, 97% sure", "Probably not, 61% sure", "The page does not say". */
function verdictWords(v: SiftVerdict): string {
  if (v.answer === "unknown") return "The page does not say";
  const sure = v.confidence >= SIFT_SURE;
  const word = v.answer === "yes" ? (sure ? "Yes" : "Probably") : sure ? "No" : "Probably not";
  return `${word}, ${percent(v)} sure`;
}

/** The width of an element, measured before the first paint so the layout does not jump. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function Sift({ data, loading }: WidgetProps<SiftData>) {
  const wishes = React.useMemo(() => data.wishes ?? [], [data.wishes]);
  const items = React.useMemo(() => data.items ?? [], [data.items]);
  const count = wishes.length;
  const judged = items.some((item) => item.verdicts);

  // A table needs a column per wish beside the title: the more wishes, the more room it takes.
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const wide = width >= (count <= 3 ? 460 : count === 4 ? 520 : 620);
  const template = `minmax(0, 1fr) repeat(${count}, ${count <= 4 ? "4.75rem" : "4.1rem"})`;

  // Wishes the user has made must-haves: only pages that meet them stay.
  const [required, setRequired] = React.useState<number[]>([]);
  const toggle = (w: number) => setRequired((now) => (now.includes(w) ? now.filter((x) => x !== w) : [...now, w]));
  const kept = React.useMemo(() => (required.length ? items.filter((item) => required.every((w) => item.verdicts?.[w]?.answer === "yes")) : items), [items, required]);

  const fits = judged ? items.filter((item) => met(item) === count).length : 0;
  const [expanded, setExpanded] = React.useState(false);
  const usual = Math.max(8, Math.min(fits, 12));
  const shown = expanded ? kept : kept.slice(0, usual);

  // Best fit first, in three bands: everything met, one missed, the rest. Each band says how many
  // pages are in it altogether, whether or not they are all on screen yet.
  const groups = React.useMemo(() => {
    if (!judged) return [{ title: "", rows: shown, total: shown.length }];
    const bandOf = (item: SiftItem) => (count === 1 ? (met(item) === 1 ? 0 : 2) : Math.min(2, count - met(item)));
    const bands: Array<{ title: string; rows: SiftItem[]; total: number }> = [
      { title: count === 1 ? "Meet it" : "Meet every wish", rows: [], total: 0 },
      { title: "Miss one", rows: [], total: 0 },
      { title: count <= 2 ? "Do not fit" : "Miss more", rows: [], total: 0 },
    ];
    for (const item of kept) bands[bandOf(item)].total += 1;
    for (const item of shown) bands[bandOf(item)].rows.push(item);
    return bands.filter((band) => band.rows.length > 0);
  }, [kept, shown, judged, count]);

  const seconds = data.judgedMs ? (data.judgedMs / 1000).toFixed(1) : null;
  // Short enough to fit beside the count on a phone: the wishes are the columns, they need no counting.
  const subtitle = judged ? `Checked ${data.checked} pages${seconds ? ` in ${seconds} s` : ""}` : items.length > 0 ? `${items.length} pages found` : undefined;
  const footerNote = judged ? [data.judgements ? `${data.judgements} checks` : null, data.skipped ? `${data.skipped} left out` : null].filter(Boolean).join(" · ") : undefined;

  const aside =
    judged && !data.error ? (
      <span className={cn("nums inline-flex h-7 items-center rounded-full px-2.5 text-[0.75rem] font-medium", fits > 0 ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground")}>
        {fits > 0 ? `${fits} ${fits === 1 ? "fits" : "fit"}` : "None fit all"}
      </span>
    ) : null;

  // Where each page stands in the list, for the order the rows arrive in.
  const order = new Map(shown.map((item, i) => [item.url, i]));
  return (
    <WidgetFrame icon={<ListFilter />} title={data.title || "Finding the ones that fit"} subtitle={subtitle} aside={aside} sources={data.sources} footerNote={footerNote} loading={loading} stage={data.stage}>
      <div ref={wrapRef} className="min-w-0">
        {data.error ? (
          <WidgetError message={data.error} />
        ) : (
          <>
            {data.unjudged ? (
              <p className="mb-3 flex gap-2 rounded-lg border border-brass/40 bg-brass/10 px-3 py-2.5 text-[0.82rem] leading-snug">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden />
                <span>{data.unjudged}</span>
              </p>
            ) : null}

            {count > 0 && !data.unjudged ? <WishBar wishes={wishes} wide={wide} template={template} required={required} onToggle={toggle} disabled={!judged} total={items.length} kept={kept.length} /> : null}

            {items.length === 0 && loading ? (
              <Skeleton wide={wide} template={template} count={count} />
            ) : kept.length === 0 ? (
              <p className="px-1 py-6 text-center text-[0.85rem] text-muted-foreground">No page meets {required.length === 1 ? "that wish" : "those wishes together"}. Tap one again to let it go.</p>
            ) : (
              groups.map((group) => (
                <section key={group.title || "all"} className="mt-2.5 first:mt-0">
                  {group.title ? (
                    <h4 className="flex items-center gap-2 px-1 pt-1 pb-1.5 text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">
                      {group.title}
                      <span className="nums rounded-full bg-muted px-1.5 py-px text-[0.68rem] tracking-normal text-muted-foreground">{group.total}</span>
                    </h4>
                  ) : null}
                  <ul className={cn(wide ? "divide-y divide-border/60" : "flex flex-col gap-2")}>
                    {group.rows.map((item) => (
                      <Row key={item.url} item={item} index={order.get(item.url) ?? 0} wishes={wishes} wide={wide} template={template} pending={!judged && !data.unjudged} plain={Boolean(data.unjudged)} />
                    ))}
                  </ul>
                </section>
              ))
            )}

            {kept.length > usual ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-border text-[0.8rem] font-medium text-muted-foreground transition-colors outline-none hover:border-ring/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {expanded ? "Show fewer" : `Show all ${kept.length}`}
                <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
            ) : null}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}

/** The wishes, as column headings (wide) or a row of chips (narrow). Tapping one makes it a must-have. */
function WishBar({
  wishes,
  wide,
  template,
  required,
  onToggle,
  disabled,
  total,
  kept,
}: {
  wishes: Wish[];
  wide: boolean;
  template: string;
  required: number[];
  onToggle: (w: number) => void;
  disabled: boolean;
  total: number;
  kept: number;
}) {
  const tally = total === 0 ? "" : required.length ? `${kept} of ${total} pages` : `${total} pages`;
  if (wide) {
    return (
      <div className="grid items-end gap-x-1 border-b border-border/70 px-2 pb-1.5" style={{ gridTemplateColumns: template }}>
        <span className="nums pb-1 text-[0.72rem] text-muted-foreground">{tally}</span>
        {wishes.map((wish, w) => {
          const on = required.includes(w);
          return (
            <button
              key={`${wish.label}-${w}`}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(w)}
              aria-pressed={on}
              title={`${capital(wish.test)}. ${on ? "Tap to stop requiring it." : "Tap to keep only pages that meet it."}`}
              className={cn(
                "flex min-h-9 items-center justify-center rounded-lg px-1 py-1 text-center text-[0.7rem] leading-[1.15] font-medium text-balance transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none",
                on ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="line-clamp-2 [overflow-wrap:anywhere]">{breakable(wish.label)}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {wishes.map((wish, w) => {
        const on = required.includes(w);
        return (
          <button
            key={`${wish.label}-${w}`}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(w)}
            aria-pressed={on}
            title={capital(wish.test)}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[0.75rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none",
              on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:border-ring/40 hover:text-foreground",
            )}
          >
            {on ? <Check className="size-3.5" strokeWidth={2.6} aria-hidden /> : null}
            {wish.label}
          </button>
        );
      })}
      {required.length ? <span className="nums pl-1 text-[0.72rem] text-muted-foreground">{tally}</span> : null}
    </div>
  );
}

function Row({ item, index, wishes, wide, template, pending, plain }: { item: SiftItem; index: number; wishes: Wish[]; wide: boolean; template: string; pending: boolean; plain: boolean }) {
  const count = wishes.length;
  const delay = Math.min(index, 10) * 0.035;
  const title = (
    <a href={item.url} target="_blank" rel="noreferrer" className="group/page flex min-w-0 items-start gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Favicon source={item} className="mt-0.5 size-4" />
      <span className="min-w-0 flex-1">
        <span className={cn("text-[0.86rem] leading-snug font-medium text-foreground decoration-border underline-offset-4 group-hover/page:underline", wide ? "line-clamp-1" : "line-clamp-2")}>
          {item.title || item.domain}
          <ArrowUpRight className="ml-0.5 inline size-3.5 -translate-y-px text-subtle opacity-0 transition-opacity group-hover/page:opacity-100" aria-hidden />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-muted-foreground">
          <span className="truncate">{item.domain}</span>
          {item.publishedDate ? <span className="shrink-0">· {formatDate(item.publishedDate)}</span> : null}
        </span>
      </span>
    </a>
  );

  if (wide) {
    return (
      <motion.li
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay, ease: EASE }}
        className="grid items-center gap-x-1 px-2 py-2.5 transition-colors hover:bg-surface"
        style={{ gridTemplateColumns: plain ? "minmax(0, 1fr)" : template }}
      >
        {title}
        {plain
          ? null
          : wishes.map((wish, w) => (
              <span key={w} className="flex justify-center">
                {pending ? <Checking index={index} column={w} className="size-6" /> : <Mark verdict={item.verdicts?.[w] ?? UNKNOWN} label={wish.label} delay={delay + w * 0.05} />}
              </span>
            ))}
      </motion.li>
    );
  }

  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay, ease: EASE }} className="rounded-xl bg-surface p-3 hairline">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{title}</div>
        {item.verdicts && count > 1 ? (
          <span className={cn("nums mt-px shrink-0 rounded-full px-1.5 py-px text-[0.7rem] font-medium", met(item) === count ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground")}>
            {met(item)}/{count}
          </span>
        ) : null}
      </div>
      {plain ? null : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {wishes.map((wish, w) =>
            pending ? (
              <Checking key={w} index={index} column={w} className="h-6 px-2.5 text-[0.72rem] leading-6 font-medium text-subtle">
                {wish.label}
              </Checking>
            ) : (
              <Chip key={w} verdict={item.verdicts?.[w] ?? UNKNOWN} label={wish.label} delay={delay + w * 0.05} />
            ),
          )}
        </div>
      )}
    </motion.li>
  );
}

/** A cell whose verdict has not come back yet. The pulse runs across the row, so the grid looks read, not stuck. */
function Checking({ index, column, className, children }: { index: number; column: number; className?: string; children?: React.ReactNode }) {
  return (
    <span aria-hidden className={cn("inline-block animate-pulse rounded-full border border-dashed border-border bg-muted/70", className)} style={{ animationDelay: `${(index % 6) * 90 + column * 160}ms`, animationDuration: "1.1s" }}>
      {children}
    </span>
  );
}

/** How a verdict looks: solid when sure, outlined when only probable, grey when the page does not say. */
function tone(v: SiftVerdict): string {
  const sure = v.confidence >= SIFT_SURE;
  if (v.answer === "yes") return sure ? "border-transparent bg-brand-soft text-brand" : "border-dashed border-brand/50 text-brand";
  if (v.answer === "no") return sure ? "border-transparent bg-down/12 text-down" : "border-dashed border-down/50 text-down";
  return "border-transparent bg-muted text-subtle";
}

function Glyph({ verdict, className }: { verdict: SiftVerdict; className?: string }) {
  if (verdict.answer === "yes") return <Check className={className} strokeWidth={2.8} aria-hidden />;
  if (verdict.answer === "no") return <X className={className} strokeWidth={2.8} aria-hidden />;
  return (
    <span className={cn("flex items-center justify-center text-[0.72rem] leading-none font-semibold", className)} aria-hidden>
      ?
    </span>
  );
}

/** One cell of the table: a round mark. What it means is in its title and its label for screen readers. */
function Mark({ verdict, label, delay }: { verdict: SiftVerdict; label: string; delay: number }) {
  const words = verdictWords(verdict);
  return (
    <motion.span
      role="img"
      aria-label={`${label}: ${words}`}
      title={words}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, delay, ease: EASE }}
      className={cn("flex size-6 items-center justify-center rounded-full border", tone(verdict))}
    >
      <Glyph verdict={verdict} className="size-3.5" />
    </motion.span>
  );
}

/** The same verdict with its wish written out, for the narrow layout where there are no columns. */
function Chip({ verdict, label, delay }: { verdict: SiftVerdict; label: string; delay: number }) {
  const sure = verdict.confidence >= SIFT_SURE;
  const note = verdict.answer === "unknown" ? "not stated" : sure ? null : verdict.answer === "yes" ? "probably" : "probably not";
  return (
    <motion.span
      title={verdictWords(verdict)}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay, ease: EASE }}
      className={cn("inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border py-0.5 pr-2 pl-1.5 text-[0.72rem] leading-tight font-medium", tone(verdict))}
    >
      <Glyph verdict={verdict} className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
      {note ? <span className="shrink-0 font-normal opacity-75">· {note}</span> : null}
    </motion.span>
  );
}

function Skeleton({ wide, template, count }: { wide: boolean; template: string; count: number }) {
  const marks = Array.from({ length: Math.max(count, 1) });
  if (wide) {
    return (
      <ul className="divide-y divide-border/60" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="grid items-center gap-x-1 px-2 py-3" style={{ gridTemplateColumns: template }}>
            <span className="flex items-center gap-2.5">
              <Shimmer className="size-4 rounded-full" />
              <Shimmer className={cn("h-3", i % 2 ? "w-2/5" : "w-3/5")} />
            </span>
            {marks.map((_, w) => (
              <span key={w} className="flex justify-center">
                <Shimmer className="size-6 rounded-full" />
              </span>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="rounded-xl bg-surface p-3 hairline">
          <span className="flex items-center gap-2.5">
            <Shimmer className="size-4 rounded-full" />
            <Shimmer className={cn("h-3", i % 2 ? "w-1/2" : "w-3/4")} />
          </span>
          <span className="mt-3 flex flex-wrap gap-1.5">
            {marks.map((_, w) => (
              <Shimmer key={w} className="h-6 w-24 rounded-full" />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Evening/weekend" may break after the slash: a narrow column heading needs somewhere to turn. */
const breakable = (label: string) => label.replace(/([/\-–])(?=\S)/g, "$1\u200b");

const capital = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

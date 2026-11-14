"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpenText, Brain, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReadPagesData, Source, WebSearchData } from "@/lib/widgets/types";
import { Favicon, dedupeSources } from "@/components/widgets/frame";
import type { ToolPart } from "./tool-part";

type Row =
  | { kind: "search"; id: string; label: string; running: boolean; results: Source[]; error?: string }
  | { kind: "read"; id: string; label: string; running: boolean; results: Source[]; error?: string };

function toRow(part: ToolPart): Row | null {
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" ? part.errorText : undefined;
  if (part.type === "tool-webSearch") {
    const output = part.state === "output-available" ? (part.output as WebSearchData) : undefined;
    const query = (part.input as { query?: string } | undefined)?.query ?? output?.query ?? "";
    return { kind: "search", id: part.toolCallId, label: query, running, results: output?.results ?? [], error: failed ?? output?.error };
  }
  if (part.type === "tool-readPages") {
    const output = part.state === "output-available" ? (part.output as ReadPagesData) : undefined;
    const urls = ((part.input as { urls?: string[] } | undefined)?.urls ?? []).filter((u) => typeof u === "string");
    const pages = output?.pages ?? [];
    const label = pages.length ? pages.map((p) => p.title || p.domain).join(", ") : urls.map(hostOf).join(", ");
    return { kind: "read", id: part.toolCallId, label, running, results: pages, error: failed ?? output?.error };
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A run of searches and page reads, shown as one quiet, expandable line. */
export function ActivityGroup({ parts }: { parts: ToolPart[] }) {
  const rows = React.useMemo(() => parts.map(toRow).filter((r): r is Row => r !== null), [parts]);
  const [open, setOpen] = React.useState(false);
  if (rows.length === 0) return null;

  const running = rows.filter((r) => r.running);
  const active = running.length > 0;
  const searches = rows.filter((r) => r.kind === "search").length;
  const reads = rows.filter((r) => r.kind === "read").length;
  const sources = dedupeSources(rows.flatMap((r) => r.results));

  const summary = [searches ? `${searches} ${searches === 1 ? "search" : "searches"}` : "", reads ? `${reads} ${reads === 1 ? "page read" : "pages read"}` : ""]
    .filter(Boolean)
    .join(", ");
  const current = running.at(-1);

  return (
    <div className="animate-fade">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group/act flex w-full items-center gap-2 rounded-lg py-1 text-left text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md", active ? "text-brand" : "text-subtle")}>
          {current?.kind === "read" ? <BookOpenText className="size-3.5" /> : <Search className="size-3.5" />}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", active && "text-shimmer")}>
          {active ? (current!.kind === "search" ? `Searching: ${current!.label || "the web"}` : `Reading ${current!.label || "pages"}`) : `Searched the web with Exa: ${summary}`}
        </span>
        {sources.length > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="flex -space-x-1.5">
              {sources.slice(0, 5).map((s) => (
                <Favicon key={s.url} source={s} className="size-4 ring-2 ring-background" />
              ))}
            </span>
            <span className="nums text-[0.72rem]">{sources.length}</span>
          </span>
        ) : null}
        <ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform duration-200", open && "rotate-90")} />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ol className="mt-1 mb-2 ml-2.5 space-y-3 border-l border-border pl-4">
              {rows.map((row) => (
                <li key={row.id} className="text-[0.8rem]">
                  <div className="flex items-start gap-2 text-foreground/90">
                    {row.kind === "search" ? <Search className="mt-0.5 size-3.5 shrink-0 text-subtle" /> : <BookOpenText className="mt-0.5 size-3.5 shrink-0 text-subtle" />}
                    <span className={cn("leading-snug", row.running && "text-shimmer")}>{row.kind === "search" ? row.label : `Read ${row.label}`}</span>
                  </div>
                  {row.error ? <p className="mt-1 ml-5.5 text-[0.75rem] text-destructive">{row.error}</p> : null}
                  {row.results.length > 0 ? (
                    <ul className="mt-1.5 ml-5.5 flex flex-wrap gap-1.5">
                      {row.results.map((s) => (
                        <li key={s.url}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            title={s.snippet ?? s.title ?? s.url}
                            className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-1 text-[0.72rem] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
                          >
                            <Favicon source={s} className="size-3.5" />
                            <span className="truncate">{s.title || s.domain}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The model's reasoning summary: a shimmer while it thinks, then a line that expands. */
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = React.useState(false);
  const clean = text.trim();
  if (!clean && !streaming) return null;
  const lastLine = clean.split("\n").filter(Boolean).at(-1) ?? "";
  return (
    <div className="animate-fade">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!clean}
        className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default"
      >
        <span className={cn("flex size-5 shrink-0 items-center justify-center", streaming ? "text-brand" : "text-subtle")}>
          <Brain className="size-3.5" />
        </span>
        <span className={cn("min-w-0 flex-1 truncate", streaming && "text-shimmer")}>
          {streaming ? stripMarkdown(lastLine) || "Thinking" : "Thought it through"}
        </span>
        {clean ? <ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform duration-200", open && "rotate-90")} /> : null}
      </button>
      <AnimatePresence initial={false}>
        {open && clean ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="mt-1 mb-2 ml-2.5 border-l border-border pl-4 text-[0.8rem] leading-relaxed whitespace-pre-wrap text-muted-foreground">{stripMarkdown(clean)}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function stripMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").replace(/`/g, "");
}

"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Check, ChevronDown, Download, FileCode, FileText, Globe, Lightbulb, PenLine, Printer, Search, Telescope, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { downloadFile, fileSlug, openDocument, portableHtml, reportDocument } from "@/lib/export";
import { CopyAction, IconAction } from "@/components/butler/icon-action";
import { Markdown } from "@/components/butler/markdown";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  faviconOf,
  type ResearchAgent,
  type ResearchData,
  type ResearchStep,
  type Source,
  type WidgetProps,
} from "@/lib/widgets/types";
import { Favicon, LiveDot, Shimmer, SourceChips, WidgetError, WidgetFrame, dedupeSources } from "./frame";

const VISIBLE_STEPS = 3;
const EASE = [0.2, 0.8, 0.2, 1] as const;

type Phase = ResearchData["status"];

export function Research({ data, loading }: WidgetProps<ResearchData>) {
  const agents = React.useMemo(() => data?.agents ?? [], [data?.agents]);
  const status: Phase = data?.status ?? "planning";
  const done = status === "done";
  const working = !done || Boolean(loading);

  const allSources = React.useMemo(
    () => dedupeSources([...(data?.sources ?? []), ...agents.flatMap((a) => a.sources ?? [])]),
    [data?.sources, agents],
  );
  const searches = agents.reduce((n, a) => n + (a.steps ?? []).filter((s) => s.type === "search").length, 0);
  const finished = agents.filter((a) => a.status === "done" || a.status === "failed").length;

  // The report as it is drawn on screen: the source for a formatted copy and for the downloads.
  const reportRef = React.useRef<HTMLDivElement>(null);

  const subtitle = done
    ? `${agents.length} ${plural(agents.length, "researcher")} · ${allSources.length} ${plural(allSources.length, "source")}`
    : undefined;

  return (
    <WidgetFrame
      icon={<Telescope />}
      title="Deep research"
      subtitle={subtitle}
      loading={working}
      stage={data?.stage ?? stageFor(status, finished, agents.length)}
      aside={
        data?.error ? null : working ? (
          <LiveDot label={phaseLabel(status)} />
        ) : data?.report ? (
          <ReportActions question={data.question} report={data.report} sources={allSources} rendered={reportRef} />
        ) : null
      }
      sources={allSources}
      footerNote={done && typeof data?.exaCostUsd === "number" ? <span className="nums">Search cost ${data.exaCostUsd.toFixed(2)}</span> : undefined}
    >
      {data?.error ? (
        <WidgetError message={data.error} />
      ) : (
        <>
          {data?.question ? (
            <h4 className="font-display text-[1.05rem] leading-snug text-balance text-foreground sm:text-[1.12rem]">
              {data.question}
            </h4>
          ) : (
            <Shimmer className="h-6 w-4/5" />
          )}

          <AnimatePresence mode="wait" initial={false}>
            {done && data?.report ? (
              <motion.div
                key="report"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <EffortSummary researchers={agents.length} searches={searches} sources={allSources.length} />
                <div ref={reportRef} className="mt-4">
                  <Markdown>{data.report}</Markdown>
                </div>
                {agents.length > 0 ? <Methodology agents={agents} /> : null}
              </motion.div>
            ) : (
              <motion.div
                key="work"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <ProgressLine
                  status={status}
                  agents={agents}
                  finished={finished}
                  searches={searches}
                  sources={allSources.length}
                  live={working}
                />
                <Lanes agents={agents} status={status} />
                {status === "writing" || (done && !data?.report) ? (
                  <WritingState report={data?.report} done={done} />
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </WidgetFrame>
  );
}

/* ───────────────────────── Copy and download ───────────────────────── */

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const credit = () => `Researched with ${APP_NAME}, which searches the live web with Exa. Check important details at the source before you act.`;

/** The report as a markdown file: the question as the title, the report, then a numbered source list. */
function reportMarkdown(question: string, report: string, sources: Source[]) {
  const list = sources.map((s, i) => `${i + 1}. [${(s.title?.trim() || s.domain || s.url).replace(/[[\]]/g, "")}](${s.url})`).join("\n");
  return [`# ${question || "Research report"}`, report.trim(), list ? `## Sources\n\n${list}` : "", `---\n\n${today()}. ${credit()}`].filter(Boolean).join("\n\n") + "\n";
}

/**
 * Copy this report, or save it on its own: as markdown, as a web page that opens anywhere, or
 * through the print dialog as a PDF. Only the report, not the rest of the conversation.
 */
function ReportActions({
  question,
  report,
  sources,
  rendered,
}: {
  question: string;
  report: string;
  sources: Source[];
  /** The report as drawn on screen. */
  rendered: React.RefObject<HTMLDivElement | null>;
}) {
  const title = question || "Research report";
  const name = fileSlug(title, "research-report");
  const bodyHtml = () => (rendered.current ? portableHtml(rendered.current) : "");
  const page = (print?: boolean) =>
    reportDocument({ title, bodyHtml: bodyHtml(), sources, kicker: `Research report · ${today()}`, footer: credit(), print });

  const saveMarkdown = () => {
    downloadFile(`${name}.md`, reportMarkdown(question, report, sources), "text/markdown");
    toast.success("Report saved", { description: `${name}.md` });
  };
  const savePage = () => {
    downloadFile(`${name}.html`, page(), "text/html");
    toast.success("Report saved", { description: `${name}.html` });
  };
  const print = () => {
    if (!openDocument(page(true))) toast.error("Your browser blocked the new tab", { description: "Allow pop-ups for this site, or download the web page and print that." });
  };

  return (
    <div className="-mr-1.5 flex items-center gap-0.5">
      <CopyAction
        label="Copy report"
        text={() => `# ${title}\n\n${report.trim()}`}
        html={() => {
          const body = bodyHtml();
          return body ? `<h1>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h1>${body}` : undefined;
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconAction label="Download report">
            <Download />
          </IconAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={saveMarkdown} className="gap-2.5 px-2 py-1.5">
            <FileText className="text-muted-foreground" />
            <span className="flex-1">Markdown</span>
            <span className="text-[0.72rem] text-subtle">.md</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={savePage} className="gap-2.5 px-2 py-1.5">
            <FileCode className="text-muted-foreground" />
            <span className="flex-1">Web page</span>
            <span className="text-[0.72rem] text-subtle">.html</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={print} className="gap-2.5 px-2 py-1.5">
            <Printer className="text-muted-foreground" />
            <span className="flex-1">Print or save as PDF</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ───────────────────────── Progress ───────────────────────── */

function ProgressLine({
  status,
  agents,
  finished,
  searches,
  sources,
  live,
}: {
  status: Phase;
  agents: ResearchAgent[];
  finished: number;
  searches: number;
  sources: number;
  live: boolean;
}) {
  const elapsed = useElapsed(live);
  const label =
    status === "planning" || agents.length === 0
      ? "Splitting the question into angles"
      : status === "writing" || status === "done"
        ? `All ${agents.length} researchers finished`
        : `${finished} of ${agents.length} ${plural(agents.length, "researcher")} finished`;

  return (
    <div className="mt-3 mb-3.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.78rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2 }}
            className="nums truncate font-medium text-foreground"
          >
            {label}
          </motion.span>
        </AnimatePresence>
        <span className="nums flex shrink-0 items-center gap-2 text-muted-foreground">
          {searches > 0 ? (
            <span className="hidden min-[400px]:inline">
              {searches} {plural(searches, "search", "searches")}
            </span>
          ) : null}
          {sources > 0 ? (
            <span className="hidden min-[400px]:inline">
              · {sources} {plural(sources, "source")}
            </span>
          ) : null}
          {live && elapsed > 0 ? <span className="text-subtle">{formatElapsed(elapsed)}</span> : null}
        </span>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {(agents.length ? agents : Array.from({ length: 4 }, () => null)).map((a, i) => {
          const s = a ? (status === "writing" && a.status !== "failed" ? "done" : a.status) : "queued";
          return (
            <div key={a?.id ?? i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  s === "failed" ? "bg-destructive/60" : "bg-brand",
                )}
                initial={false}
                animate={{ width: s === "done" || s === "failed" ? "100%" : s === "working" ? `${workingProgress(a)}%` : "0%" }}
                transition={{ duration: 0.5, ease: EASE }}
              />
              {s === "working" ? <div className="absolute inset-0 shimmer" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A lane's bar fills as steps arrive, never quite reaching the end until the agent is done. */
function workingProgress(agent: ResearchAgent | null) {
  const n = agent?.steps?.length ?? 0;
  return Math.min(85, 12 + n * 13);
}

/* ───────────────────────── Lanes ───────────────────────── */

function Lanes({ agents, status }: { agents: ResearchAgent[]; status: Phase }) {
  if (agents.length === 0) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-2" aria-label="Planning the research">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface/50 p-3" style={{ opacity: 1 - i * 0.15 }}>
            <div className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full border-[1.5px] border-subtle/60" />
              <Shimmer className="h-3.5 w-3/5" />
            </div>
            <div className="mt-3 space-y-2 pl-[1.375rem]">
              <Shimmer className="h-3 w-4/5" />
              <Shimmer className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <motion.ul layout className="grid gap-2.5 sm:grid-cols-2">
      {agents.map((agent, i) => (
        <motion.li
          key={agent.id}
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE, delay: i * 0.05 }}
        >
          <Lane agent={agent} forceDone={status === "writing"} />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function Lane({ agent, forceDone }: { agent: ResearchAgent; forceDone?: boolean }) {
  const status = forceDone && agent.status !== "failed" ? "done" : agent.status;
  const steps = agent.steps ?? [];
  const [expanded, setExpanded] = React.useState(false);
  const hidden = Math.max(0, steps.length - VISIBLE_STEPS);
  const start = expanded ? 0 : hidden;
  const visible = steps.slice(start);
  const isWorking = status === "working";

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border p-3 transition-colors duration-500",
        isWorking ? "border-brand/25 bg-brand-soft/25" : "border-border bg-surface/50",
        status === "queued" && "border-dashed",
      )}
    >
      {isWorking ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <div className="h-px w-1/3 animate-sweep bg-brand/70" />
        </div>
      ) : null}

      <div className="flex items-start gap-2.5">
        <StatusMarker status={status} />
        <p
          className={cn(
            "min-w-0 flex-1 text-[0.85rem] leading-5 font-medium",
            status === "queued" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {agent.title}
        </p>
        {steps.length > 0 ? (
          <span className="nums mt-px shrink-0 text-[0.72rem] text-subtle">
            {steps.length} {plural(steps.length, "step")}
          </span>
        ) : null}
      </div>

      <div className="mt-2 pl-[1.625rem]">
        {status === "queued" && steps.length === 0 ? (
          <p className="text-[0.78rem] text-subtle">Waiting for a free researcher</p>
        ) : status === "failed" && steps.length === 0 ? (
          <p className="text-[0.78rem] text-destructive">Could not finish this angle</p>
        ) : (
          <>
            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="-ml-1 mb-1 inline-flex h-6 items-center gap-1 rounded-md px-1 text-[0.72rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                <span className="nums">{expanded ? "Show fewer steps" : `+${hidden} earlier ${plural(hidden, "step")}`}</span>
                <ChevronDown className={cn("size-3 transition-transform duration-200", expanded && "rotate-180")} />
              </button>
            ) : null}
            <ol className="relative space-y-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {visible.map((step, j) => {
                  const index = start + j;
                  const current = isWorking && index === steps.length - 1;
                  return (
                    <motion.li
                      key={`${agent.id}-${index}`}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      transition={{ duration: 0.3, ease: EASE }}
                    >
                      <StepRow step={step} current={current} />
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
            {status === "failed" ? (
              <p className="mt-1.5 text-[0.75rem] text-destructive">Stopped before finishing</p>
            ) : null}
            {status === "done" && agent.sources?.length ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="mt-2.5 flex"
              >
                <SourceChips sources={agent.sources} max={3} className="bg-card/80" />
              </motion.div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const STEP_ICON: Record<ResearchStep["type"], React.ComponentType<{ className?: string }>> = {
  search: Search,
  read: BookOpen,
  think: Lightbulb,
};

const STEP_VERB: Record<ResearchStep["type"], string> = {
  search: "Searched",
  read: "Read",
  think: "Thought",
};

function StepRow({ step, current, compact }: { step: ResearchStep; current?: boolean; compact?: boolean }) {
  const Icon = STEP_ICON[step.type] ?? Search;
  const domains = (step.domains ?? []).filter(Boolean);
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "mt-[3px] flex size-3.5 shrink-0 items-center justify-center",
          current ? "text-brand" : "text-subtle",
        )}
        title={STEP_VERB[step.type]}
      >
        <Icon className="size-3.5" />
        <span className="sr-only">{STEP_VERB[step.type]}:</span>
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[0.78rem] leading-5",
          compact ? "text-muted-foreground" : "line-clamp-2",
          current ? "text-shimmer" : "text-muted-foreground",
        )}
      >
        {step.label}
      </span>
      {domains.length > 0 ? (
        <span className="mt-[3px] flex shrink-0 -space-x-1" title={domains.join(", ")}>
          {domains.slice(0, 3).map((d) => (
            <Favicon key={d} source={{ domain: d, favicon: faviconOf(`https://${d}`) }} className="size-3.5 ring-[1.5px] ring-card" />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function StatusMarker({ status }: { status: ResearchAgent["status"] }) {
  return (
    <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-label={STATUS_LABEL[status]} role="img">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="flex items-center justify-center"
        >
          {status === "queued" ? (
            <span className="size-2.5 rounded-full border-[1.5px] border-subtle" />
          ) : status === "working" ? (
            <span className="relative flex size-2.5 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/30 [animation-duration:1.8s]" />
              <span className="size-2 animate-pulse-dot rounded-full bg-brand" />
            </span>
          ) : status === "done" ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-brand text-primary-foreground dark:text-background">
              <Check className="size-2.5" strokeWidth={3.5} />
            </span>
          ) : (
            <span className="flex size-4 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <X className="size-2.5" strokeWidth={3.5} />
            </span>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const STATUS_LABEL: Record<ResearchAgent["status"], string> = {
  queued: "Queued",
  working: "Working",
  done: "Finished",
  failed: "Failed",
};

/* ───────────────────────── Writing and done ───────────────────────── */

function WritingState({ report, done }: { report?: string; done: boolean }) {
  return (
    <div className="mt-4">
      {!done ? (
        <div className="flex items-center gap-2 text-[0.85rem]">
          <PenLine className="size-3.5 text-brand" />
          <span className="text-shimmer font-medium">Writing the report</span>
        </div>
      ) : (
        <p className="text-[0.85rem] text-muted-foreground">The researchers finished, but no report was written.</p>
      )}
      {report ? (
        <div className="mt-3 border-t border-border/70 pt-4">
          <Markdown streaming={!done}>{report}</Markdown>
        </div>
      ) : !done ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <Shimmer className="h-3.5 w-full" />
          <Shimmer className="h-3.5 w-11/12" />
          <Shimmer className="h-3.5 w-3/5" />
        </div>
      ) : null}
    </div>
  );
}

function EffortSummary({ researchers, searches, sources }: { researchers: number; searches: number; sources: number }) {
  const items = [
    { icon: Users, value: researchers, label: plural(researchers, "researcher") },
    { icon: Search, value: searches, label: plural(searches, "search", "searches") },
    { icon: Globe, value: sources, label: plural(sources, "source") },
  ].filter((i) => i.value > 0);
  return (
    <ul className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-muted-foreground">
      {items.map(({ icon: Icon, value, label }, i) => (
        <li key={label} className="flex items-center gap-1.5">
          {i > 0 ? <span className="mr-1.5 text-subtle" aria-hidden>·</span> : null}
          <Icon className="size-3.5 text-subtle" />
          <span className="nums">
            <span className="font-medium text-foreground">{value}</span> {label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Methodology({ agents }: { agents: ResearchAgent[] }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center gap-3 bg-surface/60 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="flex -space-x-1">
          {agents.slice(0, 4).map((a) => (
            <StatusMarkerStatic key={a.id} status={a.status} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.85rem] font-medium">How this was researched</span>
          <span className="nums block truncate text-[0.75rem] text-muted-foreground">
            {agents.map((a) => a.title).join(" · ")}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <ol className="divide-y divide-border/70 border-t border-border">
              {agents.map((agent, i) => (
                <AgentReport key={agent.id} agent={agent} index={i} />
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AgentReport({ agent, index }: { agent: ResearchAgent; index: number }) {
  const [showSteps, setShowSteps] = React.useState(false);
  const steps = agent.steps ?? [];
  const sources: Source[] = agent.sources ?? [];
  return (
    <li className="px-3.5 py-3.5">
      <div className="flex items-start gap-2.5">
        <span className="nums mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.68rem] font-semibold text-brand">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] leading-5 font-medium">{agent.title}</p>
          <p className="nums mt-0.5 text-[0.72rem] text-muted-foreground">
            {steps.length} {plural(steps.length, "step")} · {sources.length} {plural(sources.length, "source")}
            {agent.status === "failed" ? <span className="text-destructive"> · did not finish</span> : null}
          </p>
        </div>
        {sources.length > 0 ? <SourceChips sources={sources} max={3} /> : null}
      </div>

      <div className="mt-2 pl-[1.875rem]">
        {agent.findings ? (
          <Markdown className="text-[0.85rem]! leading-relaxed! text-muted-foreground [&_strong]:text-foreground">
            {agent.findings}
          </Markdown>
        ) : (
          <p className="text-[0.8rem] text-subtle">No findings recorded.</p>
        )}

        {steps.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setShowSteps((v) => !v)}
              aria-expanded={showSteps}
              className="-ml-1 mt-2 inline-flex h-7 items-center gap-1 rounded-md px-1 text-[0.72rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              {showSteps ? "Hide steps" : `Show ${steps.length} ${plural(steps.length, "step")}`}
              <ChevronDown className={cn("size-3 transition-transform duration-200", showSteps && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {showSteps ? (
                <motion.ol
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="space-y-1.5 overflow-hidden border-l border-border pt-1 pl-3"
                >
                  {steps.map((s, i) => (
                    <li key={i}>
                      <StepRow step={s} compact />
                    </li>
                  ))}
                </motion.ol>
              ) : null}
            </AnimatePresence>
          </>
        ) : null}
      </div>
    </li>
  );
}

function StatusMarkerStatic({ status }: { status: ResearchAgent["status"] }) {
  const failed = status === "failed";
  return (
    <span
      className={cn(
        "flex size-4 items-center justify-center rounded-full ring-2 ring-surface",
        failed ? "bg-destructive/15 text-destructive" : "bg-brand text-primary-foreground dark:text-background",
      )}
    >
      {failed ? <X className="size-2.5" strokeWidth={3.5} /> : <Check className="size-2.5" strokeWidth={3.5} />}
    </span>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return running ? seconds : 0;
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

function phaseLabel(status: Phase) {
  if (status === "planning") return "Planning";
  if (status === "writing") return "Writing";
  return "Researching";
}

function stageFor(status: Phase, finished: number, total: number) {
  if (status === "planning") return "Planning the research";
  if (status === "writing") return "Writing the report";
  if (status === "researching") return total ? `${total - finished} ${plural(total - finished, "researcher")} still working` : "Starting researchers";
  return undefined;
}

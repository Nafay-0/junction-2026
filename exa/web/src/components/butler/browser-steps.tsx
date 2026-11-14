"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  CornerDownLeft,
  Eye,
  Globe,
  Hourglass,
  Keyboard,
  ListChecks,
  MonitorPlay,
  MousePointerClick,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrowserStepData } from "@/lib/browser/protocol";
import { faviconOf } from "@/lib/widgets/types";
import type { ToolPart, WidgetHandlers } from "./tool-part";

/** The agent's steps in the live browser. They are shown together, as one trail. */
export const BROWSER_TOOLS = new Set(["tool-browserOpen", "tool-browserAct", "tool-browserRead"]);

type RowState = "running" | "done" | "failed" | "blocked" | "waiting" | "approved" | "declined";

type Row = {
  id: string;
  label: string;
  action: string;
  state: RowState;
  problem?: string;
  url?: string;
  /** Set while the step waits for the user's yes. */
  approval?: { id: string; reason: string };
};

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type ActInput = { action?: string; text?: string; direction?: string; summary?: string; url?: string; find?: string };

/** What a step is about to do, before the browser has answered. */
function intent(part: ToolPart): { label: string; action: string } {
  const input = (part.input ?? {}) as ActInput;
  if (part.type === "tool-browserOpen") return { label: input.url ? `Opening ${hostOf(input.url) || "the page"}` : "Opening a page", action: "open" };
  if (part.type === "tool-browserRead") return { label: input.find ? `Looking for "${clip(input.find, 40)}"` : "Reading the page", action: "read" };
  const text = input.text ? `"${clip(input.text, 40)}"` : "";
  switch (input.action) {
    case "click":
      return { label: "Clicking", action: "click" };
    case "type":
      return { label: `Typing ${text}`.trim(), action: "type" };
    case "select":
      return { label: `Choosing ${text}`.trim(), action: "select" };
    case "press":
      return { label: `Pressing ${input.text ?? "a key"}`, action: "press" };
    case "scroll":
      return { label: input.direction === "up" ? "Scrolling up" : "Scrolling down", action: "scroll" };
    case "hover":
      return { label: "Pointing", action: "hover" };
    case "back":
      return { label: "Going back", action: "navigate" };
    case "wait":
      return { label: "Waiting for the page", action: "wait" };
    default:
      return { label: "Working on the page", action: "click" };
  }
}

function toRow(part: ToolPart): Row {
  const planned = intent(part);
  const base = { id: part.toolCallId, action: planned.action };
  switch (part.state) {
    case "output-available": {
      const output = part.output as BrowserStepData;
      const state: RowState = output.ok ? "done" : output.blocked ? "blocked" : "failed";
      return { ...base, action: output.action, label: output.label, state, problem: output.ok ? undefined : firstSentence(output.problem), url: output.url };
    }
    case "output-error":
      return { ...base, label: planned.label, state: "failed", problem: part.errorText || "This step failed." };
    case "output-denied":
      return { ...base, label: "You declined this step", state: "declined" };
    case "approval-requested": {
      const input = (part.input ?? {}) as ActInput;
      return { ...base, label: "Waiting for your approval", state: "waiting", approval: { id: part.approval.id, reason: input.summary?.trim() || part.approval.requestReason || "This step acts on your behalf." } };
    }
    case "approval-responded":
      return part.approval.approved ? { ...base, label: "Approved", state: "approved" } : { ...base, label: "You declined this step", state: "declined" };
    default:
      return { ...base, label: planned.label, state: "running" };
  }
}

/** The safety rules speak to the model at length; the user gets the first sentence. */
function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cut = text.split(/(?<=[.!?])\s+(?=[A-Z"])/)[0];
  return clip(cut.replace(/\bYou never\b/g, "Hovi never").replace(/\byou\b/g, "Hovi"), 200);
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  open: Navigation,
  navigate: Undo2,
  click: MousePointerClick,
  type: Keyboard,
  select: ListChecks,
  press: CornerDownLeft,
  scroll: ArrowDownUp,
  hover: MousePointerClick,
  read: Eye,
  wait: Hourglass,
};

const VISIBLE_WHILE_WORKING = 4;

export function BrowserSteps({
  parts,
  active,
  handlers,
}: {
  parts: ToolPart[];
  /** The agent is still working on this message. */
  active: boolean;
  handlers: WidgetHandlers;
}) {
  const rows = React.useMemo(() => parts.map(toRow), [parts]);
  const [open, setOpen] = React.useState<boolean | null>(null);
  const waiting = rows.find((r) => r.state === "waiting");
  // Between two steps the agent is reading the page and deciding: still working, nothing running.
  const working = active && !waiting;
  const sites = [...new Set(rows.map((r) => hostOf(r.url)).filter(Boolean))];
  const lastUrl = rows.findLast((r) => r.url)?.url;
  const done = rows.filter((r) => r.state === "done").length;
  // Open while the agent works, so the trail builds in front of the user; folded once it is finished.
  const expanded = open ?? (working || Boolean(waiting));
  const shown = expanded ? rows : [];
  const hidden = working && open === null ? Math.max(0, shown.length - VISIBLE_WHILE_WORKING) : 0;
  const current = rows.findLast((r) => r.state === "running" || r.state === "approved");

  return (
    <div className="animate-fade">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          className="group/act flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md", working ? "text-brand" : "text-subtle")}>
            {lastUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={faviconOf(lastUrl)} alt="" className="size-3.5 rounded-sm" />
            ) : (
              <Globe className="size-3.5" />
            )}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", working && "text-shimmer")}>
            {working
              ? `${current?.label ?? "Working in the live browser"}${sites.at(-1) ? ` · ${sites.at(-1)}` : ""}`
              : waiting
                ? "Waiting for your approval"
                : `Worked in the live browser: ${done} ${done === 1 ? "step" : "steps"}${sites.length ? ` on ${sites.slice(0, 2).join(" and ")}${sites.length > 2 ? ` and ${sites.length - 2} more` : ""}` : ""}`}
          </span>
          <ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform duration-200", expanded && "rotate-90")} />
        </button>
        {handlers.onOpenBrowser ? (
          <button
            type="button"
            onClick={handlers.onOpenBrowser}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
          >
            <MonitorPlay className="size-3.5" />
            {working ? "Watch" : "Open"}
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ol className="mt-1 mb-1 ml-2.5 space-y-1.5 border-l border-border pl-4">
              {hidden > 0 ? (
                <li>
                  <button type="button" onClick={() => setOpen(true)} className="text-[0.75rem] text-subtle transition-colors hover:text-foreground">
                    {hidden} earlier {hidden === 1 ? "step" : "steps"}
                  </button>
                </li>
              ) : null}
              {shown.slice(hidden).map((row) => (
                <StepRow key={row.id} row={row} />
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {waiting?.approval ? <ApprovalCard approval={waiting.approval} site={sites.at(-1)} handlers={handlers} /> : null}
    </div>
  );
}

function StepRow({ row }: { row: Row }) {
  const Icon = row.state === "blocked" ? ShieldAlert : row.state === "waiting" ? ShieldCheck : (ICONS[row.action] ?? MousePointerClick);
  const tone =
    row.state === "blocked" || row.state === "failed" || row.state === "declined"
      ? "text-muted-foreground"
      : row.state === "running" || row.state === "approved"
        ? "text-foreground"
        : "text-foreground/85";
  return (
    <li className="text-[0.8rem]">
      <div className={cn("flex items-start gap-2", tone)}>
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", row.state === "blocked" ? "text-brass" : row.state === "running" ? "text-brand" : "text-subtle")} />
        <span className={cn("min-w-0 flex-1 leading-snug", (row.state === "running" || row.state === "approved") && "text-shimmer")}>{row.label}</span>
        {row.state === "done" ? <Check className="mt-0.5 size-3.5 shrink-0 text-brand/70" /> : row.state === "failed" || row.state === "declined" ? <X className="mt-0.5 size-3.5 shrink-0 text-subtle" /> : null}
      </div>
      {row.problem ? <p className="mt-0.5 ml-5.5 text-[0.75rem] leading-snug text-muted-foreground">{row.problem}</p> : null}
    </li>
  );
}

/** The moment of commitment: what is about to happen, and the user's yes or no. */
function ApprovalCard({ approval, site, handlers }: { approval: { id: string; reason: string }; site?: string; handlers: WidgetHandlers }) {
  const [sent, setSent] = React.useState<"yes" | "no" | null>(null);
  const answer = (approved: boolean) => {
    if (sent) return;
    setSent(approved ? "yes" : "no");
    handlers.onApproval?.(approval.id, approved);
  };
  return (
    <section className="mt-2 w-full animate-rise overflow-hidden rounded-2xl border border-brand/30 bg-card shadow-card" aria-live="polite">
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ShieldCheck className="size-[1.1rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.95rem] leading-6 font-medium tracking-tight">Approve this step?</h3>
          <p className="mt-0.5 text-[0.88rem] leading-relaxed text-foreground/90">{approval.reason}</p>
          <p className="mt-1 text-[0.78rem] leading-snug text-muted-foreground">
            {site ? `On ${site}. ` : ""}The button I am about to press is marked in the live browser. Nothing happens until you say yes.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-4 sm:px-5">
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={sent !== null}
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          <Check className="size-4" strokeWidth={2.5} />
          Approve
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={sent !== null}
          className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <X className="size-4 text-muted-foreground" />
          Decline
        </button>
        {handlers.onOpenBrowser ? (
          <button type="button" onClick={handlers.onOpenBrowser} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[0.85rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <MonitorPlay className="size-4" />
            Show me
          </button>
        ) : null}
      </div>
    </section>
  );
}

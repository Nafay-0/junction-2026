"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, PanelLeft, Plus, Sun } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";
import { useHydrated } from "@/lib/use-client";
import type { RunStats } from "@/lib/agent/models";
import { EMPTY_USAGE } from "@/lib/agent/models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatsBreakdown, exaCallCount, fmtUsd, totalCost, totalTokens } from "./message";

/** Add up the stats of every answer in the conversation. */
export function sumStats(all: Array<RunStats | undefined>): RunStats | null {
  const done = all.filter((s): s is RunStats => !!s && s.durationMs !== undefined);
  if (done.length === 0) return null;
  const add = (a = EMPTY_USAGE, b = EMPTY_USAGE) => ({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  });
  const labels = [...new Set(done.map((s) => s.modelLabel))];
  return done.reduce<RunStats>(
    (acc, s) => ({
      ...acc,
      durationMs: (acc.durationMs ?? 0) + (s.durationMs ?? 0),
      steps: (acc.steps ?? 0) + (s.steps ?? 0),
      usage: add(acc.usage, s.usage),
      llmCostUsd: (acc.llmCostUsd ?? 0) + (s.llmCostUsd ?? 0),
      workerUsage: add(acc.workerUsage, s.workerUsage),
      workerCostUsd: (acc.workerCostUsd ?? 0) + (s.workerCostUsd ?? 0),
      exaCostUsd: (acc.exaCostUsd ?? 0) + (s.exaCostUsd ?? 0),
      exaCalls: {
        search: (acc.exaCalls?.search ?? 0) + (s.exaCalls?.search ?? 0),
        contents: (acc.exaCalls?.contents ?? 0) + (s.exaCalls?.contents ?? 0),
        agent: (acc.exaCalls?.agent ?? 0) + (s.exaCalls?.agent ?? 0),
        answer: (acc.exaCalls?.answer ?? 0) + (s.exaCalls?.answer ?? 0),
      },
      contextTrimmed: acc.contextTrimmed || s.contextTrimmed,
    }),
    { modelId: done[0].modelId, modelLabel: labels.length === 1 ? labels[0] : "Models", startedAt: done[0].startedAt, durationMs: 0 },
  );
}

export function TopBar({
  stats,
  onNewChat,
  showNew,
  sidebarOpen,
  onToggleSidebar,
}: {
  stats: RunStats | null;
  onNewChat: () => void;
  showNew: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  // Nothing on the right yet (a new conversation): the name has all the room it needs.
  const roomy = !stats && !showNew;
  /*
   * Sized to the chat column, not to the window: beside the live browser the column can be 380
   * pixels wide on a large screen. Nothing here wraps. As the column narrows, things step out in
   * this order: the Exa count, the token count, the "New task" label, the name. The cost, the
   * theme switch and the conversation list button always stay.
   */
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-transparent bg-background/80 px-3 whitespace-nowrap backdrop-blur-xl @min-[480px]/chat:px-4">
      {/* When the list is open it carries its own close button; on phones it is a drawer, so the toggle stays. */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Close the conversation list" : "Open the conversation list"}
        aria-expanded={sidebarOpen}
        className={`flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${sidebarOpen ? "md:hidden" : ""}`}
      >
        <PanelLeft className="size-[1.1rem]" />
      </button>
      <button type="button" onClick={onNewChat} className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}: start over`}>
        <Logo size={32} className="rounded-[0.6rem] shadow-card" />
        <span className={`font-display text-[1.45rem] leading-none tracking-tight ${roomy ? "" : "hidden @min-[360px]/chat:inline"}`}>{APP_NAME}</span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {stats ? <UsageMeter stats={stats} /> : null}
        {showNew ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNewChat}
                aria-label="New task"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-4" />
                <span className="hidden @min-[410px]/chat:inline">New task</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Start a new task</TooltipContent>
          </Tooltip>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}

function UsageMeter({ stats }: { stats: RunStats }) {
  const tokens = totalTokens(stats);
  const calls = exaCallCount(stats);
  return (
    <Popover>
      <PopoverTrigger
        className="nums flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-[0.75rem] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
        aria-label="Usage for this conversation"
      >
        <span className="font-medium text-foreground">{fmtUsd(totalCost(stats))}</span>
        <span className="hidden text-border @min-[520px]/chat:inline">|</span>
        <span className="hidden @min-[520px]/chat:inline">{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens</span>
        <span className="hidden text-border @min-[590px]/chat:inline">|</span>
        <span className="hidden @min-[590px]/chat:inline">{calls} Exa</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 text-[0.8rem]">
        <StatsBreakdown stats={stats} title="This conversation" />
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = useHydrated() && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {dark ? <Sun className="size-[1.05rem]" /> : <Moon className="size-[1.05rem]" />}
    </button>
  );
}

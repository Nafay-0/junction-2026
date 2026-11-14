"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMode } from "@/lib/agent/modes";
import { SPEND_LABELS, exaCallCount, hasFigures, isVoice, summarise, totalSpend, type RunStats, type Spend, type UsageSummary } from "@/lib/agent/stats";
import { useUser } from "@/lib/auth/client";
import type { Source } from "@/lib/widgets/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SourceChips } from "@/components/widgets/frame";
import { CopyAction, IconAction } from "./icon-action";
import { ModeIcon } from "./mode-icon";

/*
 * What an answer says about itself, and what a conversation adds up to. The interface names the
 * mode an answer ran in, never the model behind it. What it used and cost is grouped by kind
 * (the models that answer and help, Exa, voice, and the checks sift makes) and is shown only to
 * an account the admin lets see its usage.
 */

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
export const fmtUsd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(n < 1 ? 3 : 2)}`);

const Dot = () => <span className="text-border">·</span>;

/**
 * One quiet line under each answer: copy it, ask again, then the mode it ran in and how long it
 * took, and, for an account that may see usage, what it used and cost. An answer that was stopped
 * has no figures, only the actions.
 */
export function RunFooter({ stats, sources, copy, onRetry, busy }: { stats?: RunStats; sources: Source[]; copy: string; onRetry?: () => void; busy?: boolean }) {
  const { showUsage } = useUser();
  const seconds = (stats?.durationMs ?? 0) / 1000;
  const usage = summarise(stats);
  const calls = exaCallCount(usage.exaCalls);
  // Old answers, and the answers of an account that may not see usage, carry no figures.
  const figures = showUsage && hasFigures(stats);
  const mode = stats ? (isVoice(stats) ? "voice" : stats.mode) : undefined;
  const line = stats ? (
    <>
      {mode ? (
        <>
          <span className="inline-flex items-center gap-1">
            <ModeIcon mode={mode} className="size-3" />
            {mode === "voice" ? "Voice" : getMode(mode).label}
          </span>
          <Dot />
        </>
      ) : null}
      <span>{seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s</span>
      {figures && calls > 0 ? (
        <>
          <Dot />
          <span>
            {calls} Exa {calls === 1 ? "call" : "calls"}
          </span>
        </>
      ) : null}
      {figures ? (
        <>
          <Dot />
          <span>{fmtUsd(totalSpend(usage.spend))}</span>
        </>
      ) : null}
    </>
  ) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className="-ml-1.5 flex items-center gap-0.5">
          {copy ? <CopyAction text={copy} label="Copy answer" /> : null}
          {onRetry ? (
            <IconAction label={busy ? "Wait for the answer to finish, or stop it, to try again" : "Try again"} disabled={busy} onClick={onRetry}>
              <RotateCw />
            </IconAction>
          ) : null}
        </div>
        {stats && figures ? (
          <Popover>
            <PopoverTrigger className="nums flex flex-wrap items-center gap-x-1.5 rounded-md text-left text-[0.72rem] text-subtle transition-colors hover:text-muted-foreground" aria-label="What this answer used">
              {line}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0 text-[0.8rem]">
              <UsageBreakdown usage={usage} />
            </PopoverContent>
          </Popover>
        ) : stats ? (
          <span className="nums flex flex-wrap items-center gap-x-1.5 text-[0.72rem] text-subtle">{line}</span>
        ) : null}
      </div>
      {sources.length > 0 ? <SourceChips sources={sources} max={5} /> : null}
    </div>
  );
}

/**
 * What an answer, or a whole conversation, used: the cost by kind, with the counts behind each.
 * Kinds that were not used are left out.
 */
export function UsageBreakdown({ usage, title }: { usage: UsageSummary; title?: string }) {
  const { spend, llmTokens, voiceTokens, exaCalls: c } = usage;
  const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
  const detail: Record<keyof Spend, string> = {
    llm: `${fmtTokens(llmTokens.in)} tokens in, ${fmtTokens(llmTokens.out)} out${llmTokens.cached ? `, ${fmtTokens(llmTokens.cached)} from cache` : ""}`,
    exa: [count(c.search, "search", "searches"), count(c.contents, "page read", "page reads"), count(c.agent, "live lookup", "live lookups"), count(c.answer, "answer", "answers")].filter(Boolean).join(", "),
    voice: `${fmtTokens(voiceTokens.in)} tokens heard, ${fmtTokens(voiceTokens.out)} spoken`,
    decisions: count(usage.decisionCalls, "round of checks", "rounds of checks"),
  };
  const used: Record<keyof Spend, boolean> = {
    llm: llmTokens.in + llmTokens.out > 0 || spend.llm > 0,
    exa: exaCallCount(c) > 0 || spend.exa > 0,
    voice: voiceTokens.in + voiceTokens.out > 0 || spend.voice > 0,
    decisions: usage.decisionCalls > 0 || spend.decisions > 0,
  };
  const rows = SPEND_LABELS.filter(({ key }) => used[key]);
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2.5">
        <span className="font-medium">{title ?? "This answer"}</span>
        <span className="nums font-medium">{fmtUsd(totalSpend(spend))}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(({ key, label }) => (
          <li key={key} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{label}</span>
              <span className="nums text-muted-foreground">{fmtUsd(spend[key])}</span>
            </div>
            {detail[key] ? <div className="nums mt-0.5 text-[0.72rem] text-subtle">{detail[key]}</div> : null}
          </li>
        ))}
      </ul>
      <p className={cn("border-t border-border px-3 py-2 text-[0.7rem] leading-snug text-subtle")}>
        {usage.steps ? `${usage.steps} ${usage.steps === 1 ? "step" : "steps"}. ` : ""}
        Costs are estimates at list prices.
        {usage.contextTrimmed ? " Older results were set aside to keep a long conversation going." : ""}
      </p>
    </div>
  );
}

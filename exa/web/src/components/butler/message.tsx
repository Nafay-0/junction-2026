"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ButlerMessage } from "@/lib/agent/tools";
import type { RunStats } from "@/lib/agent/models";
import type { ClarifyAnswer, PlanData, PlanStep, Source } from "@/lib/widgets/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SourceChips, dedupeSources } from "@/components/widgets/frame";
import { Plan } from "@/components/widgets/plan";
import { ActivityGroup, ReasoningBlock } from "./activity";
import { Markdown } from "./markdown";
import { ACTIVITY_TOOLS, ToolWidget, isToolPart, type ToolPart } from "./tool-part";

export function UserMessage({ message }: { message: ButlerMessage }) {
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");
  const images = message.parts.filter((p) => p.type === "file" && p.mediaType?.startsWith("image/"));
  return (
    <div className="flex animate-rise flex-col items-end gap-2">
      {images.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((p, i) =>
            p.type === "file" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p.url} alt={p.filename ?? "Attached image"} className="max-h-48 max-w-[16rem] rounded-xl border border-border object-cover shadow-card" />
            ) : null,
          )}
        </div>
      ) : null}
      {text ? (
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
          {text}
        </div>
      ) : null}
    </div>
  );
}

type Block =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; text: string; streaming: boolean }
  | { kind: "activity"; key: string; parts: ToolPart[] }
  | { kind: "widget"; key: string; part: ToolPart };

function planFrom(part: ToolPart | undefined): PlanData | null {
  if (!part) return null;
  if (part.state === "output-available") return part.output as PlanData;
  const steps = ((part.input as { steps?: Array<Partial<PlanStep>> } | undefined)?.steps ?? []).filter(
    (s): s is PlanStep => typeof s?.title === "string" && (s.status === "pending" || s.status === "active" || s.status === "done"),
  );
  return steps.length ? { kind: "plan", steps } : null;
}

export function AssistantMessage({
  message,
  active,
  onAnswer,
}: {
  message: ButlerMessage;
  /** True while this message is still being generated. */
  active: boolean;
  onAnswer: (toolCallId: string, answer: ClarifyAnswer) => void;
}) {
  const { blocks, plan, sources } = React.useMemo(() => {
    const out: Block[] = [];
    const collected: Source[] = [];
    let planPart: ToolPart | undefined;
    message.parts.forEach((part, index) => {
      const key = `${message.id}-${index}`;
      if (part.type === "text") {
        if (part.text.trim()) out.push({ kind: "text", key, text: part.text, streaming: part.state === "streaming" });
        return;
      }
      if (part.type === "reasoning") {
        out.push({ kind: "reasoning", key, text: part.text, streaming: part.state === "streaming" });
        return;
      }
      if (!isToolPart(part)) return;
      if (part.state === "output-available") {
        const s = (part.output as { sources?: Source[] } | undefined)?.sources;
        if (Array.isArray(s)) collected.push(...s);
      }
      if (part.type === "tool-updatePlan") {
        planPart = part;
        return;
      }
      if (ACTIVITY_TOOLS.has(part.type)) {
        const last = out.at(-1);
        if (last?.kind === "activity") last.parts.push(part);
        else out.push({ kind: "activity", key, parts: [part] });
        return;
      }
      out.push({ kind: "widget", key: part.toolCallId, part });
    });
    // Keep only the latest reasoning line per stretch: several short ones in a row read as noise.
    const compact = out.filter((b, i) => !(b.kind === "reasoning" && !b.streaming && out[i + 1]?.kind === "reasoning"));
    return { blocks: compact, plan: planFrom(planPart), sources: dedupeSources(collected) };
  }, [message]);

  const stats = message.metadata;
  const finished = !active && stats?.durationMs !== undefined;
  const nothingYet = blocks.length === 0 && !plan;

  return (
    <div className="flex flex-col gap-3.5">
      {plan ? <Plan data={plan} loading={active} /> : null}
      {blocks.map((block) => {
        switch (block.kind) {
          case "text":
            return (
              <div key={block.key} className="animate-fade">
                <Markdown streaming={active && block.streaming}>{block.text}</Markdown>
              </div>
            );
          case "reasoning":
            return <ReasoningBlock key={block.key} text={block.text} streaming={active && block.streaming} />;
          case "activity":
            return <ActivityGroup key={block.key} parts={block.parts} />;
          case "widget":
            return <ToolWidget key={block.key} part={block.part} onAnswer={onAnswer} />;
        }
      })}
      {active && nothingYet ? <WorkingLine /> : null}
      {finished ? <RunFooter stats={stats!} sources={sources} /> : null}
    </div>
  );
}

export function WorkingLine({ label = "On it" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[0.85rem] text-muted-foreground">
      <span className="size-1.5 animate-pulse-dot rounded-full bg-brand" />
      <span className="text-shimmer">{label}</span>
    </div>
  );
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
export const fmtUsd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(n < 1 ? 3 : 2)}`);

export function totalCost(stats: RunStats | undefined): number {
  return (stats?.llmCostUsd ?? 0) + (stats?.workerCostUsd ?? 0) + (stats?.exaCostUsd ?? 0);
}

export function totalTokens(stats: RunStats | undefined): number {
  const u = stats?.usage;
  const w = stats?.workerUsage;
  return (u ? u.inputTokens + u.outputTokens : 0) + (w ? w.inputTokens + w.outputTokens : 0);
}

export function exaCallCount(stats: RunStats | undefined): number {
  const c = stats?.exaCalls;
  return c ? c.search + c.contents + c.agent + c.answer : 0;
}

/** One quiet line under each answer: which model, how long, what it cost, and where the facts came from. */
function RunFooter({ stats, sources }: { stats: RunStats; sources: Source[] }) {
  const seconds = (stats.durationMs ?? 0) / 1000;
  const exaCalls = exaCallCount(stats);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-0.5">
      <Popover>
        <PopoverTrigger className="nums flex flex-wrap items-center gap-x-1.5 rounded-md text-left text-[0.72rem] text-subtle transition-colors hover:text-muted-foreground">
          <span>{stats.modelLabel}</span>
          <Dot />
          <span>{seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s</span>
          {exaCalls > 0 ? (
            <>
              <Dot />
              <span>
                {exaCalls} Exa {exaCalls === 1 ? "call" : "calls"}
              </span>
            </>
          ) : null}
          <Dot />
          <span>{fmtUsd(totalCost(stats))}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0 text-[0.8rem]">
          <StatsBreakdown stats={stats} />
        </PopoverContent>
      </Popover>
      {sources.length > 0 ? <SourceChips sources={sources} max={5} /> : null}
    </div>
  );
}

const Dot = () => <span className="text-border">·</span>;

export function StatsBreakdown({ stats, title }: { stats: RunStats; title?: string }) {
  const u = stats.usage;
  const w = stats.workerUsage;
  const c = stats.exaCalls;
  const rows: Array<[string, string, string?]> = [];
  if (u) {
    rows.push([
      stats.modelLabel,
      fmtUsd(stats.llmCostUsd ?? 0),
      `${fmtTokens(u.inputTokens)} in, ${fmtTokens(u.outputTokens)} out${u.cacheReadTokens ? `, ${fmtTokens(u.cacheReadTokens)} cached` : ""}`,
    ]);
  }
  if (w && w.inputTokens + w.outputTokens > 0) {
    rows.push(["Sub-agents and helpers", fmtUsd(stats.workerCostUsd ?? 0), `${fmtTokens(w.inputTokens)} in, ${fmtTokens(w.outputTokens)} out`]);
  }
  if (c && exaCallCount(stats) > 0) {
    const parts = [c.search ? `${c.search} search` : "", c.contents ? `${c.contents} contents` : "", c.agent ? `${c.agent} agent` : ""].filter(Boolean).join(", ");
    rows.push(["Exa", fmtUsd(stats.exaCostUsd ?? 0), parts]);
  }
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2.5">
        <span className="font-medium">{title ?? "This answer"}</span>
        <span className="nums font-medium">{fmtUsd(totalCost(stats))}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(([label, cost, detail]) => (
          <li key={label} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{label}</span>
              <span className="nums text-muted-foreground">{cost}</span>
            </div>
            {detail ? <div className="nums mt-0.5 text-[0.72rem] text-subtle">{detail}</div> : null}
          </li>
        ))}
      </ul>
      <p className={cn("border-t border-border px-3 py-2 text-[0.7rem] leading-snug text-subtle")}>
        {stats.steps ? `${stats.steps} model ${stats.steps === 1 ? "step" : "steps"}. ` : ""}
        Model cost is an estimate at list prices.
        {stats.contextTrimmed ? " Older tool results were trimmed from the model's context to stay within its window." : ""}
      </p>
    </div>
  );
}

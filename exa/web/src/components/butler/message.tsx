"use client";

import * as React from "react";
import { ArrowUp, Pencil, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ButlerMessage } from "@/lib/agent/tools";
import type { RunStats } from "@/lib/agent/models";
import type { PlanData, PlanStep, Source } from "@/lib/widgets/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SourceChips, dedupeSources } from "@/components/widgets/frame";
import { Plan } from "@/components/widgets/plan";
import { ActivityGroup, ReasoningBlock } from "./activity";
import { BROWSER_TOOLS, BrowserSteps } from "./browser-steps";
import { CopyAction, IconAction } from "./icon-action";
import { Markdown } from "./markdown";
import { ACTIVITY_TOOLS, ToolWidget, isToolPart, type ToolPart, type WidgetHandlers } from "./tool-part";

export function UserMessage({
  message,
  onEdit,
  busy,
  hasLater,
}: {
  message: ButlerMessage;
  /** Replace this message with new text and send it again. Everything after it is dropped. */
  onEdit?: (text: string) => void;
  /** The agent is working: editing waits until it has finished or been stopped. */
  busy?: boolean;
  /** There are messages after this one, which a resend will replace. */
  hasLater?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");
  const images = message.parts.filter((p) => p.type === "file" && p.mediaType?.startsWith("image/"));
  return (
    // The negative margin gives back the room the action row takes, so messages keep their rhythm.
    <div className={cn("group/user flex animate-rise flex-col items-end gap-2", !editing && "-mb-5")}>
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
      {editing ? (
        <EditBox
          initial={text}
          hasLater={hasLater}
          allowEmpty={images.length > 0}
          onCancel={() => setEditing(false)}
          onSubmit={(next) => {
            setEditing(false);
            onEdit?.(next);
          }}
        />
      ) : (
        <>
          {text ? (
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-secondary-foreground">
              {text}
            </div>
          ) : null}
          {/* Shown on hover or keyboard focus; always visible on touch screens, which have no hover. */}
          <div className="-mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/user:opacity-100 group-hover/user:opacity-100 [@media(hover:none)]:opacity-100">
            {text ? <CopyAction text={text} label="Copy message" /> : null}
            {onEdit ? (
              <IconAction label={busy ? "Wait for the answer to finish, or stop it, to edit" : "Edit and resend"} disabled={busy} onClick={() => setEditing(true)}>
                <Pencil />
              </IconAction>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** The message turned into a text box: Enter resends, Shift+Enter adds a line, Escape cancels. */
function EditBox({
  initial,
  hasLater,
  allowEmpty,
  onCancel,
  onSubmit,
}: {
  initial: string;
  hasLater?: boolean;
  /** The message has an image, so it can be sent without text. */
  allowEmpty?: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };
  // Open with the caret at the end and the box sized to the text.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 || Boolean(allowEmpty);
  const submit = () => {
    if (canSend) onSubmit(trimmed);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="w-full animate-fade rounded-2xl border border-ring/50 bg-card p-2 shadow-card ring-3 ring-ring/15 sm:max-w-[88%]"
    >
      <textarea
        ref={ref}
        value={value}
        rows={1}
        aria-label="Edit your message"
        onChange={(e) => {
          setValue(e.target.value);
          fit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="block w-full resize-none bg-transparent px-2 pt-1.5 pb-1 text-base leading-relaxed outline-none placeholder:text-subtle sm:text-[0.95rem]"
      />
      <div className="mt-1 flex items-center justify-between gap-3 pl-2">
        <p className="min-w-0 truncate text-[0.72rem] text-subtle">{hasLater ? "Replaces everything below" : "Enter to resend"}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onCancel} className="h-8 rounded-full px-3 text-[0.82rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSend}
            className="flex h-8 items-center gap-1.5 rounded-full bg-primary pr-3 pl-2.5 text-[0.82rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          >
            <ArrowUp className="size-3.5" strokeWidth={2.5} />
            Resend
          </button>
        </div>
      </div>
    </form>
  );
}

type Block =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; text: string; streaming: boolean }
  | { kind: "activity"; key: string; parts: ToolPart[] }
  | { kind: "browser"; key: string; parts: ToolPart[] }
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
  handlers,
  onRetry,
  busy,
  spoken,
}: {
  message: ButlerMessage;
  /** In a live call's own view: the words were spoken aloud, so only what was put on screen is shown. */
  spoken?: boolean;
  /** True while this message is still being generated. */
  active: boolean;
  handlers: WidgetHandlers;
  /** Answer again from the same request. This answer and everything after it is dropped. */
  onRetry?: () => void;
  /** The agent is working somewhere in the conversation: retrying waits. */
  busy?: boolean;
}) {
  const { blocks, plan, sources, copy } = React.useMemo(() => {
    const out: Block[] = [];
    const collected: Source[] = [];
    // What "copy" puts on the clipboard: the answer as written, plus a research report if there is one.
    const written: string[] = [];
    let planPart: ToolPart | undefined;
    message.parts.forEach((part, index) => {
      const key = `${message.id}-${index}`;
      if (part.type === "text") {
        if (part.text.trim()) {
          out.push({ kind: "text", key, text: part.text, streaming: part.state === "streaming" });
          written.push(part.text.trim());
        }
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
        if (part.type === "tool-deepResearch") {
          const research = part.output as { question?: string; report?: string } | undefined;
          if (research?.report?.trim()) written.push(`${research.question ? `# ${research.question}\n\n` : ""}${research.report.trim()}`);
        }
      }
      if (part.type === "tool-updatePlan") {
        planPart = part;
        return;
      }
      if (BROWSER_TOOLS.has(part.type)) {
        // Steps in the live browser read as one trail, however many there are. The model thinks
        // between steps; those thoughts would chop the trail into single steps, so they give way.
        let i = out.length - 1;
        while (i >= 0 && out[i].kind === "reasoning") i -= 1;
        const prior = i >= 0 ? out[i] : undefined;
        if (prior?.kind === "browser") {
          out.length = i + 1;
          prior.parts.push(part);
        } else out.push({ kind: "browser", key, parts: [part] });
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
    return { blocks: compact, plan: planFrom(planPart), sources: dedupeSources(collected), copy: written.join("\n\n") };
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
            if (spoken) return null;
            return (
              <div key={block.key} className="animate-fade">
                <Markdown streaming={active && block.streaming}>{block.text}</Markdown>
              </div>
            );
          case "reasoning":
            return <ReasoningBlock key={block.key} text={block.text} streaming={active && block.streaming} />;
          case "activity":
            return <ActivityGroup key={block.key} parts={block.parts} />;
          case "browser":
            return <BrowserSteps key={block.key} parts={block.parts} active={active} handlers={handlers} />;
          case "widget":
            return <ToolWidget key={block.key} part={block.part} handlers={handlers} />;
        }
      })}
      {active && nothingYet && !spoken ? <WorkingLine /> : null}
      {!active && !nothingYet && !spoken ? <RunFooter stats={finished ? stats : undefined} sources={sources} copy={copy} onRetry={onRetry} busy={busy} /> : null}
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

/**
 * One quiet line under each answer: copy it, ask again, then which model, how long, what it cost,
 * and where the facts came from. An answer that was stopped has no figures, only the actions.
 */
function RunFooter({
  stats,
  sources,
  copy,
  onRetry,
  busy,
}: {
  stats?: RunStats;
  sources: Source[];
  copy: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const seconds = (stats?.durationMs ?? 0) / 1000;
  const exaCalls = exaCallCount(stats);
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
        {stats ? (
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
        ) : null}
      </div>
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

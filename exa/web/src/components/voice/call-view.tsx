"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Keyboard, MessagesSquare, Mic, MicOff, PhoneOff, AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import type { ButlerMessage } from "@/lib/agent/tools";
import { spokenSoFar, type CallSnapshot } from "@/lib/voice/live-call";
import { LIVE_MODEL } from "@/lib/voice/models";
import { liveCall } from "@/lib/voice/use-call";
import { AssistantMessage } from "@/components/butler/message";
import type { WidgetHandlers } from "@/components/butler/tool-part";
import { Orb } from "./orb";

const EASE = [0.22, 1, 0.36, 1] as const;

const STATUS: Record<CallSnapshot["status"], string> = {
  idle: "",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  reconnecting: "Reconnecting",
};

/** "3:07", from when the call began. */
function useElapsed(startedAt: number): string {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The last couple of sentences of a long stretch of speech: a caption, not a transcript. */
function tail(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(clean.length - max);
  const sentence = cut.search(/[.!?…]\s+\S/);
  return sentence >= 0 && sentence < max * 0.6 ? cut.slice(sentence + 2) : `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

/** What the agent is saying, appearing word by word as it is heard rather than all at once before it. */
function useSpokenCaption(saying: string, speaking: boolean): string {
  const [shown, setShown] = React.useState("");
  React.useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const next = spokenSoFar(saying, liveCall.spokenShare());
      if (next !== last) {
        last = next;
        setShown(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [saying, speaking]);
  return shown;
}

/**
 * A live call: in place of the conversation and the message box while the user is talking with
 * the agent. The stone shows who has the floor, the words appear under it as they are spoken, and
 * whatever the agent's tools find is laid out below as it arrives, the same cards and maps the
 * conversation would show. Everything here is also written into the conversation itself.
 */
export function CallView({
  call,
  messages,
  handlers,
  onShowConversation,
}: {
  call: CallSnapshot;
  messages: ButlerMessage[];
  handlers: WidgetHandlers;
  onShowConversation: () => void;
}) {
  const elapsed = useElapsed(call.startedAt);
  const caption = useSpokenCaption(call.saying, call.status === "speaking");
  const [typing, setTyping] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  // What the agent has put on screen during this call: its answers that carry more than words.
  const shown = React.useMemo(
    () => messages.filter((m) => m.role === "assistant" && m.metadata?.modelId === LIVE_MODEL.id && (m.metadata?.startedAt ?? 0) >= call.startedAt - 1000 && m.parts.some((p) => p.type.startsWith("tool-"))),
    [messages, call.startedAt],
  );
  // The stone keeps the stage while the agent is only searching or reading: a line that says
  // "searching" is not something to look at. It steps aside when there is something to see.
  const hasResults = shown.some((m) => m.parts.some((p) => p.type.startsWith("tool-") && p.type !== "tool-webSearch" && p.type !== "tool-readPages"));

  // The newest result is what the agent is talking about: bring its top into view when it arrives.
  const results = React.useRef<HTMLDivElement>(null);
  const count = shown.reduce((n, m) => n + m.parts.filter((p) => p.type.startsWith("tool-")).length, 0);
  React.useEffect(() => {
    const newest = results.current?.lastElementChild?.lastElementChild;
    if (newest) newest.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [count]);

  const working = call.working[0];
  const line =
    call.status === "connecting"
      ? "Connecting"
      : call.status === "reconnecting"
        ? "Reconnecting"
        : call.muted
          ? "You are muted"
          : working
            ? working
            : STATUS[call.status];
  const speaking = call.status === "speaking";

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    liveCall.sendText(text);
    setDraft("");
    setTyping(false);
  };

  const status = (
    <p className="flex min-w-0 items-center gap-2 text-[0.8rem] font-medium text-muted-foreground" aria-live="polite">
      <span className={cn("size-1.5 shrink-0 rounded-full", call.status === "listening" && !call.muted ? "bg-up" : speaking ? "bg-brand" : "animate-pulse-dot bg-brass")} />
      <span className={cn("truncate", (call.status === "thinking" || call.status === "connecting" || call.status === "reconnecting") && "text-shimmer")}>{line}</span>
      <span className="nums shrink-0 text-subtle">· {elapsed}</span>
    </p>
  );
  const stone = (size: "large" | "small") => (
    <button
      type="button"
      onClick={() => liveCall.interrupt()}
      aria-label={speaking ? `Stop ${APP_NAME} speaking` : `${APP_NAME} is ${line.toLowerCase()}`}
      className="shrink-0 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
    >
      <Orb status={call.status} muted={call.muted} size={size} />
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasResults ? (
        <>
          {/*
           * There is something to look at. The stone and the words move into a strip of their own
           * at the top, and what was found scrolls in its own space underneath: the two never
           * share a place on the screen, so neither can cover the other, whatever the width.
           */}
          <div className="shrink-0 border-b border-border/70 bg-background px-4">
            <div className="mx-auto flex w-full max-w-[760px] items-center gap-3.5 py-2.5">
              {stone("small")}
              <div className="min-w-0 flex-1">
                {status}
                {/*
                  * Two lines, always: the strip keeps its height while the words change, so nothing
                  * below it jumps. The text sits on the bottom edge, so the newest words are the
                  * ones in view and older ones leave by the top, as captions do.
                  */}
                <div className="mt-0.5 flex h-[2.6em] flex-col justify-end overflow-hidden text-[0.92rem] leading-[1.3] text-foreground" aria-live="polite">
                  <p>{caption ? tail(caption, 240) : call.heard ? <span className="text-muted-foreground">“{tail(call.heard, 130)}”</span> : null}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            <div ref={results} className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-5 px-4 pt-4 pb-10">
              {shown.map((message) => (
                <div key={message.id} className="min-w-0 scroll-mt-3 [&>div>*]:scroll-mt-3">
                  <AssistantMessage message={message} active={false} handlers={handlers} spoken />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Nothing to look at yet: the stone has the stage, with the words under it. */
        <div className="backdrop-room min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center px-5 py-8">
            {stone("large")}
            <div className="mt-10 flex justify-center">{status}</div>
            <div className="mt-4 flex min-h-[8rem] w-full max-w-[34rem] flex-col items-center gap-2.5 text-center" aria-live="polite">
              {call.heard ? <p className="animate-fade line-clamp-2 text-[0.92rem] leading-relaxed text-muted-foreground">“{tail(call.heard, 160)}”</p> : null}
              {caption ? (
                <p className="animate-fade text-[1.15rem] leading-relaxed text-balance text-foreground @min-[440px]/chat:text-[1.3rem]">{tail(caption)}</p>
              ) : !call.heard && call.status === "listening" && !call.muted ? (
                <p className="animate-fade text-[0.95rem] leading-relaxed text-subtle">Go ahead, I am listening. Speak in any language.</p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* The controls: large, at the bottom, where a thumb is. */}
      <div className="relative shrink-0">
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
        <div className="safe-bottom mx-auto w-full max-w-[760px] px-4 pt-1 pb-3">
          <AnimatePresence initial={false}>
            {typing ? (
              <motion.form
                key="type"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="overflow-hidden"
              >
                <div className="mb-3 flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-4 shadow-card focus-within:border-ring/60">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type something to say"
                    aria-label="Type something to say"
                    className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle sm:text-[0.95rem]"
                  />
                  <button type="submit" disabled={!draft.trim()} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30">
                    <ArrowUp className="size-[1.1rem]" strokeWidth={2.4} />
                  </button>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>

          <div className="flex items-end justify-center gap-4 @min-[380px]/chat:gap-5 @min-[440px]/chat:gap-7">
            <CallButton label="Chat" onClick={onShowConversation}>
              <MessagesSquare />
            </CallButton>
            <CallButton label={call.muted ? "Unmute" : "Mute"} pressed={call.muted} onClick={() => liveCall.setMuted(!call.muted)}>
              {call.muted ? <MicOff /> : <Mic />}
            </CallButton>
            <button
              type="button"
              onClick={() => liveCall.end()}
              aria-label="End the call"
              className="flex flex-col items-center gap-1.5 text-[0.7rem] font-medium text-muted-foreground outline-none"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-destructive text-white shadow-float transition-transform hover:scale-105 active:scale-95">
                <PhoneOff className="size-6" />
              </span>
              End
            </button>
            <CallButton label="Type" pressed={typing} onClick={() => setTyping((v) => !v)}>
              <Keyboard />
            </CallButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CallButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={label} className="flex flex-col items-center gap-1.5 text-[0.7rem] font-medium text-muted-foreground outline-none">
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color] hover:scale-105 active:scale-95 [&_svg]:size-[1.35rem]",
          pressed ? "border-transparent bg-foreground text-background" : "border-border bg-card text-foreground shadow-card hover:border-ring/50",
        )}
      >
        {children}
      </span>
      {label}
    </button>
  );
}

/**
 * The call, while the user is reading the conversation instead of looking at it: one slim row
 * above the message box that says the call is still on, with the way to mute it, end it, or go back.
 */
export function CallBar({ call, onShowCall }: { call: CallSnapshot; onShowCall: () => void }) {
  const elapsed = useElapsed(call.startedAt);
  const line = call.muted ? "Muted" : (call.working[0] ?? STATUS[call.status]);
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-full border border-brand/30 bg-card py-1.5 pr-1.5 pl-2 shadow-card">
      <button type="button" onClick={onShowCall} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none" aria-label="Back to the call">
        <Orb status={call.status} muted={call.muted} size="small" className="!size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.82rem] leading-4 font-medium">Live call · {elapsed}</span>
          <span className={cn("block truncate text-[0.74rem] leading-4 text-muted-foreground", call.status === "thinking" && "text-shimmer")}>{line}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => liveCall.setMuted(!call.muted)}
        aria-pressed={call.muted}
        aria-label={call.muted ? "Unmute" : "Mute"}
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full transition-colors", call.muted ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      </button>
      <button type="button" onClick={onShowCall} aria-label="Back to the call" className="hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @min-[440px]/chat:flex">
        <AudioLines className="size-4" />
        Live
      </button>
      <button type="button" onClick={() => liveCall.end()} aria-label="End the call" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive text-white transition-transform hover:scale-105 active:scale-95">
        <PhoneOff className="size-4" />
      </button>
    </div>
  );
}

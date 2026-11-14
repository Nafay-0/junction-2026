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
  const hasResults = shown.length > 0;

  // The newest result is what the agent is talking about: keep it in view as results arrive.
  const scroller = React.useRef<HTMLDivElement>(null);
  const count = shown.reduce((n, m) => n + m.parts.length, 0);
  React.useEffect(() => {
    const el = scroller.current;
    if (el && hasResults) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, hasResults]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain", !hasResults && "backdrop-room")}>
        <div className={cn("mx-auto flex w-full max-w-[760px] flex-col items-center px-4", hasResults ? "pt-3 pb-6" : "min-h-full justify-center pt-6 pb-10")}>
          {/* The stone. Large while there is nothing else to look at; small and out of the way once results arrive. */}
          <motion.div layout transition={{ duration: 0.45, ease: EASE }} className={cn("flex items-center", hasResults ? "sticky top-0 z-10 w-full gap-3 rounded-2xl bg-background/85 py-2 backdrop-blur-xl" : "flex-col")}>
            <button
              type="button"
              onClick={() => liveCall.interrupt()}
              aria-label={speaking ? `Stop ${APP_NAME} speaking` : `${APP_NAME} is ${line.toLowerCase()}`}
              className="rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
            >
              <Orb status={call.status} muted={call.muted} size={hasResults ? "small" : "large"} />
            </button>
            <div className={cn("min-w-0", hasResults ? "flex-1" : "mt-7 flex flex-col items-center text-center")}>
              <p className={cn("flex items-center gap-2 text-[0.8rem] font-medium text-muted-foreground", !hasResults && "justify-center")} aria-live="polite">
                <span className={cn("size-1.5 rounded-full", call.status === "listening" && !call.muted ? "bg-up" : speaking ? "bg-brand" : "animate-pulse-dot bg-brass")} />
                <span className={cn((call.status === "thinking" || call.status === "connecting" || call.status === "reconnecting") && "text-shimmer")}>{line}</span>
                <span className="nums text-subtle">· {elapsed}</span>
              </p>
              {hasResults ? <p className="mt-0.5 line-clamp-2 text-[0.92rem] leading-snug text-foreground">{caption ? tail(caption, 140) : call.heard ? <span className="text-muted-foreground">“{tail(call.heard, 120)}”</span> : null}</p> : null}
            </div>
          </motion.div>

          {/* The words: what the user said, small, and under it what the agent is saying, as it says it. */}
          {!hasResults ? (
            <div className="mt-5 flex min-h-[8rem] w-full max-w-[34rem] flex-col items-center gap-2.5 text-center" aria-live="polite">
              {call.heard ? (
                <p key={`heard-${call.heard.length > 0}`} className="animate-fade line-clamp-2 text-[0.92rem] leading-relaxed text-muted-foreground">
                  “{tail(call.heard, 160)}”
                </p>
              ) : null}
              {caption ? (
                <p className="animate-fade text-[1.15rem] leading-relaxed text-balance text-foreground @min-[440px]/chat:text-[1.3rem]">{tail(caption)}</p>
              ) : !call.heard && call.status === "listening" && !call.muted ? (
                <p className="animate-fade text-[0.95rem] leading-relaxed text-subtle">Go ahead, I am listening. Speak in any language.</p>
              ) : null}
            </div>
          ) : null}

          {/* What the agent found, as it finds it. */}
          {hasResults ? (
            <div className="mt-3 flex w-full flex-col gap-5">
              {shown.map((message) => (
                <AssistantMessage key={message.id} message={message} active={false} handlers={handlers} spoken />
              ))}
            </div>
          ) : null}
        </div>
      </div>

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

          <div className="flex items-end justify-center gap-5 @min-[440px]/chat:gap-7">
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

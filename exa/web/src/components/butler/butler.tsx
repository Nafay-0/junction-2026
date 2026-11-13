"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { ArrowDown, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_MODEL_ID, getModel } from "@/lib/agent/models";
import type { ButlerMessage } from "@/lib/agent/tools";
import { useClientValue, useStored } from "@/lib/use-client";
import type { ClarifyAnswer } from "@/lib/widgets/types";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage, WorkingLine } from "./message";
import { TopBar, sumStats } from "./top-bar";
import { Welcome } from "./welcome";

/** A sensible default location from the browser's time zone, until the user sets one. */
const ZONES: Record<string, [place: string, country: string]> = {
  "Europe/Helsinki": ["Helsinki, Finland", "FI"],
  "Europe/Stockholm": ["Stockholm, Sweden", "SE"],
  "Europe/London": ["London, United Kingdom", "GB"],
  "Europe/Berlin": ["Berlin, Germany", "DE"],
  "Europe/Paris": ["Paris, France", "FR"],
  "Europe/Amsterdam": ["Amsterdam, Netherlands", "NL"],
  "Europe/Madrid": ["Madrid, Spain", "ES"],
  "Europe/Rome": ["Rome, Italy", "IT"],
  "Europe/Tallinn": ["Tallinn, Estonia", "EE"],
  "Europe/Oslo": ["Oslo, Norway", "NO"],
  "Europe/Copenhagen": ["Copenhagen, Denmark", "DK"],
  "America/New_York": ["New York, United States", "US"],
  "America/Los_Angeles": ["San Francisco, United States", "US"],
  "America/Chicago": ["Chicago, United States", "US"],
  "Asia/Karachi": ["Karachi, Pakistan", "PK"],
  "Asia/Kolkata": ["Bengaluru, India", "IN"],
  "Asia/Tokyo": ["Tokyo, Japan", "JP"],
  "Asia/Singapore": ["Singapore", "SG"],
  "Asia/Dubai": ["Dubai, United Arab Emirates", "AE"],
};

function defaultPlace(timeZone: string): string {
  return ZONES[timeZone]?.[0] ?? timeZone.split("/").pop()?.replace(/_/g, " ") ?? "";
}

/**
 * What each request sends along with the messages. Kept outside React so the transport, which is
 * created once, always reads the latest choice: switching model mid-conversation just works,
 * including when the chat resumes on its own after a clarifying question.
 */
const live = { modelId: DEFAULT_MODEL_ID, place: "", timeZone: "Europe/Helsinki" };

const transport = new DefaultChatTransport<ButlerMessage>({
  api: "/api/chat",
  body: () => ({ modelId: live.modelId, place: live.place, timeZone: live.timeZone, country: ZONES[live.timeZone]?.[1] }),
});

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Butler() {
  const [modelId, setModelId] = useStored("hovi.model", DEFAULT_MODEL_ID);
  const [place, setPlace] = useStored("hovi.place", "");
  const timeZone = useClientValue(browserTimeZone, "Europe/Helsinki");
  const effectivePlace = place || defaultPlace(timeZone);

  React.useEffect(() => {
    live.modelId = getModel(modelId).id;
    live.place = effectivePlace;
    live.timeZone = timeZone;
  }, [modelId, effectivePlace, timeZone]);

  const { messages, sendMessage, status, stop, error, regenerate, addToolOutput, setMessages, clearError } = useChat<ButlerMessage>({
    transport,
    // Resume on its own only after the user has answered a clarifying question.
    sendAutomaticallyWhen: ({ messages: all }) => {
      const last = all.at(-1);
      const tail = last?.role === "assistant" ? last.parts.at(-1) : undefined;
      return tail?.type === "tool-askUser" && tail.state === "output-available";
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;

  const send = React.useCallback(
    (text: string, files: FileUIPart[] = []) => {
      if (!text && files.length === 0) return;
      clearError();
      void sendMessage(files.length ? { text: text || "What is this? Find out more about it.", files } : { text });
    },
    [sendMessage, clearError],
  );

  const answer = React.useCallback(
    (toolCallId: string, output: ClarifyAnswer) => {
      void addToolOutput({ tool: "askUser", toolCallId, output });
    },
    [addToolOutput],
  );

  const newChat = React.useCallback(() => {
    void stop();
    clearError();
    setMessages([]);
  }, [stop, setMessages, clearError]);

  /* Keep the newest content in view while the agent works, unless the user has scrolled up to read. */
  const scroller = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);
  const toBottom = React.useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  React.useEffect(() => {
    if (stick.current) toBottom();
  }, [messages, status, toBottom]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = distance < 160;
    setShowJump(distance > 480);
  };

  const stats = React.useMemo(() => sumStats(messages.filter((m) => m.role === "assistant").map((m) => m.metadata)), [messages]);
  const last = messages.at(-1);
  const waitingForFirstToken = status === "submitted" && last?.role === "user";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TopBar stats={stats} onNewChat={newChat} showNew={!empty} />

      <div ref={scroller} onScroll={onScroll} className={cn("relative flex-1 overflow-y-auto overscroll-contain", empty && "backdrop-room")}>
        {empty ? (
          <Welcome place={effectivePlace} onPick={(prompt) => send(prompt)} />
        ) : (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 pt-4 pb-10">
            {messages.map((message, i) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage key={message.id} message={message} active={busy && i === messages.length - 1} onAnswer={answer} />
              ),
            )}
            {waitingForFirstToken ? <WorkingLine /> : null}
            {error ? (
              <div className="flex animate-rise items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[0.85rem]">
                <span className="text-destructive">{readable(error)}</span>
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    void regenerate();
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
                >
                  <RotateCw className="size-3.5" />
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="relative shrink-0">
        {showJump && !empty ? (
          <button
            type="button"
            onClick={() => {
              stick.current = true;
              toBottom(true);
            }}
            aria-label="Jump to the latest"
            className="absolute -top-12 left-1/2 flex size-9 -translate-x-1/2 animate-fade items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-float transition-colors hover:text-foreground"
          >
            <ArrowDown className="size-4" />
          </button>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
        <div className="safe-bottom mx-auto w-full max-w-[760px] px-3 sm:px-4">
          <Composer onSend={send} onStop={() => void stop()} busy={busy} modelId={modelId} onModelChange={setModelId} place={effectivePlace} onPlaceChange={setPlace} autoFocus />
          <p className="mt-2 hidden text-center text-[0.7rem] text-subtle sm:block">Searches the live web with Exa. Check important details at the source before you act.</p>
        </div>
      </div>
    </div>
  );
}

function readable(error: Error): string {
  const message = error.message || "";
  try {
    const parsed = JSON.parse(message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* not JSON */
  }
  return message.length > 0 && message.length < 200 ? message : "Something went wrong. Try again.";
}

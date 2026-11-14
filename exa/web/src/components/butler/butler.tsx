"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type FileUIPart } from "ai";
import { ArrowDown, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_MODEL_ID, getModel } from "@/lib/agent/models";
import type { ButlerMessage } from "@/lib/agent/tools";
import { control as browserControl, useBrowserId } from "@/lib/browser/client";
import type { HandoverAnswer } from "@/lib/browser/protocol";
import {
  deleteAllConversations,
  deleteConversation,
  loadMessages,
  newConversationId,
  persistConversation,
  renameConversation,
  retitleAfterEdit,
  useConversations,
} from "@/lib/conversations";
import { describe, locate, useExactLocation, type LocateResult } from "@/lib/location";
import { useClientValue, useMediaQuery, useStored } from "@/lib/use-client";
import type { ClarifyAnswer, ExactLocation, LocationAnswer } from "@/lib/widgets/types";
import { BrowserWorkspace, useBrowserLayout } from "@/components/browser/workspace";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage, WorkingLine } from "./message";
import { Sidebar } from "./sidebar";
import type { WidgetHandlers } from "./tool-part";
import { TopBar, sumStats } from "./top-bar";
import { Welcome } from "./welcome";

/** A sensible default place from the browser's time zone, until the user names one or shares their position. */
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

type Coords = Pick<ExactLocation, "lat" | "lng" | "accuracyM" | "label" | "country">;

/**
 * What each request sends along with the messages. Kept outside React so the transport, which is
 * created once, always reads the latest choice: switching model mid-conversation just works,
 * including when the chat resumes on its own after the user answers a question or shares a location.
 */
const live: { modelId: string; place: string; timeZone: string; coords?: Coords; locationDeclined: boolean; browserId: string } = {
  modelId: DEFAULT_MODEL_ID,
  place: "",
  timeZone: "Europe/Helsinki",
  locationDeclined: false,
  browserId: "",
};

const transport = new DefaultChatTransport<ButlerMessage>({
  api: "/api/chat",
  body: () => ({
    modelId: live.modelId,
    place: live.place,
    timeZone: live.timeZone,
    country: ZONES[live.timeZone]?.[1],
    coords: live.coords,
    locationDeclined: live.locationDeclined,
    browserId: live.browserId || undefined,
  }),
});

/**
 * The open conversation as it stands right now. The chat view can be mounted afresh while a
 * conversation is open (a code reload in development, a layout change); it then starts from here
 * instead of from what was loaded when the conversation was opened.
 */
const liveMessages = new Map<string, ButlerMessage[]>();

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const ACTIVE_KEY = "hovi.active";

function remember(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* storage blocked: the conversation is still saved, it just will not reopen on refresh */
  }
}

type Active = { id: string; messages: ButlerMessage[] };

/** The app shell: the conversation list on the left, the open conversation on the right. */
export function Butler() {
  const conversations = useConversations();
  const wide = useMediaQuery("(min-width: 768px)");
  const [sidebarPref, setSidebarPref] = useStored("hovi.sidebar", "open");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const sidebarOpen = wide ? sidebarPref === "open" : drawerOpen;

  const [active, setActive] = React.useState<Active | null>(null);

  // On first load, reopen the conversation that was open last, so a refresh loses nothing.
  React.useEffect(() => {
    let cancelled = false;
    let lastId: string | null = null;
    try {
      lastId = window.localStorage.getItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    void (lastId ? loadMessages(lastId) : Promise.resolve(null)).then((messages) => {
      if (cancelled) return;
      setActive(lastId && messages?.length ? { id: lastId, messages } : { id: newConversationId(), messages: [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const closeSidebar = React.useCallback(() => {
    if (wide) setSidebarPref("closed");
    else setDrawerOpen(false);
  }, [wide, setSidebarPref]);

  const toggleSidebar = React.useCallback(() => {
    if (wide) setSidebarPref(sidebarPref === "open" ? "closed" : "open");
    else setDrawerOpen((v) => !v);
  }, [wide, sidebarPref, setSidebarPref]);

  // The live browser opening beside the chat needs the width: on anything but a very wide screen,
  // the conversation list steps aside. The user can bring it back.
  const makeRoom = React.useCallback(() => {
    if (window.innerWidth < 1500) setSidebarPref("closed");
  }, [setSidebarPref]);

  const newTask = React.useCallback(() => {
    liveMessages.clear();
    const id = newConversationId();
    remember(id);
    setActive({ id, messages: [] });
    setDrawerOpen(false);
  }, []);

  const open = React.useCallback((id: string) => {
    setDrawerOpen(false);
    void loadMessages(id).then((messages) => {
      remember(id);
      liveMessages.clear();
      setActive({ id, messages: messages ?? [] });
    });
  }, []);

  const remove = React.useCallback(
    (id: string) => {
      void deleteConversation(id);
      if (active?.id === id) newTask();
    },
    [active?.id, newTask],
  );

  return (
    <div className="flex h-dvh bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        conversations={conversations}
        activeId={active?.id ?? null}
        onSelect={open}
        onNew={newTask}
        onRename={(id, title) => void renameConversation(id, title)}
        onDelete={remove}
        onDeleteAll={() => {
          void deleteAllConversations();
          newTask();
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          // Keyed by conversation: opening another one starts a fresh chat state with its own messages.
          <ChatView
            key={active.id}
            conversationId={active.id}
            initialMessages={active.messages}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            onNewTask={newTask}
            onBrowserBeside={makeRoom}
          />
        ) : null}
      </div>
    </div>
  );
}

function ChatView({
  conversationId,
  initialMessages,
  sidebarOpen,
  onToggleSidebar,
  onNewTask,
  onBrowserBeside,
}: {
  conversationId: string;
  initialMessages: ButlerMessage[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewTask: () => void;
  /** The live browser has opened beside the chat. */
  onBrowserBeside: () => void;
}) {
  const [modelId, setModelId] = useStored("hovi.model", DEFAULT_MODEL_ID);
  const [place, setPlace] = useStored("hovi.place", "");
  const timeZone = useClientValue(browserTimeZone, "Europe/Helsinki");
  const { location, declined, save: saveLocation, setDeclined } = useExactLocation();
  const approximatePlace = place || defaultPlace(timeZone);
  const modelLabel = getModel(modelId).label;
  const browserId = useBrowserId();

  React.useEffect(() => {
    live.modelId = getModel(modelId).id;
    live.place = approximatePlace;
    live.timeZone = timeZone;
    live.coords = location ? { lat: location.lat, lng: location.lng, accuracyM: location.accuracyM, label: location.label, country: location.country } : undefined;
    live.locationDeclined = declined;
    live.browserId = browserId;
  }, [modelId, approximatePlace, timeZone, location, declined, browserId]);

  const [seed] = React.useState(() => liveMessages.get(conversationId) ?? initialMessages);
  const { messages, sendMessage, status, stop, error, regenerate, addToolOutput, addToolApprovalResponse, clearError } = useChat<ButlerMessage>({
    id: conversationId,
    messages: seed,
    transport,
    // Resume on its own only after the user has answered something the agent asked: a question,
    // their location, a hand-over in the live browser, or an approval.
    sendAutomaticallyWhen: ({ messages: all }) => {
      const last = all.at(-1);
      const tail = last?.role === "assistant" ? last.parts.at(-1) : undefined;
      const answered = (tail?.type === "tool-askUser" || tail?.type === "tool-requestLocation" || tail?.type === "tool-requestUserAction") && tail.state === "output-available";
      return answered || lastAssistantMessageIsCompleteWithApprovalResponses({ messages: all });
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;

  /* Saving. Every change is written to this browser's storage: at once when the agent finishes,
     and every few seconds while it is still working, so a refresh mid-answer keeps what there was. */
  const baseline = React.useRef<ButlerMessage[] | null>(null);
  const latest = React.useRef(messages);
  const dirty = React.useRef(false);
  const lastSaved = React.useRef(0);
  const labelRef = React.useRef(modelLabel);
  const stopRef = React.useRef(stop);
  React.useEffect(() => {
    labelRef.current = modelLabel;
    stopRef.current = stop;
  }, [modelLabel, stop]);
  React.useEffect(() => {
    latest.current = messages;
    liveMessages.set(conversationId, messages);
    if (baseline.current === null) {
      baseline.current = messages;
      return;
    }
    if (messages === baseline.current || messages.length === 0) return;
    dirty.current = true;
    const settled = status === "ready" || status === "error";
    if (!settled && Date.now() - lastSaved.current < 3000) return;
    lastSaved.current = Date.now();
    void persistConversation(conversationId, messages, labelRef.current);
  }, [messages, status, conversationId]);
  // Leaving the conversation: stop any answer in progress and save what there is.
  React.useEffect(
    () => () => {
      void stopRef.current();
      if (dirty.current && latest.current.length > 0) void persistConversation(conversationId, latest.current, labelRef.current);
    },
    [conversationId],
  );

  /* Keep the newest content in view while the agent works, unless the user has scrolled up to read.
     Sending a message, or answering a card the agent showed, always brings the view back down. */
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
  const followLatest = React.useCallback(() => {
    stick.current = true;
    setShowJump(false);
    // The new message is in the list after the next paint.
    requestAnimationFrame(() => toBottom(true));
  }, [toBottom]);

  const send = React.useCallback(
    (text: string, files: FileUIPart[] = []) => {
      if (!text && files.length === 0) return;
      clearError();
      remember(conversationId);
      followLatest();
      void sendMessage(files.length ? { text: text || "What is this? Find out more about it.", files } : { text });
    },
    [sendMessage, clearError, conversationId, followLatest],
  );

  // Edit a message and send it again: it takes the place of the old one, and everything after it goes.
  const editAndResend = React.useCallback(
    (message: ButlerMessage, text: string) => {
      const files = message.parts.filter((p): p is FileUIPart => p.type === "file");
      if (!text && files.length === 0) return;
      const before = latest.current;
      if (before.find((m) => m.role === "user")?.id === message.id) retitleAfterEdit(conversationId, before, text);
      clearError();
      remember(conversationId);
      followLatest();
      void sendMessage(files.length ? { text: text || "What is this? Find out more about it.", files, messageId: message.id } : { text, messageId: message.id });
    },
    [sendMessage, clearError, conversationId, followLatest],
  );

  // Answer again from the same request: this answer and everything after it goes.
  const retry = React.useCallback(
    (messageId: string) => {
      clearError();
      remember(conversationId);
      followLatest();
      void regenerate({ messageId });
    },
    [regenerate, clearError, conversationId, followLatest],
  );

  // A position is always shown by name, never as coordinates. If it was saved before its name
  // could be looked up (the lookup is not allowed to hold up the conversation), keep trying.
  React.useEffect(() => {
    if (!location || location.label) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      void describe(location.lat, location.lng).then((named) => {
        if (cancelled) return;
        if (named.label) saveLocation({ ...location, ...named });
        else if (n < 3) timer = setTimeout(() => attempt(n + 1), 2500 * (n + 1));
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [location, saveLocation]);

  /* Location. The browser is only asked when the user or the agent wants it. */
  const applyLocation = React.useCallback(
    (next: ExactLocation) => {
      // Update the request settings now: the chat may resume before React re-renders.
      live.coords = { lat: next.lat, lng: next.lng, accuracyM: next.accuracyM, label: next.label, country: next.country };
      live.locationDeclined = false;
      saveLocation(next);
    },
    [saveLocation],
  );
  const locateNow = React.useCallback(async (): Promise<LocateResult> => {
    const result = await locate();
    if (result.ok) applyLocation(result.location);
    return result;
  }, [applyLocation]);

  /* The live browser. The pane's own buttons and the cards in the chat end up in the same place. */
  const openBrowser = React.useRef<(() => void) | null>(null);
  const answerHandover = React.useCallback(
    (answer: HandoverAnswer, toolCallId?: string) => {
      // The browser belongs to the visitor, not to one conversation: only answer a request that is in this one.
      const pending = latest.current.some((m) => m.role === "assistant" && m.parts.some((p) => p.type === "tool-requestUserAction" && p.toolCallId === toolCallId && p.state === "input-available"));
      if (!toolCallId || !pending) return;
      followLatest();
      void addToolOutput({ tool: "requestUserAction", toolCallId, output: answer });
    },
    [addToolOutput, followLatest],
  );

  const handlers = React.useMemo<WidgetHandlers>(
    () => ({
      approximatePlace,
      savedLocation: location,
      onOpenBrowser: () => openBrowser.current?.(),
      onApproval: (approvalId: string, approved: boolean) => {
        followLatest();
        void addToolApprovalResponse({ id: approvalId, approved });
      },
      // "Done" in a chat card: hand the page back to the agent, then tell it.
      onHandover: (toolCallId: string, answer: HandoverAnswer) => {
        const finish = () => answerHandover(answer, toolCallId);
        if (live.browserId) void browserControl(live.browserId, { action: "release" }).then(finish, finish);
        else finish();
      },
      // A button inside a custom widget that continues the conversation.
      onAsk: (prompt: string) => send(prompt),
      onAnswer: (toolCallId: string, output: ClarifyAnswer) => {
        followLatest();
        void addToolOutput({ tool: "askUser", toolCallId, output });
      },
      onLocation: (toolCallId: string, output: LocationAnswer) => {
        followLatest();
        if (output.status === "granted") {
          const { status: _status, ...exact } = output;
          void _status;
          applyLocation(exact);
        } else {
          // Remember a refusal so the agent does not keep asking; a typed place becomes the place to use.
          live.locationDeclined = true;
          setDeclined(true);
          if (output.place && output.place !== approximatePlace) {
            live.place = output.place;
            setPlace(output.place);
          }
        }
        void addToolOutput({ tool: "requestLocation", toolCallId, output });
      },
    }),
    [approximatePlace, location, addToolOutput, addToolApprovalResponse, answerHandover, applyLocation, setDeclined, setPlace, send, followLatest],
  );

  const stats = React.useMemo(() => sumStats(messages.filter((m) => m.role === "assistant").map((m) => m.metadata)), [messages]);
  const last = messages.at(-1);
  const waitingForFirstToken = status === "submitted" && last?.role === "user";

  return (
    <BrowserWorkspace browserId={browserId} onHandoverDone={answerHandover}>
      <LayoutBridge target={openBrowser} onBeside={onBrowserBeside} />
      <TopBar stats={stats} onNewChat={onNewTask} showNew={!empty} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />

      <div ref={scroller} onScroll={onScroll} className={cn("relative flex-1 overflow-y-auto overscroll-contain", empty && "backdrop-room")}>
        {empty ? (
          <Welcome place={location?.label ?? approximatePlace} onPick={(prompt) => send(prompt)} />
        ) : (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 pt-4 pb-10">
            {messages.map((message, i) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} busy={busy} hasLater={i < messages.length - 1} onEdit={(text) => editAndResend(message, text)} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  active={busy && i === messages.length - 1}
                  handlers={handlers}
                  busy={busy}
                  onRetry={() => retry(message.id)}
                />
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
          <Composer
            onSend={send}
            onStop={() => void stop()}
            busy={busy}
            modelId={modelId}
            onModelChange={setModelId}
            where={{
              place: approximatePlace,
              onPlaceChange: setPlace,
              exact: location,
              onLocate: locateNow,
              onClearExact: () => {
                live.coords = undefined;
                saveLocation(null);
              },
            }}
            autoFocus
          />
          <p className="mt-2 hidden text-center text-[0.7rem] text-subtle sm:block">Searches the live web with Exa. Check important details at the source before you act.</p>
        </div>
      </div>
    </BrowserWorkspace>
  );
}

/** Lets the chat's own handlers open the live browser, which only something inside the workspace can do. */
function LayoutBridge({ target: targetRef, onBeside }: { target: React.RefObject<(() => void) | null>; onBeside: () => void }) {
  const { open, mode } = useBrowserLayout();
  React.useEffect(() => {
    if (mode === "split") onBeside();
  }, [mode, onBeside]);
  React.useEffect(() => {
    targetRef.current = () => open();
    return () => {
      targetRef.current = null;
    };
  }, [open, targetRef]);
  return null;
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

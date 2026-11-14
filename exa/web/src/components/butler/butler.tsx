"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { ArrowDown, AudioLines, Eye, MessagesSquare, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DEFAULT_EFFORT, cleanEffort, getMode, pickMode, type Effort, type ModeId } from "@/lib/agent/modes";
import type { ButlerMessage } from "@/lib/agent/tools";
import { useUser } from "@/lib/auth/client";
import { APP_NAME } from "@/lib/brand";
import { browserState, control as browserControl, requestHandover, runBrowserTool, stopBrowserTools } from "@/lib/browser/client";
import { useDesktopApp } from "@/lib/browser/desktop";
import { BROWSER_TOOL_NAMES, type BrowserToolName, type HandoverAnswer } from "@/lib/browser/protocol";
import { CLIENT_HEADER, clientKind, type ClientKind } from "@/lib/client-kind";
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
import { USAGE_CAP_SENTENCE } from "@/lib/usage-cap";
import { isCapRefusal, markCapReached, refreshCap, useCap } from "@/lib/usage-cap-client";
import type { ClarifyAnswer, ExactLocation, LocationAnswer } from "@/lib/widgets/types";
import { liveCall, useCall } from "@/lib/voice/use-call";
import { BrowserWorkspace, useBrowserLayout } from "@/components/browser/workspace";
import { CallBar, CallView } from "@/components/voice/call-view";
import { CapDialog, CapNote } from "./cap";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage, WorkingLine } from "./message";
import { Sidebar } from "./sidebar";
import type { WidgetHandlers } from "./tool-part";
import { TopBar, sumUsage } from "./top-bar";
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
 * created once, always reads the latest choice: switching mode mid-conversation just works,
 * including when the chat resumes on its own after the user answers a question or shares a location.
 */
const live: { mode: ModeId; effort: Effort; place: string; timeZone: string; coords?: Coords; locationDeclined: boolean } = {
  mode: "smart",
  effort: DEFAULT_EFFORT,
  place: "",
  timeZone: "Europe/Helsinki",
  locationDeclined: false,
};

/** Desktop app: where its live browser stands, so the agent knows what is open before it acts. */
function browserNote() {
  if (clientKind() !== "desktop") return undefined;
  const { status, url, title, control } = browserState();
  return { status, url, title, control };
}

const transport = new DefaultChatTransport<ButlerMessage>({
  api: "/api/chat",
  // Which kind of client is asking decides what the agent can do: only the desktop app has a live browser.
  headers: () => ({ [CLIENT_HEADER]: clientKind() }),
  body: () => ({
    // The mode and the effort, never a model: the server decides what stands behind them.
    mode: live.mode,
    effort: live.effort,
    place: live.place,
    timeZone: live.timeZone,
    country: ZONES[live.timeZone]?.[1],
    coords: live.coords,
    locationDeclined: live.locationDeclined,
    browser: browserNote(),
  }),
});

/** The tools the interface answers itself: questions to the user, and (in the desktop app) the steps in the live browser. */
const BROWSER_PARTS = new Set<string>(BROWSER_TOOL_NAMES.map((name) => `tool-${name}`));
const ANSWERED_HERE = new Set<string>(["tool-askUser", "tool-requestLocation", "tool-requestUserAction", ...BROWSER_PARTS]);
const isBrowserTool = (name: string): name is BrowserToolName => (BROWSER_TOOL_NAMES as readonly string[]).includes(name);

/**
 * True when the agent's last step asked the interface for something and has now been given all of
 * it: the answer to a question, the user's location, a hand-over, the result of a browser step.
 * That is the moment to carry on by itself.
 */
function answeredHere(messages: ButlerMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  const step = last.parts.slice(last.parts.findLastIndex((p) => p.type === "step-start") + 1);
  const tools = step.filter((p) => p.type.startsWith("tool-")) as Array<{ type: string; state: string }>;
  return tools.some((p) => ANSWERED_HERE.has(p.type)) && tools.every((p) => p.state === "output-available");
}

/** A picture the agent took of a page is for the answer being written. It is not kept in the saved conversation. */
function withoutPictures(messages: ButlerMessage[]): ButlerMessage[] {
  const has = (p: ButlerMessage["parts"][number]) => p.type === "tool-browserLook" && p.state === "output-available" && Boolean(p.output?.picture);
  if (!messages.some((m) => m.role === "assistant" && m.parts.some(has))) return messages;
  return messages.map((m) =>
    m.role === "assistant" && m.parts.some(has) ? { ...m, parts: m.parts.map((p) => (p.type === "tool-browserLook" && p.state === "output-available" && p.output?.picture ? { ...p, output: { ...p.output, picture: undefined } } : p)) } : m,
  );
}

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

  // The live browser belongs to the account, not to one conversation: it sits above the
  // conversation, so opening another one does not disturb a browser that is running.
  const accountId = useUser().id;
  const handover = React.useRef<((answer: HandoverAnswer, toolCallId?: string) => void) | null>(null);
  const onHandoverDone = React.useCallback((answer: HandoverAnswer, toolCallId?: string) => handover.current?.(answer, toolCallId), []);

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

  // The live browser beside the chat needs the width, so the conversation list steps aside while it
  // is there and comes back when the browser goes. If the user closed the list themselves, or
  // reopens it beside the browser, their choice stands.
  const steppedAside = React.useRef(false);
  const makeRoom = React.useCallback(() => {
    if (sidebarPref !== "open") return;
    steppedAside.current = true;
    setSidebarPref("closed");
  }, [sidebarPref, setSidebarPref]);
  const giveRoomBack = React.useCallback(() => {
    if (!steppedAside.current) return;
    steppedAside.current = false;
    setSidebarPref("open");
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

  // A conversation belongs to the kind of client it was started in. Opened from the other kind
  // it can be read, not continued: the desktop app's conversations use a browser the web lacks.
  const startedIn: ClientKind | undefined = active ? conversations.find((c) => c.id === active.id)?.origin : undefined;

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
        <BrowserWorkspace accountId={accountId} onHandoverDone={onHandoverDone}>
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
            onBrowserGone={giveRoomBack}
            handoverRef={handover}
            startedIn={startedIn}
            title={conversations.find((c) => c.id === active.id)?.title}
          />
        ) : null}
        </BrowserWorkspace>
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
  onBrowserGone,
  handoverRef,
  startedIn,
  title,
}: {
  /** The conversation's name, once it has been saved under one. */
  title?: string;
  conversationId: string;
  initialMessages: ButlerMessage[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewTask: () => void;
  /** The live browser has opened beside the chat. */
  onBrowserBeside: () => void;
  /** The live browser is no longer shown. */
  onBrowserGone: () => void;
  /** Where the conversation was started, when it is a saved one. Elsewhere it is read-only. */
  startedIn?: ClientKind;
  /** Where the browser pane finds this conversation's way of answering a hand-over. */
  handoverRef: React.RefObject<((answer: HandoverAnswer, toolCallId?: string) => void) | null>;
}) {
  const user = useUser();
  const [storedMode, setStoredMode] = useStored("hovi.mode", "");
  const [storedEffort, setStoredEffort] = useStored("hovi.effort", String(DEFAULT_EFFORT));
  // The mode chosen last, if the account still has it; otherwise the best it has, up to Smart.
  const mode = pickMode(storedMode || "smart", user.modes);
  const effort = cleanEffort(storedEffort);
  const [place, setPlace] = useStored("hovi.place", "");
  const timeZone = useClientValue(browserTimeZone, "Europe/Helsinki");
  const { location, declined, save: saveLocation, setDeclined } = useExactLocation();
  const approximatePlace = place || defaultPlace(timeZone);
  const modeLabel = getMode(mode).label;
  const desktop = useDesktopApp();
  const here: ClientKind = desktop ? "desktop" : "web";
  const readOnly = startedIn !== undefined && startedIn !== here;

  React.useEffect(() => {
    live.mode = mode;
    live.effort = effort;
    live.place = approximatePlace;
    live.timeZone = timeZone;
    live.coords = location ? { lat: location.lat, lng: location.lng, accuracyM: location.accuracyM, label: location.label, country: location.country } : undefined;
    live.locationDeclined = declined;
  }, [mode, effort, approximatePlace, timeZone, location, declined]);

  const [seed] = React.useState(() => liveMessages.get(conversationId) ?? initialMessages);
  /** The user pressed Stop (or left): what arrives after that is kept, but does not start the agent again. */
  const halted = React.useRef(false);
  const takeStep = React.useRef<((call: { toolName: string; toolCallId: string; input: unknown }) => void) | null>(null);
  const { messages, setMessages, sendMessage, status, stop, error, regenerate, addToolOutput, clearError } = useChat<ButlerMessage>({
    id: conversationId,
    messages: seed,
    transport,
    // Carry on by itself only after the interface has given the agent what it asked for: an answer
    // to a question, the user's location, a hand-over, or the result of a step in the live browser.
    sendAutomaticallyWhen: ({ messages: all }) => !halted.current && answeredHere(all),
    // The agent's browser steps are not taken on the server: the desktop app takes them.
    onToolCall: ({ toolCall }) => takeStep.current?.(toolCall),
  });

  /* The live browser's steps. The agent asks, the app (on this computer) takes the step under its
     safety rules, and the page as it then stands goes back to the agent. Each step is taken once. */
  const taken = React.useRef(new Set<string>());
  React.useEffect(() => {
    takeStep.current = (call) => {
      if (taken.current.has(call.toolCallId)) return;
      if (call.toolName === "requestUserAction") {
        taken.current.add(call.toolCallId);
        requestHandover(call.input, call.toolCallId);
        return;
      }
      if (!isBrowserTool(call.toolName)) return;
      taken.current.add(call.toolCallId);
      const tool = call.toolName;
      // Not awaited here: the answer is written into the conversation when the step is done.
      void runBrowserTool({ tool, toolCallId: call.toolCallId, input: call.input }).then((output) => void addToolOutput({ tool, toolCallId: call.toolCallId, output }));
    };
    return () => {
      takeStep.current = null;
    };
  }, [addToolOutput]);
  // The view was mounted afresh while a step was on its way (a code reload, a layout change): ask
  // for it again. The app answers a step it has already taken with the same result.
  React.useEffect(() => {
    const last = seed.at(-1);
    if (last?.role !== "assistant") return;
    for (const part of last.parts) {
      if (BROWSER_PARTS.has(part.type) && "state" in part && part.state === "input-available") takeStep.current?.({ toolName: part.type.slice(5), toolCallId: part.toolCallId, input: part.input });
    }
  }, [seed]);

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;

  /* A live call. It is another way of holding this same conversation: what is said and done in
     it is written into these messages as it happens, so the conversation view shows the call
     too, and it is saved like anything else. While it is on, the call's own view takes the place
     of the conversation and the message box; "Chat" switches back to read along. */
  const call = useCall();
  const calling = call.active && liveCall.conversationId === conversationId;
  const [callView, setCallView] = React.useState<"live" | "chat">("live");

  /* Saving. Every change is written to this browser's storage: at once when the agent finishes,
     and every few seconds while it is still working, so a refresh mid-answer keeps what there was. */
  const baseline = React.useRef<ButlerMessage[] | null>(null);
  const latest = React.useRef(messages);
  const dirty = React.useRef(false);
  const lastSaved = React.useRef(0);
  const labelRef = React.useRef(modeLabel);
  const stopRef = React.useRef(stop);
  React.useEffect(() => {
    labelRef.current = modeLabel;
    stopRef.current = stop;
  }, [modeLabel, stop]);
  React.useEffect(() => {
    latest.current = messages;
    liveMessages.set(conversationId, messages);
    if (baseline.current === null) {
      baseline.current = messages;
      return;
    }
    if (messages === baseline.current || messages.length === 0) return;
    dirty.current = true;
    // In a call the messages change with every few words: save every few seconds, and once when it ends.
    const settled = (status === "ready" || status === "error") && !calling;
    if (!settled && Date.now() - lastSaved.current < 3000) return;
    lastSaved.current = Date.now();
    void persistConversation(conversationId, withoutPictures(messages), labelRef.current);
  }, [messages, status, conversationId, calling]);
  // Leaving the conversation: stop any answer in progress, any call and any step in the browser, and save what there is.
  React.useEffect(
    () => () => {
      halted.current = true;
      if (liveCall.conversationId === conversationId) liveCall.end();
      stopBrowserTools();
      void stopRef.current();
      if (dirty.current && latest.current.length > 0) void persistConversation(conversationId, withoutPictures(latest.current), labelRef.current);
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
      // During a call, what is typed is said to the agent in the call, and answered aloud.
      if (liveCall.conversationId === conversationId && files.length === 0) {
        followLatest();
        liveCall.sendText(text);
        return;
      }
      halted.current = false;
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
      halted.current = false;
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
      halted.current = false;
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

  const startCall = React.useCallback(() => {
    if (liveCall.conversationId) return;
    // One voice at a time: an answer that is still being written stops here.
    halted.current = true;
    stopBrowserTools();
    void stop();
    clearError();
    remember(conversationId);
    setCallView("live");
    void liveCall.start({
      conversationId,
      context: () => ({ mode: live.mode, effort: live.effort, place: live.place, timeZone: live.timeZone, country: ZONES[live.timeZone]?.[1], coords: live.coords, locationDeclined: live.locationDeclined, browser: browserNote() }),
      getMessages: () => latest.current,
      setMessages: (update) => setMessages(update),
      locate: locateNow,
    });
  }, [conversationId, stop, clearError, setMessages, locateNow]);
  // A call that could not start, or ended by itself, says why. The usage limit has its own dialog.
  React.useEffect(() => {
    if (!call.problem) return;
    if (call.problem === USAGE_CAP_SENTENCE) markCapReached();
    else toast.error(call.problem);
  }, [call.problem]);

  /* The live browser. The pane's own buttons and the cards in the chat end up in the same place. */
  const openBrowser = React.useRef<(() => void) | null>(null);
  const answerHandover = React.useCallback(
    (answer: HandoverAnswer, toolCallId?: string) => {
      // Asked for during a call: the call tells the agent, aloud.
      if (toolCallId && liveCall.ownsHandover(toolCallId)) {
        liveCall.handoverDone(answer, toolCallId);
        return;
      }
      // The browser belongs to the visitor, not to one conversation: only answer a request that is in this one.
      const pending = latest.current.some((m) => m.role === "assistant" && m.parts.some((p) => p.type === "tool-requestUserAction" && p.toolCallId === toolCallId && p.state === "input-available"));
      if (!toolCallId || !pending) return;
      followLatest();
      void addToolOutput({ tool: "requestUserAction", toolCallId, output: answer });
    },
    [addToolOutput, followLatest],
  );

  React.useEffect(() => {
    handoverRef.current = answerHandover;
    return () => {
      if (handoverRef.current === answerHandover) handoverRef.current = null;
    };
  }, [handoverRef, answerHandover]);

  const handlers = React.useMemo<WidgetHandlers>(
    () => ({
      approximatePlace,
      savedLocation: location,
      // The live browser is part of the desktop app: on the web its steps are history to read.
      onOpenBrowser: desktop ? () => openBrowser.current?.() : undefined,
      // The user's yes or no to a step that commits them. The app is what waits for it.
      onApproval: (toolCallId: string, approved: boolean) => {
        followLatest();
        void browserControl({ action: "approval", toolCallId, approved }).catch(() => {});
      },
      // "Done" in a chat card: hand the page back to the agent, then tell it.
      onHandover: (toolCallId: string, answer: HandoverAnswer) => {
        const finish = () => answerHandover(answer, toolCallId);
        void browserControl({ action: "release" }).then(finish, finish);
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
    [approximatePlace, location, desktop, addToolOutput, answerHandover, applyLocation, setDeclined, setPlace, send, followLatest],
  );
  // Read-only: the cards show what was asked and answered, and none of them talks back.
  const shown = React.useMemo<WidgetHandlers>(() => (readOnly ? { approximatePlace, savedLocation: location } : handlers), [readOnly, handlers, approximatePlace, location]);

  const usage = React.useMemo(() => sumUsage(messages.filter((m) => m.role === "assistant").map((m) => m.metadata)), [messages]);

  /* The usage limit. The server refuses and stops; here the interface finds out, stops asking, and says why once.
     Only an account that has a limit ever asks where it stands. */
  const cap = useCap();
  const capped = cap.reached;
  // The dialog opens by itself each time the limit is reached, and closes if the admin raises it.
  const [capOpen, setCapOpen] = React.useState(capped);
  const [wasCapped, setWasCapped] = React.useState(capped);
  if (wasCapped !== capped) {
    setWasCapped(capped);
    setCapOpen(capped);
  }
  const hasCap = user.usageCapUsd !== null;
  React.useEffect(() => {
    if (hasCap) void refreshCap();
  }, [hasCap]);
  // A request the server refused for the limit is not an error to retry.
  const refused = Boolean(error && isCapRefusal(error));
  React.useEffect(() => {
    if (!refused) return;
    halted.current = true;
    stopBrowserTools();
    markCapReached();
    clearError();
  }, [refused, clearError]);
  // An answer the limit stopped half-way says so in its figures. After any answer, a capped account checks where it stands.
  const wasBusy = React.useRef(false);
  React.useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (latest.current.at(-1)?.metadata?.capReached) {
      halted.current = true;
      stopBrowserTools();
      markCapReached();
    } else if (hasCap) void refreshCap();
  }, [busy, hasCap]);
  // Reaching the limit ends a call too.
  React.useEffect(() => {
    if (capped && liveCall.conversationId === conversationId) liveCall.end();
  }, [capped, conversationId]);
  const last = messages.at(-1);
  const waitingForFirstToken = status === "submitted" && last?.role === "user";

  return (
    <>
      <LayoutBridge target={openBrowser} onBeside={onBrowserBeside} onGone={onBrowserGone} />
      <TopBar usage={usage} title={empty ? undefined : title} onNewChat={onNewTask} showNew={!empty} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
      <CapDialog open={capOpen} onOpenChange={setCapOpen} />

      {calling ? (
        <div className="flex shrink-0 justify-center px-3 pb-1">
          <div role="tablist" aria-label="Call or conversation" className="flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5 shadow-card">
            {(
              [
                ["live", "Live", <AudioLines key="i" className="size-3.5" />],
                ["chat", "Conversation", <MessagesSquare key="i" className="size-3.5" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={callView === id}
                onClick={() => setCallView(id)}
                className={cn("flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8rem] font-medium transition-colors", callView === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {calling && callView === "live" ? (
        <CallView call={call} messages={messages} handlers={shown} onShowConversation={() => setCallView("chat")} />
      ) : (
      <>
      <div ref={scroller} onScroll={onScroll} className={cn("relative flex-1 overflow-y-auto overscroll-contain", empty && "backdrop-room")}>
        {empty ? (
          <Welcome place={location?.label ?? approximatePlace} onPick={(prompt) => send(prompt)} onTalk={readOnly ? undefined : startCall} />
        ) : (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 pt-4 pb-10">
            {messages.map((message, i) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} busy={busy} hasLater={i < messages.length - 1} onEdit={readOnly ? undefined : (text) => editAndResend(message, text)} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  active={busy && i === messages.length - 1}
                  handlers={shown}
                  busy={busy}
                  onRetry={readOnly ? undefined : () => retry(message.id)}
                />
              ),
            )}
            {waitingForFirstToken ? <WorkingLine /> : null}
            {error && !readOnly && !refused ? (
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
          {calling ? <CallBar call={call} onShowCall={() => setCallView("live")} /> : null}
          {readOnly ? (
            <ReadOnlyNote startedIn={startedIn ?? "web"} onNewTask={onNewTask} />
          ) : capped ? (
            <CapNote onDetails={() => setCapOpen(true)} />
          ) : (
          <Composer
            onSend={send}
            onTalk={calling ? undefined : startCall}
            inCall={calling}
            onStop={() => {
              // Stopping also ends a step in the live browser; a step waiting for approval counts as declined.
              halted.current = true;
              stopBrowserTools();
              void stop();
            }}
            busy={busy}
            mode={mode}
            effort={effort}
            modes={user.modes}
            onModeChange={setStoredMode}
            onEffortChange={(next) => setStoredEffort(String(next))}
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
          )}
          <p className="mt-2 hidden text-center text-[0.7rem] text-subtle @min-[520px]/chat:block">Searches the live web with Exa. Check important details at the source before you act.</p>
        </div>
      </div>
      </>
      )}
    </>
  );
}

/** In place of the message box, when a conversation is open in the kind of client it was not started in. */
function ReadOnlyNote({ startedIn, onNewTask }: { startedIn: ClientKind; onNewTask: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-3xl border border-border bg-card px-4 py-3.5 shadow-card sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Eye className="size-[1.05rem]" />
      </span>
      <div className="min-w-[13rem] flex-1">
        <p className="text-[0.9rem] leading-5 font-medium">Read-only here</p>
        <p className="mt-0.5 text-[0.8rem] leading-snug text-muted-foreground">
          {startedIn === "desktop"
            ? `This conversation was started in the ${APP_NAME} desktop app, where the agent works in a live browser. Open it there to carry on.`
            : `This conversation was started in ${APP_NAME} on the web. Open it there to carry on, or start a new task here.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onNewTask}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
      >
        <Plus className="size-4" />
        New task
      </button>
    </div>
  );
}

/** Lets the chat's own handlers open the live browser, which only something inside the workspace can do. */
function LayoutBridge({ target: targetRef, onBeside, onGone }: { target: React.RefObject<(() => void) | null>; onBeside: () => void; onGone: () => void }) {
  const { open, mode } = useBrowserLayout();
  // Only a change of layout counts: the list is moved when the browser arrives or leaves, not on every render.
  const seen = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (seen.current === mode) return;
    const first = seen.current === null;
    seen.current = mode;
    if (mode === "split") onBeside();
    else if (mode === "closed" && !first) onGone();
  }, [mode, onBeside, onGone]);
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

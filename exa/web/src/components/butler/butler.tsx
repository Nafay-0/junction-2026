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
import { askBrowserState, browserState, control as browserControl, requestHandover, runBrowserTool, stopBrowserTools, useApprovalId } from "@/lib/browser/client";
import { useDesktopApp } from "@/lib/browser/desktop";
import { BROWSER_TOOL_NAMES, type BrowserToolName, type HandoverAnswer } from "@/lib/browser/protocol";
import { CLIENT_HEADER, clientKind, type ClientKind } from "@/lib/client-kind";
import {
  deleteConversation,
  loadMessages,
  newConversationId,
  persistConversation,
  renameConversation,
  retitleAfterEdit,
  useConversations,
} from "@/lib/conversations";
import { describe, locate, useExactLocation, type LocateResult } from "@/lib/location";
import { markNotificationsRead, onNewNotification, reportNeedsYou, type NeedsYou } from "@/lib/notifications/client";
import { useClientValue, useMediaQuery, useStored } from "@/lib/use-client";
import { USAGE_CAP_SENTENCE } from "@/lib/usage-cap";
import { isCapRefusal, markCapReached, refreshCap, useCap } from "@/lib/usage-cap-client";
import { RUN_ACTIVE_CODE, RUN_GONE_CODE } from "@/lib/run-state";
import { fetchRunState, refreshRunning, stopRunOnServer, useRunning } from "@/lib/runs-client";
import type { ClarifyAnswer, ExactLocation, LocationAnswer } from "@/lib/widgets/types";
import { liveCall, useCall } from "@/lib/voice/use-call";
import { BrowserWorkspace, useBrowserLayout } from "@/components/browser/workspace";
import { useOpenNotification } from "@/components/notifications/bell";
import { SlowNote } from "@/components/notifications/slow-note";
import { CallBar, CallView } from "@/components/voice/call-view";
import { CapDialog, CapNote } from "./cap";
import { Composer, type ComposerHandle } from "./composer";
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

/** Marks a request that joins a task already running on the server instead of starting one. */
const REJOIN = { rejoin: true } as const;
const isRejoin = (metadata: unknown) => Boolean(metadata && typeof metadata === "object" && (metadata as { rejoin?: unknown }).rejoin === true);

const transport = new DefaultChatTransport<ButlerMessage>({
  api: "/api/chat",
  // Which kind of client is asking decides what the agent can do: only the desktop app has a live browser.
  headers: () => ({ [CLIENT_HEADER]: clientKind() }),
  /*
   * A request either starts a task or joins one. A task belongs to the server once it has
   * started (see lib/runs.ts): after a reload, or when a conversation is opened again, the
   * interface puts the conversation back as it was when the task began and asks for the task's
   * stream from its start. That replay goes through the same path as a fresh answer, so what is
   * rebuilt is exactly what would have been shown had nobody left.
   */
  prepareSendMessagesRequest: ({ id, messages, requestMetadata, trigger, messageId }) =>
    isRejoin(requestMetadata)
      ? { api: `/api/chat/${encodeURIComponent(id)}/stream`, body: {} }
      : {
          body: {
            id,
            messages,
            trigger,
            messageId,
            // The mode and the effort, never a model: the server decides what stands behind them.
            mode: live.mode,
            effort: live.effort,
            place: live.place,
            timeZone: live.timeZone,
            country: ZONES[live.timeZone]?.[1],
            coords: live.coords,
            locationDeclined: live.locationDeclined,
            browser: browserNote(),
          },
        },
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

/** True when the last answer has a step still waiting: of the given kind, or the one with the given id. */
function waitsFor(messages: ButlerMessage[], type?: string, toolCallId?: string): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  return last.parts.some((p) => "toolCallId" in p && "state" in p && p.state === "input-available" && (type === undefined || p.type === type) && (toolCallId === undefined || p.toolCallId === toolCallId));
}

/** The step in the last answer that is still waiting: of the given kind, and with the given id when one is named. */
function waitingPart(messages: ButlerMessage[], type: string, toolCallId?: string): { toolCallId: string; input?: unknown } | undefined {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  for (const p of last.parts) {
    if (p.type === type && "toolCallId" in p && "state" in p && p.state === "input-available" && (toolCallId === undefined || p.toolCallId === toolCallId)) return { toolCallId: p.toolCallId, input: p.input };
  }
  return undefined;
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

/** What a step is told when another task is working in the one live browser. */
const BROWSER_BUSY = {
  kind: "browser" as const,
  label: "The live browser is busy",
  action: "open" as const,
  url: "",
  title: "",
  ok: false,
  problem:
    "The live browser is being used by another of the user's chats right now, and there is only one. This step was not taken. Tell the user in one sentence that this chat needs the browser the other chat is using, and that they can ask again when it has finished or stop it. Do not retry.",
  page: "",
  sources: [] as [],
};

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const ACTIVE_KEY = "hovi.active";

/*
 * A chat has its own address, /chat/<id>, and the front door (/) is a new chat. The address is
 * kept in step with the browser's own history calls, not by loading a page: moving between
 * chats must not take down the ones that are still working out of sight. Back and Forward then
 * move between chats, a reload stays on the chat, and the address can be shared or put in an email.
 */
const CHAT_PATH = /^\/chat\/([A-Za-z0-9_-]{6,80})\/?$/;
const chatInAddress = (): string | null => CHAT_PATH.exec(window.location.pathname)?.[1] ?? null;

function showInAddress(id: string | null, how: "push" | "replace") {
  const path = id ? `/chat/${id}` : "/";
  const now = window.location.pathname;
  // Only where the app is the page, and only when it is not already there.
  if ((now !== "/" && !CHAT_PATH.test(now)) || (now === path && !window.location.search)) return;
  try {
    if (how === "push") window.history.pushState(null, "", path);
    else window.history.replaceState(null, "", path);
  } catch {
    /* the address stays as it was; the chat is open all the same */
  }
}

/** The chat on screen, for code outside the shell that needs to know whether a chat is the one being looked at. */
let onScreen: string | null = null;

/** The user did something in this chat: it is the one to come back to, and if it is on screen the address says so. */
function rememberHere(id: string) {
  remember(id);
  if (onScreen === id) showInAddress(id, "replace");
}

function remember(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* storage blocked: the conversation is still saved, it just will not reopen on refresh */
  }
}

type Active = {
  id: string;
  messages: ButlerMessage[];
  /** A task is running in it on the server: the chat joins it as soon as it is on screen. */
  rejoin?: boolean;
};

/**
 * A saved conversation, ready to show. When a task is running in it, what comes back is the
 * conversation as that task found it, and the chat replays the task on top of it.
 */
async function openConversation(id: string): Promise<Active | null> {
  const [messages, run] = await Promise.all([loadMessages(id), fetchRunState(id)]);
  if (run.active && run.messages) return { id, messages: run.messages, rejoin: true };
  return messages?.length ? { id, messages } : null;
}

/** Conversations with work in progress in this window, and which of them is using the live browser. */
const workingNow = new Set<string>();
let browserHolder: string | null = null;

/*
 * Tasks at work in the live browser. The browser is part of the app, so when the app is closed
 * such a task waits until its conversation is opened in the app again. Which ones they were is
 * kept in this app's own storage (it is about this computer's browser, not the account), so the
 * list can mark them after the app has been closed and opened. After a day they are forgotten:
 * a task that old is no longer picked up by itself.
 */
const BROWSER_TASKS_KEY = "hovi.browserTasks";
const BROWSER_TASK_LIFE_MS = 24 * 60 * 60 * 1000;
/** In progress now, in this window. */
const browserTasks = new Map<string, number>();
/** Left from before the app was last closed, and not opened since. */
const leftTasks = new Map<string, number>();

/* The left ones as a small store, so the list re-draws when one is opened or deleted. */
const NO_TASKS: string[] = [];
let leftIds: string[] = NO_TASKS;
let leftRead = false;
const leftListeners = new Set<() => void>();

function publishLeft() {
  leftIds = [...leftTasks.keys()];
  leftListeners.forEach((listener) => listener());
}

function subscribeLeft(onChange: () => void) {
  leftListeners.add(onChange);
  if (!leftRead) {
    leftRead = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(BROWSER_TASKS_KEY) ?? "[]") as Array<[string, number]>;
      for (const [id, at] of saved) if (typeof id === "string" && Date.now() - at < BROWSER_TASK_LIFE_MS && !browserTasks.has(id)) leftTasks.set(id, at);
    } catch {
      /* nothing kept, or storage is blocked: nothing is marked */
    }
    if (leftTasks.size > 0) leftIds = [...leftTasks.keys()];
  }
  return () => {
    leftListeners.delete(onChange);
  };
}

const useLeftTasks = () =>
  React.useSyncExternalStore(
    subscribeLeft,
    () => leftIds,
    () => NO_TASKS,
  );

/** The conversation has been opened (it picks its task up itself) or is gone: it is no longer one that was left. */
function forgetLeftTask(id: string) {
  if (!leftTasks.delete(id)) return;
  writeBrowserTasks();
  publishLeft();
}

function writeBrowserTasks() {
  try {
    window.localStorage.setItem(BROWSER_TASKS_KEY, JSON.stringify([...leftTasks, ...browserTasks].slice(-20)));
  } catch {
    /* storage blocked: the tasks still pick up when opened, they are just not marked */
  }
}

function noteBrowserTask(id: string, on: boolean) {
  if (on === browserTasks.has(id)) return;
  if (on) browserTasks.set(id, Date.now());
  else browserTasks.delete(id);
  writeBrowserTasks();
}

/* Whether the conversation list is closed only because it stepped aside for the live browser. */
const ASIDE_KEY = "hovi.sidebar.aside";
function noteAside(on: boolean) {
  try {
    if (on) window.localStorage.setItem(ASIDE_KEY, "1");
    else window.localStorage.removeItem(ASIDE_KEY);
  } catch {
    /* storage blocked: the list just stays as it was left */
  }
}
function wasAside(): boolean {
  try {
    return window.localStorage.getItem(ASIDE_KEY) === "1";
  } catch {
    return false;
  }
}

type HandoverHandler = (answer: HandoverAnswer, toolCallId?: string) => void;

/** The app shell: the conversation list on the left, the open conversation on the right. */
export function Butler() {
  const conversations = useConversations();
  const wide = useMediaQuery("(min-width: 768px)");
  const [sidebarPref, setSidebarPref] = useStored("hovi.sidebar", "open");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const sidebarOpen = wide ? sidebarPref === "open" : drawerOpen;

  const [active, setActive] = React.useState<Active | null>(null);
  /*
   * Tasks run side by side. A conversation that is left while it is working is not closed: it
   * stays alive out of sight, carries on (its steps in the live browser included), and is there,
   * mid-task, when it is opened again. Once its work is done it is let go. A task also survives
   * a reload or a closed window, because it runs on the server: see `openConversation`.
   */
  const [kept, setKept] = React.useState<string[]>([]);
  const [working, setWorking] = React.useState<string[]>([]);
  const activeId = React.useRef<string | null>(null);
  const keptIds = React.useRef<string[]>([]);
  React.useEffect(() => {
    activeId.current = active?.id ?? null;
    onScreen = active?.id ?? null;
    keptIds.current = kept;
  }, [active, kept]);

  /* Conversations that cannot go on until the user does something in the live browser: a step
     waiting for their yes, or a page handed to them. The list marks them. */
  const [needsUser, setNeedsUser] = React.useState<string[]>([]);
  const onNeedsUser = React.useCallback((id: string, now: boolean) => {
    setNeedsUser((ids) => (now === ids.includes(id) ? ids : now ? [...ids, id] : ids.filter((x) => x !== id)));
  }, []);

  /* Browser tasks that were in progress when the app was last closed. They pick up when their
     conversation is opened; the one that was on screen is opened by itself. */
  const left = useLeftTasks();
  React.useEffect(() => {
    if (active?.id) forgetLeftTask(active.id);
  }, [active]);
  const waitingForUser = React.useMemo(() => [...new Set([...needsUser, ...left])], [needsUser, left]);

  const onWorking = React.useCallback((id: string, now: boolean) => {
    if (now === workingNow.has(id)) return;
    if (now) workingNow.add(id);
    else {
      workingNow.delete(id);
      noteBrowserTask(id, false);
      if (browserHolder === id) browserHolder = null;
    }
    setWorking([...workingNow]);
    void refreshRunning();
    // A conversation kept alive only for its task is let go a moment after the task ends.
    if (!now) {
      setTimeout(() => {
        if (workingNow.has(id) || activeId.current === id) return;
        setKept((ids) => ids.filter((x) => x !== id));
        liveMessages.delete(id);
      }, 2500);
    }
  }, []);

  /** The conversation on screen is being left: if it is working it stays alive, otherwise it is closed. */
  const leave = React.useCallback((id: string | null) => {
    if (!id) return;
    if (workingNow.has(id)) setKept((ids) => (ids.includes(id) ? ids : [...ids, id]));
    else {
      setKept((ids) => ids.filter((x) => x !== id));
      liveMessages.delete(id);
    }
  }, []);

  // The live browser belongs to the account, not to one conversation: it sits above the
  // conversations, so opening another one does not disturb a browser that is running. What the
  // user does in its pane is answered by whichever conversation asked for it.
  const accountId = useUser().id;
  const handovers = React.useRef(new Map<string, HandoverHandler>());
  const onHandoverDone = React.useCallback((answer: HandoverAnswer, toolCallId?: string) => handovers.current.forEach((answerIn) => answerIn(answer, toolCallId)), []);
  const registerHandover = React.useCallback((id: string, handler: HandoverHandler | null) => {
    if (handler) handovers.current.set(id, handler);
    else handovers.current.delete(id);
  }, []);

  /* Opening a chat means fetching it, which takes a moment. Each move (open this chat, start a
     new one) is numbered, and a chat that arrives after the user has moved on is not shown: the
     latest move wins. Without this, a chat pressed just before "New chat" would turn up on top
     of the new one. */
  const moves = React.useRef(0);

  // On first load, reopen the conversation that was open last, so a refresh loses nothing: if a
  // task was running in it, it still is, and the chat joins it.
  React.useEffect(() => {
    let cancelled = false;
    let lastId: string | null = null;
    try {
      lastId = window.localStorage.getItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    // An address that names a chat (/chat/<id>, which is what an email links to) opens that one.
    const linked = chatInAddress();
    if (linked) {
      lastId = linked;
      remember(linked);
    }
    const turn = ++moves.current;
    void (lastId ? openConversation(lastId) : Promise.resolve(null)).then((found) => {
      // The user has already gone somewhere else: that is where they are.
      if (cancelled || moves.current !== turn) return;
      setActive(found ?? { id: newConversationId(), messages: [] });
      // The address says what is on screen: the chat that was opened, or the front door for a new one.
      showInAddress(found ? found.id : null, "replace");
      if (linked && !found) toast("That chat isn\u2019t here", { description: "It may have been deleted, or it belongs to another account." });
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
    noteAside(true);
    setSidebarPref("closed");
  }, [sidebarPref, setSidebarPref]);
  const giveRoomBack = React.useCallback(() => {
    if (!steppedAside.current) return;
    steppedAside.current = false;
    noteAside(false);
    setSidebarPref("open");
  }, [setSidebarPref]);
  // The app was closed while the list was aside for a browser that is gone now: the list comes back.
  React.useEffect(() => {
    if (!wasAside()) return;
    noteAside(false);
    if (browserState().status !== "ready") setSidebarPref("open");
  }, [setSidebarPref]);

  /* Starting a new chat and opening one. `how` says what happens to the address: a step the
     user took adds to the history ("push"), so Back returns to where they were; a move that came
     from Back or Forward itself changes nothing there (null). */
  const startNew = React.useCallback(
    (how: "push" | null) => {
      moves.current += 1;
      leave(activeId.current);
      const id = newConversationId();
      remember(id);
      setActive({ id, messages: [] });
      setDrawerOpen(false);
      if (how) showInAddress(null, how);
    },
    [leave],
  );
  const newTask = React.useCallback(() => startNew("push"), [startNew]);

  const openChat = React.useCallback(
    (id: string, how: "push" | null) => {
      setDrawerOpen(false);
      const from = activeId.current;
      if (id === from) return;
      const turn = ++moves.current;
      if (how) showInAddress(id, how);
      // Still alive in the background: show it as it stands, mid-task.
      if (keptIds.current.includes(id)) {
        leave(from);
        remember(id);
        setActive({ id, messages: liveMessages.get(id) ?? [] });
        return;
      }
      void openConversation(id).then((found) => {
        if (moves.current !== turn) return;
        leave(from);
        remember(id);
        liveMessages.delete(id);
        setActive(found ?? { id, messages: [] });
      });
    },
    [leave],
  );
  const open = React.useCallback((id: string) => openChat(id, "push"), [openChat]);

  // Back and Forward move between chats: the address has already changed, the chat follows it.
  React.useEffect(() => {
    const follow = () => {
      const id = chatInAddress();
      if (id) openChat(id, null);
      else if (window.location.pathname === "/") startNew(null);
    };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [openChat, startNew]);

  /* A notification that arrives while the page is open is announced once. One about the chat the
     user is looking at needs no announcing: it is marked read. When the window is not the one in
     use, the system is asked to show it too (the desktop app may; a website only where the user
     has allowed it), since nobody is looking at a toast in a window behind another. */
  const openNotice = useOpenNotification(open);
  React.useEffect(
    () =>
      onNewNotification((item) => {
        const inFront = document.visibilityState === "visible" && document.hasFocus();
        if (inFront && item.conversationId && item.conversationId === activeId.current) {
          void markNotificationsRead([item.id]);
          return;
        }
        const opens = Boolean(item.conversationId || item.jobId);
        toast(item.title, { description: item.body || undefined, duration: 12_000, action: opens ? { label: "Open", onClick: () => openNotice(item) } : undefined });
        if (inFront) return;
        try {
          if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
          const shown = new Notification(item.title, { body: item.body || undefined, tag: item.id });
          shown.onclick = () => {
            window.focus();
            if (opens) openNotice(item);
            shown.close();
          };
        } catch {
          /* the system would not show it: the bell and the email still do their part */
        }
      }),
    [openNotice],
  );

  // A task was left waiting when the app was last closed: say so once, with a way to open it.
  // The list may be closed or out of view, and the mark there is easy to miss.
  const toldLeft = React.useRef(false);
  React.useEffect(() => {
    if (toldLeft.current || !active) return;
    const found = left.filter((id) => id !== active.id && conversations.some((c) => c.id === id));
    if (found.length === 0) return;
    toldLeft.current = true;
    const first = found[0];
    toast(found.length > 1 ? `${found.length} chats are waiting for you` : "A chat is waiting for you", {
      description: found.length > 1 ? "Open one from the list to carry on." : conversations.find((c) => c.id === first)?.title,
      duration: 20_000,
      action: { label: "Open", onClick: () => open(first) },
    });
  }, [left, active, conversations, open]);

  const remove = React.useCallback(
    (id: string) => {
      // Deleting a conversation ends whatever is running in it (the server does the same).
      workingNow.delete(id);
      noteBrowserTask(id, false);
      forgetLeftTask(id);
      setWorking([...workingNow]);
      setKept((ids) => ids.filter((x) => x !== id));
      void deleteConversation(id).then(() => void refreshRunning());
      if (activeId.current === id) newTask();
    },
    [newTask],
  );

  // Tasks running here, and tasks left running on the server (after a reload, or from another window).
  const onServer = useRunning(working.length > 0);
  const running = React.useMemo(() => [...new Set([...working, ...onServer])], [working, onServer]);
  const mounted = active ? [...new Set([...kept, active.id])] : kept;

  return (
    <div className="flex h-dvh bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        conversations={conversations}
        activeId={active?.id ?? null}
        running={running}
        waiting={waitingForUser}
        onSelect={open}
        onNew={newTask}
        onRename={(id, title) => void renameConversation(id, title)}
        onDelete={remove}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <BrowserWorkspace accountId={accountId} onHandoverDone={onHandoverDone}>
          {mounted.map((id) => {
            const shown = id === active?.id;
            // A conversation belongs to the kind of client it was started in. Opened from the other kind
            // it can be read, not continued: the desktop app's conversations use a browser the web lacks.
            const meta = conversations.find((c) => c.id === id);
            return (
              // Keyed by conversation: each one has its own chat state. One that is working out of sight is only hidden.
              <div key={id} className={shown ? "contents" : "hidden"}>
                <ChatView
                  conversationId={id}
                  initialMessages={shown && active ? active.messages : (liveMessages.get(id) ?? [])}
                  rejoin={shown && active?.rejoin === true}
                  hidden={!shown}
                  sidebarOpen={sidebarOpen}
                  onToggleSidebar={toggleSidebar}
                  onNewTask={newTask}
                  onBrowserBeside={makeRoom}
                  onBrowserGone={giveRoomBack}
                  registerHandover={registerHandover}
                  onWorking={onWorking}
                  onNeedsUser={onNeedsUser}
                  onOpenChat={open}
                  startedIn={meta?.origin}
                  title={meta?.title}
                />
              </div>
            );
          })}
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
  registerHandover,
  onWorking,
  onNeedsUser,
  onOpenChat,
  hidden,
  rejoin,
  startedIn,
  title,
}: {
  /** Not on screen: the conversation was left while it was working, and carries on. */
  hidden: boolean;
  /** A task is already running in this conversation on the server: join it. */
  rejoin: boolean;
  /** Tell the shell whether this conversation has work in progress. */
  onWorking: (id: string, working: boolean) => void;
  /** Tell the shell whether this conversation is waiting for the user in the live browser. */
  onNeedsUser: (id: string, waiting: boolean) => void;
  /** Open another chat: what a notification about one does. */
  onOpenChat: (id: string) => void;
  /** Where the browser pane finds this conversation's way of answering a hand-over. */
  registerHandover: (id: string, handler: ((answer: HandoverAnswer, toolCallId?: string) => void) | null) => void;
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

  // A task being joined starts from the conversation as that task found it, whatever this window last showed.
  const [seed] = React.useState(() => (rejoin ? initialMessages : (liveMessages.get(conversationId) ?? initialMessages)));
  const composer = React.useRef<ComposerHandle>(null);
  /** The user pressed Stop (or left): what arrives after that is kept, but does not start the agent again. */
  const halted = React.useRef(false);
  const takeStep = React.useRef<((call: { toolName: string; toolCallId: string; input: unknown }, again?: boolean) => void) | null>(null);
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
  const [stepping, setStepping] = React.useState(0);
  /** This conversation's own steps in flight. Stopping, or leaving, ends those and nobody else's. */
  const inFlight = React.useRef(0);
  const stopOwnSteps = React.useCallback(() => {
    if (inFlight.current > 0) stopBrowserTools();
  }, []);
  React.useEffect(() => {
    takeStep.current = (call, again = false) => {
      if (taken.current.has(call.toolCallId)) return;
      if (call.toolName === "requestUserAction") {
        taken.current.add(call.toolCallId);
        noteBrowserTask(conversationId, true);
        requestHandover(call.input, call.toolCallId);
        return;
      }
      if (!isBrowserTool(call.toolName)) return;
      taken.current.add(call.toolCallId);
      const tool = call.toolName;
      // There is one live browser. While another task is working in it, this one is told so instead of taking the page from under it.
      if (browserHolder && browserHolder !== conversationId && workingNow.has(browserHolder)) {
        void addToolOutput({ tool, toolCallId: call.toolCallId, output: BROWSER_BUSY });
        return;
      }
      browserHolder = conversationId;
      noteBrowserTask(conversationId, true);
      inFlight.current += 1;
      setStepping((n) => n + 1);
      // Not awaited here: the answer is written into the conversation when the step is done.
      void runBrowserTool({ tool, toolCallId: call.toolCallId, input: call.input, ...(again ? { again: true } : {}) })
        .then((output) => void addToolOutput({ tool, toolCallId: call.toolCallId, output }))
        .finally(() => {
          inFlight.current = Math.max(0, inFlight.current - 1);
          setStepping((n) => Math.max(0, n - 1));
        });
    };
    return () => {
      takeStep.current = null;
    };
  }, [addToolOutput, conversationId]);
  /* The conversation was opened with something still waiting in the live browser: the window was
     reloaded, the conversation was left and opened again, or the app was quit and started. Ask for
     it again, so the task picks up by itself.
     - A step: if the app still has it (it is waiting for the user's yes, say) the same answer
       comes back. If it does not, the app was closed in between: the step is not taken, the agent
       is told the page is gone, and it works its way back (asking for approval again).
     - The user's turn on a page: if the page is still in their hands, "Done" in the browser
       reaches this conversation as before. If the browser has closed, the agent is told so. */
  React.useEffect(() => {
    if (!desktop || readOnly) return;
    const last = seed.at(-1);
    if (last?.role !== "assistant") return;
    for (const part of last.parts) {
      if (!("state" in part) || part.state !== "input-available") continue;
      if (BROWSER_PARTS.has(part.type)) takeStep.current?.({ toolName: part.type.slice(5), toolCallId: part.toolCallId, input: part.input }, true);
      if (part.type !== "tool-requestUserAction" || taken.current.has(part.toolCallId) || liveCall.ownsHandover(part.toolCallId)) continue;
      const { toolCallId, input } = part;
      taken.current.add(toolCallId);
      void askBrowserState().then((state) => {
        if (state?.handover?.toolCallId === toolCallId) return;
        const free = !browserHolder || browserHolder === conversationId || !workingNow.has(browserHolder);
        // The page is still open but no longer in the user's hands: hand it to them again.
        if (state?.status === "ready" && free) {
          browserHolder = conversationId;
          requestHandover(input, toolCallId);
          return;
        }
        void addToolOutput({ tool: "requestUserAction", toolCallId, output: { status: "interrupted" } });
      });
    }
  }, [seed, desktop, readOnly, conversationId, addToolOutput]);

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;

  /* Work in progress: an answer being written, a step in the live browser, or the moment between
     a step coming back and the agent carrying on. While it lasts the conversation is kept alive
     when the user goes elsewhere. Pressing Stop ends it. */
  const [stopped, setStopped] = React.useState(false);
  const working = busy || stepping > 0 || (!stopped && !readOnly && answeredHere(messages));
  /* Waiting for the user in the live browser: the page is in their hands, or a step needs their
     yes. The task is not over, so the conversation stays alive when they look at another one
     ("Done" in the browser must still reach it), and the list says it is waiting for them. */
  const approvalId = useApprovalId();
  const theirTurn = Boolean(desktop) && !readOnly && !stopped && waitsFor(messages, "tool-requestUserAction");
  const theirYes = stepping > 0 && approvalId !== undefined && waitsFor(messages, undefined, approvalId);
  const alive = working || theirTurn;
  React.useEffect(() => {
    onWorking(conversationId, alive);
  }, [onWorking, conversationId, alive]);
  React.useEffect(() => () => onWorking(conversationId, false), [onWorking, conversationId]);
  React.useEffect(() => {
    onNeedsUser(conversationId, theirTurn || theirYes);
  }, [onNeedsUser, conversationId, theirTurn, theirYes]);
  React.useEffect(() => () => onNeedsUser(conversationId, false), [onNeedsUser, conversationId]);
  /* The server is told too, so it can reach a user who is not at the screen: the notice shows in
     the app at once, and an email follows if a minute later it is still waiting and they are
     away. When they have dealt with it the server is told that as well, and no email goes out.
     The step that is waiting names the report, so each one is told once. */
  const handover = theirTurn ? waitingPart(messages, "tool-requestUserAction") : undefined;
  const handoverInput = (handover?.input ?? {}) as { kind?: NeedsYou["what"]; reason?: string };
  const needsId = theirYes ? approvalId : handover?.toolCallId;
  const needsWhat: NonNullable<NeedsYou["what"]> = theirYes ? "approval" : (handoverInput.kind ?? "other");
  const needsText = theirYes ? undefined : handoverInput.reason;
  React.useEffect(() => {
    if (!needsId) return;
    let told = false;
    // A moment later, so a view that is put straight back (development does that) tells it once.
    const timer = setTimeout(() => {
      told = true;
      const approval = browserState().approval;
      const text = needsWhat === "approval" ? (approval?.toolCallId === needsId ? approval.summary : undefined) : needsText;
      reportNeedsYou({ conversationId, toolCallId: needsId, what: needsWhat, text });
    }, 400);
    return () => {
      clearTimeout(timer);
      if (told) reportNeedsYou({ conversationId, toolCallId: needsId, resolved: true });
    };
  }, [needsId, needsWhat, needsText, conversationId]);

  /* A task that is already running on the server (the page was reloaded or closed, or the task
     was started from another window): the conversation was opened as that task found it, and
     here its stream is asked for from the start. A dropped connection is picked up the same way. */
  const joined = React.useRef(false);
  React.useEffect(() => {
    if (!rejoin || joined.current) return;
    // A tick later, so that it happens once: in development React mounts a view, takes it down and
    // mounts it again, and the leaving code below would hang up on a request sent in between.
    const timer = setTimeout(() => {
      joined.current = true;
      halted.current = false;
      void sendMessage(undefined, { metadata: REJOIN });
    }, 0);
    return () => clearTimeout(timer);
  }, [rejoin, sendMessage]);
  const dropped = Boolean(error) && !isCapRefusal(error);
  const gone = Boolean(error && (error.message || "").includes(`"${RUN_GONE_CODE}"`));
  const retried = React.useRef(0);
  React.useEffect(() => {
    if (!dropped || readOnly) return;
    let cancelled = false;
    void fetchRunState(conversationId).then((run) => {
      if (cancelled) return;
      // The task ended between asking and joining: what it did is saved, so show that.
      if (!run.active && gone) {
        void loadMessages(conversationId).then((saved) => {
          if (cancelled) return;
          if (saved) setMessages(saved);
          clearError();
        });
        return;
      }
      // Nothing running: the error stands, with its "Try again". Three times in a row is not a blip.
      if (!run.active || !run.messages || retried.current >= 3) return;
      retried.current += 1;
      setMessages(run.messages);
      clearError();
      void sendMessage(undefined, { metadata: REJOIN });
    });
    return () => {
      cancelled = true;
    };
  }, [dropped, gone, readOnly, conversationId, setMessages, clearError, sendMessage]);

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
  // Leaving the conversation: stop any answer in progress, any call and its own steps in the browser, and save what there is.
  // It happens a tick later and is called off if the view is put straight back: in development
  // React takes a new view down and mounts it again, and that is not leaving. (Taken as leaving,
  // it would decline a step that is waiting for approval and keep the task from picking up.)
  const leaving = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => {
    clearTimeout(leaving.current);
    halted.current = false;
    return () => {
      halted.current = true;
      leaving.current = setTimeout(() => {
        if (liveCall.conversationId === conversationId) liveCall.end();
        stopOwnSteps();
        void stopRef.current();
        if (dirty.current && latest.current.length > 0) void persistConversation(conversationId, withoutPictures(latest.current), labelRef.current);
      }, 0);
    };
  }, [conversationId, stopOwnSteps]);

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
      setStopped(false);
      retried.current = 0;
      clearError();
      rememberHere(conversationId);
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
      rememberHere(conversationId);
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
      rememberHere(conversationId);
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
    setStopped(true);
    stopOwnSteps();
    void stopRunOnServer(conversationId);
    void stop();
    clearError();
    rememberHere(conversationId);
    setCallView("live");
    void liveCall.start({
      conversationId,
      context: () => ({ mode: live.mode, effort: live.effort, place: live.place, timeZone: live.timeZone, country: ZONES[live.timeZone]?.[1], coords: live.coords, locationDeclined: live.locationDeclined, browser: browserNote() }),
      getMessages: () => latest.current,
      setMessages: (update) => setMessages(update),
      locate: locateNow,
    });
  }, [conversationId, stop, clearError, setMessages, locateNow, stopOwnSteps]);
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
        if (liveCall.conversationId === conversationId) liveCall.handoverDone(answer, toolCallId);
        return;
      }
      // The browser belongs to the visitor, not to one conversation: only answer a request that is in this one.
      const pending = latest.current.some((m) => m.role === "assistant" && m.parts.some((p) => p.type === "tool-requestUserAction" && p.toolCallId === toolCallId && p.state === "input-available"));
      if (!toolCallId || !pending) return;
      followLatest();
      void addToolOutput({ tool: "requestUserAction", toolCallId, output: answer });
    },
    [addToolOutput, followLatest, conversationId],
  );

  React.useEffect(() => {
    registerHandover(conversationId, answerHandover);
    return () => registerHandover(conversationId, null);
  }, [registerHandover, conversationId, answerHandover]);

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
  const alreadyRunning = Boolean(error && (error.message || "").includes(`"${RUN_ACTIVE_CODE}"`));
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
  // A call belongs to the conversation on screen: leaving it ends the call, though not the task.
  React.useEffect(() => {
    if (hidden && liveCall.conversationId === conversationId) liveCall.end();
  }, [hidden, conversationId]);
  // Reaching the limit ends a call too.
  React.useEffect(() => {
    if (capped && liveCall.conversationId === conversationId) liveCall.end();
  }, [capped, conversationId]);
  const last = messages.at(-1);
  const waitingForFirstToken = status === "submitted" && last?.role === "user";

  return (
    <>
      {hidden ? null : <LayoutBridge target={openBrowser} onBeside={onBrowserBeside} onGone={onBrowserGone} />}
      <TopBar usage={usage} title={empty ? undefined : title} onNewChat={onNewTask} onOpenChat={onOpenChat} showNew={!empty} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
      <CapDialog open={capOpen && !hidden} onOpenChange={setCapOpen} />

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
          <Welcome place={location?.label ?? approximatePlace} onPick={(prompt) => composer.current?.fill(prompt)} onTalk={readOnly ? undefined : startCall} />
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
            {error && !readOnly && !refused && !alreadyRunning && !gone ? (
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
          {/* Working for a while in one go, and not waiting on the user: offer to tell them when it is done. */}
          {working && !theirYes && !hidden && !readOnly && !capped && !calling ? <SlowNote conversationId={conversationId} /> : null}
          {readOnly ? (
            <ReadOnlyNote startedIn={startedIn ?? "web"} onNewTask={onNewTask} />
          ) : capped ? (
            <CapNote onDetails={() => setCapOpen(true)} />
          ) : (
          <Composer
            ref={composer}
            onSend={send}
            onTalk={calling ? undefined : startCall}
            inCall={calling}
            onStop={() => {
              // Stop is the one thing that ends a task: the server is told, since leaving the page no longer does it.
              // It also ends a step in the live browser; a step waiting for approval counts as declined.
              halted.current = true;
              setStopped(true);
              stopOwnSteps();
              void stopRunOnServer(conversationId);
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
          <p className="mt-2 hidden text-center text-[0.7rem] text-subtle @min-[520px]/chat:block">Answers come from the live web. Double-check anything important.</p>
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
            ? `This chat started in the ${APP_NAME} desktop app. Open it there to continue.`
            : `This chat started on the web. Open it there to continue, or start a new one here.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onNewTask}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
      >
        <Plus className="size-4" />
        New chat
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

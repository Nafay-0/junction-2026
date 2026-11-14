"use client";

import * as React from "react";
import { IDLE_STATE, type AgentAction, type BrowserEvent, type BrowserState, type ControlRequest, type UserInput } from "./protocol";

/**
 * The interface's side of the live browser: one connection per browser id, shared by every
 * component that shows it (the pane, the inline card, the layout that opens by itself).
 *
 * State and the agent's latest action go through React. Frames do not: at ten or more a second
 * they would re-render everything, so a view subscribes to them directly and paints them itself.
 * What the user types or clicks while in control is sent in small batches and never logged.
 */

export type BrowserSnapshot = {
  state: BrowserState;
  /** The agent's most recent step. Its `id` changes with every new one. */
  action: AgentAction | null;
  /**
   * True while that step is happening. A step is news once: when a view is opened again, or the
   * agent gets the page back, the last step must not play a second time as if it were new.
   */
  fresh: boolean;
  /** False before the first message arrives and while the connection is being restored. */
  connected: boolean;
};

export type BrowserFrame = { data: string; width: number; height: number };

type FrameListener = (frame: BrowserFrame) => void;
type Watcher = (next: BrowserState, previous: BrowserState) => void;

export type MockHandlers = {
  /** Called with what the interface would have sent to the page. */
  onInput?: (events: UserInput[]) => void;
  /** Return the state a control request leads to. Without it, a sensible default applies. */
  onControl?: (request: ControlRequest, state: BrowserState) => BrowserState;
};

type Entry = {
  id: string;
  snapshot: BrowserSnapshot;
  listeners: Set<() => void>;
  watchers: Set<Watcher>;
  frameListeners: Set<FrameListener>;
  lastFrame: BrowserFrame | null;
  /** How many components are using this browser. The connection lives while this is above zero. */
  users: number;
  source: EventSource | null;
  retries: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  closeTimer: ReturnType<typeof setTimeout> | undefined;
  mock: MockHandlers | null;
  /** Ends the life of the step being shown. */
  actionTimer: ReturnType<typeof setTimeout> | undefined;
  /** Input waiting to be sent, and the send in flight (batches go out one at a time, in order). */
  queue: UserInput[];
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  sending: Promise<void>;
};

const DISCONNECTED: BrowserSnapshot = { state: IDLE_STATE, action: null, fresh: false, connected: false };
/** How long after it starts a step still counts as happening: long enough for its drawing to finish. */
const STEP_LIFE_MS = 4500;
const entries = new Map<string, Entry>();

function entryFor(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    entry = {
      id,
      snapshot: DISCONNECTED,
      listeners: new Set(),
      watchers: new Set(),
      frameListeners: new Set(),
      lastFrame: null,
      users: 0,
      source: null,
      retries: 0,
      retryTimer: undefined,
      closeTimer: undefined,
      mock: null,
      actionTimer: undefined,
      queue: [],
      flushTimer: undefined,
      sending: Promise.resolve(),
    };
    entries.set(id, entry);
  }
  return entry;
}

function update(entry: Entry, patch: Partial<BrowserSnapshot>) {
  const previous = entry.snapshot;
  entry.snapshot = { ...previous, ...patch };
  entry.listeners.forEach((listener) => listener());
  if (patch.state && patch.state !== previous.state) entry.watchers.forEach((watcher) => watcher(entry.snapshot.state, previous.state));
}

function receive(entry: Entry, event: BrowserEvent) {
  if (event.type === "frame") {
    entry.lastFrame = { data: event.data, width: event.width, height: event.height };
    entry.frameListeners.forEach((listener) => listener(entry.lastFrame!));
  } else if (event.type === "state") {
    // No page, no step: a browser that was closed and opened again starts with a clean view.
    if (event.state.status !== "ready" && entry.snapshot.action) {
      clearTimeout(entry.actionTimer);
      update(entry, { state: event.state, action: null, fresh: false });
    } else update(entry, { state: event.state });
  } else if (event.type === "action") {
    update(entry, { action: event.action, fresh: true });
    clearTimeout(entry.actionTimer);
    entry.actionTimer = setTimeout(() => {
      if (entry.snapshot.action?.id === event.action.id) update(entry, { fresh: false });
    }, event.action.leadMs + STEP_LIFE_MS);
  }
}

function connect(entry: Entry) {
  if (entry.mock || entry.source || typeof EventSource === "undefined") return;
  const source = new EventSource(`/api/browser/stream?id=${encodeURIComponent(entry.id)}`);
  entry.source = source;
  source.onopen = () => {
    entry.retries = 0;
    update(entry, { connected: true });
  };
  source.onmessage = (message) => {
    try {
      receive(entry, JSON.parse(message.data as string) as BrowserEvent);
    } catch {
      /* a malformed message is dropped; the next state message puts things right */
    }
  };
  source.onerror = () => {
    if (entry.snapshot.connected) update(entry, { connected: false });
    // The browser retries a dropped connection by itself. A refused one (no server yet) is closed
    // for good, so try again here, a little later each time.
    if (source.readyState !== EventSource.CLOSED) return;
    source.close();
    if (entry.source === source) entry.source = null;
    if (entry.users === 0) return;
    const wait = Math.min(15_000, 1000 * 2 ** entry.retries);
    entry.retries += 1;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => {
      if (entry.users > 0) connect(entry);
    }, wait);
  };
}

function disconnect(entry: Entry) {
  clearTimeout(entry.retryTimer);
  entry.source?.close();
  entry.source = null;
  if (!entry.mock && entry.snapshot.connected) update(entry, { connected: false });
}

function acquire(id: string): () => void {
  const entry = entryFor(id);
  entry.users += 1;
  clearTimeout(entry.closeTimer);
  connect(entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.users -= 1;
    if (entry.users > 0) return;
    // Components often remount (a new conversation, a layout change): keep the line open briefly.
    entry.closeTimer = setTimeout(() => {
      if (entry.users === 0) disconnect(entry);
    }, 4000);
  };
}

/** The live browser's state and the agent's latest step. Connects while mounted. An empty id gives the idle state. */
export function useBrowser(id: string): BrowserSnapshot {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!id) return () => {};
      const entry = entryFor(id);
      entry.listeners.add(onChange);
      const release = acquire(id);
      return () => {
        entry.listeners.delete(onChange);
        release();
      };
    },
    [id],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => (id ? entryFor(id).snapshot : DISCONNECTED),
    () => DISCONNECTED,
  );
}

/** Follow state changes outside rendering: `listener(next, previous)` on every change. Returns the way to stop. */
export function watchBrowser(id: string, listener: Watcher): () => void {
  if (!id) return () => {};
  const entry = entryFor(id);
  entry.watchers.add(listener);
  const release = acquire(id);
  return () => {
    entry.watchers.delete(listener);
    release();
  };
}

/**
 * Receive every picture of the page. The newest one is delivered at once, so a view that mounts
 * late is not blank. Paint it yourself (set an image's `src`); do not put frames in React state.
 */
export function subscribeFrames(id: string, listener: FrameListener): () => void {
  if (!id) return () => {};
  const entry = entryFor(id);
  entry.frameListeners.add(listener);
  if (entry.lastFrame) listener(entry.lastFrame);
  const release = acquire(id);
  return () => {
    entry.frameListeners.delete(listener);
    release();
  };
}

/** A frame as an image address. */
export const frameSrc = (frame: BrowserFrame) => `data:image/jpeg;base64,${frame.data}`;

const FLUSH_MS = 30;

/** Send what the user did in the live view. Batched, in order; nothing is logged or kept. */
export function sendInput(id: string, events: UserInput[]) {
  if (!id || events.length === 0) return;
  const entry = entryFor(id);
  for (const event of events) {
    const last = entry.queue.at(-1);
    if (event.type === "mouse" && event.action === "move" && last?.type === "mouse" && last.action === "move") {
      entry.queue[entry.queue.length - 1] = event;
    } else if (event.type === "wheel" && last?.type === "wheel") {
      entry.queue[entry.queue.length - 1] = { ...event, deltaX: last.deltaX + event.deltaX, deltaY: last.deltaY + event.deltaY };
    } else {
      entry.queue.push(event);
    }
  }
  if (entry.flushTimer) return;
  entry.flushTimer = setTimeout(() => flush(entry), FLUSH_MS);
}

function flush(entry: Entry) {
  entry.flushTimer = undefined;
  const batch = entry.queue;
  if (batch.length === 0) return;
  entry.queue = [];
  if (entry.mock) {
    entry.mock.onInput?.(batch);
    return;
  }
  entry.sending = entry.sending
    .then(() =>
      fetch(`/api/browser/input?id=${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      }),
    )
    .then(
      () => undefined,
      () => undefined,
    );
}

function mockControl(request: ControlRequest, state: BrowserState): BrowserState {
  switch (request.action) {
    case "take":
      return { ...state, control: "user", busy: false, activity: "" };
    case "release":
      return { ...state, control: "agent", handover: undefined };
    case "navigate":
      return { ...state, status: "ready", url: request.url, title: request.url, loading: false };
    case "tab":
      return { ...state, tabs: state.tabs.map((tab) => ({ ...tab, active: tab.id === request.tabId })) };
    case "close":
      return { ...IDLE_STATE, status: "closed" };
    case "forget":
      return { ...IDLE_STATE };
    default:
      return state;
  }
}

/** Ask the browser to do something on the user's behalf: take over, hand back, go back, close. */
export async function control(id: string, request: ControlRequest): Promise<BrowserState> {
  const entry = entryFor(id);
  if (entry.mock) {
    const next = (entry.mock.onControl ?? mockControl)(request, entry.snapshot.state);
    update(entry, { state: next });
    return next;
  }
  const response = await fetch(`/api/browser/control?id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await problemOf(response));
  const next = (await response.json()) as BrowserState;
  // The stream sends the same state a moment later; applying it now makes the button feel instant.
  update(entry, { state: next });
  return next;
}

async function problemOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return "The browser did not respond.";
}

/**
 * A stand-in for the server, for development: events you `emit` reach every component exactly as
 * real ones would, and what the interface sends back goes to `handlers`.
 */
export function mockBrowser(id: string, handlers: MockHandlers = {}): { emit: (event: BrowserEvent) => void; setConnected: (connected: boolean) => void; stop: () => void } {
  const entry = entryFor(id);
  disconnect(entry);
  entry.mock = handlers;
  update(entry, { connected: true });
  return {
    emit: (event) => receive(entry, event),
    setConnected: (connected) => update(entry, { connected }),
    stop: () => {
      entry.mock = null;
      entry.lastFrame = null;
      update(entry, { state: IDLE_STATE, action: null, fresh: false, connected: false });
      if (entry.users > 0) connect(entry);
    },
  };
}

const ID_KEY = "hovi.browser";
let cachedId = "";

function readOrCreateId(): string {
  if (cachedId) return cachedId;
  let id = "";
  try {
    id = window.localStorage.getItem(ID_KEY) ?? "";
  } catch {
    /* storage blocked: an id for this visit only */
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.localStorage.setItem(ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
  cachedId = id;
  return id;
}

const never = () => () => {};

/** This visitor's live browser. Stable across visits; "" while the page is still hydrating. */
export function useBrowserId(): string {
  return React.useSyncExternalStore(never, readOrCreateId, () => "");
}

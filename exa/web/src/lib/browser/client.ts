"use client";

import * as React from "react";
import { IDLE_STATE, type AgentAction, type BrowserCall, type BrowserEvent, type BrowserState, type BrowserStepData, type ControlRequest } from "./protocol";

/**
 * The interface's side of the live browser: one store, shared by every component that shows it
 * (the pane, the trail of steps in the chat, the layout that opens by itself).
 *
 * The browser lives in the desktop app. In a web browser there is none: the store stays idle,
 * nothing is connected, and asking for a step says so.
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
  /** True in the desktop app once its browser engine has answered. Always false on the web. */
  connected: boolean;
};

type Watcher = (next: BrowserState, previous: BrowserState) => void;

const DISCONNECTED: BrowserSnapshot = { state: IDLE_STATE, action: null, fresh: false, connected: false };
/** How long after it starts a step still counts as happening: long enough for its drawing to finish. */
const STEP_LIFE_MS = 4500;

let snapshot: BrowserSnapshot = DISCONNECTED;
const listeners = new Set<() => void>();
const watchers = new Set<Watcher>();
let actionTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const desktop = () => (typeof window === "undefined" ? undefined : window.berylDesktop);

function update(patch: Partial<BrowserSnapshot>) {
  const previous = snapshot;
  snapshot = { ...previous, ...patch };
  listeners.forEach((listener) => listener());
  if (patch.state && patch.state !== previous.state) watchers.forEach((watcher) => watcher(snapshot.state, previous.state));
}

function receive(event: BrowserEvent) {
  if (event.type === "state") {
    // No page, no step: a browser that was closed and opened again starts with a clean view.
    if (event.state.status !== "ready" && snapshot.action) {
      clearTimeout(actionTimer);
      update({ state: event.state, action: null, fresh: false });
    } else update({ state: event.state });
  } else if (event.type === "action") {
    update({ action: event.action, fresh: true });
    clearTimeout(actionTimer);
    actionTimer = setTimeout(() => {
      if (snapshot.action?.id === event.action.id) update({ fresh: false });
    }, event.action.leadMs + STEP_LIFE_MS);
  }
}

/** Listen to the app's browser engine. Once, for the life of the page. */
function connect() {
  const app = desktop();
  if (started || !app) return;
  started = true;
  app.browser.subscribe(receive);
  void app.browser.state().then(
    (state) => {
      if (state) update({ state, connected: true });
    },
    () => {},
  );
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  connect();
  return () => {
    listeners.delete(onChange);
  };
}

/** The live browser's state and the agent's latest step. Idle and not connected outside the desktop app. */
export function useBrowser(): BrowserSnapshot {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => DISCONNECTED,
  );
}

/** The state right now, outside rendering. */
export const browserState = (): BrowserState => snapshot.state;

/** Follow state changes outside rendering: `listener(next, previous)` on every change. Returns the way to stop. */
export function watchBrowser(listener: Watcher): () => void {
  watchers.add(listener);
  connect();
  return () => {
    watchers.delete(listener);
  };
}

/** Ask the browser to do something on the user's behalf: take over, hand back, go back, approve a step, close. */
export async function control(request: ControlRequest): Promise<BrowserState> {
  const app = desktop();
  if (!app) throw new Error("The live browser is part of the desktop app.");
  const next = await app.browser.control(request);
  // The engine sends the same state a moment later; applying it now makes the button feel instant.
  if (next) update({ state: next });
  return next ?? snapshot.state;
}

/** What a step answers with when there is no browser to take it in. */
function noBrowser(call: BrowserCall): BrowserStepData {
  const problem = "The live browser is part of the desktop app, and this conversation is open on the web. Nothing was done on the site. Tell the user that acting on websites needs the Beryl desktop app.";
  return { kind: "browser", label: "The live browser is in the desktop app", action: call.tool === "browserOpen" ? "open" : call.tool === "browserClose" ? "close" : "read", url: "", title: "", ok: false, problem, page: problem, sources: [] };
}

/** Take one of the agent's steps in the live browser. Never rejects: a step that could not be taken says why. */
export async function runBrowserTool(call: BrowserCall): Promise<BrowserStepData> {
  const app = desktop();
  if (!app) return noBrowser(call);
  try {
    return (await app.browser.run(call)) ?? noBrowser(call);
  } catch (err) {
    const problem = err instanceof Error ? err.message : "The browser did not respond.";
    return { ...noBrowser(call), label: "That step did not work", problem, page: `NOT DONE. ${problem}` };
  }
}

/** The user pressed Stop: steps in flight end, and a step waiting for approval counts as declined. */
export function stopBrowserTools() {
  void desktop()?.browser.stop().catch(() => {});
}

/** The agent has asked the user to step in: the page is theirs until they hand it back. */
export function requestHandover(input: unknown, toolCallId: string) {
  void desktop()?.browser.handover(input, toolCallId).catch(() => {});
}

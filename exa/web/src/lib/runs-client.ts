"use client";

import * as React from "react";
import { api } from "@/lib/auth/fetch";
import type { ButlerMessage } from "@/lib/agent/tools";
import type { RunList, RunState } from "@/lib/run-state";

/*
 * Tasks that keep running, as the interface knows them. The server owns a task once it has
 * started: leaving the page does not stop it. Here the interface asks whether a conversation has
 * one running (to pick it up again), asks for the list of running ones (to mark them beside the
 * chat), and tells the server when the user really means Stop.
 */

/** Whether a task is running in this conversation, and if so the conversation as it was when the task began. */
export async function fetchRunState(id: string): Promise<{ active: boolean; messages?: ButlerMessage[] }> {
  try {
    const response = await api(`/api/chat/${encodeURIComponent(id)}/run`);
    if (!response.ok) return { active: false };
    const state = (await response.json()) as RunState;
    return state.active ? { active: true, messages: state.messages as ButlerMessage[] } : { active: false };
  } catch {
    return { active: false };
  }
}

/** The user pressed Stop: end the task on the server. Closing the page is not this. */
export async function stopRunOnServer(id: string): Promise<void> {
  try {
    await api(`/api/chat/${encodeURIComponent(id)}/run`, { method: "DELETE" });
  } catch {
    /* offline: the task carries on, and Stop can be pressed again */
  }
  void refreshRunning();
}

/* ───────── The list of running tasks ───────── */

const NONE: string[] = [];
let running: string[] = NONE;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Ask the server which of this account's conversations have a task running. */
export async function refreshRunning(): Promise<string[]> {
  try {
    const response = await api("/api/chat/runs");
    if (response.ok) {
      const next = ((await response.json()) as RunList).running.map((run) => run.id);
      if (next.length !== running.length || next.some((id, i) => id !== running[i])) {
        running = next.length ? next : NONE;
        listeners.forEach((listener) => listener());
      }
    }
  } catch {
    /* offline: what was known stands */
  }
  return running;
}

/**
 * The conversations with a task running on the server. Asked once when the app opens, and then
 * every few seconds for as long as something is running, here or there.
 */
export function useRunning(alsoWatch: boolean): string[] {
  const list = React.useSyncExternalStore(
    subscribe,
    () => running,
    () => NONE,
  );
  const watching = alsoWatch || list.length > 0;
  React.useEffect(() => {
    void refreshRunning();
  }, []);
  React.useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void refreshRunning(), 4000);
    return () => clearInterval(timer);
  }, [watching]);
  return list;
}

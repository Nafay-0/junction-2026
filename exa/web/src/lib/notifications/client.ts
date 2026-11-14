"use client";

import * as React from "react";
import { api } from "@/lib/auth/fetch";
import { DEFAULT_NOTIFY, PRESENCE_EVERY_MS, cleanNotify, type NotificationItem, type NotificationList, type NotifyPrefs } from "./types";

/*
 * Notifications, on the interface's side: the list behind the bell, and the heartbeat that tells
 * the server this window is in front of its user (so it does not email them about something they
 * can see here). One request does both: every few seconds a window that is visible and focused
 * says so, and the answer carries the latest notices. It runs on the web and in the desktop app
 * alike, from the moment anything on the page asks for the list.
 *
 * A notice that arrives while the page is open is announced once (a toast, see butler.tsx); what
 * was already there when the page loaded only shows in the bell.
 */

type Snapshot = NotificationList & { loaded: boolean };

const EMPTY: Snapshot = { items: [], unread: 0, loaded: false };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
/** Called with each notice that is new since the last look. */
const announcers = new Set<(item: NotificationItem) => void>();
/** Every notice seen so far. Null until the first list has arrived: nothing is announced before that. */
let known: Set<string> | null = null;
let started = false;

/** Tells this window apart from the account's other ones. New with every page load. */
const windowId = (() => {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined") crypto.getRandomValues(bytes);
  return `w${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("")}`.slice(0, 24);
})();

const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";
/** In front of the user: the page is showing and it is the window they are working in. */
const here = () => visible() && document.hasFocus();

function publish(list: NotificationList) {
  snapshot = { items: list.items, unread: list.unread, loaded: true };
  if (known === null) known = new Set(list.items.map((item) => item.id));
  else {
    // Newest first in the list; announced oldest first, and never more than a few at once.
    const fresh = list.items.filter((item) => !known!.has(item.id));
    for (const item of fresh) known.add(item.id);
    for (const item of fresh.filter((n) => !n.read).slice(0, 3).reverse()) announcers.forEach((announce) => announce(item));
  }
  listeners.forEach((listener) => listener());
}

async function take(response: Response) {
  if (!response.ok || response.status === 204) return;
  const list = (await response.json()) as NotificationList;
  if (Array.isArray(list.items)) publish(list);
}

let beating = false;
/** Say whether this window is in front, and take the latest notices from the answer. */
async function beat() {
  if (beating) return;
  beating = true;
  try {
    await take(await api("/api/presence", { method: "POST", json: { windowId, here: here() } }));
  } catch {
    /* offline: the next beat tries again */
  } finally {
    beating = false;
  }
}

/** Fetch the list without saying anything about presence. */
export async function refreshNotifications(): Promise<void> {
  try {
    await take(await api("/api/notifications"));
  } catch {
    /* offline */
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  let last = here();
  const look = () => {
    const now = here();
    // Coming to the front, or leaving it: say so at once. Coming back also brings what was missed.
    if (now !== last) {
      last = now;
      void beat();
    }
  };
  void (here() ? beat() : refreshNotifications());
  window.setInterval(() => {
    last = here();
    if (last) void beat();
    // Showing but not the window in use (beside another app, say): keep the bell fresh without claiming to be in front.
    else if (visible()) void refreshNotifications();
  }, PRESENCE_EVERY_MS);
  window.addEventListener("focus", look);
  window.addEventListener("blur", look);
  document.addEventListener("visibilitychange", look);
  // The page is going away: one last word, sent in a way that survives the page.
  window.addEventListener("pagehide", () => {
    try {
      navigator.sendBeacon("/api/presence", new Blob([JSON.stringify({ windowId, here: false })], { type: "application/json" }));
    } catch {
      /* the server stops counting this window a minute after its last beat anyway */
    }
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  start();
  return () => {
    listeners.delete(onChange);
  };
}

/** The account's notifications and how many are unread. Starts the heartbeat. */
export function useNotifications(): Snapshot {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

/** Be told about each notice that arrives while the page is open. Returns the way to stop. Starts the heartbeat. */
export function onNewNotification(announce: (item: NotificationItem) => void): () => void {
  announcers.add(announce);
  start();
  return () => {
    announcers.delete(announce);
  };
}

/** Mark some notices, or all of them, as read. Shown at once; the server follows. */
export async function markNotificationsRead(ids: string[] | "all"): Promise<void> {
  const hit = (item: NotificationItem) => !item.read && (ids === "all" || ids.includes(item.id));
  if (!snapshot.items.some(hit)) return;
  const items = snapshot.items.map((item) => (hit(item) ? { ...item, read: true } : item));
  snapshot = { ...snapshot, items, unread: ids === "all" ? 0 : Math.max(0, snapshot.unread - snapshot.items.filter(hit).length) };
  listeners.forEach((listener) => listener());
  try {
    await take(await api("/api/notifications", { method: "POST", json: { action: "read", ids } }));
  } catch {
    /* the next look puts it right */
  }
}

/** Remove every notice. */
export async function clearNotifications(): Promise<void> {
  snapshot = { ...snapshot, items: [], unread: 0 };
  listeners.forEach((listener) => listener());
  try {
    await take(await api("/api/notifications", { method: "DELETE" }));
  } catch {
    /* the next look puts it right */
  }
}

/* ───────── Settings ───────── */

export async function fetchNotifyPrefs(): Promise<NotifyPrefs> {
  try {
    const response = await api("/api/notifications/settings");
    return response.ok ? cleanNotify(await response.json()) : DEFAULT_NOTIFY;
  } catch {
    return DEFAULT_NOTIFY;
  }
}

/** Change some switches. What comes back is what is now in force, or null when it could not be saved. */
export async function saveNotifyPrefs(change: Partial<NotifyPrefs>): Promise<NotifyPrefs | null> {
  try {
    const response = await api("/api/notifications/settings", { method: "PUT", json: change });
    return response.ok ? cleanNotify(await response.json()) : null;
  } catch {
    return null;
  }
}

/* ───────── "Tell me when it's done" ───────── */

export type NotifyWhenDone = { on: boolean; workingForMs?: number };

export async function fetchNotifyWhenDone(conversationId: string): Promise<NotifyWhenDone> {
  try {
    const response = await api(`/api/chat/${encodeURIComponent(conversationId)}/notify`);
    return response.ok ? ((await response.json()) as NotifyWhenDone) : { on: false };
  } catch {
    return { on: false };
  }
}

/** Ask to be told when this chat is done, or take that back. True when the server has it. */
export async function setNotifyWhenDone(conversationId: string, on: boolean): Promise<boolean> {
  try {
    const response = await api(`/api/chat/${encodeURIComponent(conversationId)}/notify`, { method: "POST", json: { on } });
    return response.ok;
  } catch {
    return false;
  }
}

/* ───────── The live browser is waiting for the user ───────── */

export type NeedsYou = {
  conversationId: string;
  /** The step that is waiting: the approval's id, or the hand-over request's. */
  toolCallId: string;
  what?: "approval" | "login" | "captcha" | "verification" | "payment" | "other";
  text?: string;
  /** The user has dealt with it. */
  resolved?: boolean;
};

/** Tell the server the live browser is waiting for the user, or that it no longer is. Never throws. */
export function reportNeedsYou(report: NeedsYou): void {
  void api("/api/notifications/needs-you", { method: "POST", json: { ...report, text: report.text?.slice(0, 600) }, keepalive: true })
    .then(() => (report.resolved ? refreshNotifications() : undefined))
    .catch(() => {});
}

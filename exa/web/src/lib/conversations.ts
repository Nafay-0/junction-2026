"use client";

import * as React from "react";
import { isVoice } from "@/lib/agent/stats";
import type { ButlerMessage } from "@/lib/agent/tools";
import { api } from "@/lib/auth/fetch";
import { BROWSER_TOOL_NAMES } from "@/lib/browser/protocol";
import { clientKind, type ClientKind } from "@/lib/client-kind";

/**
 * Saved conversations. They live in the account, on the server (Postgres, through
 * /api/conversations), so they are there on every device the user signs in on. This file is the
 * interface's side of that: a list that stays fresh in memory, and writes that go out one at a
 * time. Nothing about a conversation is kept in the browser any more.
 *
 * A conversation belongs to the kind of client it was started in (`origin`): the web, or the
 * desktop app. From the other kind it can be read, renamed and deleted, but not added to, and the
 * server refuses a save (409).
 */

export type ConversationMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The model used for the latest answer, for display. */
  modelLabel?: string;
  /** Where the conversation was started. It never changes. */
  origin: ClientKind;
};

const EMPTY: ConversationMeta[] = [];
const path = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

/* ───────── A tiny external store so React components re-render when the list changes ───────── */

let snapshot: ConversationMeta[] = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
let refreshedAt = 0;
let watching = false;
const listeners = new Set<() => void>();
/** Conversations deleted here while a save was still on its way: that save must not bring them back. */
const deleted = new Set<string>();
/** Names given here that the server does not have yet (the conversation had not been saved when it was renamed). */
const renamed = new Map<string, string>();

function publish(next: ConversationMeta[]) {
  snapshot = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
  listeners.forEach((l) => l());
}

/** Fetch the list from the server. What is being saved here right now is kept on top of it. */
function refresh(): Promise<void> {
  loading ??= (async () => {
    try {
      const response = await api("/api/conversations");
      if (!response.ok) return;
      const { conversations } = (await response.json()) as { conversations: ConversationMeta[] };
      const merged = new Map(conversations.filter((c) => !deleted.has(c.id)).map((c) => [c.id, c]));
      const now = Date.now();
      for (const local of snapshot) {
        const remote = merged.get(local.id);
        if (remote) {
          // Newer here: a save is on its way. A name the server has not heard of yet stays too.
          merged.set(local.id, { ...remote, updatedAt: Math.max(remote.updatedAt, local.updatedAt), title: renamed.get(local.id) ?? remote.title });
        } else if (sending.has(local.id) || waiting.has(local.id) || now - local.updatedAt < 120_000) {
          // Not on the server yet: it was just started here. (One the server no longer has was deleted elsewhere.)
          merged.set(local.id, local);
        }
      }
      loaded = true;
      refreshedAt = now;
      publish([...merged.values()]);
    } catch {
      /* offline: the list stays as it is, and the next look tries again */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!loaded) void refresh();
  // The same account may be at work on another device: look again when this window is returned to.
  if (!watching && typeof window !== "undefined") {
    watching = true;
    const look = () => {
      if (document.visibilityState === "visible" && loaded && Date.now() - refreshedAt > 30_000) void refresh();
    };
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
  }
  return () => {
    listeners.delete(onChange);
  };
}

/** The saved conversations, newest first. Empty until the first read finishes. */
export function useConversations(): ConversationMeta[] {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

/* ───────── Reads ───────── */

/** A conversation with its messages, or null when this account has no such conversation. */
export async function loadConversation(id: string): Promise<{ meta: ConversationMeta; messages: ButlerMessage[] } | null> {
  try {
    const response = await api(path(id));
    if (!response.ok) return null;
    const { meta, messages } = (await response.json()) as { meta: ConversationMeta; messages: ButlerMessage[] };
    // In the desktop app, a recent conversation of its own may be waiting on a step in the live
    // browser or on the user there: that is picked up again, not closed off.
    const pickUp = clientKind() === "desktop" && meta.origin === "desktop" && Date.now() - meta.updatedAt < PICK_UP_WITHIN_MS;
    return { meta, messages: settle(messages, pickUp) };
  } catch {
    return null;
  }
}

export async function loadMessages(id: string): Promise<ButlerMessage[] | null> {
  return (await loadConversation(id))?.messages ?? null;
}

/* ───────── Writes ─────────
 * The chat saves every few seconds while an answer is being written, with the whole message list
 * each time. For one conversation only one save is on its way at a time; if more arrive while it
 * is, only the newest waits and the ones in between are dropped. */

type Write = { meta: ConversationMeta; messages: ButlerMessage[]; done: Array<() => void>; tries: number };
const waiting = new Map<string, Write>();
const sending = new Set<string>();
/** Conversations the server said are read-only here: no point in sending them again. */
const readOnly = new Set<string>();
/** How long to wait before sending a failed save again: three more tries, then it is left to the next save. */
const RETRY_MS = [2000, 6000, 15_000];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Send one write. True when there is nothing more to do for it (saved, or refused for good). */
async function put(id: string, write: Write): Promise<boolean> {
  if (deleted.has(id) || readOnly.has(id)) return true;
  try {
    const response = await api(path(id), { method: "PUT", json: { title: write.meta.title, modelLabel: write.meta.modelLabel, messages: write.messages } });
    if (response.status === 409) readOnly.add(id);
    if (response.ok) {
      // A name given before the first save reached the server goes after it now.
      const name = renamed.get(id);
      if (name) {
        renamed.delete(id);
        void api(path(id), { method: "PATCH", json: { title: name } }).catch(() => {});
      }
    }
    // Worth another try only when the server itself was in trouble; a refusal (4xx) will not change.
    return response.status < 500;
  } catch {
    return false; // offline, or the server is away
  }
}

async function send(id: string): Promise<void> {
  if (sending.has(id)) return;
  sending.add(id);
  try {
    for (let write = waiting.get(id); write; write = waiting.get(id)) {
      waiting.delete(id);
      const settled = await put(id, write);
      if (!settled && write.tries < RETRY_MS.length) {
        // Put it back unless something newer arrived meanwhile (which carries everything this one had).
        const newer = waiting.get(id);
        if (newer) newer.done.push(...write.done);
        else waiting.set(id, { ...write, tries: write.tries + 1 });
        await pause(RETRY_MS[write.tries]);
        continue;
      }
      // A save that could not be sent is dropped quietly: the conversation still works for this visit, and the next save carries everything.
      if (!settled) console.warn("[conversations] could not save this conversation; it will be tried again with the next change");
      write.done.forEach((resolve) => resolve());
    }
  } finally {
    sending.delete(id);
  }
}

/** Save a conversation. Resolves when this write, or a newer one that replaced it, has been sent. Never rejects. */
export function saveConversation(meta: ConversationMeta, messages: ButlerMessage[]): Promise<void> {
  if (deleted.has(meta.id)) return Promise.resolve();
  publish([meta, ...snapshot.filter((c) => c.id !== meta.id)]);
  return new Promise((resolve) => {
    const earlier = waiting.get(meta.id);
    waiting.set(meta.id, { meta, messages, done: [...(earlier?.done ?? []), resolve], tries: 0 });
    void send(meta.id);
  });
}

/** Save a conversation after activity, keeping its title (the user may have renamed it), creation time and origin. */
export function persistConversation(id: string, messages: ButlerMessage[], modelLabel?: string): Promise<void> {
  const existing = snapshot.find((c) => c.id === id);
  const now = Date.now();
  return saveConversation(
    { id, title: existing?.title ?? titleFrom(messages), createdAt: existing?.createdAt ?? now, updatedAt: now, modelLabel, origin: existing?.origin ?? clientKind() },
    messages,
  );
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const current = snapshot.find((c) => c.id === id);
  const next = title.trim();
  if (!current || !next) return;
  // The list first, so the new name shows at once.
  publish(snapshot.map((c) => (c.id === id ? { ...c, title: next } : c)));
  try {
    const response = await api(path(id), { method: "PATCH", json: { title: next } });
    // Not on the server yet (its first save is still on the way): the name follows that save.
    if (response.status === 404) renamed.set(id, next);
  } catch {
    renamed.set(id, next);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  deleted.add(id);
  waiting.delete(id);
  publish(snapshot.filter((c) => c.id !== id));
  try {
    await api(path(id), { method: "DELETE" });
  } catch {
    /* it is gone from the list; the server copy goes with the next successful delete */
  }
}

export async function deleteAllConversations(): Promise<void> {
  for (const c of snapshot) deleted.add(c.id);
  waiting.clear();
  publish([]);
  try {
    await api("/api/conversations", { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

export function newConversationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const titleOf = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 72 ? `${clean.slice(0, 70).trimEnd()}…` : clean;
};

/** A title from the first thing the user asked. */
export function titleFrom(messages: ButlerMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.find((p) => p.type === "text");
  const title = titleOf(text && text.type === "text" ? text.text : "");
  if (!title) return first?.parts.some((p) => p.type === "file") ? "Image search" : "New task";
  return title;
}

/**
 * The first message was edited and sent again: the title follows it, unless the user gave the
 * conversation a name of their own. `before` is the conversation as it was before the edit.
 */
export function retitleAfterEdit(id: string, before: ButlerMessage[], editedText: string): void {
  const current = snapshot.find((c) => c.id === id);
  const next = titleOf(editedText);
  if (!current || !next || current.title !== titleFrom(before)) return;
  void renameConversation(id, next);
}

/** Tools the user answers in the browser: these may rightly still be waiting when a conversation is reopened. */
const WAITS_FOR_USER = new Set(["tool-askUser", "tool-requestLocation"]);

/**
 * What the desktop app answers: a step in the live browser, and the user's turn on a page. When
 * the app is closed while one of these is waiting, the task waits with it, and the conversation
 * picks it up when it is opened in the app again (`ChatView` in butler.tsx).
 */
const ANSWERED_BY_APP = new Set(["tool-requestUserAction", ...BROWSER_TOOL_NAMES.map((name) => `tool-${name}`)]);
/** After a day a task that was waiting is no longer picked up by itself: it is shown as stopped, and the user can ask again. */
const PICK_UP_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * A conversation saved while the agent was still working has parts frozen mid-flight.
 * Close them off so a reopened conversation shows "stopped" instead of a spinner that never ends.
 * With `pickUp`, the steps the desktop app answers are left waiting in the last answer (unless it
 * was spoken in a call, which ended with the app): the chat asks the app for them again.
 */
function settle(messages: ButlerMessage[], pickUp = false): ButlerMessage[] {
  return messages.map((message, index) => {
    if (message.role !== "assistant") return message;
    const resumes = pickUp && index === messages.length - 1 && !isVoice(message.metadata);
    const parts = message.parts.map((part) => {
      if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") return { ...part, state: "done" as const };
      if (!part.type.startsWith("tool-")) return part;
      const tool = part as { type: string; state: string; preliminary?: boolean };
      const unfinished = tool.state === "input-streaming" || tool.state === "input-available" || (tool.state === "output-available" && tool.preliminary === true);
      if (!unfinished || WAITS_FOR_USER.has(tool.type)) return part;
      if (resumes && tool.state === "input-available" && ANSWERED_BY_APP.has(tool.type)) return part;
      return { ...part, state: "output-error", errorText: "Stopped before this finished.", output: undefined, preliminary: undefined } as unknown as typeof part;
    });
    return { ...message, parts };
  });
}

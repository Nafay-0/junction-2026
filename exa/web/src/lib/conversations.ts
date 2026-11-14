"use client";

import * as React from "react";
import type { ButlerMessage } from "@/lib/agent/tools";

/**
 * Saved conversations. They live in the browser's IndexedDB: nothing is stored on a server,
 * so there is no account and no database to run. Two stores keep the sidebar fast: `meta`
 * holds one small record per conversation, `messages` holds the full message list (which can
 * be large: research reports, attached images).
 */

export type ConversationMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The model used for the latest answer, for display. */
  modelLabel?: string;
};

const DB_NAME = "hovi";
const DB_VERSION = 1;
const META = "meta";
const MESSAGES = "messages";
const EMPTY: ConversationMeta[] = [];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // If opening fails (private mode, storage blocked), allow a later retry.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function get<T>(store: IDBObjectStore, key?: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = key === undefined ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

/* ───────── A tiny external store so React components re-render when the list changes ───────── */

let snapshot: ConversationMeta[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: ConversationMeta[]) {
  snapshot = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
  loaded = true;
  listeners.forEach((l) => l());
}

async function refresh() {
  try {
    const db = await openDb();
    publish(await get<ConversationMeta[]>(db.transaction(META).objectStore(META)));
  } catch {
    publish([]);
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!loaded) void refresh();
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

/* ───────── Reads and writes ───────── */

export async function loadMessages(id: string): Promise<ButlerMessage[] | null> {
  try {
    const db = await openDb();
    const messages = await get<ButlerMessage[] | undefined>(db.transaction(MESSAGES).objectStore(MESSAGES), id);
    return messages ? settle(messages) : null;
  } catch {
    return null;
  }
}

export async function saveConversation(meta: ConversationMeta, messages: ButlerMessage[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([META, MESSAGES], "readwrite");
    tx.objectStore(META).put(meta);
    tx.objectStore(MESSAGES).put(messages, meta.id);
    await done(tx);
    publish([meta, ...snapshot.filter((c) => c.id !== meta.id)]);
  } catch (err) {
    // Storage full or blocked: the conversation still works for this visit.
    console.warn("[conversations] could not save", err);
  }
}

/** Save a conversation after activity, keeping its title (the user may have renamed it) and creation time. */
export function persistConversation(id: string, messages: ButlerMessage[], modelLabel?: string): Promise<void> {
  const existing = snapshot.find((c) => c.id === id);
  const now = Date.now();
  return saveConversation({ id, title: existing?.title ?? titleFrom(messages), createdAt: existing?.createdAt ?? now, updatedAt: now, modelLabel }, messages);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const current = snapshot.find((c) => c.id === id);
  if (!current) return;
  const next = { ...current, title: title.trim() || current.title };
  try {
    const db = await openDb();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(next);
    await done(tx);
  } catch {
    /* keep the in-memory rename */
  }
  publish(snapshot.map((c) => (c.id === id ? next : c)));
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([META, MESSAGES], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(MESSAGES).delete(id);
    await done(tx);
  } catch {
    /* still remove it from the list */
  }
  publish(snapshot.filter((c) => c.id !== id));
}

export async function deleteAllConversations(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([META, MESSAGES], "readwrite");
    tx.objectStore(META).clear();
    tx.objectStore(MESSAGES).clear();
    await done(tx);
  } catch {
    /* ignore */
  }
  publish([]);
}

export function newConversationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A title from the first thing the user asked. */
export function titleFrom(messages: ButlerMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.find((p) => p.type === "text");
  const raw = text && text.type === "text" ? text.text : "";
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return first?.parts.some((p) => p.type === "file") ? "Image search" : "New task";
  return clean.length > 72 ? `${clean.slice(0, 70).trimEnd()}…` : clean;
}

/** Tools the user answers in the browser: these may rightly still be waiting when a conversation is reopened. */
const WAITS_FOR_USER = new Set(["tool-askUser", "tool-requestLocation"]);

/**
 * A conversation saved while the agent was still working has parts frozen mid-flight.
 * Close them off so a reopened conversation shows "stopped" instead of a spinner that never ends.
 */
function settle(messages: ButlerMessage[]): ButlerMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts.map((part) => {
      if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") return { ...part, state: "done" as const };
      if (!part.type.startsWith("tool-")) return part;
      const tool = part as { type: string; state: string; preliminary?: boolean };
      const unfinished = tool.state === "input-streaming" || tool.state === "input-available" || (tool.state === "output-available" && tool.preliminary === true);
      if (!unfinished || WAITS_FOR_USER.has(tool.type)) return part;
      return { ...part, state: "output-error", errorText: "Stopped before this finished.", output: undefined, preliminary: undefined } as unknown as typeof part;
    });
    return { ...message, parts };
  });
}

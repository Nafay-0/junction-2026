"use client";

import * as React from "react";

const never = () => () => {};

/** False while rendering on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/**
 * A value only the browser knows (time zone, current hour). Returns `fallback` on the server so
 * the first render matches. `read` must return a primitive, or the same object each time.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return React.useSyncExternalStore(never, read, () => fallback);
}

/** Whether a CSS media query matches, kept up to date. False on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribeToQuery = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribeToQuery,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/** A small setting kept in localStorage (falls back to memory when storage is blocked). */
export function useStored(key: string, initial: string): [string, (value: string) => void] {
  const value = React.useSyncExternalStore(
    subscribe,
    () => readStored(key) ?? initial,
    () => initial,
  );
  const set = React.useCallback(
    (next: string) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage blocked: the in-memory copy still works for this visit */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

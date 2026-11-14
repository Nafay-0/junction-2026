"use client";

import * as React from "react";

/**
 * Live polling for widgets that keep themselves fresh while someone is looking at them.
 *
 * - Polls only while the element (pass `observe` as the root element's ref) is in the viewport and the tab is visible.
 * - Never throws. A failed request, a non-OK status or a payload that does not pass `accept`
 *   keeps the last good value (or none, so the widget keeps showing its prop data).
 * - `data` is null until the first good poll; widgets render `live.data ?? props.data`.
 */

export type LiveOptions<T> = {
  /** Time between polls, in milliseconds. */
  intervalMs: number;
  /** Turn polling off (for example while the tool is still loading). Defaults to true. */
  enabled?: boolean;
  /** Delay before the first poll after the widget comes into view. Defaults to min(5s, intervalMs). */
  firstDelayMs?: number;
  /** Shape check for the response; a payload that fails it is ignored. */
  accept?: (value: unknown) => value is T;
};

export type LiveState<T> = {
  /** The latest good polled value, or null when nothing has arrived yet. */
  data: T | null;
  /** When `data` last arrived (ms since epoch), or null. */
  updatedAt: number | null;
  /** True while a request is in flight. */
  refreshing: boolean;
  /** True while polling is running (enabled, in view, tab visible). Show a LiveDot when true. */
  active: boolean;
  /** Callback ref for the widget's root element, so polling can pause when it scrolls out of view. */
  observe: (el: Element | null) => void;
};

export function useLive<T>(url: string | null, options: LiveOptions<T>): LiveState<T> {
  const urls = React.useMemo(() => (url ? [url] : []), [url]);
  const many = useLiveMany<T>(urls, options);
  return {
    data: many.data[0] ?? null,
    updatedAt: many.updatedAt,
    refreshing: many.refreshing,
    active: many.active,
    observe: many.observe,
  };
}

export type LiveManyState<T> = Omit<LiveState<T>, "data"> & {
  /** One slot per url, in the same order; null where nothing good has arrived. */
  data: Array<T | null>;
};

/** Same as `useLive`, for several endpoints polled together (one request each per tick). */
export function useLiveMany<T>(urls: string[], options: LiveOptions<T>): LiveManyState<T> {
  const { intervalMs, enabled = true, accept } = options;
  const firstDelayMs = options.firstDelayMs ?? Math.min(5000, intervalMs);
  const key = urls.join("\n");

  const [node, setNode] = React.useState<Element | null>(null);
  const observe = React.useCallback((el: Element | null) => setNode(el), []);
  const inView = useInView(node);
  const pageVisible = usePageVisible();

  // Results are tagged with the url set they belong to, so a new tool result never shows stale polls.
  const [state, setState] = React.useState<{ key: string; data: Array<T | null>; updatedAt: number | null }>({
    key,
    data: [],
    updatedAt: null,
  });
  const [refreshing, setRefreshing] = React.useState(false);

  const acceptRef = React.useRef(accept);
  React.useEffect(() => {
    acceptRef.current = accept;
  }, [accept]);

  const active = enabled && urls.length > 0 && inView && pageVisible;

  React.useEffect(() => {
    if (!active) return;
    const list = key.split("\n");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      controller = new AbortController();
      setRefreshing(true);
      const results = await Promise.all(list.map((u) => fetchJson(u, controller!.signal)));
      if (cancelled) return;
      setRefreshing(false);
      const check = acceptRef.current;
      const good = results.map((r) => (r !== undefined && (!check || check(r)) ? (r as T) : null));
      if (good.some((g) => g !== null)) {
        setState((prev) => {
          const base = prev.key === key ? prev.data : [];
          return {
            key,
            data: list.map((_, i) => good[i] ?? base[i] ?? null),
            updatedAt: Date.now(),
          };
        });
      }
      timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, firstDelayMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      setRefreshing(false);
    };
  }, [active, key, intervalMs, firstDelayMs]);

  const current = state.key === key ? state : { data: EMPTY as Array<T | null>, updatedAt: null };
  return { data: current.data, updatedAt: current.updatedAt, refreshing: active && refreshing, active, observe };
}

const EMPTY: never[] = [];

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    const json: unknown = await res.json();
    if (json === null || typeof json !== "object") return undefined;
    if ("error" in json && (json as { error?: unknown }).error) return undefined;
    return json;
  } catch {
    return undefined;
  }
}

function useInView(node: Element | null): boolean {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setInView(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [node]);
  return inView && node !== null;
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function usePageVisible(): boolean {
  return React.useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false,
  );
}

/** The current time, re-read every `stepMs` while `enabled`. For "Updated 12s ago" labels. */
export function useNow(stepMs = 1000, enabled = true): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs, enabled]);
  return now;
}

/** "Updated just now", "Updated 12s ago", "Updated 3m ago". */
export function formatUpdated(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  return `Updated ${Math.floor(m / 60)}h ago`;
}

/**
 * Tracks a number and reports the direction of its last change, with a counter that
 * increases on every change so animations keyed on it replay.
 */
export function useChangeFlash(value: number | undefined, durationMs = 900) {
  const [prev, setPrev] = React.useState(value);
  const [flash, setFlash] = React.useState<{ dir: "up" | "down" | null; n: number }>({ dir: null, n: 0 });
  if (value !== prev) {
    setPrev(value);
    if (value !== undefined && prev !== undefined && Number.isFinite(value) && Number.isFinite(prev)) {
      setFlash((f) => ({ dir: value > prev ? "up" : "down", n: f.n + 1 }));
    }
  }
  React.useEffect(() => {
    if (!flash.dir) return;
    const t = setTimeout(() => setFlash((f) => ({ ...f, dir: null })), durationMs);
    return () => clearTimeout(t);
  }, [flash.n, flash.dir, durationMs]);
  return flash;
}

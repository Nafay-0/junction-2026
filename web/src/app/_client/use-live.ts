"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDockEvents } from "./use-dock-events";

/**
 * THE ONE PLACE screens get live updates. Every live view (the wall, a waiting order in the buyer console)
 * reads through this hook, so the transport can change in one file.
 *
 * Today: server-sent events from /api/v1/events trigger an immediate refetch, and polling runs underneath as
 * the fallback, at `pollMs` while the stream is down and at `pollMsStreaming` while it is up (the stream only
 * carries approval and order events; intake steps still need the poll). Pass `events: null` for polling only.
 */
export type LiveOptions = {
  /** SSE url, e.g. "/api/v1/events" or "/api/v1/events?orgId=org_x". */
  events?: string | null;
  /** Poll interval while there is no event stream. About once a second. */
  pollMs?: number;
  /** Poll interval while the event stream is connected. */
  pollMsStreaming?: number;
  /** Stop everything (e.g. the order is final). */
  enabled?: boolean;
};

export type Live<T> = { data: T | undefined; error: string | undefined; streaming: boolean; refresh: () => void; updatedAt: number | undefined };

export function useLive<T>(load: () => Promise<T>, { events = null, pollMs = 1000, pollMsStreaming = 4000, enabled = true }: LiveOptions = {}): Live<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const loadRef = useRef(load);
  const inFlight = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(() => {
    if (inFlight.current) {
      again.current = true; // coalesce bursts of events into one extra fetch
      return;
    }
    inFlight.current = true;
    void (async () => {
      do {
        again.current = false;
        try {
          const d = await loadRef.current();
          setData(d);
          setError(undefined);
          setUpdatedAt(Date.now());
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not reach AimoPilot.");
        }
      } while (again.current);
      inFlight.current = false;
    })();
  }, []);

  useDockEvents(
    enabled ? events : null,
    () => refresh(),
    () => {
      setStreaming(true);
      refresh();
    },
  );

  // EventSource has no "closed" callback in useDockEvents; treat the stream as down when the tab was hidden.
  useEffect(() => {
    if (!events || !enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") setStreaming(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [events, enabled]);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(refresh);
    const ms = streaming ? pollMsStreaming : pollMs;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, ms);
    return () => clearInterval(t);
  }, [enabled, streaming, pollMs, pollMsStreaming, refresh]);

  return { data, error, streaming, refresh, updatedAt };
}

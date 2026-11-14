"use client";

import { useEffect, useRef } from "react";

export type LiveEvent = {
  id: number;
  type: "approval_requested" | "approval_approved" | "approval_declined" | "approval_withdrawn" | "approval_expired" | "order_committed" | "order_rejected" | "order_withdrawn";
  at: string;
  orgId: string;
  orderId: string;
  approvalId?: string;
  totalCents: number;
  summary: string;
};

const TYPES: LiveEvent["type"][] = ["approval_requested", "approval_approved", "approval_declined", "approval_withdrawn", "approval_expired", "order_committed", "order_rejected", "order_withdrawn"];

/**
 * Subscribe to /api/v1/events with EventSource (server-sent events). The browser reconnects by itself and
 * resumes from the last event id. `onSync` runs on every (re)connect and when the page becomes visible again
 * (phones suspend background tabs), so the screen refetches whatever it may have missed.
 */
export function useDockEvents(url: string | null, onEvent: (e: LiveEvent) => void, onSync?: () => void): void {
  const handlers = useRef({ onEvent, onSync });
  useEffect(() => {
    handlers.current = { onEvent, onSync };
  });

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    const source = new EventSource(url, { withCredentials: true });
    const listener = (msg: MessageEvent<string>) => {
      try {
        handlers.current.onEvent(JSON.parse(msg.data) as LiveEvent);
      } catch {
        // ignore malformed events
      }
    };
    for (const t of TYPES) source.addEventListener(t, listener as EventListener);
    source.onopen = () => handlers.current.onSync?.();
    const onVisible = () => {
      if (document.visibilityState === "visible") handlers.current.onSync?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      source.close();
    };
  }, [url]);
}

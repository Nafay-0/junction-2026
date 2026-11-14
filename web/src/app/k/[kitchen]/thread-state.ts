"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../_client/api";

/** Statuses worth trying again by themselves: no connection, rate limited, the store busy or restarting. */
const TRANSIENT = new Set([0, 429, 502, 503, 504]);
/** An `error` that is not a server message but one of these, said in the buyer's words by the page. */
export const SEND_PROBLEM = "@send:";
import type { AgentTurn, BuyerTurn, SubmitTurn, SubmitTurnReply, Thread, ThreadEvent, Turn } from "@/server/thread/types";

/**
 * The kitchen's thread in the browser: loaded once, then kept live from the server's event stream
 * (docs/agent-thread.md). The browser holds nothing it cannot fetch again: a reload or a dropped connection resumes
 * from the last event applied. Buyer turns show at once (optimistic) and are replaced by the server's own when it
 * echoes them back with the same clientTurnId.
 */

export type ThreadApi = {
  thread?: Thread;
  /** Buyer turns sent but not yet echoed by the server, with their pending agent turn. */
  pending: BuyerTurn[];
  live: boolean;
  posting: boolean;
  error?: string;
  submit: (turn: Omit<SubmitTurn, "clientTurnId">) => Promise<boolean>;
  reset: () => Promise<void>;
};

/** Apply one event to a thread: idempotent by seq, so a replayed event changes nothing. */
export function applyEvent(t: Thread, e: ThreadEvent): Thread {
  if (e.type === "reset") return t;
  if (e.seq <= t.seq) return t;
  const turns = [...t.turns];
  const agentAt = (turnId: string) => turns.findIndex((x) => x.turnId === turnId && x.role === "agent");
  const patch = (i: number, f: (a: AgentTurn) => AgentTurn) => {
    if (i >= 0) turns[i] = f(turns[i] as AgentTurn);
  };
  switch (e.type) {
    case "turn": {
      const i = turns.findIndex((x) => x.turnId === e.turn.turnId);
      if (i >= 0) turns[i] = e.turn;
      else turns.push(e.turn);
      break;
    }
    case "step":
      patch(agentAt(e.turnId), (a) => {
        const steps = [...a.steps];
        const j = steps.findIndex((s) => s.stepId === e.step.stepId);
        if (j >= 0) steps[j] = e.step;
        else steps.push(e.step);
        return { ...a, steps };
      });
      break;
    case "card": {
      // A card with the same id is replaced wherever it is shown; a new one joins its turn.
      let found = false;
      for (let i = 0; i < turns.length; i++) {
        const x = turns[i];
        if (x.role !== "agent") continue;
        const j = x.cards.findIndex((c) => c.cardId === e.card.cardId);
        if (j >= 0) {
          const cards = [...x.cards];
          cards[j] = e.card;
          turns[i] = { ...x, cards };
          found = true;
        }
      }
      if (!found) patch(agentAt(e.turnId), (a) => ({ ...a, cards: [...a.cards, e.card] }));
      break;
    }
    case "line":
      patch(agentAt(e.turnId), (a) => ({ ...a, line: e.text }));
      break;
    case "status":
      patch(agentAt(e.turnId), (a) => ({ ...a, status: e.status, ...(e.ms !== undefined ? { ms: e.ms } : {}), ...(e.marks ? { marks: e.marks } : {}) }));
      break;
  }
  const active = e.type === "status" ? (e.status === "done" || e.status === "failed" ? (t.activeTurnId === e.turnId ? undefined : t.activeTurnId) : e.turnId) : t.activeTurnId;
  return { ...t, turns, seq: e.seq, activeTurnId: active };
}

const EVENT_TYPES = ["turn", "step", "card", "line", "status", "reset"] as const;

function newClientId(): string {
  try {
    return `c_${crypto.randomUUID()}`;
  } catch {
    return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useThreadState(slug: string): ThreadApi {
  const base = `/ui-api/kitchens/${encodeURIComponent(slug)}/thread`;
  const [thread, setThread] = useState<Thread>();
  const [pending, setPending] = useState<BuyerTurn[]>([]);
  const [live, setLive] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);
  const threadId = useRef<string | undefined>(undefined);
  const es = useRef<EventSource | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoff = useRef(1000);
  const alive = useRef(true);
  const reconnect = useRef<() => void>(() => undefined);
  /** Set once the first snapshot is in: until then the stream is not opened (it opens from the snapshot's seq). */
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const r = await api<{ thread: Thread }>("GET", base);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    seq.current = r.data.thread.seq;
    threadId.current = r.data.thread.threadId;
    setThread(r.data.thread);
    // A turn sent before this snapshot arrived is in it already: its optimistic copy goes.
    const sent = new Set(r.data.thread.turns.flatMap((t) => (t.role === "buyer" && t.clientTurnId ? [t.clientTurnId] : [])));
    setPending((p) => p.filter((x) => !sent.has(x.clientTurnId ?? "")));
    setError(undefined);
    loaded.current = true;
    return true;
  }, [base]);

  const connect = useCallback(() => {
    es.current?.close();
    if (!alive.current) return;
    const src = new EventSource(`${base}/stream?after=${seq.current}`);
    es.current = src;
    const onEvent = (m: MessageEvent<string>) => {
      let e: ThreadEvent;
      try {
        e = JSON.parse(m.data) as ThreadEvent;
      } catch {
        return;
      }
      // A started-over kitchen keeps the old thread's events in its log: only this thread's count.
      if (!threadId.current || e.threadId !== threadId.current) return;
      if (e.type === "reset") {
        setPending([]);
        seq.current = 0;
        void load();
        return;
      }
      if (e.seq <= seq.current) return;
      seq.current = e.seq;
      if (e.type === "turn" && e.turn.role === "buyer" && e.turn.clientTurnId) {
        const id = e.turn.clientTurnId;
        setPending((p) => p.filter((x) => x.clientTurnId !== id));
      }
      setThread((t) => (t ? applyEvent(t, e) : t));
    };
    for (const type of EVENT_TYPES) src.addEventListener(type, onEvent as EventListener);
    src.onmessage = onEvent;
    src.onopen = () => {
      setLive(true);
      backoff.current = 1000;
    };
    src.onerror = () => {
      setLive(false);
      // The browser retries an open stream by itself (with Last-Event-ID); a closed one is reopened from our seq.
      if (src.readyState === EventSource.CLOSED) {
        clearTimeout(retry.current);
        retry.current = setTimeout(() => reconnect.current(), backoff.current);
        backoff.current = Math.min(15_000, backoff.current * 2);
      }
    };
  }, [base, load]);

  useEffect(() => {
    reconnect.current = connect;
  }, [connect]);

  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void load().then(() => connect()));
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!es.current || es.current.readyState === EventSource.CLOSED)) connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(retry.current);
      es.current?.close();
      es.current = null;
    };
  }, [load, connect]);

  const submit = useCallback(
    async (turn: Omit<SubmitTurn, "clientTurnId">) => {
      const clientTurnId = newClientId();
      const optimistic: BuyerTurn = { turnId: clientTurnId, role: "buyer", at: new Date().toISOString(), door: turn.door, via: turn.via, ...(turn.text ? { text: turn.text } : {}), ...(turn.action ? { action: turn.action } : {}), ...(turn.label ? { label: turn.label } : {}), clientTurnId };
      setPending((p) => [...p, optimistic]);
      setPosting(true);
      setError(undefined);
      // A busy store (503 store_unavailable, a rate limit) or a dropped connection: tried again by itself, with the
      // same client id, so the server counts it once. Only then the buyer is told, in words, and their words are kept.
      let r = await api<SubmitTurnReply>("POST", `${base}/turns`, { ...turn, clientTurnId });
      for (const wait of [1000, 2500, 5000]) {
        if (r.ok || !TRANSIENT.has(r.status)) break;
        await new Promise((ok) => setTimeout(ok, wait));
        r = await api<SubmitTurnReply>("POST", `${base}/turns`, { ...turn, clientTurnId });
      }
      setPosting(false);
      if (!r.ok) {
        setPending((p) => p.filter((x) => x.clientTurnId !== clientTurnId));
        setError(r.status === 0 ? `${SEND_PROBLEM}offline:${turn.text ? "words" : "tap"}` : TRANSIENT.has(r.status) ? `${SEND_PROBLEM}busy:${turn.text ? "words" : "tap"}` : r.error.message);
        return false;
      }
      // The stream may have dropped meanwhile: make sure it is open, so the answer arrives.
      if (loaded.current && (!es.current || es.current.readyState === EventSource.CLOSED)) connect();
      return true;
    },
    [base, connect],
  );

  const reset = useCallback(async () => {
    const r = await api<{ thread: Thread }>("POST", `${base}/reset`, {});
    if (r.ok) {
      setPending([]);
      seq.current = r.data.thread.seq;
      threadId.current = r.data.thread.threadId;
      setThread(r.data.thread);
    } else setError(r.error.message);
  }, [base]);

  return { thread, pending, live, posting, error, submit, reset };
}

/** Is a turn still in flight (the agent is working, or waiting for the buyer or a person)? */
export const isOpen = (t: Turn) => t.role === "agent" && (t.status === "working" || t.status === "waiting_buyer" || t.status === "waiting_approver");

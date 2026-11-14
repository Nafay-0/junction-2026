import type { ModelMessage } from "ai";
import { newId } from "@/core/util";
import type { RecordStore } from "@/server/records";
import type { AgentTurn, BuyerTurn, Card, Thread, ThreadEvent, ThreadStep, Turn } from "./types";

/**
 * The threads, one per kitchen, and each thread's event log.
 *
 * Every change to a thread is an event with the next sequence number; the thread itself is the fold of its events,
 * kept alongside so a reload reads it in one call. Subscribers (the SSE route, the voice door) get each event as
 * it is appended, and a reconnecting client asks for the events after the last one it applied. A thread is written
 * to the record store (PostgreSQL with DOCK_STORE=postgres) after every change, at most every 250 ms, so a restart
 * keeps the conversation; the event log restarts from the thread's seq.
 *
 * What the model saw (its message history) is kept here too, server side only: it never goes to a browser.
 */

export type StoredThread = Thread & {
  /** The agent loop's message history (model messages), pruned to the last few turns. */
  messages: ModelMessage[];
  /** Pending sign-off waits: approval id of the runtime's approval request, per order. */
  waits: Record<string, { approvalId: string; toolCallId: string; turnId: string; messages: ModelMessage[]; context: string }>;
  /** clientTurnId → reply, for resends. */
  seen: Record<string, { buyerTurnId: string; agentTurnId: string }>;
  archived?: string[];
};

type Listener = (e: ThreadEvent) => void;

const MAX_EVENTS = 2000;

export class ThreadStore {
  private readonly threads = new Map<string, StoredThread>();
  private readonly logs = new Map<string, ThreadEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly dirty = new Set<string>();
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly records?: RecordStore<StoredThread>) {}

  async restore(): Promise<number> {
    if (!this.records) return 0;
    for (const t of await this.records.list()) this.threads.set(t.kitchen, t);
    return this.threads.size;
  }

  /** The kitchen's thread, made on first use. */
  get(kitchen: string, orgId: string): StoredThread {
    let t = this.threads.get(kitchen);
    if (!t || t.orgId !== orgId) {
      t = { threadId: newId("thr"), kitchen, orgId, startedAt: new Date().toISOString(), turns: [], seq: 0, messages: [], waits: {}, seen: {} };
      this.threads.set(kitchen, t);
      this.touch(kitchen);
    }
    return t;
  }

  all(): StoredThread[] {
    return [...this.threads.values()];
  }

  peek(kitchen: string): StoredThread | undefined {
    return this.threads.get(kitchen);
  }

  byId(threadId: string): StoredThread | undefined {
    for (const t of this.threads.values()) if (t.threadId === threadId) return t;
    return undefined;
  }

  /** What a browser may see: the thread without the model's history. */
  publicView(t: StoredThread): Thread {
    const { messages: _m, waits: _w, seen: _s, archived: _a, ...pub } = t;
    void _m, void _w, void _s, void _a;
    return structuredClone(pub);
  }

  /** Start over: a new thread for the kitchen. The old one stays in the ledger and the trace. */
  reset(kitchen: string, orgId: string): StoredThread {
    const old = this.threads.get(kitchen);
    if (old) this.emit(old, { type: "reset" });
    this.threads.delete(kitchen);
    const t = this.get(kitchen, orgId);
    if (old) {
      t.archived = [...(old.archived ?? []), old.threadId].slice(-20);
      // Sequence numbers keep counting per kitchen, so a client that missed the reset still sees it as newer; the
      // old thread's events leave the log, all but the reset itself.
      t.seq = old.seq;
      this.logs.set(kitchen, (this.logs.get(kitchen) ?? []).filter((e) => e.type === "reset" && e.threadId === old.threadId));
    }
    return t;
  }

  events(kitchen: string, after: number): ThreadEvent[] {
    return (this.logs.get(kitchen) ?? []).filter((e) => e.seq > after);
  }

  subscribe(kitchen: string, fn: Listener): () => void {
    let s = this.listeners.get(kitchen);
    if (!s) this.listeners.set(kitchen, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }

  // ---------- changes, each one an event ----------

  addTurn(t: StoredThread, turn: Turn): void {
    t.turns.push(turn);
    this.emit(t, { type: "turn", turn: structuredClone(turn) });
  }

  turn(t: StoredThread, turnId: string): Turn | undefined {
    return t.turns.find((x) => x.turnId === turnId);
  }

  agentTurn(t: StoredThread, turnId: string): AgentTurn | undefined {
    const x = this.turn(t, turnId);
    return x?.role === "agent" ? x : undefined;
  }

  step(t: StoredThread, turnId: string, step: ThreadStep): void {
    const a = this.agentTurn(t, turnId);
    if (!a) return;
    const i = a.steps.findIndex((s) => s.stepId === step.stepId);
    if (i >= 0) a.steps[i] = step;
    else a.steps.push(step);
    this.emit(t, { type: "step", turnId, step: structuredClone(step) });
  }

  /** A new card, or a newer version of one already shown (same cardId), in whichever turn holds it. */
  card(t: StoredThread, turnId: string, card: Card): void {
    let holder = this.agentTurn(t, turnId);
    for (const x of t.turns) if (x.role === "agent" && x.cards.some((c) => c.cardId === card.cardId)) holder = x;
    if (!holder) return;
    const i = holder.cards.findIndex((c) => c.cardId === card.cardId);
    if (i >= 0) holder.cards[i] = card;
    else holder.cards.push(card);
    this.emit(t, { type: "card", turnId: holder.turnId, card: structuredClone(card) });
  }

  line(t: StoredThread, turnId: string, text: string): void {
    const a = this.agentTurn(t, turnId);
    if (!a) return;
    a.line = text;
    this.emit(t, { type: "line", turnId, text });
  }

  status(t: StoredThread, turnId: string, status: AgentTurn["status"], extra: { ms?: number; marks?: AgentTurn["marks"] } = {}): void {
    const a = this.agentTurn(t, turnId);
    if (!a) return;
    a.status = status;
    if (extra.ms !== undefined) a.ms = extra.ms;
    if (extra.marks) a.marks = { ...a.marks, ...extra.marks };
    if (status === "working" || status === "waiting_buyer" || status === "waiting_approver") t.activeTurnId = turnId;
    else if (t.activeTurnId === turnId) t.activeTurnId = undefined;
    this.emit(t, { type: "status", turnId, status, ...(a.ms !== undefined ? { ms: a.ms } : {}), ...(a.marks ? { marks: { ...a.marks } } : {}) });
  }

  mark(t: StoredThread, turnId: string, name: keyof NonNullable<AgentTurn["marks"]>, ms: number): void {
    const a = this.agentTurn(t, turnId);
    if (!a || a.marks?.[name] !== undefined) return;
    a.marks = { ...a.marks, [name]: ms };
  }

  /** Every card currently shown in the thread, newest last. */
  cards(t: StoredThread): { turnId: string; card: Card }[] {
    return t.turns.flatMap((x) => (x.role === "agent" ? x.cards.map((card) => ({ turnId: x.turnId, card })) : []));
  }

  buyerTurns(t: StoredThread): BuyerTurn[] {
    return t.turns.filter((x): x is BuyerTurn => x.role === "buyer");
  }

  /** Persist a change made outside the event methods (the model history, the waits). */
  save(t: StoredThread): void {
    this.touch(t.kitchen);
  }

  private emit(t: StoredThread, body: DistributiveOmit<ThreadEvent, "seq" | "threadId" | "at">): void {
    const e = { ...body, seq: ++t.seq, threadId: t.threadId, at: new Date().toISOString() } as ThreadEvent;
    let log = this.logs.get(t.kitchen);
    if (!log) this.logs.set(t.kitchen, (log = []));
    log.push(e);
    if (log.length > MAX_EVENTS) log.splice(0, log.length - MAX_EVENTS);
    for (const fn of this.listeners.get(t.kitchen) ?? []) {
      try {
        fn(e);
      } catch {
        // a broken listener must not stop the others
      }
    }
    this.touch(t.kitchen);
  }

  private touch(kitchen: string): void {
    if (!this.records) return;
    this.dirty.add(kitchen);
    this.flushTimer ??= setTimeout(() => void this.flush(), 250);
  }

  async flush(): Promise<void> {
    this.flushTimer = undefined;
    const kitchens = [...this.dirty];
    this.dirty.clear();
    for (const k of kitchens) {
      const t = this.threads.get(k);
      if (t) await this.records?.put(k, t).catch(() => undefined);
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

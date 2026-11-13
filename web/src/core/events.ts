/**
 * Live events for the approver's phone and the big screen. The order flow publishes; the SSE route subscribes.
 *
 * In-memory and single-process. For several serverless instances, replace InMemoryEventBus with an
 * implementation over a shared channel (Postgres LISTEN/NOTIFY, or a hosted pub/sub such as Redis or Ably):
 * publish() becomes `pg_notify('dock_events', json)` written in the same transaction as the order change,
 * subscribe() holds one LISTEN connection per instance, and `since()` reads a durable events table by id,
 * so a client that reconnects to a different instance still gets what it missed.
 */
export type DockEventType =
  | "approval_requested"
  | "approval_approved"
  | "approval_declined"
  | "approval_withdrawn" // the buyer (or its agent) took back an order that waited for sign-off
  | "approval_expired" // the quote's fixed price ran out before anyone signed
  | "order_committed"
  | "order_rejected";

export type DockEvent = {
  id: number; // monotonically increasing per bus; doubles as the SSE event id
  type: DockEventType;
  at: string;
  orgId: string;
  orderId: string;
  approvalId?: string;
  totalCents: number;
  /** One short sentence for a screen. */
  summary: string;
};

export type DockEventInput = Omit<DockEvent, "id">;

export interface EventPublisher {
  publish(event: DockEventInput): void;
}

export interface EventBus extends EventPublisher {
  /** Calls `handler` for every later event matching `filter`. Returns the unsubscribe function. */
  subscribe(filter: (e: DockEvent) => boolean, handler: (e: DockEvent) => void): () => void;
  /** Recent events after `id`, for clients that reconnect (SSE Last-Event-ID). */
  since(id: number, filter: (e: DockEvent) => boolean): DockEvent[];
}

export class InMemoryEventBus implements EventBus {
  private seq = 0;
  private readonly recent: DockEvent[] = [];
  private readonly subscribers = new Set<{ filter: (e: DockEvent) => boolean; handler: (e: DockEvent) => void }>();

  constructor(private readonly keep = 500) {}

  publish(input: DockEventInput): void {
    const event: DockEvent = { ...input, id: ++this.seq };
    this.recent.push(event);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    for (const s of [...this.subscribers]) {
      if (!s.filter(event)) continue;
      try {
        s.handler(structuredClone(event));
      } catch {
        // a broken subscriber (closed stream) must never break the order flow
        this.subscribers.delete(s);
      }
    }
  }

  subscribe(filter: (e: DockEvent) => boolean, handler: (e: DockEvent) => void): () => void {
    const s = { filter, handler };
    this.subscribers.add(s);
    return () => void this.subscribers.delete(s);
  }

  since(id: number, filter: (e: DockEvent) => boolean): DockEvent[] {
    return structuredClone(this.recent.filter((e) => e.id > id && filter(e)));
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }
}

import type { DockEvent } from "@/core/events";
import { DockError } from "@/core/orders";
import { requireApprovalReader } from "@/server/approval-api";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { canRead, principalOf } from "@/server/authz";

/**
 * Live events as server-sent events: approval_requested, approval_approved, approval_declined, order_committed,
 * order_rejected. Each event carries ids and a one-line summary; clients refetch details on an event.
 *
 *   /api/v1/events?scope=mine        this phone's kitchen only (approver cookie)
 *   /api/v1/events?approvalId=apr_x  one approval
 *   /api/v1/events?orgId=org_x       one organisation
 *   /api/v1/events                   everything in full for the operations desk; for anyone else (the big
 *                                    screen) an aggregated stream: type, time and amount, no kitchen or order
 *   Who may ask for which is decided in server/authz.ts.
 *
 * Reconnects resume from Last-Event-ID (EventSource sends it automatically). A comment line every 15 s keeps
 * proxies and phones from closing an idle connection.
 */
const HEARTBEAT_MS = 15_000;

/** What the public wall's stream carries: that something happened, and how much. No kitchen, order or approval. */
const PUBLIC_SUMMARY: Record<DockEvent["type"], string> = {
  approval_requested: "A kitchen's agent asked a person to sign off an order.",
  approval_approved: "A person signed off an order.",
  approval_declined: "A person declined an order.",
  approval_withdrawn: "A kitchen withdrew an order waiting for sign-off.",
  approval_expired: "An order waiting for sign-off expired unsigned.",
  order_committed: "An order was placed with the wholesaler.",
  order_rejected: "The gate refused an order.",
};
const publicEvent = (e: DockEvent) => ({ id: e.id, type: e.type, at: e.at, totalCents: e.totalCents, summary: PUBLIC_SUMMARY[e.type] });

export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const url = new URL(req.url);
    const filters: ((e: DockEvent) => boolean)[] = [];
    const who = await principalOf(req, rt);
    let scoped = !!who.ops; // the operations desk sees every kitchen's events in full
    if (url.searchParams.get("scope") === "mine") {
      const me = await currentApprover(req, rt);
      if (!me) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen.", "approver_identity");
      const orgId = me.account.orgId;
      filters.push((e) => e.orgId === orgId);
      scoped = true;
    }
    const approvalId = url.searchParams.get("approvalId");
    if (approvalId) {
      await requireApprovalReader(rt, req, approvalId, url.searchParams.get("token"));
      filters.push((e) => e.approvalId === approvalId);
      scoped = true;
    }
    const orgId = url.searchParams.get("orgId");
    if (orgId) {
      // A kitchen's own events: its agent, its signed-in account, its approver, operations.
      if (!canRead(who, orgId)) throw new DockError(403, "not_your_kitchen", "These are another kitchen's events.", "data_access");
      filters.push((e) => e.orgId === orgId);
      scoped = true;
    }
    // Anyone else (the public wall) gets an aggregated stream: what happened and how much, never whose.
    const shape = scoped ? (e: DockEvent) => e : publicEvent;
    const filter = (e: DockEvent) => filters.every((f) => f(e));
    const lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? Number.NaN);

    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (text: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const sendEvent = (e: DockEvent) => send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(shape(e))}\n\n`);
        send(`retry: 2000\n: connected\n\n`);
        if (Number.isFinite(lastId)) for (const e of rt.events.since(lastId, filter)) sendEvent(e);
        const unsubscribe = rt.events.subscribe(filter, sendEvent);
        const ping = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
        cleanup = () => {
          if (!open) return;
          open = false;
          unsubscribe();
          clearInterval(ping);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        req.signal?.addEventListener("abort", () => cleanup());
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}

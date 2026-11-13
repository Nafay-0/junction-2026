import type { DockEvent } from "@/core/events";
import { DockError } from "@/core/orders";
import { currentApprover, handleApprover } from "@/server/approver-session";

/**
 * Live events as server-sent events: approval_requested, approval_approved, approval_declined, order_committed,
 * order_rejected. Each event carries ids and a one-line summary; clients refetch details on an event.
 *
 *   /api/v1/events?scope=mine        this phone's kitchen only (approver cookie)
 *   /api/v1/events?approvalId=apr_x  one approval
 *   /api/v1/events?orgId=org_x       one organisation
 *   /api/v1/events                   everything (the big screen)
 *
 * Reconnects resume from Last-Event-ID (EventSource sends it automatically). A comment line every 15 s keeps
 * proxies and phones from closing an idle connection.
 */
const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const url = new URL(req.url);
    const filters: ((e: DockEvent) => boolean)[] = [];
    if (url.searchParams.get("scope") === "mine") {
      const me = await currentApprover(req, rt);
      if (!me) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen.", "approver_identity");
      const orgId = me.account.orgId;
      filters.push((e) => e.orgId === orgId);
    }
    const approvalId = url.searchParams.get("approvalId");
    if (approvalId) filters.push((e) => e.approvalId === approvalId);
    const orgId = url.searchParams.get("orgId");
    if (orgId) filters.push((e) => e.orgId === orgId);
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
        const sendEvent = (e: DockEvent) => send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
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

import { portalRoute } from "@/server/kitchen-portal-http";
import { threadEvents } from "@/server/thread/engine";
import type { ThreadEvent } from "@/server/thread/types";

/**
 * GET /ui-api/kitchens/{kitchen}/thread/stream?after=<seq>: the thread's events as Server-Sent Events, from after
 * `seq` (or the Last-Event-ID header). Each event's id is its seq; a comment every 15 s keeps proxies from closing it.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/thread/stream">) {
  return portalRoute(req, ctx.params, async (k) => {
    const url = new URL(req.url);
    const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
    const src = await threadEvents(k);
    const enc = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        let last = after;
        const send = (e: ThreadEvent) => {
          if (e.seq <= last) return; // sequence numbers keep counting across a reset, so a reset is newer too
          last = Math.max(last, e.seq);
          try {
            c.enqueue(enc.encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
          } catch {
            close();
          }
        };
        c.enqueue(enc.encode(`retry: 1500\n: thread\n\n`));
        const unsubscribe = src.subscribe(send);
        for (const e of src.after(after)) send(e);
        const beat = setInterval(() => {
          try {
            c.enqueue(enc.encode(`: beat\n\n`));
          } catch {
            close();
          }
        }, 15_000);
        close = () => {
          clearInterval(beat);
          unsubscribe();
          try {
            c.close();
          } catch {
            // already closed
          }
        };
        req.signal.addEventListener("abort", () => close(), { once: true });
      },
      cancel() {
        close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  });
}

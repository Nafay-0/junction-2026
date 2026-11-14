import { browserFor, validBrowserId } from "@/lib/browser/session";
import type { BrowserEvent } from "@/lib/browser/protocol";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The live view: state, frames and the agent's steps, as server-sent events. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!validBrowserId(id)) return Response.json({ error: "Missing or invalid browser id." }, { status: 400 });
  const session = browserFor(id);
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: BrowserEvent) => {
        // A viewer that cannot keep up gets the next frame instead of a backlog; state and steps always go out.
        if (event.type === "frame" && (controller.desiredSize ?? 1) <= 0) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* the viewer has gone */
        }
      };
      unsubscribe = session.subscribe(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          /* closed */
        }
      }, 15_000);
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
    },
  }, { highWaterMark: 8 });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

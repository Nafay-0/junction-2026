import { DockError } from "@/core/errors";
import { callLink } from "@/server/channels/call-links";
import { startCall } from "@/server/channels/voice/start";
import { resolveKitchen } from "@/server/console-kitchens";
import { handle, readJson } from "@/server/http";

/**
 * GET /ui-api/voice/{kitchen}/call  ->  { url, qrSvg }: where a phone calls this kitchen's agent (the portal's
 * "Call your agent" control). A visitor kitchen's URL is /call, which opens the call on the phone that joined it;
 * a demo kitchen's is /call?k=<slug>.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    const k = await resolveKitchen(kitchen);
    if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
    const link = await callLink(req, k.info.kind === "demo" && (kitchen === "kaari" || kitchen === "laakso") ? { kitchen } : {});
    return Response.json({ url: link.url, qrSvg: link.qrSvg }, { headers: { "cache-control": "no-store" } });
  });
}

/**
 * POST /ui-api/voice/{kitchen}/call  { mode?: "push_to_talk" | "hands_free" | "typed", carryFrom?: callId }
 *
 * Starts a call with the kitchen's purchasing agent: reserves the kitchen's one line, and returns a one-use,
 * short-lived Gemini Live token whose setup (instructions, tools, voice detection) is locked on this server.
 * 409 line_busy, 429 call_limit, 403 call_not_yours, 503 voice_unavailable: the screen offers typing instead.
 * Not part of the public API: it is the call screen's own back end.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    const body = ((await readJson(req)) ?? {}) as { mode?: string; carryFrom?: string };
    const start = await startCall(req, kitchen, { mode: typeof body.mode === "string" ? body.mode : undefined, carryFrom: typeof body.carryFrom === "string" ? body.carryFrom : undefined });
    return Response.json(start, { status: 201, headers: { "cache-control": "no-store" } });
  });
}

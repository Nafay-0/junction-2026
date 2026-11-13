import { startCall } from "@/server/channels/voice/start";
import { handle, readJson } from "@/server/http";

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

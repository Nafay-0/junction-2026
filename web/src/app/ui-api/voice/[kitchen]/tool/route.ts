import { runTool } from "@/server/channels/voice/tools";
import { handle, readJson } from "@/server/http";

/**
 * POST /ui-api/voice/{kitchen}/tool  { callId, name, args, heard?, via?, tapped? }
 * One function call from the voice agent, or one typed or tapped step on the call screen, run against Dock's
 * intake as the kitchen's agent. Returns { forModel, screen }: what the agent is to say, and what the screen shows.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/tool">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    return Response.json(await runTool(kitchen, await readJson(req)), { headers: { "cache-control": "no-store" } });
  });
}

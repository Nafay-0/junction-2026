import { fallbackModel, voiceModel } from "@/server/channels/voice/live";
import { calls, voiceLimits } from "@/server/channels/voice/calls";
import { handle } from "@/server/http";
import { dailyUsage } from "@/server/limits";

/**
 * GET /ui-api/voice/usage: for the presenter, what voice has used today on this server: calls, lines open now,
 * spend at list prices per model, the caps, and the server's daily model budget that calls also count against.
 * No kitchen data. Not part of the public API.
 */
export async function GET() {
  return handle(async () => {
    const limits = voiceLimits();
    return Response.json({ enabled: limits.enabled, model: voiceModel(), fallback: fallbackModel() ?? null, ...calls().usage(limits), modelBudget: dailyUsage().llm }, { headers: { "cache-control": "no-store" } });
  });
}

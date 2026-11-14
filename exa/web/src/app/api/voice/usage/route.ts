import { requireUser } from "@/lib/auth/server";
import { clientKindOf } from "@/lib/client-kind";
import { validConversationId } from "@/lib/db/conversations";
import { recordUsage } from "@/lib/db/usage";
import { LIVE_MODEL, TRANSCRIBE_MODEL, voiceCost, type VoiceTokens } from "@/lib/voice/models";

export const dynamic = "force-dynamic";

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(0, Math.round(value)), 50_000_000) : 0);

/**
 * What a voice session used, reported by the interface when it ends (the session ran between the
 * interface and Gemini, so only the interface saw the counts). It goes on the account's record
 * for the admin's overview. The figures are the interface's word; nothing is charged from them.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { purpose?: string; conversationId?: string; startedAt?: number; durationMs?: number; turns?: number; tokens?: Partial<VoiceTokens> };
  const model = body.purpose === "dictation" ? TRANSCRIBE_MODEL : LIVE_MODEL;
  const tokens: VoiceTokens = { textIn: count(body.tokens?.textIn), audioIn: count(body.tokens?.audioIn), textOut: count(body.tokens?.textOut), audioOut: count(body.tokens?.audioOut) };
  if (tokens.textIn + tokens.audioIn + tokens.textOut + tokens.audioOut === 0) return Response.json({ recorded: false });
  await recordUsage({
    userId: user.id,
    conversationId: validConversationId(body.conversationId) ? body.conversationId : undefined,
    client: clientKindOf(req),
    model: { id: model.id, label: model.label },
    kind: "voice",
    stats: {
      mode: "voice",
      startedAt: count(body.startedAt) || Date.now(),
      durationMs: count(body.durationMs),
      steps: count(body.turns),
      usage: { inputTokens: tokens.textIn + tokens.audioIn, outputTokens: tokens.textOut + tokens.audioOut, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
      llmCostUsd: voiceCost(model, tokens),
    },
  });
  return Response.json({ recorded: true });
}

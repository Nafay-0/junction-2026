import { GoogleGenAI, Modality } from "@google/genai";
import { RunMeter } from "@/lib/agent/meter";
import { getModel } from "@/lib/agent/models";
import { languageModel, workerModelFor } from "@/lib/agent/providers";
import { createTools } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";
import { requireUser } from "@/lib/auth/server";
import { clientKindOf } from "@/lib/client-kind";
import { conversationOrigin, validConversationId } from "@/lib/db/conversations";
import { readOnlyReason } from "@/lib/db/origin";
import { LIVE_MODEL, TRANSCRIBE_MODEL, type VoiceGrant } from "@/lib/voice/models";
import { voiceSystemInstruction, voiceToolDeclarations } from "@/lib/voice/server";

export const dynamic = "force-dynamic";

/** How long a session token is good for. A dropped call may reconnect with it inside that time. */
const TOKEN_MINUTES = 30;

type TokenRequest = {
  purpose?: "live" | "dictation";
  conversationId?: string;
  modelId?: string;
  place?: string;
  country?: string;
  timeZone?: string;
  coords?: { lat: number; lng: number; accuracyM?: number; label?: string; country?: string };
  locationDeclined?: boolean;
  browser?: { status?: string; url?: string; title?: string; control?: string };
  /** What was said earlier in the conversation, as plain text, so a call can carry on from it. */
  history?: string;
};

/**
 * A short-lived token for one voice session. The interface connects to Gemini's Live API with it
 * directly, so audio goes straight there and back; the API key stays here. The token is locked to
 * the model and to everything the agent is told and may do, so none of that is the interface's to change.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return Response.json({ error: "Voice needs a Gemini key (GOOGLE_API_KEY) on the server." }, { status: 503 });

  const body = ((await req.json().catch(() => ({}))) ?? {}) as TokenRequest;
  const client = clientKindOf(req);
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  const expiresAt = Date.now() + TOKEN_MINUTES * 60_000;
  const lifetime = { uses: 1, expireTime: new Date(expiresAt).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString() };

  try {
    if (body.purpose === "dictation") {
      // Speech to text as it is spoken, in whatever language: words appear while the user talks.
      const token = await ai.authTokens.create({
        config: {
          ...lifetime,
          liveConnectConstraints: { model: TRANSCRIBE_MODEL.id, config: { responseModalities: [Modality.TEXT], inputAudioTranscription: { languageCodes: [] } } },
          lockAdditionalFields: [],
        },
      });
      return Response.json({ token: token.name ?? "", model: TRANSCRIBE_MODEL.id, expiresAt } satisfies VoiceGrant);
    }

    // A call belongs to a conversation, and a conversation is continued only where it was started.
    const conversationId = validConversationId(body.conversationId) ? body.conversationId : undefined;
    if (conversationId) {
      const origin = await conversationOrigin(user.id, conversationId);
      if (origin && origin !== client) return Response.json({ error: readOnlyReason(origin) }, { status: 409 });
    }

    const info = getModel(body.modelId);
    const timeZone = safeTimeZone(body.timeZone);
    const now = new Date();
    const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
    const time = `${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })} (${timeZone})`;
    const coords = validCoords(body.coords);
    const ctx: ToolContext = { meter: new RunMeter(), model: info, worker: workerModelFor(info), today, client };
    const tools = createTools(ctx, languageModel(info));
    const browser = client === "desktop" && typeof body.browser?.status === "string" ? { status: body.browser.status.slice(0, 20), url: String(body.browser.url ?? "").slice(0, 300), title: String(body.browser.title ?? "").slice(0, 120), control: String(body.browser.control ?? "").slice(0, 10) } : undefined;

    const token = await ai.authTokens.create({
      config: {
        ...lifetime,
        liveConnectConstraints: {
          model: LIVE_MODEL.id,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: voiceSystemInstruction(client, { today, time, place: body.place?.slice(0, 80), coords, locationDeclined: body.locationDeclined === true, client, browser }, typeof body.history === "string" ? body.history : undefined),
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.BERYL_VOICE || "Sulafat" } } },
            // What the user said and what the agent said, as text, for the conversation view and the captions.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // A short pause ends the user's turn: long enough not to cut a thought in two, short enough to feel quick.
            realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 550, prefixPaddingMs: 120 } },
            // A long call keeps going: the oldest part of it is folded away instead of ending the session.
            contextWindowCompression: { slidingWindow: {} },
            tools: [{ functionDeclarations: await voiceToolDeclarations(tools) }],
          },
        },
        // Only what is set above is fixed. The interface still names the session to resume after a dropped connection.
        lockAdditionalFields: [],
      },
    });
    return Response.json({ token: token.name ?? "", model: LIVE_MODEL.id, expiresAt } satisfies VoiceGrant);
  } catch (err) {
    console.error("[voice] could not make a session token", err instanceof Error ? err.message : err);
    return Response.json({ error: "Voice could not start. Try again in a moment." }, { status: 502 });
  }
}

function validCoords(input: TokenRequest["coords"]): TokenRequest["coords"] | undefined {
  if (!input || typeof input.lat !== "number" || typeof input.lng !== "number") return undefined;
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) return undefined;
  return { lat: input.lat, lng: input.lng, accuracyM: typeof input.accuracyM === "number" ? Math.round(input.accuracyM) : undefined, label: typeof input.label === "string" ? input.label.slice(0, 80) : undefined, country: typeof input.country === "string" ? input.country.slice(0, 2) : undefined };
}

function safeTimeZone(tz: string | undefined): string {
  if (!tz) return "Europe/Helsinki";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Helsinki";
  }
}

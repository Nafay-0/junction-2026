import { DockError } from "@/core/errors";
import { VOICE_TOOLS } from "../prompts";

/**
 * Gemini Live API (Google DeepMind's realtime voice interface), as documented on 2026-11-13:
 *   https://aistudio.google.com/docs/live-api                       overview, audio formats
 *   https://aistudio.google.com/docs/live-api/get-started-websocket WebSocket endpoints and messages
 *   https://aistudio.google.com/docs/live-api/ephemeral-tokens      short-lived tokens for browsers
 *   https://aistudio.google.com/docs/live-api/capabilities          VAD, transcription, model ids
 *   https://aistudio.google.com/docs/live-api/tools                 function calling
 *   https://aistudio.google.com/docs/live-api/session-management    15 min audio sessions, ~10 min connections
 *   https://aistudio.google.com/api-reference/live                  BidiGenerateContentSetup, AuthToken
 *   https://aistudio.google.com/docs/pricing                        $3/M audio in ($0.005/min), $12/M audio out ($0.018/min)
 *
 * The browser talks to Google directly (lower latency for audio) with a token this server mints: one use,
 * a new session must start within 60 s, and every message is refused after the call's time limit. The token
 * carries the whole session setup (model, instructions, tools, voice activity settings); a setup the browser
 * sends is ignored, so a page cannot change what the agent is told or which tools it has. The API key never
 * leaves the server.
 */

export const LIVE_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

export const DEFAULT_VOICE_MODEL = "gemini-3.8-live";

/** Paid-tier list prices per minute of audio, for the cost estimate. */
export const LIVE_PRICE = { audioInPerMin: 0.005, audioOutPerMin: 0.018, textInPerM: 0.75, textOutPerM: 4.5 };

export type CallMode = "push_to_talk" | "hands_free";

export function voiceModel(env: Record<string, string | undefined> = process.env): string {
  return env.DOCK_VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL;
}

export function liveSetup(opts: { model: string; system: string; mode: CallMode }) {
  return {
    model: `models/${opts.model}`,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    systemInstruction: { parts: [{ text: opts.system }] },
    tools: [{ functionDeclarations: VOICE_TOOLS }],
    // Push-to-talk: the browser marks the start and end of each turn, so hall noise between turns is never sent.
    // Hands-free: the server's voice activity detection, set to need clear speech to start and a pause to end.
    realtimeInputConfig:
      opts.mode === "push_to_talk"
        ? { automaticActivityDetection: { disabled: true } }
        : { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: "START_SENSITIVITY_LOW", endOfSpeechSensitivity: "END_SENSITIVITY_LOW", prefixPaddingMs: 200, silenceDurationMs: 800 } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export type LiveToken = { token: string; expiresAt: string; startBy: string };

/** Mint a one-use token whose locked setup is `setup`. Throws a DockError the routes return as is. */
export async function mintLiveToken(setup: ReturnType<typeof liveSetup>, opts: { seconds: number; now?: Date; apiKey?: string; fetchImpl?: typeof fetch }): Promise<LiveToken> {
  const apiKey = opts.apiKey ?? (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (!apiKey) throw new DockError(503, "voice_unavailable", "Voice calls are not configured on this server (no Gemini API key). Type the request instead.");
  const now = (opts.now ?? new Date()).getTime();
  const expiresAt = new Date(now + opts.seconds * 1000).toISOString();
  const startBy = new Date(now + 60_000).toISOString();
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(TOKENS_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ uses: 1, expireTime: expiresAt, newSessionExpireTime: startBy, bidiGenerateContentSetup: setup }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DockError(503, "voice_unavailable", "The voice service did not answer. Type the request instead.");
  }
  const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
  if (!res.ok || !body.name) throw new DockError(503, "voice_unavailable", `The voice service refused to start a call (${res.status}${body.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}). Type the request instead.`);
  return { token: body.name, expiresAt, startBy };
}

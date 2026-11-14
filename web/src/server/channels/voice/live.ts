import { DockError } from "@/core/errors";
import { LIVE_TOOLS } from "../../thread/voice-brief";

/**
 * Gemini Live API (Google DeepMind's realtime voice interface), as documented on 2026-11-14:
 *   https://aistudio.google.com/docs/live-api                       overview, audio formats
 *   https://aistudio.google.com/docs/live-api/get-started-websocket WebSocket endpoints and messages
 *   https://aistudio.google.com/docs/live-api/ephemeral-tokens      short-lived tokens for browsers
 *   https://aistudio.google.com/docs/live-api/capabilities          VAD, transcription (customVocabulary), model ids
 *   https://aistudio.google.com/docs/live-api/tools                 function calling
 *   https://aistudio.google.com/docs/live-api/session-management    15 min audio sessions, ~10 min connections
 *   https://aistudio.google.com/api-reference/live                  BidiGenerateContentSetup, AudioTranscriptionConfig, AuthToken
 *   https://aistudio.google.com/docs/pricing                        $3/M audio in ($0.005/min), $12/M audio out ($0.018/min)
 *
 * The browser talks to Google directly (lower latency for audio) with a token this server mints: one use,
 * a new session must start within 60 s, and every message is refused after the call's time limit. The token
 * carries the whole session setup (model, instructions, tools, voice activity settings); a setup the browser
 * sends is ignored, so a page cannot change what the agent is told or which tools it has. The API key never
 * leaves the server.
 *
 * The OpenAI Realtime API is the other provider (realtime.ts); `voiceModel()` names the model and
 * `providerOf()` which of the two it belongs to.
 */

export const LIVE_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

/** Chosen by the evaluation in web/docs/doors.md. */
export const DEFAULT_VOICE_MODEL = "gemini-3.8-live";
/** Tried when the first provider refuses (free-tier quota, outage), if its key is set. */
export const DEFAULT_FALLBACK_MODEL = "gpt-realtime-2.1";

/** Paid-tier list prices per minute of audio, for the cost estimate. */
export const LIVE_PRICE = { audioInPerMin: 0.005, audioOutPerMin: 0.018, textInPerM: 0.75, textOutPerM: 4.5 };

/** One voice mode: hands-free (the provider hears when the buyer starts and stops; the buyer can talk over the agent). */
export type CallMode = "hands_free";
export type VoiceProvider = "gemini" | "openai";

export function voiceModel(env: Record<string, string | undefined> = process.env): string {
  return env.DOCK_VOICE_MODEL?.trim().replace(/^(google|gemini|openai):/, "") || DEFAULT_VOICE_MODEL;
}

/** The fallback model, or undefined when switched off ("off") or the same as the first. */
export function fallbackModel(env: Record<string, string | undefined> = process.env): string | undefined {
  const v = env.DOCK_VOICE_FALLBACK_MODEL?.trim().replace(/^(google|gemini|openai):/, "");
  if (v?.toLowerCase() === "off") return undefined;
  const m = v || (providerOf(voiceModel(env)) === "gemini" ? DEFAULT_FALLBACK_MODEL : DEFAULT_VOICE_MODEL);
  return m === voiceModel(env) ? undefined : m;
}

export function providerOf(model: string): VoiceProvider {
  return /^(gpt-|openai)/i.test(model) ? "openai" : "gemini";
}

export function liveSetup(opts: { model: string; system: string; mode: CallMode; vocabulary?: string[] }) {
  return {
    model: `models/${opts.model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      // The extended-thinking model refuses a session without a thinking level (1007); DOCK_VOICE_THINKING sets it.
      ...(/thinking/.test(opts.model) ? { thinkingConfig: { thinkingLevel: (process.env.DOCK_VOICE_THINKING?.trim() || "low").toUpperCase() } } : {}),
    },
    systemInstruction: { parts: [{ text: opts.system }] },
    tools: [{ functionDeclarations: LIVE_TOOLS }],
    // Hands-free: the provider's voice activity detection, set to need clear speech to start and a short pause to end
    // (DOCK_VOICE_SILENCE_MS, default 500 ms); speech that starts while the agent talks interrupts it (barge-in).
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: "START_SENSITIVITY_LOW", endOfSpeechSensitivity: "END_SENSITIVITY_LOW", prefixPaddingMs: 200, silenceDurationMs: silenceMs() } },
    // The words a kitchen orders with, so "butter" is not heard as "powder" (customVocabulary biases recognition).
    // VERBATIM keeps number words as said ("kuusitoista"), which AimoPilot's own number reader understands; the
    // default formatting turned Finnish and Swedish numbers into wrong digits ("6" for sixteen) in the evaluation.
    inputAudioTranscription: { ...(opts.vocabulary?.length ? { customVocabulary: opts.vocabulary.slice(0, 100) } : {}), ...(transcriptionMode() ? { mode: transcriptionMode() } : {}) },
    outputAudioTranscription: {},
  };
}

/** The pause that ends the buyer's turn, in milliseconds. */
function silenceMs(): number {
  const v = Number(process.env.DOCK_VOICE_SILENCE_MS);
  return Number.isFinite(v) && v >= 300 && v <= 2000 ? v : 500;
}

/** Gemini's transcript formatting: VERBATIM (default) or SMART (DOCK_VOICE_TRANSCRIPTION=smart), "" for the service default. */
function transcriptionMode(): string | undefined {
  const v = (process.env.DOCK_VOICE_TRANSCRIPTION ?? "verbatim").trim().toLowerCase();
  return v === "smart" ? "SMART" : v === "verbatim" ? "VERBATIM" : undefined;
}

export type LiveToken = { token: string; expiresAt: string; startBy: string };

/**
 * Test-only: DOCK_VOICE_SCRIPTED=1 (with DOCK_SCRIPTED_MODELS=1, the recorded-model switch) mints a token here
 * instead of at Google, so a browser suite that answers the Live socket itself (Playwright's routeWebSocket) runs
 * the whole call with no key and no network. Off by default; refused outright on a deployed server (DOCK_PUBLIC_URL
 * or VERCEL set), where a token nobody can use would only hide a missing key.
 */
export function scriptedVoice(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DOCK_VOICE_SCRIPTED !== "1") return false;
  if (env.DOCK_PUBLIC_URL || env.VERCEL) throw new DockError(503, "voice_unavailable", "Scripted voice tokens are for local tests only and are refused on a deployed server. Type the request instead.");
  return env.DOCK_SCRIPTED_MODELS === "1";
}

/** Mint a one-use token whose locked setup is `setup`. Throws a DockError the routes return as is. */
export async function mintLiveToken(setup: ReturnType<typeof liveSetup>, opts: { seconds: number; now?: Date; apiKey?: string; fetchImpl?: typeof fetch }): Promise<LiveToken> {
  if (!opts.apiKey && !opts.fetchImpl && scriptedVoice()) {
    const now = (opts.now ?? new Date()).getTime();
    return { token: `scripted-${Math.random().toString(36).slice(2, 12)}`, expiresAt: new Date(now + opts.seconds * 1000).toISOString(), startBy: new Date(now + 60_000).toISOString() };
  }
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
  if (!res.ok || !body.name) throw new DockError(res.status === 429 ? 429 : 503, res.status === 429 ? "voice_rate_limited" : "voice_unavailable", `The voice service refused to start a call (${res.status}${body.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}). Type the request instead.`);
  return { token: body.name, expiresAt, startBy };
}

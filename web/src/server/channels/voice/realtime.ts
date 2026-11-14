import { DockError } from "@/core/errors";
import { LIVE_TOOLS } from "../../thread/voice-brief";
import type { CallMode } from "./live";

/**
 * OpenAI Realtime API, as documented on 2026-11-14:
 *   https://developers.openai.com/api/docs/guides/realtime                    browser sessions, client secrets
 *   https://developers.openai.com/api/docs/guides/realtime-websocket          wss://api.openai.com/v1/realtime, browser subprotocol auth
 *   https://developers.openai.com/api/docs/guides/realtime-conversations      events, function calls, 60 min session cap
 *   https://developers.openai.com/api/docs/guides/realtime-transcription      gpt-live-transcribe, keywords, languages
 *   https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
 *   https://developers.openai.com/api/docs/pricing                            gpt-realtime-2.1 $32/M audio in, $64/M out
 *
 * The browser opens a WebSocket with a short-lived client secret this server mints with the session's
 * instructions, tools and audio settings. Unlike Gemini's locked token, an OpenAI client could send its own
 * session.update; that changes nothing that matters, because every decision is made by this server's tools
 * (thread/voice-bridge.ts) from the caller's transcribed words, and the server refuses tool calls after the call's time limit.
 * Audio is 24 kHz 16-bit PCM both ways.
 */

export const REALTIME_WS_URL = "wss://api.openai.com/v1/realtime";
const SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

/** List prices per million tokens; audio is about 600 tokens a minute in (10 per second) and 1,200 out. */
export const REALTIME_PRICE: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }> = {
  "gpt-realtime-2.1": { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
  "gpt-realtime-2.1-mini": { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
  "gpt-realtime-2": { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
};

/** Function tools in the Realtime API's JSON-schema form, from the same declarations Gemini gets. */
export function realtimeTools() {
  const lower = (s: unknown): unknown =>
    Array.isArray(s) ? s.map(lower) : s && typeof s === "object" ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : lower(v)])) : s;
  return LIVE_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: lower(t.parameters) }));
}

export function realtimeSession(opts: { model: string; system: string; mode: CallMode; vocabulary?: string[] }) {
  const keywords = (opts.vocabulary ?? []).filter((k) => !/[<>\n]/.test(k)).slice(0, 100);
  return {
    type: "realtime",
    model: opts.model,
    instructions: opts.system,
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        // A phone held close: the near-field filter keeps the caller and lowers the hall.
        noise_reduction: { type: "near_field" },
        // The transcript is what AimoPilot acts on, so it gets the kitchen's words and the three languages.
        transcription: transcriptionFor(opts.mode, keywords),
        // Hands-free: the server's voice detection with a fixed pause, as on Gemini. Semantic turn detection waited 5 to
        // 9 s after a short answer ("the first one") in the live run, at low and at medium eagerness. Speech over the
        // agent interrupts it.
        turn_detection: { type: "server_vad", threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true },
      },
      output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
    },
    tools: realtimeTools(),
    tool_choice: "auto",
    max_output_tokens: 800,
  };
}

const SETTING = "A kitchen worker on a phone ordering food supplies from a wholesaler, in English, Finnish or Swedish, in a loud room. Amounts in litres, kilos, pieces or cases.";

/** The transcriber: gpt-transcribe reads each whole turn that the turn detection ends (hands-free). */
function transcriptionFor(_mode: CallMode, keywords: string[]) {
  return { model: process.env.DOCK_VOICE_OPENAI_TRANSCRIBE?.trim() || "gpt-transcribe", prompt: `${SETTING} Words they use: ${keywords.slice(0, 60).join(", ")}.` };
}

export type RealtimeSecret = { token: string; expiresAt: string; startBy: string };

/** Mint a client secret for one session. The secret must be used within 60 s; the call's time limit is ours. */
export async function mintRealtimeSecret(session: ReturnType<typeof realtimeSession>, opts: { seconds: number; now?: Date; apiKey?: string; fetchImpl?: typeof fetch }): Promise<RealtimeSecret> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new DockError(503, "voice_unavailable", "Voice calls are not configured on this server (no OpenAI API key). Type the request instead.");
  const now = (opts.now ?? new Date()).getTime();
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(SECRETS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DockError(503, "voice_unavailable", "The voice service did not answer. Type the request instead.");
  }
  const body = (await res.json().catch(() => ({}))) as { value?: string; error?: { message?: string } };
  if (!res.ok || !body.value) throw new DockError(res.status === 429 ? 429 : 503, res.status === 429 ? "voice_rate_limited" : "voice_unavailable", `The voice service refused to start a call (${res.status}${body.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}). Type the request instead.`);
  return { token: body.value, expiresAt: new Date(now + opts.seconds * 1000).toISOString(), startBy: new Date(now + 60_000).toISOString() };
}

// ---------- WebRTC set up by this server: the session can be ended here ----------

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/**
 * The browser's WebRTC offer, answered through this server ("unified interface", docs: realtime-webrtc): the
 * session configuration and the API key stay here, and the call id OpenAI returns lets this server hang the
 * session up (POST /v1/realtime/calls/{id}/hangup, which ends WebRTC sessions too) at the call's time limit, the
 * same bound Gemini's token enforces. The browser never holds a key that could open or prolong a session.
 */
export async function createRealtimeCall(session: ReturnType<typeof realtimeSession>, sdp: string, opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}): Promise<{ answer: string; callId: string }> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new DockError(503, "voice_unavailable", "Voice calls are not configured on this server (no OpenAI API key). Type the request instead.");
  const fd = new FormData();
  fd.set("sdp", sdp);
  fd.set("session", JSON.stringify(session));
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(CALLS_URL, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: fd, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new DockError(503, "voice_unavailable", "The voice service did not answer. Type the request instead.");
  }
  const text = await res.text();
  if (!res.ok) throw new DockError(res.status === 429 ? 429 : 503, res.status === 429 ? "voice_rate_limited" : "voice_unavailable", `The voice service refused to start a call (${res.status}: ${text.slice(0, 200)}). Type the request instead.`);
  const callId = (res.headers.get("location") ?? "").split("/").filter(Boolean).at(-1) ?? "";
  if (!/^rtc_[\w-]+$/.test(callId)) throw new DockError(503, "voice_unavailable", "The voice service did not return a call id, so this server could not bound the call. Type the request instead.");
  return { answer: text, callId };
}

/** End an OpenAI realtime call from this server. Never throws: a call already over is fine. */
export async function hangupRealtimeCall(callId: string, opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || !/^rtc_[\w-]+$/.test(callId)) return false;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${CALLS_URL}/${callId}/hangup`, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The models behind voice. Shared by the server and the interface: no keys, no imports.
 *
 * Voice runs on Gemini's Live API, whatever model is picked for typed conversations:
 * - `gemini-3.8-live` holds the spoken conversation: it hears audio, speaks audio, and calls tools.
 * - `gemini-3.5-transcribe-live` turns speech into text as it is spoken, for voice input.
 * Prices are US dollars per million tokens (read 14 Nov 2026). One second of audio is 25 tokens.
 */

export type VoiceTokens = { textIn: number; audioIn: number; textOut: number; audioOut: number };

export const NO_VOICE_TOKENS: VoiceTokens = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };

export const LIVE_MODEL = {
  id: "gemini-3.8-live",
  label: "Gemini 3.8 Live",
  price: { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 },
} as const;

export const TRANSCRIBE_MODEL = {
  id: "gemini-3.5-transcribe-live",
  label: "Gemini 3.5 Transcribe",
  price: { textIn: 0, audioIn: 3.5, textOut: 21, audioOut: 0 },
} as const;

export type VoiceModel = typeof LIVE_MODEL | typeof TRANSCRIBE_MODEL;

export function voiceCost(model: VoiceModel, tokens: VoiceTokens): number {
  const { price } = model;
  return (tokens.textIn * price.textIn + tokens.audioIn * price.audioIn + tokens.textOut * price.textOut + tokens.audioOut * price.audioOut) / 1_000_000;
}

/** Where the interface connects, with the short-lived token the server hands it. Never with the API key. */
export const LIVE_SOCKET = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** Audio as the Live API wants it and sends it: 16-bit PCM, mono. */
export const MIC_RATE = 16_000;
export const SPEAKER_RATE = 24_000;

/** What the two kinds of voice session are for. */
export type VoicePurpose = "live" | "dictation";

/** What the server answers when asked for a session. */
export type VoiceGrant = { token: string; model: string; expiresAt: number };

/** The tools the app itself answers during a call, instead of asking the server. */
export const ANSWERED_BY_APP = ["requestLocation", "requestUserAction", "browserOpen", "browserAct", "browserRead", "browserLook", "browserClose"] as const;

/** One line from the tool route while a tool runs: what there is so far, then the result and what the model is told. */
export type VoiceToolEvent =
  | { type: "progress"; output: unknown }
  /** `spent`: what the tool itself cost (Exa calls, sub-agents), for the answer's figures. */
  | { type: "result"; output: unknown; text: string; spent?: { exaCostUsd?: number; workerCostUsd?: number; exaCalls?: { search: number; contents: number; agent: number; answer: number } } }
  | { type: "error"; error: string };

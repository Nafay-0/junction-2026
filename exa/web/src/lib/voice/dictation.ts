"use client";

import { CLIENT_HEADER, clientKind } from "@/lib/client-kind";
import { Microphone, microphoneProblem } from "./audio";
import { LiveSocket, requestVoiceGrant } from "./live-socket";
import { NO_VOICE_TOKENS, type VoiceTokens } from "./models";

/*
 * Voice input: speak, and the words appear in the message box as they are spoken, in whatever
 * language. Nothing is sent to the agent; the user reads what was heard and presses Send.
 *
 * It runs on Gemini's live transcription model. While the user speaks it sends its best guess so
 * far (`onInterim`, which replaces the last guess); when they pause it sends the finished piece
 * (`onFinal`).
 */

export type DictationHandlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** Listening has stopped: because it was asked to, or because something went wrong (`problem`). */
  onEnd: (problem?: string) => void;
};

export type Dictation = {
  /** Stop listening. What was being said is finished off first. */
  stop: () => void;
  /** How loud the microphone is, 0 to about 1. For a meter drawn from an animation frame. */
  level: () => number;
};

/** A live transcription session lasts ten minutes at most: stop a little before that. */
const LONGEST_MS = 9.5 * 60_000;

/** Start listening. Call it from a click or a tap. Resolves once the microphone is open and words can flow. */
export async function startDictation(handlers: DictationHandlers): Promise<Dictation> {
  let mic: Microphone | undefined;
  let socket: LiveSocket | undefined;
  let ended = false;
  let stopping = false;
  const waiting: string[] = [];
  const startedAt = Date.now();
  let tokens: VoiceTokens = { ...NO_VOICE_TOKENS };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const end = (problem?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    mic?.close();
    socket?.close();
    handlers.onEnd(problem);
    // What it used goes on the account's record.
    void fetch("/api/voice/usage", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", [CLIENT_HEADER]: clientKind() },
      body: JSON.stringify({ purpose: "dictation", startedAt, durationMs: Date.now() - startedAt, tokens }),
    }).catch(() => {});
  };

  const stop = () => {
    if (ended || stopping) return;
    stopping = true;
    mic?.close();
    mic = undefined;
    // Tell the model the speech is over, give it a moment to finish the last piece, then hang up.
    socket?.endAudio();
    timer = setTimeout(() => end(), 1400);
  };

  try {
    // The microphone and the session are fetched at the same time: whichever is slower sets the wait.
    const [grant, opened] = await Promise.all([
      requestVoiceGrant("dictation"),
      Microphone.open((chunk) => {
        if (socket?.open) socket.sendAudio(chunk);
        else if (waiting.length < 100) waiting.push(chunk); // up to four seconds said before the line is up are not lost
      }),
    ]);
    mic = opened;
    socket = new LiveSocket(grant, {
      onReady: () => {
        for (const chunk of waiting.splice(0)) socket?.sendAudio(chunk);
      },
      onInterim: (text) => !ended && handlers.onInterim(text),
      onHeard: (text) => {
        if (ended) return;
        handlers.onFinal(text);
        if (stopping) end();
      },
      onUsage: (used) => {
        tokens = { textIn: tokens.textIn + used.textIn, audioIn: tokens.audioIn + used.audioIn, textOut: tokens.textOut + used.textOut, audioOut: tokens.audioOut + used.audioOut };
      },
      onClose: ({ clean, reason }) => end(clean || stopping ? undefined : reason ? "Voice input stopped. Try again." : undefined),
    });
    socket.connect();
    timer = setTimeout(stop, LONGEST_MS);
  } catch (err) {
    mic?.close();
    socket?.close();
    ended = true;
    throw new Error(err instanceof DOMException ? microphoneProblem(err) : err instanceof Error ? err.message : "Voice input could not start.");
  }

  return { stop, level: () => mic?.level ?? 0 };
}

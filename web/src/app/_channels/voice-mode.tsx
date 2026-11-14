"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useCall } from "./use-call";

/**
 * Speaking as a mode of the kitchen's thread: one call per store page, shared by the thread's composer (the
 * microphone, hold to talk or open microphone, the voice states) and the thread's log (what is being heard now, what
 * the agent is saying now). The call's steps reach the thread through the server (thread/voice-bridge.ts), so the
 * buyer's turns and the cards in the log are the thread's own; this only adds the live, not-yet-final words.
 *
 * Hanging up leaves the buyer where they are, typing in the same composer.
 */

type Voice = ReturnType<typeof useCall>;
const VoiceContext = createContext<Voice | null>(null);

export function VoiceModeProvider({ kitchen, children }: { kitchen: string; children: ReactNode }) {
  const voice = useCall(kitchen);
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

/** The store's call, or null outside a store page. */
export function useVoiceMode(): Voice | null {
  return useContext(VoiceContext);
}

/** A call is on (ringing, connected, or reconnecting): the composer shows the voice controls. */
export function callOn(v: Voice | null): boolean {
  const p = v?.view.phase;
  return p === "ringing" || p === "connected" || p === "recovering";
}

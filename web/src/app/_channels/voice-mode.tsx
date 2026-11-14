"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ThreadApi } from "../k/[kitchen]/thread-state";
import { useCall } from "./use-call";

/**
 * Talking is a mode of the kitchen's thread, and there is one way to do it: hands-free. One call per store page,
 * shared by the composer (the microphone starts it in place; the voice bar shows its state, the live level, mute and
 * end) and the conversation itself: the buyer's words land in the thread as ordinary turns marked as spoken, and the
 * agent's replies are the thread's own turns, said aloud (server/thread/voice-bridge.ts). Hanging up leaves the
 * buyer where they are, typing in the same composer.
 *
 * A card tapped or words typed while the call is live are turns of the same thread: their replies are said too.
 */

type Voice = ReturnType<typeof useCall>;
const VoiceContext = createContext<Voice | null>(null);

export function VoiceModeProvider({ kitchen, thread, children }: { kitchen: string; thread?: ThreadApi; children: ReactNode }) {
  const voice = useCall(kitchen);
  const live = voice.view.phase === "live";
  const seen = useRef<Set<string> | null>(null);
  const turns = thread?.thread?.turns;
  const followTurn = voice.followTurn;
  useEffect(() => {
    if (!live) {
      seen.current = null;
      return;
    }
    // When the call starts, everything already in the thread has been seen; after that, a reply to a tap or to typed
    // words is followed and said (a spoken turn is followed by the call itself).
    const all = turns ?? [];
    if (!seen.current) {
      seen.current = new Set(all.map((t) => t.turnId));
      return;
    }
    for (const t of all) {
      if (seen.current.has(t.turnId)) continue;
      seen.current.add(t.turnId);
      if (t.role !== "agent" || !t.replyTo) continue;
      const buyer = all.find((b) => b.turnId === t.replyTo);
      if (buyer?.role === "buyer" && buyer.door !== "voice") followTurn(t.turnId);
    }
  }, [live, turns, followTurn]);
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

/** The store's call, or null outside a store page. */
export function useVoiceMode(): Voice | null {
  return useContext(VoiceContext);
}

/** A call is on (starting, live, or reconnecting): the composer shows the voice bar. */
export function callOn(v: Voice | null): boolean {
  const p = v?.view.phase;
  return p === "starting" || p === "live" || p === "reconnecting";
}

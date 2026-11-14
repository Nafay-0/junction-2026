"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { LOGO } from "@/lib/brand";
import type { CallStatus } from "@/lib/voice/live-call";
import { liveCall } from "@/lib/voice/use-call";

/**
 * The call's face: the Beryl stone, alive. It breathes while it listens, a ring widens with the
 * user's voice, its facets catch the light in turn while it works, and it swells with its own
 * voice while it speaks. The sound levels are read straight from the audio, sixty times a second,
 * and written to CSS variables: nothing here goes through React while it moves.
 */
export function Orb({ status, muted, size = "large", className }: { status: CallStatus; muted?: boolean; size?: "large" | "small"; className?: string }) {
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    let mic = 0;
    let voice = 0;
    const tick = () => {
      const levels = liveCall.levels();
      // Rise quickly, fall slowly: a meter that follows speech without flickering.
      const heard = Math.min(1, levels.mic * 9);
      const spoken = Math.min(1, levels.speaker * 6);
      mic = heard > mic ? mic + (heard - mic) * 0.5 : mic + (heard - mic) * 0.12;
      voice = spoken > voice ? voice + (spoken - voice) * 0.5 : voice + (spoken - voice) * 0.14;
      el.style.setProperty("--mic", mic.toFixed(3));
      el.style.setProperty("--voice", voice.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const small = size === "small";
  return (
    <div
      ref={root}
      data-status={muted ? "muted" : status}
      data-size={size}
      className={cn("orb relative shrink-0", small ? "size-11" : "size-[9.5rem] @min-[440px]/chat:size-[11.5rem]", className)}
      style={{ "--mic": 0, "--voice": 0 } as React.CSSProperties}
      aria-hidden
    >
      {/* The user's voice: a ring that widens as they speak. */}
      <span className="orb-ring absolute inset-0 rounded-full" />
      {/* The agent's voice: a glow that swells. */}
      <span className="orb-glow absolute inset-0 rounded-full" />
      <svg viewBox="0 0 32 32" className="orb-stone relative size-full">
        <rect width="32" height="32" rx="16" className="orb-tile" />
        {LOGO.facets.map((facet, i) => (
          <path key={facet.d} d={facet.d} opacity={facet.opacity} className="orb-facet" style={{ "--i": i } as React.CSSProperties} />
        ))}
        <path d={LOGO.table} className="orb-table" />
      </svg>
    </div>
  );
}

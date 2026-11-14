"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * The show's clock. Live, it is the wall clock. When a recording plays, it is the recorded run's clock, so a
 * countdown in a recording counts down as it did on the day instead of showing zero.
 */
export const ClockOffset = createContext(0);

export function useShowNow(tick: boolean, everyMs = 250): number {
  const offset = useContext(ClockOffset);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!tick) return;
    const t = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(t);
  }, [tick, offset, everyMs]);
  return now;
}

/** The show clock's time when `seen` first became true (undefined before). */
export function useArrival(seen: boolean): number | undefined {
  const offset = useContext(ClockOffset);
  const [at, setAt] = useState<number>();
  useEffect(() => {
    if (!seen || at !== undefined) return;
    const t = setTimeout(() => setAt(Date.now() + offset), 0);
    return () => clearTimeout(t);
  }, [seen, at, offset]);
  return at;
}

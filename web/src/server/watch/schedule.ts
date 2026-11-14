import type { Runtime } from "../runtime";

/**
 * The watch without a person: one timer per process, like the test-account resets (accounts/schedule.ts) and the
 * recall radar's poll. Every DOCK_WATCH_MINUTES (default 30; 0 turns it off) it runs the watch over every kitchen
 * (server/watch/service.ts runWatch): one live call per kitchen with something to watch, at most every ten minutes
 * per kitchen (the cache), and the renewals that are due (the cut-off within 30 hours). Not under tests or during a
 * build; it never keeps the process alive. Staff have the same run as a button (/ops/watch, "Run the watch now").
 */
const g = globalThis as typeof globalThis & { __dockWatchTimer?: NodeJS.Timeout; __dockWatchRunning?: boolean };

export function watchMinutes(): number {
  const v = Number(process.env.DOCK_WATCH_MINUTES?.trim() || 30);
  return Number.isFinite(v) && v >= 0 ? v : 30;
}

export function scheduleInfo(): { minutes: number | null; reason?: string } {
  if (process.env.VITEST) return { minutes: null, reason: "not under tests" };
  const m = watchMinutes();
  return m === 0 ? { minutes: null, reason: "DOCK_WATCH_MINUTES=0" } : { minutes: m };
}

export function scheduleWatch(rt: Runtime): void {
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build") return;
  const minutes = watchMinutes();
  if (g.__dockWatchTimer) clearInterval(g.__dockWatchTimer);
  if (minutes === 0) return;
  g.__dockWatchTimer = setInterval(() => {
    if (g.__dockWatchRunning) return;
    g.__dockWatchRunning = true;
    void import("./service")
      .then((m) => m.runWatch(rt, { by: "schedule" }))
      .catch((err) => console.warn("[watch] scheduled run failed", (err as Error).message))
      .finally(() => (g.__dockWatchRunning = false));
  }, minutes * 60_000);
  g.__dockWatchTimer.unref();
}

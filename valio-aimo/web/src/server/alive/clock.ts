import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The sample activity's two contexts, carried by async context so nothing else in the process is touched:
 *
 *   playing   while the seed plays a beat (story.ts): which sample set it belongs to and how far back in time the beat
 *             happens. The ledger's clock and the gate's clock read `sampleNow()`, so a beat written "three days ago"
 *             carries that time in its entries and its order; every entry it writes is stamped `data.sample`.
 *   viewing   while an operations page reads (server/ops/handler.ts): whether that viewer hides the sample.
 *
 * Outside both, `sampleNow()` is the real time and every read sees everything: a request that is not a sample beat
 * is never moved in time, and the core never knows any of this.
 */
export type Playing = { setId: string; offsetMs: number; beat?: string };
export type Viewing = { hideSample: boolean };

const g = globalThis as typeof globalThis & { __dockSamplePlaying?: AsyncLocalStorage<Playing>; __dockSampleViewing?: AsyncLocalStorage<Viewing> };
const playing = (g.__dockSamplePlaying ??= new AsyncLocalStorage<Playing>());
const viewing = (g.__dockSampleViewing ??= new AsyncLocalStorage<Viewing>());

/** Now, or the beat's moment while a sample beat plays. */
export function sampleNow(): Date {
  const p = playing.getStore();
  return new Date(Date.now() + (p?.offsetMs ?? 0));
}

/** The beat playing in this async context, if any. */
export function playingNow(): Playing | undefined {
  return playing.getStore();
}

/** Play `fn` as part of sample set `setId`, `agoMs` before now (0: now). */
export function play<T>(setId: string, agoMs: number, beat: string, fn: () => Promise<T>): Promise<T> {
  // A beat sees the store as the gate does, whatever page started it (never a viewer's narrowed reads).
  return viewing.run({ hideSample: false }, () => playing.run({ setId, offsetMs: -Math.max(0, agoMs), beat }, fn));
}

/** Read as a viewer who hides (or shows) the sample. */
export function viewAs<T>(v: Viewing, fn: () => T): T {
  return viewing.run(v, fn);
}

export function viewingNow(): Viewing | undefined {
  return viewing.getStore();
}

/** The cookie the operations portal's switch sets: "hidden" hides the sample on every operations page. */
export const SAMPLE_COOKIE = "aimopilot-sample";

export function hidesSample(cookieHeader: string | null | undefined): boolean {
  return /(?:^|;\s*)aimopilot-sample=hidden(?:;|$)/.test(cookieHeader ?? "");
}

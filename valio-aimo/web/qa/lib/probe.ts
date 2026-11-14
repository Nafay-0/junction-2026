 
import type { Http, Recorder } from "./http";
import type { Checks } from "./invariants";

export const AREAS = [
  "gate", "quotes", "ledger", "mandate", "intake", "conversion", "dates", "memory", "interpreter", "runner", "rest", "mcp", "sandbox", "screens", "dependency",
] as const;
export const KINDS = ["plausible", "hostile", "boundary", "sequence", "authority", "exhaustion", "inconsistency", "language", "usability"] as const;
export type Area = (typeof AREAS)[number];
export type Kind = (typeof KINDS)[number];

export type ProbeCtx = {
  http: Http; // the server under test (seed catalogue unless stated)
  rec: Recorder;
  check: Checks;
  rng: () => number;
  seed: number;
  /** Optional second server on the partner's real catalogue; live lookups there are rationed. */
  realHttp?: Http;
  /** Count of live lookups this run made against the real server (budgeted). */
  live: { used: number; budget: number };
  /** Whether mandates minted locally are accepted by the server (same org keys). */
  keysMatch: boolean;
};

export type Probe = {
  id: string;
  area: Area;
  kind: Kind;
  title: string;
  /** Finding ids this probe reproduces when it fails (see qa/findings.json). */
  findings?: string[];
  /** "real": needs the real-catalogue server; "keys": needs locally minted mandates to verify; "any": always runs. */
  needs?: ("real" | "keys")[];
  /** How many probe-level cases it runs (for the coverage matrix); default 1. */
  cases?: number;
  run(ctx: ProbeCtx): Promise<void | { cases?: number; skip?: string }>;
};

/** Deterministic PRNG (mulberry32). */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Crash-test ratings and licence levels per agent, as the operations portal shows them.
 *
 * The crash test (src/crash/, its own branch) rates an agent on a scenario suite and gives it a licence level
 * (L0 Learner to L3 Autonomous) that caps what it may buy alone. Until that engine publishes results to the
 * running server, this reads a small JSON file if one exists and says "not crash-tested yet" otherwise:
 *
 *   DOCK_LICENCES_FILE (default .data/licences.json):
 *   { "licences": [ { "agentId": "agent_kaari_buyer", "level": "L2", "name": "Trusted", "rating": 86.4,
 *       "perOrderLimitCents": 100000, "substitution": "needs_approval", "why": "...", "ratedAt": "2026-11-14T08:00:00Z",
 *       "suite": "dock-crash/1", "crashAgent": "reference" } ] }
 *
 * To light it up from the engine: implement LicenceSource over its results and pass it to `licenceSource()`.
 */
export type LicenceRecord = {
  agentId: string;
  level: string;
  name: string;
  rating?: number;
  perOrderLimitCents?: number;
  substitution?: string;
  why?: string;
  ratedAt?: string;
  suite?: string;
  crashAgent?: string;
};

export interface LicenceSource {
  /** "file" or the engine's name; "none" when nothing is available yet. */
  readonly kind: string;
  get(agentId: string): LicenceRecord | undefined;
}

const g = globalThis as typeof globalThis & { __dockLicenceSource?: LicenceSource; __dockLicenceCache?: { file: string; mtime: number; byAgent: Map<string, LicenceRecord> } };

function licencesFile(): string {
  return process.env.DOCK_LICENCES_FILE?.trim() || path.join(process.cwd(), ".data", "licences.json");
}

/** Reads the file again when it changes, so a new crash-test run shows without a restart. */
export const fileLicenceSource: LicenceSource = {
  get kind() {
    return fileRecords().size ? "file" : "none";
  },
  get(agentId) {
    return fileRecords().get(agentId);
  },
};

function fileRecords(): Map<string, LicenceRecord> {
  const file = licencesFile();
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return new Map();
  }
  const hit = g.__dockLicenceCache;
  if (hit && hit.file === file && hit.mtime === mtime) return hit.byAgent;
  const byAgent = new Map<string, LicenceRecord>();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { licences?: unknown };
    for (const r of Array.isArray(parsed.licences) ? parsed.licences : []) {
      const rec = r as Partial<LicenceRecord>;
      if (typeof rec.agentId === "string" && typeof rec.level === "string") byAgent.set(rec.agentId, { name: rec.level, ...rec } as LicenceRecord);
    }
  } catch {
    // a broken file reads as no licences, never as a crash of the portal
  }
  g.__dockLicenceCache = { file, mtime, byAgent };
  return byAgent;
}

export function licenceSource(replace?: LicenceSource): LicenceSource {
  if (replace) g.__dockLicenceSource = replace;
  return g.__dockLicenceSource ?? fileLicenceSource;
}

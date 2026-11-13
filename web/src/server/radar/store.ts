import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Dock } from "@/core/orders";
import { newSpend } from "./partners";
import { SOURCES, type SourceId } from "./sources";
import type { Hold, Match, Notice, SourceState, Spend } from "./types";

/**
 * The radar's state for one Dock instance: sources, notices, matches, holds, drills and spend. Holds are a safety
 * control, so they survive a restart: the state is written to .data/radar/state.json (RADAR_STATE_FILE to move it,
 * "off" to keep it in memory, as tests do). On several instances it belongs in shared storage next to the repository.
 */

export type DrillNotice = {
  drillId: string;
  slug: string;
  productId: string;
  productName: string;
  /** The catalogue's names, so the page can name the product exactly as the wholesaler lists it. */
  names: { fi?: string; sv?: string; en?: string };
  brand?: string | null;
  vendor?: string | null;
  ean?: string;
  pack?: string;
  bestBefore: string;
  publishedAt: string;
  publishedBy: string;
  withdrawnAt?: string;
  withdrawnBy?: string;
  /** When the radar picked it up and when the hold it caused stopped an order: the drill's own stopwatch. */
  pickedUpAt?: string;
  heldAt?: string;
  firstRefusalAt?: string;
};

export type RadarState = {
  version: 1;
  sources: Record<SourceId, SourceState>;
  notices: Notice[];
  matches: Match[];
  holds: Hold[];
  drills: DrillNotice[];
  spend: Spend;
  /** URLs Exa found that Context.dev read as not being a recall notice: not read again. */
  notRecalls: string[];
  startedAt: string;
};

function freshState(now = new Date()): RadarState {
  const sources = Object.fromEntries(SOURCES.map((s) => [s.id, { sourceId: s.id, status: "never_checked", checks: 0, noticesRead: 0 } satisfies SourceState])) as Record<SourceId, SourceState>;
  return { version: 1, sources, notices: [], matches: [], holds: [], drills: [], spend: newSpend(now), notRecalls: [], startedAt: now.toISOString() };
}

function stateFile(): string | undefined {
  const v = process.env.RADAR_STATE_FILE?.trim();
  if (v === "off" || (!v && (process.env.VITEST || process.env.NODE_ENV === "test"))) return undefined;
  return v || path.resolve(process.cwd(), ".data", "radar", "state.json");
}

export class RadarStore {
  state: RadarState;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private readonly file = stateFile();

  constructor(readonly dock: Dock) {
    this.state = this.load();
  }

  private load(): RadarState {
    const fresh = freshState();
    if (!this.file || !existsSync(this.file)) return fresh;
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as RadarState;
      if (s.version !== 1) return fresh;
      // New sources added to the config since the file was written start unchecked; spend starts again per process.
      for (const id of Object.keys(fresh.sources) as SourceId[]) s.sources[id] ??= fresh.sources[id];
      s.spend = { ...newSpend(), contextDevRemaining: s.spend?.contextDevRemaining };
      s.notRecalls ??= [];
      s.drills ??= [];
      s.startedAt = fresh.startedAt;
      return s;
    } catch {
      return fresh;
    }
  }

  /** Written a moment later, so a burst of changes is one write. */
  save(): void {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
    this.saveTimer.unref?.();
  }

  flush(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.file);
    } catch {
      // read-only disk: the state stays in memory for this process
    }
  }

  /** Holds in force for any of these products, newest first. */
  activeHolds(productIds: Iterable<string>): Hold[] {
    const ids = new Set(productIds);
    return this.state.holds.filter((h) => !h.liftedAt && ids.has(h.productId)).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  }

  notice(noticeId: string): Notice | undefined {
    return this.state.notices.find((n) => n.noticeId === noticeId);
  }
}

const stores = new WeakMap<Dock, RadarStore>();

/** The radar state of one runtime's Dock (a fresh runtime, as in tests, gets a fresh store). */
export function radarStore(dock: Dock): RadarStore {
  let s = stores.get(dock);
  if (!s) stores.set(dock, (s = new RadarStore(dock)));
  return s;
}

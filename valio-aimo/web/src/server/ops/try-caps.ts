import { DockError } from "@/core/errors";

/**
 * What a visitor may try on the operations portal without the passcode (the third door, opsTry in handler.ts):
 * a few named actions, each with a limit per client address and, where it costs something shared, a server-wide
 * daily limit for visitors. Staff are not counted here. All in memory (one process; a restart resets them).
 *
 *   door            per address              visitors per UTC day         also capped by
 *   aiven-agent     3 an hour                (the launcher's own cap)     DOCK_SHOWCASE_LAUNCHES_PER_DAY=12 runs a day,
 *                                                                         one at a time, DOCK_SHOWCASE_LAUNCH_GAP_S apart
 *   copilot         20 an hour               400                          3 s per statement, 2 connections (dock_copilot)
 *   search-timing   1 per 10 minutes         60                           one run a minute on the server (probe-run.ts)
 *
 * Settings (optional, names in web/.env.example): DOCK_TRY_<DOOR>_PER_ADDRESS and DOCK_TRY_<DOOR>_DAILY, for example
 * DOCK_TRY_COPILOT_PER_ADDRESS=20, DOCK_TRY_SEARCH_TIMING_DAILY=60. DOCK_TRY=off closes the door (staff only again).
 *
 * A try that turns out free (the launcher plays a recording) or fails (an error answer) is given back.
 */
export type TryDoorId = "aiven-agent" | "copilot" | "search-timing";

type DoorDef = {
  /** What one try is, singular and plural, for the sentences. */
  one: string;
  many: string;
  perAddress: number;
  windowMs: number;
  /** "this hour", "in 10 minutes": the address window in words. */
  windowWords: string;
  /** Visitors' tries per UTC day on this server; null: none here (another cap covers it). */
  perDay: number | null;
  /** What pressing it costs or touches, in one plain line. */
  costs: string;
};

const HOUR = 3_600_000;

const DEFAULTS: Record<TryDoorId, DoorDef> = {
  "aiven-agent": {
    one: "Aiven agent run",
    many: "Aiven agent runs",
    perAddress: 3,
    windowMs: HOUR,
    windowWords: "an hour",
    perDay: null,
    costs: "Starts one buyer on Aiven's free Managed Agents tier, using one of this server's runs for today; it orders for Laakso Catering, the demo kitchen. When none is left, a recording plays and nothing is counted.",
  },
  copilot: {
    one: "question",
    many: "questions",
    perAddress: 20,
    windowMs: HOUR,
    windowWords: "an hour",
    perDay: 400,
    costs: "Runs one read-only query as dock_copilot on one telemetry view (or reads Aiven's service list). No model is called, so it adds nothing to the model spend.",
  },
  "search-timing": {
    one: "timing run",
    many: "timing runs",
    perAddress: 1,
    windowMs: 10 * 60_000,
    windowWords: "per 10 minutes",
    perDay: 60,
    costs: "About 30 catalogue searches through both backends: 30 query embeddings (a fraction of a cent, counted in the day's model spend) and 30 OpenSearch queries. Nothing is written but one telemetry event.",
  },
};

const envName = (door: TryDoorId, what: "PER_ADDRESS" | "DAILY") => `DOCK_TRY_${door.toUpperCase().replace(/-/g, "_")}_${what}`;
const envInt = (name: string): number | undefined => {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** The door's settings now (read on every call, so a restart with new values needs no code change). */
export function doorDef(door: TryDoorId): DoorDef {
  const d = DEFAULTS[door];
  const perDay = envInt(envName(door, "DAILY"));
  return { ...d, perAddress: envInt(envName(door, "PER_ADDRESS")) ?? d.perAddress, perDay: perDay ?? d.perDay };
}

export const tryOpen = () => !/^(0|off|false|no)$/i.test(process.env.DOCK_TRY?.trim() ?? "");

/** What one address may still do at one door: shown on the page, so a cap is never a surprise. */
export type TryRoom = {
  door: TryDoorId;
  /** Tries left for this address in its current window. */
  left: number;
  perAddress: number;
  windowWords: string;
  /** What one try is called: "question", "questions". */
  one: string;
  many: string;
  /** Seconds until this address's window frees up again (null when nothing is used). */
  freesInS: number | null;
  /** Visitors' tries left today on this server, null when the door has no daily count. */
  dayLeft: number | null;
  perDay: number | null;
  /** Seconds to midnight UTC, when the daily count starts again. */
  dayFreesInS: number;
  /** One line: what pressing it costs or touches. */
  costs: string;
  /** Why it is closed right now, in words with when it frees up; absent when a try is possible. */
  blocked?: string;
  /** The door is closed on this server (DOCK_TRY=off). */
  closed?: true;
};

type Window = { start: number; count: number };
type Day = { day: string; count: number };

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const toMidnightS = (t: number) => {
  const d = new Date(t);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - t) / 1000));
};

/** "41 seconds", "12 minutes", "3 h 5 min". */
export function inWords(s: number): string {
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** A taken try; give it back when it turned out free or failed. */
export type Ticket = { giveBack: () => void };

export class TryCaps {
  private readonly windows = new Map<string, Window>();
  private readonly days = new Map<TryDoorId, Day>();
  constructor(private readonly maxKeys = 20_000) {}

  private win(door: TryDoorId, addr: string, now: number): Window | undefined {
    const w = this.windows.get(`${door}|${addr}`);
    return w && now - w.start < doorDef(door).windowMs ? w : undefined;
  }

  private day(door: TryDoorId, now: number): Day {
    const d = utcDay(now);
    let c = this.days.get(door);
    if (!c || c.day !== d) {
      c = { day: d, count: 0 };
      this.days.set(door, c);
    }
    return c;
  }

  room(door: TryDoorId, addr: string, now = Date.now()): TryRoom {
    const def = doorDef(door);
    const w = this.win(door, addr, now);
    const used = w?.count ?? 0;
    const freesInS = w ? Math.max(1, Math.ceil((w.start + def.windowMs - now) / 1000)) : null;
    const dayUsed = this.day(door, now).count;
    const dayLeft = def.perDay === null ? null : Math.max(0, def.perDay - dayUsed);
    const room: TryRoom = { door, left: Math.max(0, def.perAddress - used), perAddress: def.perAddress, windowWords: def.windowWords, one: def.one, many: def.many, freesInS, dayLeft, perDay: def.perDay, dayFreesInS: toMidnightS(now), costs: def.costs };
    if (!tryOpen()) return { ...room, left: 0, closed: true, blocked: "Visitors cannot start this on this server today; staff with the passcode can." };
    if (dayLeft === 0) room.blocked = `Today's ${def.perDay} ${def.many} for visitors on this server are used. They start again at midnight UTC, in ${inWords(room.dayFreesInS)}.`;
    else if (room.left === 0) room.blocked = `You have used ${def.perAddress === 1 ? `your ${def.one}` : `your ${def.perAddress} ${def.many}`} ${def.windowWords} from this address. The next one frees up in ${inWords(freesInS ?? 1)}.`;
    return room;
  }

  /** Count one try for this address, or refuse with 429 try_limit saying when it frees up. */
  take(door: TryDoorId, addr: string, now = Date.now()): Ticket {
    const room = this.room(door, addr, now);
    if (room.blocked) throw new DockError(room.closed ? 403 : 429, room.closed ? "staff_only" : "try_limit", room.blocked, undefined, { door, retryInS: room.closed ? null : room.dayLeft === 0 ? room.dayFreesInS : room.freesInS });
    const def = doorDef(door);
    const id = `${door}|${addr}`;
    let w = this.win(door, addr, now);
    if (!w) {
      this.windows.delete(id); // re-insert so Map order stays oldest-first
      w = { start: now, count: 0 };
      this.windows.set(id, w);
      this.evict();
    }
    w.count++;
    const d = this.day(door, now);
    if (def.perDay !== null) d.count++;
    const taken = w;
    let given = false;
    return {
      giveBack: () => {
        if (given) return;
        given = true;
        if (taken.count > 0) taken.count--;
        // Only while that day's count is still the one in use: after midnight UTC the old day's count is gone, and
        // a try taken yesterday must not lower today's. (Not the real clock: a caller may pass its own `now`.)
        if (def.perDay !== null && this.days.get(door) === d && d.count > 0) d.count--;
      },
    };
  }

  private evict() {
    if (this.windows.size <= this.maxKeys) return;
    for (const id of this.windows.keys()) {
      if (this.windows.size <= this.maxKeys * 0.9) break;
      this.windows.delete(id);
    }
  }

  /** Tests only. */
  reset() {
    this.windows.clear();
    this.days.clear();
  }
}

const g = globalThis as typeof globalThis & { __dockTryCaps?: TryCaps };
export const tryCaps = () => (g.__dockTryCaps ??= new TryCaps());

export const TRY_DOORS: TryDoorId[] = ["aiven-agent", "copilot", "search-timing"];

/** GET /ops-api/platform/try: this address's room at every door; `staff` when the passcode is in. */
export type TryStatus = { staff: boolean; doors: Record<TryDoorId, TryRoom> };

/** Mail addresses in what a visitor is shown: withheld (the viewer rules show no contact details). */
export function scrubMail<T>(value: T): T {
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, "[mail address withheld]");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

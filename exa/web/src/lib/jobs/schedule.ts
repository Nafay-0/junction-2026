import { Cron } from "croner";
import { MIN_GAP_MINUTES, type JobSchedule } from "./types";

/*
 * When a job runs next. Plain functions over the schedule: no database, no clock of their own
 * (the caller says what "now" is), so they can be tested with fixed dates.
 *
 * Times the agent gives are wall-clock times in the job's time zone ("2026-11-15T08:00"), which
 * is how a person says them. A time that carries its own offset or a Z is taken as it is.
 */

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 } as const;

export function validTimeZone(timeZone: string | undefined | null): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** How far a time zone is from UTC at a given moment, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(instant / 1000) * 1000;
}

/** A moment from what the agent wrote: with an offset it is exact, without one it is local time in `timeZone`. Null when it is no date. */
export function momentOf(text: string | undefined | null, timeZone: string): Date | null {
  const raw = text?.trim();
  if (!raw) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const exact = new Date(raw);
    return Number.isNaN(exact.getTime()) ? null : exact;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  if (Number.isNaN(wall)) return null;
  // The offset depends on the moment, and the moment on the offset: twice round settles it, clock changes included.
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return new Date(instant);
}

const cronOf = (line: string, timeZone: string) => new Cron(line.trim(), { timezone: timeZone, paused: true, mode: "5-part" });

export type Checked = { ok: true; schedule: JobSchedule } | { ok: false; problem: string };

/** Make sure a schedule from outside (the model) is one that can be kept. `problem` is a sentence the agent can act on. */
export function checkSchedule(input: unknown, timeZone: string, now = new Date()): Checked {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (s.kind === "once") {
    const at = momentOf(typeof s.at === "string" ? s.at : "", timeZone);
    if (!at) return { ok: false, problem: 'A one-time job needs `at`: the local date and time, like "2026-11-15T08:00".' };
    if (at.getTime() <= now.getTime() - 60_000) return { ok: false, problem: "That time has already passed. Give a time in the future." };
    return { ok: true, schedule: { kind: "once", at: at.toISOString() } };
  }
  if (s.kind === "every") {
    const every = Number(s.every);
    const unit = s.unit as keyof typeof UNIT_MS;
    if (!Number.isInteger(every) || every < 1 || !(unit in UNIT_MS)) return { ok: false, problem: "A repeating job needs `every` (a whole number) and `unit` (minutes, hours, days or weeks)." };
    if (every * UNIT_MS[unit] < MIN_GAP_MINUTES * 60_000) return { ok: false, problem: `A job can run at most every ${MIN_GAP_MINUTES} minutes.` };
    const from = typeof s.from === "string" && s.from.trim() ? momentOf(s.from, timeZone) : null;
    if (typeof s.from === "string" && s.from.trim() && !from) return { ok: false, problem: '`from` must be a local date and time, like "2026-11-15T08:00".' };
    return { ok: true, schedule: { kind: "every", every, unit, ...(from ? { from: from.toISOString() } : {}) } };
  }
  if (s.kind === "cron") {
    const line = typeof s.cron === "string" ? s.cron.trim().replace(/\s+/g, " ") : "";
    if (line.split(" ").length !== 5) return { ok: false, problem: "A cron schedule is five fields: minute hour day-of-month month day-of-week, like \"0 8 * * 1-5\"." };
    let runs: Date[];
    try {
      runs = cronOf(line, timeZone).nextRuns(8, now);
    } catch (err) {
      return { ok: false, problem: `That cron line is not valid (${err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : "unknown reason"}).` };
    }
    if (runs.length === 0) return { ok: false, problem: "That cron line never comes up." };
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].getTime() - runs[i - 1].getTime() < MIN_GAP_MINUTES * 60_000) return { ok: false, problem: `A job can run at most every ${MIN_GAP_MINUTES} minutes.` };
    }
    return { ok: true, schedule: { kind: "cron", cron: line } };
  }
  return { ok: false, problem: 'The schedule needs a `kind`: "once", "every" or "cron".' };
}

export type Limits = {
  /** When the job was made: where an interval without `from` counts from. */
  createdAt: Date;
  untilAt?: Date | null;
  maxRuns?: number | null;
  /** Scheduled runs so far. */
  runCount: number;
};

/** The first run after `after`, or null when the job has no run left. */
export function nextRun(schedule: JobSchedule, timeZone: string, after: Date, limits: Limits): Date | null {
  if (limits.maxRuns != null && limits.runCount >= limits.maxRuns) return null;
  let next: Date | null = null;
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    next = limits.runCount === 0 && !Number.isNaN(at.getTime()) ? at : null;
    // A one-time job whose moment passed while the server was away still runs, once.
    if (next && next.getTime() <= after.getTime()) next = limits.runCount === 0 ? next : null;
  } else if (schedule.kind === "every") {
    const step = schedule.every * UNIT_MS[schedule.unit];
    const first = schedule.from ? new Date(schedule.from).getTime() : limits.createdAt.getTime() + step;
    next = new Date(after.getTime() < first ? first : first + (Math.floor((after.getTime() - first) / step) + 1) * step);
  } else {
    try {
      next = cronOf(schedule.cron, timeZone).nextRun(after);
    } catch {
      next = null;
    }
  }
  if (!next) return null;
  if (limits.untilAt && next.getTime() > limits.untilAt.getTime()) return null;
  return next;
}

/** The next few runs, for showing someone what a schedule really means. */
export function upcoming(schedule: JobSchedule, timeZone: string, count: number, after: Date, limits: Limits): Date[] {
  const out: Date[] = [];
  let from = after;
  let done = limits.runCount;
  while (out.length < count) {
    const next = nextRun(schedule, timeZone, from, { ...limits, runCount: done });
    if (!next) break;
    out.push(next);
    from = next;
    done += 1;
  }
  return out;
}

/** A date as a person in that time zone would say it: "Mon 16 Nov, 08:00". */
export function sayWhen(date: Date, timeZone: string): string {
  return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

/** The schedule in plain words, when the agent gave none. */
export function describeSchedule(schedule: JobSchedule, timeZone: string): string {
  if (schedule.kind === "once") return `Once, on ${sayWhen(new Date(schedule.at), timeZone)}`;
  if (schedule.kind === "every") return `Every ${schedule.every === 1 ? schedule.unit.replace(/s$/, "") : `${schedule.every} ${schedule.unit}`}`;
  return `On a schedule (${schedule.cron})`;
}

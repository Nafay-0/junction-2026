import { decodeJwt } from "jose";
import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { roleLabel } from "@/app/_ui/plain";
import type { Runtime } from "../runtime";
import type { SandboxSummary } from "../sandboxes";
import type { Send } from "./agent";
import { SIGNOFF_TIMEOUT_MS, WeekDirector, type Pace } from "./week";
import type { Frame, KitchenRef, Recording, WeekRun } from "./types";

/**
 * The weeks playing in this server process, one per kitchen at a time. Several visitors' weeks run side by side,
 * each in its own kitchen (their own organisation, mandate and approver), so they never share an order, a budget
 * or a sign-off; the catalogue lock (lock.ts) keeps their simulated conditions apart.
 *
 * Every change of a run is kept as a frame, so a finished live run can be saved as a recording and replayed through
 * the same screen when the network or a service fails (recordings.ts).
 */
export const SHOW_LIMITS = {
  /** Weeks at once, across all kitchens. */
  concurrent: Number(process.env.DOCK_SHOW_CONCURRENT_WEEKS ?? 4),
  /** Weeks per UTC day: each costs a few dozen partner calls and no model calls. */
  perDay: Number(process.env.DOCK_SHOW_WEEKS_PER_DAY ?? 250),
  signOffTimeoutMs: Number(process.env.DOCK_SHOW_SIGNOFF_SECONDS ?? SIGNOFF_TIMEOUT_MS / 1000) * 1000,
};

type Entry = { director: WeekDirector; latest: WeekRun; frames: Frame<WeekRun>[]; t0: number; waiters: Set<() => void>; promise: Promise<WeekRun> };

type State = { runs: Map<string, Entry>; byKitchen: Map<string, string>; day: string; started: number; house?: string; finished: { runId: string; liveCalls: number }[] };
const g = globalThis as typeof globalThis & { __dockShow?: State };
const state = (): State => (g.__dockShow ??= { runs: new Map(), byKitchen: new Map(), day: utcDay(), started: 0, finished: [] });

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function roll(s: State) {
  const d = utcDay();
  if (d !== s.day) {
    s.day = d;
    s.started = 0;
    s.finished = [];
  }
}

/** The mandate inside a kitchen's token (already verified when it was signed; the gate verifies it again on every call). */
function mandateOf(token: string): Mandate {
  return (decodeJwt(token) as { mandate: Mandate }).mandate;
}

export function kitchenRef(s: SandboxSummary, house = false): KitchenRef {
  return {
    sandboxId: s.sandboxId,
    orgId: s.orgId,
    agentId: s.agentId,
    name: s.kitchenName,
    city: s.city,
    approverName: s.approverName,
    roleLabel: roleLabel(s.role),
    passkey: s.passkey,
    perOrderLimitCents: s.perOrderLimitCents,
    expiresAt: s.expiresAt,
    house,
  };
}

/**
 * The kitchen the week runs in: the visitor's own (by sandbox id), else the house kitchen, a visitor kitchen the
 * show made without a phone. Nobody holds a passkey for the house kitchen, so its sign-off always times out and the
 * agent withdraws the order; the screen says so before the week starts.
 */
export async function resolveKitchen(rt: Runtime, sandboxId?: string): Promise<{ ref: KitchenRef; token: string; mandate: Mandate }> {
  const s = state();
  let id = sandboxId;
  let house = false;
  if (!id) {
    const existing = s.house ? await rt.sandboxes.get(s.house) : undefined;
    if (existing && Date.parse(existing.expiresAt) - Date.now() > 10 * 60_000) id = existing.sandboxId;
    else {
      const made = await rt.sandboxes.joinWithoutPasskey();
      s.house = made.sandbox.sandboxId;
      id = made.sandbox.sandboxId;
    }
    house = true;
  }
  const summary = await rt.sandboxes.get(id);
  const creds = await rt.sandboxes.agentCredentials(id);
  if (!summary || !creds) throw new DockError(404, "kitchen_not_found", "That visitor kitchen does not exist any more (kitchens close after 90 minutes). Scan the code again.");
  return { ref: kitchenRef(summary, house || id === s.house), token: creds.mandateToken, mandate: mandateOf(creds.mandateToken) };
}

export type StartOptions = { sandboxId?: string; pace?: Pace; signOffTimeoutMs?: number; send?: Send; now?: () => Date };

/** Start (or restart) the week for a kitchen. A week already playing there is stopped and cleaned up first. */
export async function startWeek(rt: Runtime, opts: StartOptions = {}): Promise<WeekRun> {
  const s = state();
  roll(s);
  const { ref, token, mandate } = await resolveKitchen(rt, opts.sandboxId);
  const previous = s.byKitchen.get(ref.sandboxId);
  if (previous) await stopWeek(previous);
  const active = [...s.runs.values()].filter((e) => !isOver(e.latest)).length;
  if (active >= SHOW_LIMITS.concurrent) throw new DockError(429, "show_busy", `${active} weeks are playing already; the table runs at most ${SHOW_LIMITS.concurrent} at once. Try again in a minute.`, "show_limit");
  if (s.started >= SHOW_LIMITS.perDay) throw new DockError(429, "show_daily_cap", `The show's ${SHOW_LIMITS.perDay} weeks for today are used up; switch to the recording (key F).`, "show_limit");
  s.started += 1;
  const holder: { entry?: Entry } = {};
  const director = new WeekDirector({
    rt,
    kitchen: ref,
    mandateToken: token,
    mandate,
    send: opts.send,
    pace: opts.pace,
    now: opts.now,
    signOffTimeoutMs: opts.signOffTimeoutMs ?? SHOW_LIMITS.signOffTimeoutMs,
    onChange: (run) => {
      const entry = holder.entry;
      if (!entry) return;
      entry.latest = run;
      entry.frames.push({ t: Date.now() - entry.t0, data: run });
      if (entry.frames.length > 400) entry.frames.splice(1, entry.frames.length - 400);
      for (const w of [...entry.waiters]) w();
    },
  });
  const entry: Entry = { director, latest: structuredClone(director.run), frames: [{ t: 0, data: structuredClone(director.run) }], t0: Date.now(), waiters: new Set(), promise: Promise.resolve(director.run) };
  holder.entry = entry;
  s.runs.set(director.run.runId, entry);
  s.byKitchen.set(ref.sandboxId, director.run.runId);
  entry.promise = director.play().then((run) => {
    s.finished.push({ runId: run.runId, liveCalls: run.liveCalls });
    if (s.byKitchen.get(ref.sandboxId) === run.runId) s.byKitchen.delete(ref.sandboxId);
    pruneRuns(s);
    return run;
  });
  void entry.promise.catch(() => undefined);
  return structuredClone(entry.latest);
}

function isOver(r: WeekRun): boolean {
  return r.state === "finished" || r.state === "cancelled" || r.state === "failed";
}

function pruneRuns(s: State) {
  const done = [...s.runs.entries()].filter(([, e]) => isOver(e.latest)).sort((a, b) => a[1].t0 - b[1].t0);
  for (const [id] of done.slice(0, Math.max(0, done.length - 30))) s.runs.delete(id);
}

export async function stopWeek(runId: string): Promise<WeekRun | undefined> {
  const e = state().runs.get(runId);
  if (!e) return undefined;
  return e.director.stop();
}

export function getWeek(runId: string): WeekRun | undefined {
  const e = state().runs.get(runId);
  return e && structuredClone(e.latest);
}

/** The run's state once its version passes `after`, or after `waitMs` whatever it is (long poll). */
export async function nextWeek(runId: string, after: number, waitMs = 15_000): Promise<WeekRun | undefined> {
  const e = state().runs.get(runId);
  if (!e) return undefined;
  if (e.latest.version > after || isOver(e.latest)) return structuredClone(e.latest);
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      e.waiters.delete(done);
      resolve();
    };
    const t = setTimeout(done, waitMs);
    e.waiters.add(done);
  });
  return structuredClone(e.latest);
}

/** Wait for the week to end (tests, the recorder). */
export async function weekDone(runId: string): Promise<WeekRun | undefined> {
  const e = state().runs.get(runId);
  return e ? e.promise : undefined;
}

export function listWeeks(): WeekRun[] {
  // Newest first, by when they were started in this process.
  return [...state().runs.values()].reverse().map((e) => structuredClone(e.latest));
}

export function activeWeekFor(sandboxId: string): WeekRun | undefined {
  const id = state().byKitchen.get(sandboxId);
  return id ? getWeek(id) : listWeeks().find((r) => r.kitchen.sandboxId === sandboxId);
}

/** The run's frames as a recording, ready to save (recordings.ts). */
export function recordingOf(runId: string, source: string): Recording<WeekRun> | undefined {
  const e = state().runs.get(runId);
  if (!e || !isOver(e.latest)) return undefined;
  const frames = e.frames.map((f) => ({ t: f.t, data: { ...f.data, source: "recording" as const, recordedAt: e.latest.endedAt } }));
  return { kind: "week", title: `A week in ${e.latest.kitchen.name}`, capturedAt: e.latest.endedAt ?? new Date().toISOString(), source, durationMs: frames.at(-1)?.t ?? 0, frames };
}

export function showCounts(): { day: string; started: number; finished: number; liveCalls: number; houseKitchen?: string } {
  const s = state();
  roll(s);
  return { day: s.day, started: s.started, finished: s.finished.length, liveCalls: s.finished.reduce((n, f) => n + f.liveCalls, 0), houseKitchen: s.house };
}

/** Tests only. */
export function resetShow(): void {
  g.__dockShow = undefined;
}

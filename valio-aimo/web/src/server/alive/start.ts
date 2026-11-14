import { newId } from "@/core/util";
import type { Runtime } from "@/server/runtime";
import { play, viewAs, viewingNow } from "./clock";
import { SAMPLE_STEP_SUPERSEDED, sampleSets, setOfEntry } from "./marks";
import type { SeedReport } from "./story";

/**
 * When the sample activity plays (DOCK_SAMPLE_ACTIVITY):
 *
 *   on     at start, when the ledger has no activity in the last day (a laptop, a preview: always, since memory starts
 *          empty). The default for an in-memory server.
 *   once   at start, only if the ledger holds no sample set yet (idempotent: a restart does not play it again). The
 *          default with DOCK_STORE=postgres (the hosted site).
 *   off    never by itself; "Refresh the sample activity" on the operations portal still plays one.
 *
 * Never under tests or during a build unless a test asks (playStory directly). It runs after start, in the
 * background: the server answers meanwhile and pages fill as it goes.
 */
export type SampleSetting = "on" | "once" | "off";

export function sampleSetting(rt: Pick<Runtime, "aiven">): SampleSetting {
  const v = process.env.DOCK_SAMPLE_ACTIVITY?.trim().toLowerCase();
  if (v === "on" || v === "once" || v === "off") return v;
  if (v === "0" || v === "false" || v === "no") return "off";
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build") return "off";
  return rt.aiven.switches.store === "postgres" ? "once" : "on";
}

type State = { running?: Promise<SeedReport | undefined>; last?: SeedReport; lastTouch: number; lastFresh: number; lastSlow: number; todayPlayed?: string };
const g = globalThis as typeof globalThis & { __dockSampleState?: WeakMap<object, State> };
const states = (g.__dockSampleState ??= new WeakMap());
const stateOf = (rt: Runtime): State => {
  let s = states.get(rt.dock);
  if (!s) states.set(rt.dock, (s = { lastTouch: 0, lastFresh: 0, lastSlow: 0 }));
  return s;
};

const DAY = 86_400_000;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: "info", at: new Date().toISOString(), component: "sample", msg, ...extra }));

/** The set pages show now: the newest one not superseded. */
export function currentSet(rt: Runtime): { set: string; firstAt: string; lastAt: string } | undefined {
  return sampleSets(rt.dock.ledger).filter((s) => !s.superseded).at(-1);
}

/** What /ops shows about the sample: whether any is there, the newest set, and the ids its "Start here" links to. */
export function sampleStatus(rt: Runtime): { setting: SampleSetting; running: boolean; current?: { set: string; firstAt: string; lastAt: string }; ids: Record<string, string>; sets: number } {
  const cur = currentSet(rt);
  let ids: Record<string, string> = {};
  if (cur) {
    for (const e of rt.dock.ledger.unfiltered()) {
      const d = e.data as { step?: string; ids?: Record<string, string>; sample?: { set?: string } };
      if (e.type === "control" && d.step === "sample_played" && d.sample?.set === cur.set && d.ids) ids = { ...ids, ...d.ids };
    }
  }
  return { setting: sampleSetting(rt), running: !!stateOf(rt).running, ...(cur ? { current: cur } : {}), ids, sets: sampleSets(rt.dock.ledger).length };
}

/** Play a set (or parts of the current one), one at a time per process. */
async function run(rt: Runtime, opts: Parameters<typeof import("./story").playStory>[1]): Promise<SeedReport | undefined> {
  const s = stateOf(rt);
  if (s.running) await s.running.catch(() => undefined);
  const p = (async () => {
    const { playStory } = await import("./story");
    const r = await playStory(rt, opts);
    s.last = r;
    const failed = r.beats.filter((b) => !b.ok);
    log("sample activity played", { set: r.setId, ms: r.ms, beats: r.beats.length, failed: failed.length, ...(failed.length ? { failures: failed.map((b) => `${b.name}: ${b.detail}`).slice(0, 8) } : {}) });
    return r;
  })();
  s.running = p;
  try {
    return await p;
  } finally {
    if (s.running === p) s.running = undefined;
  }
}

/** At start (instrumentation.ts): play the sample if the setting says so, in the background. */
export function startSampleActivity(rt: Runtime): void {
  const setting = sampleSetting(rt);
  if (setting === "off") return;
  const all = rt.dock.ledger.unfiltered();
  if (setting === "once" && sampleSets(rt.dock.ledger).length) return log("sample activity already played once on this store; not again", { setting });
  if (setting === "on") {
    const since = new Date(Date.now() - DAY).toISOString();
    // Activity: an agent asked for something, a conversation turn, an order. Not the server's own start-up entries.
    const recent = all.filter((e) => e.at >= since && (e.type === "request" || e.type === "order" || (e.type === "agent" && e.data.event === "turn")) && !setOfEntry(rt.dock.ledger, e));
    if (recent.length) return log("live activity in the last day: no sample played", { setting, recent: recent.length });
    if (currentSet(rt) && Date.parse(currentSet(rt)!.lastAt) > Date.now() - DAY) return;
  }
  const t = setTimeout(() => void run(rt, {}).catch((err: Error) => console.error("[sample] failed:", err.message)), 300);
  t.unref?.();
}

/**
 * "Refresh the sample activity": nothing leaves the append-only ledger; every earlier set is marked superseded (a
 * control entry each, with who asked), so pages show only the new one, which is played now.
 */
export async function refreshSample(rt: Runtime, by: string): Promise<SeedReport | undefined> {
  for (const s of sampleSets(rt.dock.ledger).filter((x) => !x.superseded)) {
    rt.dock.ledger.append({ type: "control", actor: `ops:${by}`, summary: `${by} refreshed the sample activity: the earlier sample set ${s.set} is superseded and no longer shown (its entries stay in the ledger, which is append-only).`, data: { step: SAMPLE_STEP_SUPERSEDED, set: s.set, by } });
  }
  return run(rt, { setId: newId("smp") });
}

/**
 * Keep the sample's "now" true while people look at it (called from operations reads, at most once a minute): an order
 * holds its fixed price only 30 minutes, so when none of the current set waits for a person any more, new ones are
 * asked for, of different ages; today's scorecard gets today's activity on a new day; the one slow turn is played again
 * when the alert it shows has gone quiet. All in the current set, all marked sample.
 */
export function touchSample(rt: Runtime): void {
  const s = stateOf(rt);
  const now = Date.now();
  // Not for a viewer who hid the sample, and never inside a sample beat.
  if (viewingNow()?.hideSample || s.running || now - s.lastTouch < 60_000) return;
  s.lastTouch = now;
  const cur = currentSet(rt);
  if (!cur) return;
  void viewAs({ hideSample: false }, async () => {
    const pending = (await rt.dock.pendingOrders()).filter((o) => setOfEntry(rt.dock.ledger, { data: {}, orderId: o.orderId, requestId: o.requestId }) === cur.set);
    const today = new Date().toISOString().slice(0, 10);
    const needToday = s.todayPlayed !== today && cur.lastAt.slice(0, 10) !== today;
    const needWaiting = pending.length === 0 && now - s.lastFresh > 5 * 60_000;
    const needSlow = now - s.lastSlow > 16 * 60_000 && Date.parse(cur.lastAt) < now - 16 * 60_000;
    if (!needToday && !needWaiting && !needSlow) return;
    s.lastFresh = now;
    if (needSlow) s.lastSlow = now;
    if (needToday) s.todayPlayed = today;
    await run(rt, { setId: cur.set, sampleKitchens: sampleStatus(rt).ids.sampleKitchens?.split(","), parts: needToday ? ["today"] : [], fresh: { waiting: needWaiting && !needToday, slow: needSlow } });
  }).catch((err: Error) => console.error("[sample] top-up failed:", err.message));
}


export { play };

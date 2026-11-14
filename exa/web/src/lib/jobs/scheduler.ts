import "server-only";
import { failInterruptedRuns } from "@/lib/db/jobs";
import { databaseReady } from "@/lib/db/start";
import { runDue } from "./run";

/*
 * The clock for jobs. Every few seconds the server looks for jobs whose time has come and starts
 * them. It runs inside the server process, which is right for a server that stays up as one
 * instance (ours does: running chats live in its memory for the same reason). A job that came
 * due while the server was down runs at the first look after it is back, once.
 */

const LOOK_EVERY_MS = 20_000;

type State = { timer?: ReturnType<typeof setInterval>; looking: boolean };
const holder = globalThis as typeof globalThis & { __berylScheduler?: State };
const state: State = (holder.__berylScheduler ??= { looking: false });

async function look(): Promise<void> {
  if (state.looking) return;
  state.looking = true;
  try {
    if ((await databaseReady()) !== null) return;
    await runDue();
  } catch (err) {
    console.warn("[jobs] could not look for due jobs", err instanceof Error ? err.message : err);
  } finally {
    state.looking = false;
  }
}

/** Start the clock. Safe to call more than once: there is only ever one. */
export function startScheduler(): void {
  if (state.timer) return;
  state.timer = setInterval(() => void look(), LOOK_EVERY_MS);
  // Runs cut off by the last shutdown can never finish: close them, then take the first look.
  void databaseReady()
    .then((problem) => (problem === null ? failInterruptedRuns() : 0))
    .then((closed) => {
      if (closed) console.log(`[jobs] ${closed} run(s) were cut off by a restart`);
    })
    .catch(() => {})
    .finally(() => void look());
}

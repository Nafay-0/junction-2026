import "server-only";
import { ensureAdmin } from "@/lib/auth/admin";
import { NO_DATABASE_URL } from "./client";
import { runMigrations } from "./migrate";

/*
 * Getting the database ready: bring its tables up to date, then make sure the admin account from
 * the environment exists. It runs once when the server starts (src/instrumentation.ts) and is
 * awaited by everything that needs the database, so a server that was started before its database
 * heals by itself: a failed attempt is tried again a little later, never in a tight loop.
 */

type State = { attempt?: Promise<string | null>; settled?: boolean; problem?: string | null; at?: number; logged?: string };
const holder = globalThis as unknown as { __berylStart?: State };
const state = (holder.__berylStart ??= {});
const RETRY_MS = 15_000;

/** Null when the database is ready, otherwise one sentence that says what is wrong. Never throws. */
export function databaseReady(): Promise<string | null> {
  const failedLongAgo = state.settled && state.problem && Date.now() - (state.at ?? 0) > RETRY_MS;
  if (state.attempt && !failedLongAgo) return state.attempt;
  state.settled = false;
  state.attempt = prepare().then((problem) => {
    state.settled = true;
    state.problem = problem;
    state.at = Date.now();
    if (problem && state.logged !== problem) console.error(`[database] ${problem}`);
    if (!problem && state.logged) console.log("[database] ready");
    state.logged = problem ?? undefined;
    return problem;
  });
  return state.attempt;
}

async function prepare(): Promise<string | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return NO_DATABASE_URL;
  try {
    await runMigrations(url);
  } catch (err) {
    return `The database could not be reached or brought up to date (${reasonOf(err)}). Check DATABASE_URL and that Postgres is running.`;
  }
  try {
    await ensureAdmin();
  } catch (err) {
    return `The admin account could not be set up (${reasonOf(err)}).`;
  }
  return null;
}

function reasonOf(err: unknown): string {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  if (code === "ECONNREFUSED") return "nothing is listening at that address";
  if (code === "ENOTFOUND") return "that host does not exist";
  if (code === "3D000") return "that database does not exist: create it first";
  if (code === "28P01" || code === "28000") return "the user name or password was refused";
  if (code === "CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "it did not answer in time";
  const message = (e?.message ?? e?.cause?.message ?? "unknown error").split("\n")[0];
  return message.length > 140 ? `${message.slice(0, 139)}…` : message;
}

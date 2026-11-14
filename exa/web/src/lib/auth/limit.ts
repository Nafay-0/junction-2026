import "server-only";

/*
 * A brake on guessing passwords. Failed sign-ins are counted per email and per address; too many
 * in a short time and further tries are turned away for a while. Kept in memory: it resets when
 * the server restarts, and each server instance counts on its own, which is enough to make
 * guessing slow. The slow password check (scrypt) does the rest.
 */

type Entry = { count: number; since: number; until: number };

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const PER_EMAIL = 6;
const PER_ADDRESS = 30;

const holder = globalThis as unknown as { __berylAttempts?: Map<string, Entry> };
const attempts = (holder.__berylAttempts ??= new Map<string, Entry>());

function entry(key: string, now: number): Entry {
  let e = attempts.get(key);
  if (!e || (now - e.since > WINDOW_MS && now > e.until)) {
    e = { count: 0, since: now, until: 0 };
    attempts.set(key, e);
  }
  return e;
}

/** Without a proxy in front (a server on this computer) every request looks alike: counting them together would lock everyone out at once. */
const UNKNOWN = "local";

const keys = (email: string, address: string) => [{ key: `e:${email}`, max: PER_EMAIL }, ...(address === UNKNOWN ? [] : [{ key: `a:${address}`, max: PER_ADDRESS }])];

/** Seconds to wait before another try is allowed, or 0. */
export function waitBeforeSignIn(email: string, address: string): number {
  const now = Date.now();
  let wait = 0;
  for (const { key } of keys(email, address)) wait = Math.max(wait, (attempts.get(key)?.until ?? 0) - now);
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

export function noteFailedSignIn(email: string, address: string): void {
  const now = Date.now();
  for (const { key, max } of keys(email, address)) {
    const e = entry(key, now);
    e.count += 1;
    if (e.count >= max) e.until = now + LOCK_MS;
  }
  // Keep the map from growing without end.
  if (attempts.size > 5000) for (const [key, e] of attempts) if (now - e.since > WINDOW_MS && now > e.until) attempts.delete(key);
}

export function noteSignedIn(email: string): void {
  attempts.delete(`e:${email}`);
}

/** The address a request came from, as far as it can be known behind a proxy. */
export function addressOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || UNKNOWN;
}

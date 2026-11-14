import "server-only";
import { PRESENCE_LASTS_MS } from "@/lib/notifications/types";

/*
 * Who has Beryl open in front of them right now. A window that is visible and focused says so
 * every few seconds (the web and the desktop app alike); when it is hidden or closed it says so
 * once, or simply stops. An account is "here" while any of its windows has said so recently.
 *
 * Kept in the memory of the one server process, like the running tasks. It only decides whether
 * an email is worth sending, so losing it in a restart costs at most one extra email.
 */

type Store = Map<string, Map<string, number>>;
const holder = globalThis as typeof globalThis & { __berylPresence?: Store };
const store: Store = (holder.__berylPresence ??= new Map());

/** A window reports whether it is in front of its user. `windowId` tells windows of one account apart. */
export function checkIn(userId: string, windowId: string, here: boolean): void {
  let windows = store.get(userId);
  if (!here) {
    windows?.delete(windowId);
    if (windows && windows.size === 0) store.delete(userId);
    return;
  }
  if (!windows) store.set(userId, (windows = new Map()));
  windows.set(windowId.slice(0, 64), Date.now());
  if (windows.size > 20) windows.delete(windows.keys().next().value as string);
}

/** True while the account has a window in front of someone. */
export function isHere(userId: string): boolean {
  const windows = store.get(userId);
  if (!windows) return false;
  const now = Date.now();
  for (const [id, at] of windows) {
    if (now - at <= PRESENCE_LASTS_MS) return true;
    windows.delete(id);
  }
  store.delete(userId);
  return false;
}

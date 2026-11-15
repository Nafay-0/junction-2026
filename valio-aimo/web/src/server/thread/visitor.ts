import type { Card, Turn } from "./types";

/** Within this long of the other session's last message, the quiet line says another visitor is using the kitchen. */
export const VISITOR_NOTE_MS = 10 * 60_000;

/**
 * A message from a different browser session than the one that wrote the previous message, in a shared test kitchen:
 * a boundary goes before it. Undefined when it is the same session, there is no earlier message, or the kitchen is
 * not shared.
 */
export function visitorSwitch(turns: Turn[], visitor: string | undefined, shared: boolean, now: number): { note: boolean } | undefined {
  if (!shared || !visitor) return undefined;
  const prev = [...turns].reverse().find((t) => t.role === "buyer");
  if (!prev || prev.role !== "buyer" || prev.visitor === visitor) return undefined;
  return { note: now - Date.parse(prev.at) < VISITOR_NOTE_MS };
}

/** The turns since the last boundary: what this session opened (the whole conversation when there is none). */
export function ownTurns<T extends Turn>(turns: T[]): T[] {
  const i = turns.map((t) => t.role === "agent" && !!t.boundary).lastIndexOf(true);
  return i < 0 ? turns : turns.slice(i + 1);
}

/** The cards of those turns, as the store lists them ({ turnId, card }). */
export function ownCards(turns: Turn[], all: { turnId: string; card: Card }[]): { turnId: string; card: Card }[] {
  const ids = new Set(ownTurns(turns).map((t) => t.turnId));
  return all.filter((x) => ids.has(x.turnId));
}

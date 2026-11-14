import type { SecondReadingRecord } from "@/core/second-reading";

/**
 * Where a second reading waits between the interpret call and the intake that opens on its need. The interpret
 * route (or a door) reads the buyer's words twice; the intake, opened next with the need it returned, picks the
 * record up by the kitchen and the buyer's own words, so every door that reads text gets it without passing anything
 * along. In memory, per process: a record that is not found (another instance, a restart) only means the request is
 * shown as read once.
 */
const TTL_MS = 24 * 3600_000;
const MAX = 2000;

type Kept = { record: SecondReadingRecord; until: number };
const g = globalThis as typeof globalThis & { __dockSecondReadings?: Map<string, Kept> };
const store = () => (g.__dockSecondReadings ??= new Map());
const keyOf = (orgId: string, text: string) => `${orgId}\u0000${text.trim()}`;

export function rememberSecondReading(orgId: string, text: string, record: SecondReadingRecord, now = Date.now()): void {
  const s = store();
  const k = keyOf(orgId, text);
  s.delete(k);
  s.set(k, { record, until: now + TTL_MS });
  while (s.size > MAX) s.delete(s.keys().next().value!);
}

export function findSecondReading(orgId: string, text: string | undefined, now = Date.now()): SecondReadingRecord | undefined {
  if (!text?.trim()) return undefined;
  const kept = store().get(keyOf(orgId, text));
  if (!kept || kept.until < now) return undefined;
  return structuredClone(kept.record);
}

/** Tests only. */
export function clearSecondReadings(): void {
  store().clear();
}

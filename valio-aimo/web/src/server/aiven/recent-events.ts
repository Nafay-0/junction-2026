import type { ActionEvent, ActionStream } from "./actions";
import { eventIndexer } from "./search/event-index";

/**
 * The last few thousand action events this process emitted that do not come from the ledger (model and tool calls,
 * searches, the live cache's calls), so the agent scorecard can be computed without the database: the ledger itself
 * holds the rest. In memory only, lost at restart; PostgreSQL's telemetry table is the record.
 */
const MAX = 5_000;
const g = globalThis as typeof globalThis & { __dockRecentEvents?: ActionEvent[] };

export function recentEvents(): readonly ActionEvent[] {
  return g.__dockRecentEvents ?? [];
}

export function rememberEvent(e: ActionEvent): void {
  if (e.ledgerSeq !== undefined) return; // the ledger has it
  const l = (g.__dockRecentEvents ??= []);
  l.push(e);
  if (l.length > MAX) l.splice(0, l.length - MAX);
}

/** The same stream, remembering what passes (never throws, never blocks). */
export function remembering(stream: ActionStream): ActionStream {
  return {
    emit: (e) => {
      try {
        rememberEvent(e);
        eventIndexer()?.add(e); // the audit trail on OpenSearch (search/event-index.ts)
      } catch {
        // best effort
      }
      stream.emit(e);
    },
    flush: (ms) => stream.flush(ms),
    close: () => stream.close(),
    stats: () => stream.stats(),
    ...(stream.lastEventId ? { lastEventId: () => stream.lastEventId!() } : {}),
  };
}

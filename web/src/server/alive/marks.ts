import type { Ledger, LedgerEntry, LedgerInput } from "@/core/ledger";
import { playingNow, viewingNow } from "./clock";

/**
 * How sample activity is told apart from live activity, from the ledger alone:
 *
 *   - every entry a sample beat writes carries `data.sample = { set, beat }` (stamped before it is hashed, so the
 *     flag is part of the signed chain and cannot be added or removed later);
 *   - an entry written later about a sample request or order (an expiry, a mail outcome) is sample by its ids;
 *   - "Refresh the sample activity" appends a control entry `{ step: "sample_superseded", set }`: nothing is removed
 *     from the append-only ledger, but every page shows only the newest set from then on.
 *
 * The index is kept per ledger, rebuilt incrementally as the ledger grows.
 */
export type SampleTag = { set: string; beat?: string };
export const SAMPLE_STEP_SUPERSEDED = "sample_superseded";
export const SAMPLE_STEP_PLAYED = "sample_played";

export function sampleTagOf(e: Pick<LedgerEntry, "data">): SampleTag | undefined {
  const s = (e.data as { sample?: SampleTag } | undefined)?.sample;
  return s && typeof s === "object" && typeof s.set === "string" ? s : undefined;
}

/** The ledger's stamp hook: a sample beat's entries carry the flag. */
export function stampSample(input: LedgerInput): LedgerInput {
  const p = playingNow();
  if (!p) return input;
  return { ...input, data: { ...(input.data ?? {}), sample: { set: p.setId, ...(p.beat ? { beat: p.beat } : {}) } } };
}

type Index = {
  n: number;
  sets: Map<string, { firstAt: string; lastAt: string; entries: number; superseded?: string; played?: boolean }>;
  /** Request and order ids that belong to a sample set, and the set. */
  requests: Map<string, string>;
  orders: Map<string, string>;
  threads: Map<string, string>;
};

const indexes = new WeakMap<Ledger, Index>();

function indexOf(ledger: Ledger): Index {
  let ix = indexes.get(ledger);
  if (!ix) indexes.set(ledger, (ix = { n: 0, sets: new Map(), requests: new Map(), orders: new Map(), threads: new Map() }));
  if (ix.n === ledger.length) return ix;
  const all = ledger.unfiltered();
  for (let i = ix.n; i < all.length; i++) {
    const e = all[i];
    const d = e.data as Record<string, unknown>;
    if (e.type === "control" && d.step === SAMPLE_STEP_SUPERSEDED && typeof d.set === "string") {
      const s = ix.sets.get(d.set);
      if (s) s.superseded = e.at;
      continue;
    }
    const tag = sampleTagOf(e);
    if (!tag) continue;
    const s = ix.sets.get(tag.set) ?? { firstAt: e.at, lastAt: e.at, entries: 0 };
    s.entries += 1;
    if (e.at < s.firstAt) s.firstAt = e.at;
    if (e.at > s.lastAt) s.lastAt = e.at;
    if (d.step === SAMPLE_STEP_PLAYED) s.played = true;
    ix.sets.set(tag.set, s);
    if (e.requestId) ix.requests.set(e.requestId, tag.set);
    if (e.orderId) ix.orders.set(e.orderId, tag.set);
    const thread = (d.thread as { threadId?: string } | undefined)?.threadId;
    if (thread) ix.threads.set(thread, tag.set);
  }
  ix.n = all.length;
  return ix;
}

/** The sample sets in this ledger, oldest first. */
export function sampleSets(ledger: Ledger): { set: string; firstAt: string; lastAt: string; entries: number; superseded?: string; played: boolean }[] {
  return [...indexOf(ledger).sets.entries()].map(([set, s]) => ({ set, ...s, played: !!s.played })).sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}

/** The set an entry belongs to: its own flag, or the request or order it is about. */
export function setOfEntry(ledger: Ledger, e: Pick<LedgerEntry, "data" | "requestId" | "orderId">): string | undefined {
  const tag = sampleTagOf(e);
  if (tag) return tag.set;
  const ix = indexOf(ledger);
  return (e.orderId && ix.orders.get(e.orderId)) || (e.requestId && ix.requests.get(e.requestId)) || undefined;
}

export function isSampleOrder(ledger: Ledger, o: { orderId: string; requestId?: string }): boolean {
  const ix = indexOf(ledger);
  return ix.orders.has(o.orderId) || (!!o.requestId && ix.requests.has(o.requestId));
}

export function isSampleRequest(ledger: Ledger, requestId: string): boolean {
  return indexOf(ledger).requests.has(requestId);
}

export function isSampleThread(ledger: Ledger, threadId: string): boolean {
  return indexOf(ledger).threads.has(threadId);
}

/** Whether a set is hidden for the current reader: superseded sets always, every set when the viewer hides the sample. */
function hiddenSet(ix: Index, set: string | undefined): boolean {
  if (!set) return false;
  if (viewingNow()?.hideSample) return true;
  return !!ix.sets.get(set)?.superseded;
}

function anySuperseded(ix: Index): boolean {
  for (const s of ix.sets.values()) if (s.superseded) return true;
  return false;
}

/** The ledger's read filter for the current reader (undefined: everything). */
export function ledgerVisibility(ledger: () => Ledger | undefined): () => ((e: LedgerEntry) => boolean) | undefined {
  return () => {
    const l = ledger();
    if (!l) return undefined;
    const ix = indexOf(l);
    if (!ix.sets.size || (!viewingNow()?.hideSample && !anySuperseded(ix))) return undefined;
    return (e) => {
      const tag = sampleTagOf(e);
      const set = tag?.set ?? (e.orderId && ix.orders.get(e.orderId)) ?? (e.requestId && ix.requests.get(e.requestId)) ?? undefined;
      return !hiddenSet(ix, set || undefined);
    };
  };
}

/** The gate's order-list filter for the current reader (undefined: every order). */
export function orderVisibility(ledger: () => Ledger | undefined): () => ((o: { orderId: string; requestId: string }) => boolean) | undefined {
  return () => {
    const l = ledger();
    if (!l) return undefined;
    const ix = indexOf(l);
    if (!ix.sets.size || (!viewingNow()?.hideSample && !anySuperseded(ix))) return undefined;
    return (o) => !hiddenSet(ix, ix.orders.get(o.orderId) ?? ix.requests.get(o.requestId));
  };
}

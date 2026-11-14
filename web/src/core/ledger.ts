import { canonicalJson, sha256Hex } from "./util";

/**
 * Append-only, hash-chained audit log. Each entry hashes its own content plus the previous entry's hash,
 * so editing, removing or reordering any entry breaks verification from that point on. A cut-off tail
 * is only visible against a known head (seq + hash) kept elsewhere, e.g. printed on a signed order.
 */
export type LedgerEntryType =
  | "request" // the agent opened a purchase request
  | "intake" // structured need, concerns, confirmations, questions, answers, options and the buyer's choice
  | "lookup" // master-data search or live price/availability check
  | "quote" // the wholesaler issued a fixed-price quote
  | "decision" // the policy gate decided on an order
  | "approval_requested" // a human was asked to sign off
  | "approval" // a human approved or declined
  | "order" // an order was committed at the quoted price
  | "refusal" // a call was refused before reaching the policy (bad mandate, forged quote, bad approval proof)
  | "control" // the wholesaler's operations staff suspended or resumed an agent or a kitchen
  | "offer" // the wholesaler's selling agent offered a product to a kitchen (or held one back, and why), and the kitchen's answer
  | "watch" // the kitchen agent's watch: a key product that cannot come (and the substitutes), a recurring order renewed or held, a staged condition
  | "agent" // the kitchen's own agent conversation: a turn, a model call, a tool call, a grounding refusal, a memory read or write
  | "mail"; // an email to the kitchen (server/notify): sent, skipped or failed, and the kitchen's address set, confirmed or removed (never the address or the body)

export type LedgerInput = {
  type: LedgerEntryType;
  actor: string; // "agent:<id>", "dock", "approver:<role>", "unknown"
  summary: string; // one plain-language sentence: what happened
  requestId?: string;
  orderId?: string;
  data?: Record<string, unknown>; // machine-readable detail; decisions carry `reasons: string[]`
};

export type LedgerEntry = Omit<LedgerInput, "data"> & {
  seq: number;
  at: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export type LedgerHead = { seq: number; hash: string };
export type LedgerVerification =
  | { ok: true; length: number; head: LedgerHead | null }
  | { ok: false; brokenAt: number; problem: "hash_mismatch" | "chain_break" | "sequence_gap" | "head_mismatch"; message: string };

export const GENESIS_HASH = "0".repeat(64);

export interface LedgerStore {
  append(entry: LedgerEntry): void;
  all(): readonly LedgerEntry[];
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly items: LedgerEntry[] = [];
  append(entry: LedgerEntry): void {
    this.items.push(structuredClone(entry));
  }
  all(): readonly LedgerEntry[] {
    return this.items;
  }
}

export type LedgerFilter = { requestId?: string; orderId?: string };

/**
 * The ledger over a store. Entries are frozen once stored (deep), so nothing in this process can edit one after the
 * fact; that is what lets the reads below share them instead of copying, and lets verification be incremental:
 *
 *   entries(filter)   copies (callers may change what they get), found through an index by request and by order
 *   readonly(filter)  the stored entries themselves, frozen: for readers that only look (views, the wall), no copy
 *   verify()          checks only the entries added since the last verification, against the head it verified
 *                     (and that the entry at that head is still the one it verified); verifyFull() checks the
 *                     whole chain from the genesis hash, as verifyLedger does
 *
 * The index and the freeze catch up with the store lazily, so entries a store loaded before (PostgreSQL) or that
 * were appended to it directly are covered too.
 */
export class Ledger {
  private readonly byRequest = new Map<string, LedgerEntry[]>();
  private readonly byOrder = new Map<string, LedgerEntry[]>();
  private indexed = 0;
  /** Called after every append, in this process (server/notify reads the watch's entries this way). */
  private readonly listeners = new Set<(e: LedgerEntry) => void>();
  /** How far the chain has been verified: entries [0, length) are fine, the last of them has hash `hash`. */
  private verified: { length: number; hash: string } = { length: 0, hash: GENESIS_HASH };

  constructor(
    private readonly store: LedgerStore = new InMemoryLedgerStore(),
    private readonly now: () => Date = () => new Date(),
    /**
     * Optional, from the server: `stamp` may add to an entry's input before it is hashed (the sample activity's flag,
     * server/alive), and `visible` may narrow what the reads below return for the current caller (a page that hides
     * the sample). Verification, the head and the length always see the whole chain.
     */
    private readonly hooks: { stamp?: (input: LedgerInput) => LedgerInput; visible?: () => ((e: LedgerEntry) => boolean) | undefined } = {},
  ) {}

  static hashOf(e: Omit<LedgerEntry, "hash">): string {
    const { seq, at, type, actor, summary, requestId, orderId, data, prevHash } = e;
    return sha256Hex(canonicalJson({ seq, at, type, actor, summary, requestId, orderId, data, prevHash }));
  }

  append(raw: LedgerInput): LedgerEntry {
    const input = this.hooks.stamp ? this.hooks.stamp(raw) : raw;
    const all = this.store.all();
    const last = all[all.length - 1];
    const body = {
      seq: last ? last.seq + 1 : 0,
      at: this.now().toISOString(),
      type: input.type,
      actor: input.actor,
      summary: input.summary,
      requestId: input.requestId,
      orderId: input.orderId,
      data: JSON.parse(JSON.stringify(input.data ?? {})) as Record<string, unknown>, // JSON-safe snapshot
      prevHash: last ? last.hash : GENESIS_HASH,
    };
    const entry: LedgerEntry = { ...body, hash: Ledger.hashOf(body) };
    this.store.append(entry);
    this.catchUp();
    for (const fn of [...this.listeners]) {
      try {
        fn(structuredClone(entry));
      } catch {
        // a listener never breaks an append (the order flow writes here)
      }
    }
    return structuredClone(entry);
  }

  /** Be told of every entry appended from now on, after it is stored. Returns the function that stops it. */
  onAppend(fn: (e: LedgerEntry) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Copies of the entries (all, or one request's / one order's), in order. */
  entries(filter: LedgerFilter = {}): LedgerEntry[] {
    return structuredClone(this.readonly(filter) as LedgerEntry[]);
  }

  /** The stored entries themselves (frozen, never copied), in order, in an array of the caller's own. For readers that only look. */
  readonly(filter: LedgerFilter = {}): readonly LedgerEntry[] {
    const all = this.unfiltered(filter);
    const keep = this.hooks.visible?.();
    return keep ? all.filter(keep) : all;
  }

  /** As readonly(), never narrowed by the caller's view: for code that must see every entry (indexes of the sample). */
  unfiltered(filter: LedgerFilter = {}): readonly LedgerEntry[] {
    this.catchUp();
    if (!filter.requestId && !filter.orderId) return this.store.all().slice();
    const a = filter.requestId ? (this.byRequest.get(filter.requestId) ?? []) : undefined;
    const b = filter.orderId ? (this.byOrder.get(filter.orderId) ?? []) : undefined;
    if (a && b) return (a.length <= b.length ? a : b).filter((e) => e.requestId === filter.requestId && e.orderId === filter.orderId);
    return (a ?? b)!.slice();
  }

  /** Entries after sequence number `seq` (all of them for -1), frozen, in order. */
  since(seq: number): readonly LedgerEntry[] {
    this.catchUp();
    const all = this.store.all();
    // seq equals the position in a verified chain; fall back to a scan if it does not.
    const i = Math.max(0, seq + 1);
    if (i >= all.length) return [];
    const out = all[i].seq === i ? all.slice(i) : all.filter((e) => e.seq > seq);
    const keep = this.hooks.visible?.();
    return keep ? out.filter(keep) : out;
  }

  get length(): number {
    return this.store.all().length;
  }

  head(): LedgerHead | null {
    const all = this.store.all();
    const last = all[all.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : null;
  }

  /**
   * The chain verified: incrementally, from the last head this ledger verified (see the class comment). Same
   * answer as verifyFull() for anything that can happen to entries in this process, since they are frozen.
   */
  verify(expectedHead?: LedgerHead): LedgerVerification {
    this.catchUp();
    const all = this.store.all();
    const v = this.verified;
    const intact = v.length <= all.length && (v.length === 0 || all[v.length - 1].hash === v.hash);
    if (!intact) this.verified = { length: 0, hash: GENESIS_HASH };
    const from = this.verified.length;
    const r = verifyChain(all, from, this.verified.hash, expectedHead);
    if (r.ok && all.length) this.verified = { length: all.length, hash: all[all.length - 1].hash };
    return r;
  }

  /** The whole chain checked from the genesis hash, every entry hashed again. */
  verifyFull(expectedHead?: LedgerHead): LedgerVerification {
    this.catchUp();
    const all = this.store.all();
    const r = verifyLedger(all, expectedHead);
    this.verified = r.ok && all.length ? { length: all.length, hash: all[all.length - 1].hash } : { length: 0, hash: GENESIS_HASH };
    return r;
  }

  /** Freeze and index entries the store holds that this ledger has not seen yet. */
  private catchUp(): void {
    const all = this.store.all();
    if (this.indexed > all.length) {
      // the store was replaced under us: start again
      this.byRequest.clear();
      this.byOrder.clear();
      this.indexed = 0;
    }
    for (; this.indexed < all.length; this.indexed++) {
      const e = all[this.indexed];
      deepFreeze(e);
      if (e.requestId) push(this.byRequest, e.requestId, e);
      if (e.orderId) push(this.byOrder, e.orderId, e);
    }
  }
}

function push(m: Map<string, LedgerEntry[]>, k: string, e: LedgerEntry): void {
  const list = m.get(k);
  if (list) list.push(e);
  else m.set(k, [e]);
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** Check a full chain from its first entry. Pass `expectedHead` to also detect a removed tail. */
export function verifyLedger(entries: readonly LedgerEntry[], expectedHead?: LedgerHead): LedgerVerification {
  return verifyChain(entries, 0, GENESIS_HASH, expectedHead);
}

/** Check entries [from, end) given that entry from-1 (already verified) has hash `prevHash`. */
function verifyChain(entries: readonly LedgerEntry[], from: number, prevHash: string, expectedHead?: LedgerHead): LedgerVerification {
  for (let i = from; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, brokenAt: e.seq, problem: "sequence_gap", message: `Entry at position ${i} has seq ${e.seq}: an entry is missing or out of order.` };
    if (e.prevHash !== prevHash) return { ok: false, brokenAt: e.seq, problem: "chain_break", message: `Entry ${e.seq} does not point to the entry before it.` };
    if (Ledger.hashOf(e) !== e.hash) return { ok: false, brokenAt: e.seq, problem: "hash_mismatch", message: `Entry ${e.seq} was edited after it was written.` };
    prevHash = e.hash;
  }
  const last = entries[entries.length - 1];
  const head = last ? { seq: last.seq, hash: last.hash } : null;
  if (expectedHead && (head?.seq !== expectedHead.seq || head?.hash !== expectedHead.hash)) {
    return { ok: false, brokenAt: head ? head.seq + 1 : 0, problem: "head_mismatch", message: `Ledger ends at ${head?.seq ?? "nothing"}, expected head ${expectedHead.seq}: entries were cut off.` };
  }
  return { ok: true, length: entries.length, head };
}

/** One line per entry, with the reasons under each decision, for people to read. */
export function explain(entries: readonly LedgerEntry[]): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${e.at.slice(11, 19)}  ${e.summary}`);
    const reasons = e.data.reasons;
    if (Array.isArray(reasons)) for (const r of reasons) lines.push(`          - ${String(r)}`);
  }
  return lines;
}

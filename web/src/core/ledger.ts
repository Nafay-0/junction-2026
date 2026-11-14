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
  | "control"; // the wholesaler's operations staff suspended or resumed an agent or a kitchen

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

export class Ledger {
  constructor(
    private readonly store: LedgerStore = new InMemoryLedgerStore(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  static hashOf(e: Omit<LedgerEntry, "hash">): string {
    const { seq, at, type, actor, summary, requestId, orderId, data, prevHash } = e;
    return sha256Hex(canonicalJson({ seq, at, type, actor, summary, requestId, orderId, data, prevHash }));
  }

  append(input: LedgerInput): LedgerEntry {
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
    return structuredClone(entry);
  }

  entries(filter: { requestId?: string; orderId?: string } = {}): LedgerEntry[] {
    return structuredClone(
      this.store
        .all()
        .filter((e) => (!filter.requestId || e.requestId === filter.requestId) && (!filter.orderId || e.orderId === filter.orderId)),
    );
  }

  head(): LedgerHead | null {
    const all = this.store.all();
    const last = all[all.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : null;
  }

  verify(expectedHead?: LedgerHead): LedgerVerification {
    return verifyLedger(this.store.all(), expectedHead);
  }
}

/** Check a full chain from its first entry. Pass `expectedHead` to also detect a removed tail. */
export function verifyLedger(entries: readonly LedgerEntry[], expectedHead?: LedgerHead): LedgerVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
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

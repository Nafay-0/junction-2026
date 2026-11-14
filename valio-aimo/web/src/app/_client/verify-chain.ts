"use client";

import type { LedgerEntry } from "@/core/ledger";

/**
 * Re-check the ledger in the browser, without trusting the server's own verdict: recompute every entry's
 * SHA-256 over the same canonical JSON as src/core/ledger.ts and follow the chain from the first entry.
 * (A browser copy of `verifyLedger`; core/ imports node:crypto, so it cannot be imported here.)
 */
export type ChainCheck = { ok: true; length: number; headHash: string | null } | { ok: false; brokenAt: number; message: string; length: number };

const GENESIS = "0".repeat(64);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashOf(e: LedgerEntry): Promise<string> {
  const { seq, at, type, actor, summary, requestId, orderId, data, prevHash } = e;
  return sha256Hex(JSON.stringify(sortKeys({ seq, at, type, actor, summary, requestId, orderId, data, prevHash })));
}

export async function verifyChain(entries: LedgerEntry[]): Promise<ChainCheck> {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, brokenAt: e.seq, length: entries.length, message: `Entry ${e.seq} sits at position ${i}: an entry is missing or out of order.` };
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, length: entries.length, message: `Entry ${e.seq} does not point to the entry before it.` };
    if ((await hashOf(e)) !== e.hash) return { ok: false, brokenAt: e.seq, length: entries.length, message: `Entry ${e.seq} was changed after it was written.` };
    prev = e.hash;
  }
  return { ok: true, length: entries.length, headHash: entries.at(-1)?.hash ?? null };
}

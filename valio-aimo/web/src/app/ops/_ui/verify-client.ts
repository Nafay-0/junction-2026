"use client";

import { compactVerify, createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet } from "jose";
import type { LedgerEntry } from "@/core/ledger";
import { api } from "../../_client/api";
import { hashOf } from "../../_client/verify-chain";

/**
 * Checks that run in the browser, trusting nothing but the wholesaler's published keys (/.well-known/jwks.json)
 * and SHA-256: a signed receipt, quote or claim, and the ledger's hash chain. When this browser has no Ed25519 in
 * WebCrypto, the signature check falls back to the server's (/ops-api/verify) and says so.
 */
export type TokenCheck =
  | { ok: true; by: "browser" | "server"; typ: string; kind: string; kid: string; payload: Record<string, unknown>; anchor?: { seq: number; hash: string; matches: boolean | null } }
  | { ok: false; by: "browser" | "server"; problem: string; typ?: string };

const KINDS: Record<string, string> = { "order+jws": "Order confirmation", "quote+jws": "Fixed-price quote", "vc+jwt": "Signed claim" };
const JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

let jwksPromise: Promise<JSONWebKeySet> | undefined;
function jwks(): Promise<JSONWebKeySet> {
  jwksPromise ??= fetch("/.well-known/jwks.json", { cache: "no-store" }).then((r) => r.json() as Promise<JSONWebKeySet>);
  return jwksPromise;
}

export function extractToken(input: string): string | undefined {
  const text = input.trim().replace(/^"|"$/g, "");
  if (JWS.test(text)) return text;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const order = (json.order ?? (json.structuredContent as Record<string, unknown> | undefined)?.order ?? json) as Record<string, unknown>;
    return [order.confirmation, json.confirmation, json.quoteToken, json.token, json.claim].find((v): v is string => typeof v === "string" && JWS.test(v));
  } catch {
    return undefined;
  }
}

export async function verifyToken(input: string, ledger?: readonly { seq: number; hash: string }[]): Promise<TokenCheck> {
  const token = extractToken(input);
  if (!token) return { ok: false, by: "browser", problem: "No signed token found. Paste a compact JWS (three dot-separated parts) or the JSON that holds one." };
  let typ: string | undefined;
  try {
    typ = decodeProtectedHeader(token).typ;
  } catch {
    return { ok: false, by: "browser", problem: "The header cannot be read: this is not a JWS." };
  }
  if (!typ || !KINDS[typ]) return { ok: false, by: "browser", typ, problem: `Not a AimoPilot document: typ is ${typ ?? "missing"}; expected order+jws, quote+jws or vc+jwt.` };
  try {
    const { payload, protectedHeader } = await compactVerify(token, createLocalJWKSet(await jwks()), { algorithms: ["Ed25519", "EdDSA"] });
    const body = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    const head = body.ledgerHead as { seq?: number; hash?: string } | null | undefined;
    const anchor =
      typ === "order+jws" && head && typeof head.seq === "number" && typeof head.hash === "string"
        ? { seq: head.seq, hash: head.hash, matches: ledger ? ledger.find((e) => e.seq === head.seq)?.hash === head.hash : null }
        : undefined;
    return { ok: true, by: "browser", typ, kind: KINDS[typ], kid: protectedHeader.kid ?? "?", payload: body, anchor };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not supported|unrecognized|algorithm/i.test(msg) && !/signature/i.test(msg)) {
      const r = await api<TokenCheck>("POST", "/ops-api/verify", { text: token });
      if (r.ok) return { ...r.data, by: "server" } as TokenCheck;
    }
    return {
      ok: false,
      by: "browser",
      typ,
      problem: /no applicable key|matching key/i.test(msg) ? "Signed with a key the wholesaler does not publish." : /signature/i.test(msg) ? "The signature does not match: the content was changed after signing, or the wholesaler never signed it." : msg,
    };
  }
}

export type ChainResult = {
  ok: boolean;
  length: number;
  recomputed: number;
  linked: number;
  brokenAt?: number;
  message?: string;
  /** seq -> how this browser checked it */
  bySeq: Record<number, "recomputed" | "linked">;
  headHash?: string;
};

/**
 * Follow the chain from the first entry. Entries whose content is kept with the kitchen cannot be re-hashed here;
 * they are checked by link: the next entry must point at the hash they carry.
 */
export async function checkChain(entries: (LedgerEntry & { withheld?: string })[]): Promise<ChainResult> {
  let prev = "0".repeat(64);
  const bySeq: ChainResult["bySeq"] = {};
  let recomputed = 0;
  let linked = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const base = { length: entries.length, recomputed, linked, bySeq };
    if (e.seq !== i) return { ...base, ok: false, brokenAt: e.seq, message: `Entry ${e.seq} sits at position ${i}: an entry is missing or out of order.` };
    if (e.prevHash !== prev) return { ...base, ok: false, brokenAt: e.seq, message: `Entry ${e.seq} does not point to the entry before it.` };
    if (e.withheld) {
      linked += 1;
      bySeq[e.seq] = "linked";
    } else {
      const { withheld: _w, ...entry } = e;
      void _w;
      if ((await hashOf(entry as LedgerEntry)) !== e.hash) return { ...base, ok: false, brokenAt: e.seq, message: `Entry ${e.seq} was changed after it was written.` };
      recomputed += 1;
      bySeq[e.seq] = "recomputed";
    }
    prev = e.hash;
  }
  return { ok: true, length: entries.length, recomputed, linked, bySeq, headHash: entries.at(-1)?.hash };
}

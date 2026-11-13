import { compactVerify, createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet } from "jose";
import type { LedgerEntry } from "@/core/ledger";

/**
 * Check a receipt or a signed claim pasted in from outside, with nothing but the wholesaler's published keys:
 * an order confirmation (typ order+jws), a quote (quote+jws) or a signed claim about a product (vc+jwt, the trust
 * protocol). Accepts the bare compact JWS or JSON holding it. For an order confirmation it also checks the ledger
 * anchor printed in it: the entry at that sequence number must still carry that hash.
 *
 * The same check runs in the browser (ops/_ui/verify-client.ts) without trusting this server; this one is the
 * cross-check and works on browsers without Ed25519 in WebCrypto.
 */
export const KNOWN_TYPES: Record<string, string> = {
  "order+jws": "Order confirmation",
  "quote+jws": "Fixed-price quote",
  "vc+jwt": "Signed claim",
};

export type VerifyResult =
  | { ok: true; typ: string; kind: string; kid: string; payload: Record<string, unknown>; anchor?: { seq: number; hash: string; matches: boolean | null } }
  | { ok: false; problem: string; typ?: string };

const JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export function extractToken(input: string): string | undefined {
  const text = input.trim().replace(/^"|"$/g, "");
  if (JWS.test(text)) return text;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const order = (json.order ?? (json.structuredContent as Record<string, unknown> | undefined)?.order ?? json) as Record<string, unknown>;
    const found = [order.confirmation, json.confirmation, json.quoteToken, json.token, json.claim, (json.quote as Record<string, unknown> | undefined)?.quoteToken].find((v) => typeof v === "string" && JWS.test(v));
    return found as string | undefined;
  } catch {
    return undefined;
  }
}

export async function verifyPasted(input: string, jwks: JSONWebKeySet, ledger?: readonly LedgerEntry[]): Promise<VerifyResult> {
  const token = extractToken(input);
  if (!token) return { ok: false, problem: "No signed token found. Paste a compact JWS (three dot-separated parts) or the JSON that holds one (confirmation, quoteToken or a claim)." };
  let typ: string | undefined;
  try {
    typ = decodeProtectedHeader(token).typ;
  } catch {
    return { ok: false, problem: "The token's header cannot be read: it is not a JWS." };
  }
  if (!typ || !KNOWN_TYPES[typ]) return { ok: false, typ, problem: `Not a Dock document: typ is ${typ ?? "missing"}; expected order+jws, quote+jws or vc+jwt.` };
  try {
    const { payload, protectedHeader } = await compactVerify(token, createLocalJWKSet(jwks), { algorithms: ["Ed25519", "EdDSA"] });
    const body = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    let anchor: { seq: number; hash: string; matches: boolean | null } | undefined;
    const head = body.ledgerHead as { seq?: number; hash?: string } | null | undefined;
    if (typ === "order+jws" && head && typeof head.seq === "number" && typeof head.hash === "string") {
      const e = ledger?.find((x) => x.seq === head.seq);
      anchor = { seq: head.seq, hash: head.hash, matches: ledger ? e?.hash === head.hash : null };
    }
    return { ok: true, typ, kind: KNOWN_TYPES[typ], kid: protectedHeader.kid ?? "?", payload: body, anchor };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, typ, problem: /no applicable key|matching key/i.test(msg) ? "Signed with a key the wholesaler does not publish." : /signature/i.test(msg) ? "The signature does not match: the content was changed after signing, or it was never signed by the wholesaler." : msg };
  }
}

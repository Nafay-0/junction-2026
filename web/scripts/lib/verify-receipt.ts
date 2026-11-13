import { compactVerify, createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet } from "jose";

/**
 * Verify a Dock order receipt (or quote) using only the wholesaler's published JWK Set and a stock JOSE
 * library. No Dock code: this is what any third party (an auditor, the buyer's ERP) would run.
 */
export type Verified = { typ: string; kid: string; payload: Record<string, unknown> };

export const RECEIPT_TYP = "order+jws";
export const QUOTE_TYP = "quote+jws";

export async function verifySigned(jws: string, jwks: JSONWebKeySet, expectTyp: string[] = [RECEIPT_TYP, QUOTE_TYP]): Promise<Verified> {
  const header = decodeProtectedHeader(jws);
  if (!header.typ || !expectTyp.includes(header.typ)) throw new Error(`Not a Dock receipt: typ is ${header.typ ?? "missing"}, expected ${expectTyp.join(" or ")}.`);
  // Ed25519 is the fully-specified name (RFC 9864); EdDSA is the older name for the same thing.
  const { payload, protectedHeader } = await compactVerify(jws, createLocalJWKSet(jwks), { algorithms: ["Ed25519", "EdDSA"] });
  return { typ: protectedHeader.typ!, kid: protectedHeader.kid!, payload: JSON.parse(new TextDecoder().decode(payload)) };
}

/** Accept a bare compact JWS, `{ confirmation }`, `{ order: { confirmation } }` (GET /api/v1/orders/{id}) or an MCP get_order result. */
export function extractJws(input: string): string {
  const text = input.trim();
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(text)) return text;
  const json = JSON.parse(text) as Record<string, unknown>;
  const order = (json.order ?? (json.structuredContent as Record<string, unknown> | undefined)?.order ?? json) as Record<string, unknown>;
  const jws = order.confirmation ?? json.quoteToken;
  if (typeof jws !== "string") throw new Error("No `confirmation` (order receipt) or `quoteToken` found in the input.");
  return jws;
}

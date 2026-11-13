"use client";

import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from "jose";

/**
 * Checks, in the browser, what the wholesaler signed: an order confirmation (`order+jws`) and the claims a quote
 * rests on (`vc+jwt`), against the wholesaler's published keys. Signature and content only; nothing is trusted
 * from the server's own verdict.
 */
export type KeySet = { keys: (JWK & { kid?: string })[] };

async function keyFor(token: string, jwks: KeySet) {
  const { kid, alg } = decodeProtectedHeader(token);
  const jwk = jwks.keys.find((k) => k.kid === kid) ?? (jwks.keys.length === 1 ? jwks.keys[0] : undefined);
  if (!jwk) throw new Error(`No published key "${kid ?? "(none)"}".`);
  return { key: await importJWK(jwk, alg ?? "EdDSA"), kid: kid ?? jwk.kid ?? "" };
}

export type SignedCheck<T> = { ok: true; payload: T; kid: string; typ?: string } | { ok: false; message: string };

export async function verifySigned<T = Record<string, unknown>>(token: string, jwks: KeySet): Promise<SignedCheck<T>> {
  try {
    const { key, kid } = await keyFor(token, jwks);
    const { payload, protectedHeader } = await compactVerify(token, key);
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(payload)) as T, kid, typ: protectedHeader.typ };
  } catch (err) {
    const name = (err as Error)?.name;
    return { ok: false, message: name === "JWSSignatureVerificationFailed" ? "The signature does not verify: the content was changed or not signed by the wholesaler." : (err as Error)?.message ?? "Could not check it." };
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

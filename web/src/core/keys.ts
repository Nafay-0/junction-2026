import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from "jose";

/**
 * All signatures in Dock are compact JWS with Ed25519 (RFC 8037, "Ed25519" alg per RFC 9864).
 * "EdDSA" is accepted on verify for interop with older libraries; it means the same thing for an Ed25519 key.
 */
export const SIGN_ALG = "Ed25519";
export const VERIFY_ALGS = ["Ed25519", "EdDSA"];

export type SigningKey = { kid: string; privateKey: CryptoKey };
export type VerifyingKey = { kid: string; publicKey: CryptoKey };
export type KeyPair = SigningKey & VerifyingKey & { publicJwk: JWK };

export async function generateEd25519KeyPair(kid: string): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(SIGN_ALG, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: SIGN_ALG, use: "sig" };
  return { kid, privateKey, publicKey, publicJwk };
}

/** Import an Ed25519 key pair from a private JWK (`kty: OKP`, `crv: Ed25519`, with `d` and `x`). */
export async function importEd25519KeyPair(kid: string, privateJwk: JWK): Promise<KeyPair> {
  const { d: _d, ...pub } = privateJwk;
  void _d;
  const privateKey = (await importJWK(privateJwk, SIGN_ALG)) as CryptoKey;
  const publicKey = (await importJWK(pub, SIGN_ALG)) as CryptoKey;
  return { kid, privateKey, publicKey, publicJwk: { ...pub, kid, alg: SIGN_ALG, use: "sig" } };
}

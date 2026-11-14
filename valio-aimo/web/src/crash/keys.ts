import { createPrivateKey } from "node:crypto";
import type { JWK } from "jose";
import { importEd25519KeyPair, type KeyPair } from "@/core/keys";
import { sha256Hex } from "@/core/util";

/**
 * Keys derived from public strings, so every run of a world signs with the same keys on every machine.
 * They protect nothing: the crash test's wholesaler and buyer organisations are synthetic.
 */
export async function derivedKeyPair(kid: string, seedText: string): Promise<KeyPair> {
  const seed = Buffer.from(sha256Hex(`dock crash test key: ${seedText}`), "hex");
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const jwk = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }).export({ format: "jwk" }) as JWK;
  return importEd25519KeyPair(kid, jwk);
}

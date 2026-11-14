import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/*
 * Passwords are never stored. What is stored is the output of scrypt, a deliberately slow and
 * memory-hungry function, with a random salt per password, written as
 *   scrypt$N$r$p$<salt>$<hash>
 * so the cost can be raised later without breaking the passwords already saved.
 */

const COST = { N: 32_768, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, bytes: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem: scrypt needs about 128 * N * r bytes, which is above Node's default limit at this cost.
    scrypt(password.normalize("NFKC"), salt, bytes, { ...options, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** True when the password matches the stored value. The comparison takes the same time either way. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const options = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(options.N) || !Number.isInteger(options.r) || !Number.isInteger(options.p)) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    const actual = await derive(password, Buffer.from(salt, "base64url"), expected.length, options);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Spend the time a real check would take. Used when the email is unknown, so a wrong email and a
 * wrong password cannot be told apart by how long the answer takes.
 */
export async function pretendToVerify(password: string): Promise<void> {
  await derive(password, Buffer.alloc(SALT_BYTES, 1), KEY_BYTES, COST).catch(() => {});
}

/** What a password must be. One rule, said in one sentence: long enough. */
export { MAX_PASSWORD, MIN_PASSWORD } from "./validation";

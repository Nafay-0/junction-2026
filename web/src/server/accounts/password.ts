import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Passwords, hashed with scrypt (memory-hard, in Node's own crypto). Stored as
 *
 *   scrypt$<log2 N>$<r>$<p>$<salt, base64url>$<hash, base64url>
 *
 * so the cost can be raised later without breaking stored hashes. A password is never stored, logged or returned;
 * only this string is, and it never leaves the server either. The rule is a length minimum and nothing fancier.
 */

export const PASSWORD_MIN = 10;
/** An upper bound keeps one sign-in from hashing a megabyte. */
export const PASSWORD_MAX = 200;

const COST = { log2N: 15, r: 8, p: 1 }; // 32 MiB and roughly 50 to 100 ms per hash on a server
const KEY_LEN = 32;
const SALT_LEN = 16;

function scrypt(password: string, salt: Buffer, opts: { log2N: number; r: number; p: number }): Promise<Buffer> {
  const o: ScryptOptions = { N: 2 ** opts.log2N, r: opts.r, p: opts.p, maxmem: 256 * 2 ** opts.log2N * opts.r * opts.p };
  return new Promise((resolve, reject) => scryptCb(password.normalize("NFC"), salt, KEY_LEN, o, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Why a new password is not accepted, or undefined when it is. */
export function passwordProblem(password: unknown): "password_too_short" | "password_too_long" | "password_missing" | undefined {
  if (typeof password !== "string" || password.length === 0) return "password_missing";
  if ([...password].length < PASSWORD_MIN) return "password_too_short";
  if (password.length > PASSWORD_MAX) return "password_too_long";
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, COST);
  return ["scrypt", COST.log2N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time check of a password against a stored hash. False for a malformed hash, never a throw. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [log2N, r, p] = parts.slice(1, 4).map(Number);
  if (![log2N, r, p].every((n) => Number.isInteger(n) && n > 0) || log2N > 20 || r > 32 || p > 4) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (expected.length !== KEY_LEN || password.length > PASSWORD_MAX) return false;
  const key = await scrypt(password, salt, { log2N, r, p });
  return timingSafeEqual(key, expected);
}

let dummy: Promise<string> | undefined;

/**
 * A hash no password matches, checked when the username is unknown, so an unknown username costs the same time as
 * a wrong password and the answer is the same.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummy;
}

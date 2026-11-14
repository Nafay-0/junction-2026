/**
 * Usernames and restaurant names. A username is also the kitchen's address in the store (/k/<username>), so it is
 * normalised (NFKC, trimmed, lower case) and restricted to a safe alphabet: letters a to z, digits, hyphen and
 * underscore, 3 to 32 characters, starting with a letter or digit. Names the store's own routes or kitchens use
 * are refused.
 */

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

/** Kitchen addresses and words the store and its routes already use, plus names that would mislead. */
const RESERVED = new Set([
  "kaari", "laakso", // the built-in demo kitchens: accounts of their own, with passwords from the environment
  "mine", "signup", "signin", "signout", "sign-up", "sign-in", "sign-out", "login", "logout", "keep", "join", "new", "account", "accounts",
  "admin", "administrator", "root", "system", "ops", "operations", "staff", "support", "help", "api", "ui-api", "ops-api",
  "approve", "approver", "screen", "wall", "plan", "menu", "call", "channels", "knowledge", "k", "dock", "aimopilot", "valio", "aimo",
  "test", "demo", "null", "undefined", "anonymous", "everyone", "kitchen", "kitchens",
]);

export function normaliseUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.normalize("NFKC").trim().toLowerCase() : "";
}

export type UsernameProblem = "username_missing" | "username_shape" | "username_reserved";

/** Why a username cannot be taken (after normalising), or undefined. */
export function usernameProblem(username: string): UsernameProblem | undefined {
  if (!username) return "username_missing";
  if (!USERNAME_RE.test(username)) return "username_shape";
  if (RESERVED.has(username) || username.startsWith("sbx") || username.startsWith("org_") || username.startsWith("agent_")) return "username_reserved";
  return undefined;
}

/** A restaurant's name as people write it: trimmed, single spaces, no control characters, 2 to 80 characters. */
export function cleanRestaurantName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 80 ? s : undefined;
}

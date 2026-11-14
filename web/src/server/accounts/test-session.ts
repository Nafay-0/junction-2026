import { randomBytes } from "node:crypto";
import { addDays } from "@/core/util";
import type { Runtime } from "../runtime";
import { tokenHash } from "./service";

/**
 * TESTS ONLY. A signed-in session cookie for an existing account (a stage kitchen's, "kaari" or "laakso", or any
 * other), made directly in the account store, so a test can act as the kitchen's own person without its password.
 */
export async function sessionCookieFor(rt: Pick<Runtime, "accounts">, username: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await rt.accounts.store.putSession(tokenHash(token), { username, createdAt: now.toISOString(), expiresAt: addDays(now, 1).toISOString() });
  return `dock_account=${token}`;
}

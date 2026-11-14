import { DockError } from "@/core/errors";
import { readCookie } from "../approver-session";
import { requestOrigin } from "../config";
import type { Runtime } from "../runtime";
import type { Account, AccountSession } from "./store";

/**
 * The account's session cookie and the checks every account route makes.
 *
 *   dock_account   HttpOnly, SameSite=Lax, Secure on https (and in production away from localhost), 14 days.
 *                  Only its SHA-256 is stored; signing out deletes it, so a copied cookie stops working too.
 *   same origin    every state-changing request with the cookie must come from this site: the browser's Origin
 *                  (or Sec-Fetch-Site) must say so, and the body must be JSON, which a cross-site form cannot send.
 */
export const ACCOUNT_COOKIE = "dock_account";

function secureFor(req: Request): boolean {
  const origin = requestOrigin(req);
  if (origin.startsWith("https:")) return true;
  return process.env.NODE_ENV === "production" && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
}

export function accountCookie(req: Request, token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${ACCOUNT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFor(req) ? "; Secure" : ""}`;
}

export function clearAccountCookie(req: Request): string {
  return `${ACCOUNT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFor(req) ? "; Secure" : ""}`;
}

export function accountTokenOf(req: Request): string | undefined {
  return readCookie(req, ACCOUNT_COOKIE);
}

/** The signed-in account of this request, or undefined. */
export async function currentAccount(req: Request, rt: Pick<Runtime, "accounts">): Promise<{ account: Account; session: AccountSession } | undefined> {
  return rt.accounts.session(accountTokenOf(req));
}

/**
 * What only the account's own sign-in may do, never a phone signed in by the call code: add a signing device, sign
 * the mandate, read or change the connector address, change what the kitchen remembers, mint another code.
 */
export function requireFullSession(s: { session: AccountSession } | undefined, what = "This"): void {
  if (s?.session.scope === "call") {
    throw new DockError(403, "phone_session_limited", `${what} needs the account's own sign-in. This phone was signed in by the call code, which is for calling the kitchen's agent only.`, "account");
  }
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuse a state-changing request that a browser sent from another site. A request with no Origin and no
 * Sec-Fetch-Site is not from a browser page (a script, a test); it carries no ambient cookie a page could abuse.
 */
export function requireSameOrigin(req: Request, opts: { json?: boolean } = {}): void {
  if (SAFE.has(req.method)) return;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const own = requestOrigin(req);
  const allowed = new Set([own, ...(process.env.DOCK_PUBLIC_URL?.trim() ? [new URL(process.env.DOCK_PUBLIC_URL.trim()).origin] : [])]);
  if (origin && origin !== "null" ? !allowed.has(origin) : origin === "null" || (site !== null && site !== "same-origin" && site !== "none")) {
    throw new DockError(403, "cross_site_refused", "This request came from another site; it was not carried out.", "account");
  }
  const type = req.headers.get("content-type") ?? "";
  if (opts.json !== false && req.method === "POST" && !/^application\/json\b/i.test(type)) {
    throw new DockError(415, "json_required", "Send the request body as application/json.", "account");
  }
}

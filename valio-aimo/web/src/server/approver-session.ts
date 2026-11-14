import type { ApproverAccount } from "@/core/passkeys";
import { DockError } from "@/core/orders";
import { PasskeyError } from "@/core/passkeys";
import { handle } from "./http";
import type { Runtime } from "./runtime";
import type { SandboxSummary } from "./sandboxes";
import { requestOrigin } from "./config";

/**
 * Which approver this phone is: an HttpOnly cookie set when the visitor registers their passkey.
 * It identifies the phone for the home screen, live updates and one-tap decline. Approving always needs
 * the passkey itself; the cookie alone never approves (except the demo-only tap, when switched on).
 */
export const SESSION_COOKIE = "dock_approver";

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionTokenOf(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

export function sessionCookie(req: Request, token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const secure = requestOrigin(req).startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function currentApprover(req: Request, rt: Runtime): Promise<{ account: ApproverAccount; sandbox?: SandboxSummary } | undefined> {
  const account = await rt.passkeys.sessionApprover(sessionTokenOf(req));
  if (!account) return undefined;
  return { account, sandbox: await rt.sandboxes.forApprover(account.approverId) };
}

/** `handle` for the approver routes: passkey errors become the same structured JSON as every other refusal. */
export function handleApprover(fn: (rt: Runtime) => Promise<Response>): Promise<Response> {
  return handle(async (rt) => {
    try {
      return await fn(rt);
    } catch (err) {
      if (err instanceof PasskeyError) throw new DockError(err.status, err.code, err.message, "approver_identity");
      throw err;
    }
  });
}

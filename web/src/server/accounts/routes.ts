import { DockError } from "@/core/errors";
import { handle } from "../http";
import { clientAddress } from "../limits";
import type { Runtime } from "../runtime";
import { currentAccount, requireSameOrigin } from "./http";
import type { Account } from "./store";

/**
 * Plumbing for the account routes (/ui-api/account/**): same-origin and JSON checks on every change, the caller's
 * address for the rate limits, and the signed-in account when a route needs one. Errors are the usual JSON shape.
 */
export function accountRoute(req: Request, fn: (rt: Runtime, ctx: { address: string }) => Promise<Response>): Promise<Response> {
  return handle(async (rt) => {
    requireSameOrigin(req);
    return fn(rt, { address: clientAddress(req.headers) });
  });
}

export function signedInRoute(req: Request, fn: (rt: Runtime, account: Account, ctx: { address: string }) => Promise<Response>): Promise<Response> {
  return accountRoute(req, async (rt, ctx) => {
    const s = await currentAccount(req, rt);
    if (!s) throw new DockError(401, "not_signed_in", "Sign in first.", "account");
    return fn(rt, s.account, ctx);
  });
}

export const noStore = { "cache-control": "no-store" };

import { accountCookie, currentAccount } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";
import { startFreeKitchen } from "@/server/demo/fresh";

/**
 * POST /ui-api/account/fresh { fresh?: true }: "Start a fresh kitchen" (server/demo/fresh.ts). No form: a kitchen of
 * this browser's own with free-play rules, signed in at once. Pressed again in the same browser it gives back the
 * kitchen it already has; `fresh: true` starts over with a new one. The account ceiling and the sign-ups per address
 * apply as for any new account.
 */
export async function POST(req: Request) {
  return accountRoute(req, async (rt, { address }) => {
    const body = (await readJson(req).catch(() => ({}))) as { fresh?: unknown };
    const s = await currentAccount(req, rt);
    const r = await startFreeKitchen(rt, { current: s?.session.scope === "call" ? undefined : s?.account, address, fresh: body.fresh === true });
    const headers: Record<string, string> = { ...noStore };
    if (r.signedIn) headers["set-cookie"] = accountCookie(req, r.signedIn.token, r.signedIn.expiresAt);
    return Response.json({ next: r.next, created: r.created }, { status: r.created ? 201 : 200, headers });
  });
}

import { accountCookie } from "@/server/accounts/http";
import { publicBaseUrl } from "@/server/config";
import { getRuntime } from "@/server/runtime";

/**
 * GET /k/handoff?t=<token>&next=<path>: a phone opened the QR code a signed-in account showed ("continue on your
 * phone", e.g. the call QR). The one-time link (10 minutes, stored hashed, used up here) gives the phone a session of
 * its own for that account, then goes on to `next`, a path on this site. An expired or used link goes to sign-in.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = publicBaseUrl(req);
  const next = url.searchParams.get("next") ?? "/k";
  const safeNext = /^\/(?![/\\])[\w\-./?=&%]*$/.test(next) ? next : "/k";
  const rt = await getRuntime();
  const s = await rt.accounts.handOff(url.searchParams.get("t"));
  if (!s) return Response.redirect(`${base}/k?handoff=expired`, 303);
  return new Response(null, { status: 303, headers: { location: `${base}${safeNext}`, "set-cookie": accountCookie(req, s.token, s.expiresAt), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

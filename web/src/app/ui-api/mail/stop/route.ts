import { stopByLink } from "@/server/notify/service";
import { publicBaseUrl } from "@/server/config";
import { getRuntime } from "@/server/runtime";

/**
 * The one-click stop link in every order email (server/notify). The token names the kitchen's address record, not
 * the address. Stopping is the safe direction, so the link does it at once:
 *
 *   GET  ?t=…   from the mail: stops, then shows /mail/stopped in the kitchen's language
 *   POST ?t=…   RFC 8058 one-click from the mail client's own unsubscribe button (List-Unsubscribe-Post)
 */
export async function GET(req: Request) {
  const rt = await getRuntime();
  const r = await stopByLink(rt, new URL(req.url).searchParams.get("t"));
  const to = new URL("/mail/stopped", publicBaseUrl(req));
  to.searchParams.set("ok", r.ok ? "1" : "0");
  if (r.ok) to.searchParams.set("lang", r.lang);
  return Response.redirect(to, 303);
}

export async function POST(req: Request) {
  const rt = await getRuntime();
  const r = await stopByLink(rt, new URL(req.url).searchParams.get("t"));
  return Response.json({ ok: r.ok }, { status: r.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}

import { qrSvg } from "@/server/approval-links";
import { noStore, signedInRoute } from "@/server/accounts/routes";
import { publicBaseUrl } from "@/server/config";

/**
 * POST /ui-api/account/device/link { next? }: a one-time address (10 minutes) for a phone to add itself as a signing
 * device. `next`, an order's sign-off screen (/approve/apr_...), is where the phone goes once the device is added: the
 * thread's "Send to my phone" for an order that waits while the kitchen has no signing device yet.
 */
export async function POST(req: Request) {
  return signedInRoute(req, async (rt, a) => {
    const body = (await req.json().catch(() => ({}))) as { next?: unknown };
    const next = typeof body.next === "string" && /^\/approve\/apr_[A-Za-z0-9]{6,40}$/.test(body.next) ? body.next : undefined;
    const { token, expiresAt } = await rt.accounts.oneTimeLink(a.username, "device");
    const url = `${publicBaseUrl(req)}/join/device?t=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    return Response.json({ url, qrSvg: await qrSvg(url), expiresAt }, { headers: noStore });
  });
}

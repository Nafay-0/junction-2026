import { qrSvg } from "@/server/approval-links";
import { noStore, signedInRoute } from "@/server/accounts/routes";
import { publicBaseUrl } from "@/server/config";

/** POST /ui-api/account/device/link: a one-time address (10 minutes) for a phone to add itself as a signing device. */
export async function POST(req: Request) {
  return signedInRoute(req, async (rt, a) => {
    const { token, expiresAt } = rt.accounts.deviceLink(a.username);
    const url = `${publicBaseUrl(req)}/join/device?t=${encodeURIComponent(token)}`;
    return Response.json({ url, qrSvg: await qrSvg(url), expiresAt }, { headers: noStore });
  });
}

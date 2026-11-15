import { noStore, signedInRoute } from "@/server/accounts/routes";
import { joinLink } from "@/server/accounts/phone-join";

/**
 * POST /ui-api/account/device/link { next? }: a one-time address (10 minutes) for a phone to add itself as a signing
 * device. `next`, an order's sign-off screen (/approve/apr_...) or a rules change's (/approve/rch_...), is where the phone goes once the device is added: the
 * thread's "Send to my phone" for an order that waits while the kitchen has no signing device yet, and in a shared test
 * kitchen or a fresh kitchen every time (server/accounts/phone-join.ts: each reviewer's phone joins as one more device).
 */
export async function POST(req: Request) {
  return signedInRoute(req, async (rt, a) => {
    const body = (await req.json().catch(() => ({}))) as { next?: unknown };
    const next = typeof body.next === "string" && /^\/approve\/(apr_[A-Za-z0-9]{6,40}|rch_[A-Za-z0-9_]{4,60})$/.test(body.next) ? body.next : undefined;
    // A shared test kitchen or a fresh kitchen: always a new one-time address (each reviewer's phone joins), up to a cap.
    const link = await joinLink(rt, req, a, next);
    return Response.json(link, { headers: noStore });
  });
}

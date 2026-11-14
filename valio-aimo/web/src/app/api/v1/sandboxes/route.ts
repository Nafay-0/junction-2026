import { handleApprover } from "@/server/approver-session";
import { currentOps } from "@/server/ops/access";

/**
 * Live demo kitchens, for the big screen. No keys, no mandate tokens. The operations desk gets each kitchen's ids and
 * limits; anyone else only who is here (kitchen, city, approver, times), so ids are not handed to strangers.
 */
export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const all = await rt.sandboxes.list();
    if (currentOps(req)) return Response.json({ sandboxes: all });
    return Response.json({ sandboxes: all.map((s) => ({ kitchenName: s.kitchenName, city: s.city, approverName: s.approverName, createdAt: s.createdAt, expiresAt: s.expiresAt })) });
  });
}

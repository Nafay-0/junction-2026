import { canRead, principalOf, requireSomeone } from "@/server/authz";
import { handle } from "@/server/http";

/**
 * Orders waiting for sign-off. An approver's phone sees its own kitchen's, an agent (its mandate) its own
 * organisation's, the operations desk everyone's; a stranger gets 401 (server/authz.ts). Never includes tokens.
 */
export async function GET(req: Request) {
  return handle(async (rt) => {
    const who = await principalOf(req, rt);
    requireSomeone(who, "The list of sign-offs");
    const orgOf = new Map((await rt.dock.listOrders()).map((o) => [o.orderId, o.orgId]));
    const approvals = (await rt.dock.listPendingApprovals()).filter((a) => canRead(who, orgOf.get(a.orderId) ?? ""));
    return Response.json({ approvals });
  });
}

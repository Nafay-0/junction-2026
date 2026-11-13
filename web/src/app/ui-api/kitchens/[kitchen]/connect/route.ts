import { publicBaseUrl } from "@/server/config";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * GET /ui-api/kitchens/{kitchen}/connect: what an outside agent needs to act for this kitchen through the open
 * interface: the addresses, the agent id and the kitchen's signed mandate.
 *
 * DEMO NOTE: the mandate is a bearer credential. Showing it here gives nothing a visitor of this console could
 * not already do through the console itself (orders still stop at the gate and at the named approver), but a
 * real shop would hand it out only to the kitchen's signed-in administrator.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/connect">) {
  return portalRoute(ctx.params, async (k) => {
    const base = publicBaseUrl(req);
    return Response.json(
      {
        mcpUrl: `${base}/api/mcp`,
        openApiUrl: `${base}/api/v1/openapi.json`,
        catalogUrl: `${base}/.well-known/api-catalog`,
        jwksUrl: `${base}/.well-known/jwks.json`,
        agentId: k.agentId,
        orgId: k.info.orgId,
        mandate: k.mandateToken,
        mandateValidUntil: k.info.mandate.validUntil,
      },
      noStore,
    );
  });
}

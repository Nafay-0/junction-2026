import { DockError } from "@/core/errors";
import { requireKitchenPerson } from "@/server/authz";
import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { getRuntime } from "@/server/runtime";
import { setAutoRenew, watchForOrg } from "@/server/watch/service";

/**
 * GET /ui-api/kitchens/{kitchen}/watch: what the kitchen's agent's watch has for this kitchen (findings, renewals,
 * the learned recurring orders and their drift). Records only, no live call.
 * POST { action: "auto_renew", family, on }: switch auto-renew for a recurring order. The kitchen's own signed-in
 * person only, recorded with their name (the same choice the conversation and set_auto_renew make).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/watch">) {
  return portalRoute(req, ctx.params, async (k) => Response.json(await watchForOrg(await getRuntime(), k.info.orgId), noStore));
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/watch">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    if (body.action !== "auto_renew" || typeof body.family !== "string" || typeof body.on !== "boolean") throw new DockError(400, "invalid_request", 'Send { action: "auto_renew", family, on }.');
    requireKitchenPerson(k, "Switching auto-renew");
    const rt = await getRuntime();
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", transport: "direct", path: "store: auto-renew" });
    const a = await setAutoRenew(rt, session, { family: body.family.slice(0, 60), on: body.on, by: k.console!.person!.name, via: "kitchen store" });
    return Response.json({ autoRenew: a }, noStore);
  });
}

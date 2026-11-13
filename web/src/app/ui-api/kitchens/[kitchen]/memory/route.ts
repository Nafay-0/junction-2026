import { errorBody } from "@/server/http";
import { changeMemory } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * POST /ui-api/kitchens/{kitchen}/memory
 *   { action: "forget", preferenceId }                   forget a rule a person stated
 *   { action: "rule", family, dimension, choice }        state a rule (from a learned habit, or the opposite of it)
 * The change is written to the ledger with the person the portal relays for.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/memory">) {
  return portalRoute(req, ctx.params, async (k) => {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length < 80 ? x : undefined);
    if (b.action === "forget" && str(b.preferenceId)) return Response.json({ kitchen: await changeMemory(k, { action: "forget", preferenceId: str(b.preferenceId)!, by: k.info.by }) }, noStore);
    if (b.action === "rule" && str(b.family) && str(b.dimension) && str(b.choice)) {
      return Response.json({ kitchen: await changeMemory(k, { action: "rule", family: str(b.family)!, dimension: str(b.dimension)!, choice: str(b.choice)!, by: k.info.by }) }, noStore);
    }
    return Response.json(errorBody("invalid_request", 'Send { action: "forget", preferenceId } or { action: "rule", family, dimension, choice }.'), { status: 400 });
  });
}

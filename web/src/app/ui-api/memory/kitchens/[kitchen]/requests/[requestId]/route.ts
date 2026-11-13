import { DockError } from "@/core/errors";
import { getRuntime } from "@/server/runtime";
import { interactionFromIntake } from "@/server/memory/intake-events";
import { kitchenMemoryRoute, type ResolvedKitchen } from "@/server/memory/http";

/**
 * GET  /ui-api/memory/kitchens/{kitchen}/requests/{requestId}
 *   One line per remembered thing this request used, for its card: "Lactose-free applied: stated by Sanna
 *   Koskinen on 3 Nov", "Checked against memory: ...". Marks those items as used now.
 * POST /ui-api/memory/kitchens/{kitchen}/requests/{requestId}
 *   Learn from the request's record: the buyer's words, the option chosen, the answered checks.
 * The request is read through the kitchen's own agent session, so another kitchen's request is not found.
 */
async function intakeOf(k: ResolvedKitchen, requestId: string) {
  const { dock } = await getRuntime();
  const session = await dock.authenticate(k.mandateToken, k.agentId);
  if (!/^req_[a-z0-9]+$/.test(requestId)) throw new DockError(404, "intake_not_found", "No such request.");
  return dock.intake.get(session, requestId);
}

export async function GET(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]/requests/[requestId]">) {
  void req.url;
  const { requestId } = await ctx.params;
  return kitchenMemoryRoute(req, ctx.params, async (k, memory) => ({ requestId, lines: await memory.usage(k.info.orgId, await intakeOf(k, requestId)) }));
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]/requests/[requestId]">) {
  void req.url;
  const { requestId } = await ctx.params;
  return kitchenMemoryRoute(req, ctx.params, async (k, memory) => {
    const intake = await intakeOf(k, requestId);
    const profile = await memory.load(k.info.orgId, k.info.name);
    const { segments, events } = interactionFromIntake(profile, intake as never);
    return memory.write(k.info.orgId, { door: "typed", by: k.info.by, requestId, segments, events }, k.info.name);
  });
}

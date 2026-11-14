import { DockError } from "@/core/orders";
import { readJson } from "@/server/http";
import { opsMode } from "@/server/ops/access";
import { opsRoute } from "@/server/ops/handler";
import { suspensions } from "@/server/ops/suspensions";
import { controlView, suspendTarget } from "@/server/ops/views";

/**
 * GET /ops-api/control: suspensions in force and past, the agents and organisations that can be suspended, and the
 * orders waiting for a customer's sign-off.
 * POST /ops-api/control { action: "suspend", scope: "agent" | "org", target, reason } or { action: "resume", suspensionId, note? }.
 * There is no action to approve or decline an order: that belongs to the person the kitchen's mandate names.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json(await controlView(rt, opsMode())));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    if (body.action === "suspend") {
      const scope = body.scope === "org" ? "org" : body.scope === "agent" ? "agent" : undefined;
      if (!scope) throw new DockError(400, "invalid_request", 'scope must be "agent" or "org".');
      const suspension = await suspendTarget(rt, { scope, target: str("target"), reason: str("reason").slice(0, 300), by: staff.name });
      await suspensions(rt.dock).saved(); // in the store before staff are told it is in force: it outlives a restart
      return Response.json({ suspension }, { status: 201 });
    }
    if (body.action === "resume") {
      const suspension = suspensions(rt.dock).resume(str("suspensionId"), { by: staff.name, note: str("note").slice(0, 300) });
      await suspensions(rt.dock).saved();
      return Response.json({ suspension });
    }
    if (body.action === "approve" || body.action === "decline") {
      throw new DockError(403, "ops_cannot_sign_off", "Operations staff cannot approve or decline an order for a customer. Only the person the kitchen's mandate names can, on their own device.");
    }
    throw new DockError(400, "invalid_request", 'action must be "suspend" or "resume".');
  });
}

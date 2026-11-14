import { DockError } from "@/core/errors";
import { launcherStatus } from "@/server/aiven/showcase/launcher";
import { bodyOf, optionalId, showRoute } from "@/server/show/http";
import { OUTSIDE_LIMITS, availableModels, outsideSpend, startOutside } from "@/server/show/outside";

/** GET: who can be sent in (models with a key, the Aiven agent). POST { sandboxId?, runner?, model? }: send one in. */
export async function GET(req: Request) {
  return showRoute(req, async () => {
    const a = launcherStatus();
    return Response.json({ models: availableModels(), aiven: { configured: a.configured, missing: a.missing, left: a.left }, limits: OUTSIDE_LIMITS, spend: outsideSpend() });
  });
}

export async function POST(req: Request) {
  return showRoute(req, async (rt, staff) => {
    const body = await bodyOf(req);
    const runner = body.runner === "aiven" || body.runner === "builtin" ? body.runner : "auto";
    try {
      const run = await startOutside(rt, { sandboxId: optionalId(body.sandboxId), runner, model: typeof body.model === "string" ? body.model : undefined, by: staff.name });
      return Response.json({ run }, { status: 201 });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "outside_failed";
      throw new DockError(code.endsWith("_cap") ? 429 : 503, code, err instanceof Error ? err.message : String(err), "show_limit");
    }
  });
}

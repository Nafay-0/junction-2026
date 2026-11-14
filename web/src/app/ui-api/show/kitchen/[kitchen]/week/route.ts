import { DockError } from "@/core/errors";
import { consoleKitchen } from "@/server/authz";
import { handle } from "@/server/http";
import { activeWeekFor, nextWeek, startWeek } from "@/server/show/registry";

/**
 * A visitor's own kitchen's week, from the phone that joined it (or the operations desk). The two demo kitchens are
 * shared by everyone at the table, so the week runs only in visitor kitchens.
 *
 *   GET ?run=<runId>&after=<version>   the week as soon as it changes (long poll); without run, the latest one
 *   POST                               play (or replay) the week in this kitchen
 */
type Ctx = { params: Promise<{ kitchen: string }> };

async function visitorKitchen(req: Request, slug: string) {
  return handle(async (rt) => {
    const k = await consoleKitchen(req, rt, slug);
    if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen is not open.");
    if (k.info.kind !== "visitor") throw new DockError(409, "demo_kitchen", "The week plays in a visitor's own kitchen: scan the QR code at the table to get one.");
    return Response.json({ ok: true });
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { kitchen } = await ctx.params;
  const denied = await visitorKitchen(req, kitchen);
  if (!denied.ok) return denied;
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const runId = q.get("run");
    const latest = activeWeekFor(kitchen);
    if (!runId) return Response.json({ run: latest ?? null }, { headers: { "cache-control": "no-store" } });
    const run = await nextWeek(runId, Number(q.get("after") ?? -1));
    if (!run || run.kitchen.sandboxId !== kitchen) throw new DockError(404, "week_not_found", "No such week for this kitchen.");
    return Response.json({ run }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { kitchen } = await ctx.params;
  const denied = await visitorKitchen(req, kitchen);
  if (!denied.ok) return denied;
  return handle(async (rt) => Response.json({ run: await startWeek(rt, { sandboxId: kitchen }) }, { status: 201 }));
}

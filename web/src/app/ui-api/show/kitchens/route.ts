import { showRoute } from "@/server/show/http";
import { kitchenRef, listWeeks, showCounts } from "@/server/show/registry";

/** GET: every open visitor kitchen (newest first) with the week playing there, for the presenter and the table. */
export async function GET(req: Request) {
  return showRoute(req, async (rt) => {
    const counts = showCounts();
    const weeks = listWeeks();
    const kitchens = (await rt.sandboxes.list())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ ...kitchenRef(s, s.sandboxId === counts.houseKitchen), createdAt: s.createdAt, week: weeks.find((w) => w.kitchen.sandboxId === s.sandboxId) }));
    return Response.json({ kitchens, now: new Date().toISOString() });
  });
}

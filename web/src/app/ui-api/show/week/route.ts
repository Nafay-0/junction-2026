import { bodyOf, optionalId, showRoute } from "@/server/show/http";
import { listWeeks, startWeek } from "@/server/show/registry";

/** GET: the weeks playing or played in this process, newest first. POST { sandboxId? }: start (or restart) one. */
export async function GET(req: Request) {
  return showRoute(req, async () => Response.json({ weeks: listWeeks() }));
}

export async function POST(req: Request) {
  return showRoute(req, async (rt) => {
    const body = await bodyOf(req);
    const run = await startWeek(rt, { sandboxId: optionalId(body.sandboxId) });
    return Response.json({ run }, { status: 201 });
  });
}

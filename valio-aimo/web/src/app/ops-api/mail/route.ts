import { DockError } from "@/core/errors";
import { mailPreview, mailView } from "@/server/notify/service";
import { opsRead } from "@/server/ops/handler";

/**
 * GET /ops-api/mail: what was emailed to which kitchen (masked address), for which event, the outcome, the caps and
 * what is left. GET /ops-api/mail?preview=<mailId>: that mail rendered again (masked address, inert links). Staff never
 * see a kitchen's full address.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => {
    const id = new URL(req.url).searchParams.get("preview");
    if (!id) return Response.json(await mailView(rt));
    const p = await mailPreview(rt, id);
    if (!p) throw new DockError(404, "mail_not_found", "No such mail.");
    return Response.json(p);
  });
}

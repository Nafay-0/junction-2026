import { DockError } from "@/core/orders";
import { readJson } from "@/server/http";
import { opsRoute } from "@/server/ops/handler";
import { verifyPasted } from "@/server/ops/verify";

/** POST /ops-api/verify { text }: check a pasted receipt, quote or signed claim against the published keys. */
export async function POST(req: Request) {
  return opsRoute(req, async (rt) => {
    const body = (await readJson(req)) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) throw new DockError(400, "invalid_request", "Paste a receipt, a quote or a signed claim.");
    const jwks = { keys: [rt.dock.wholesalerPublicJwk as never] };
    return Response.json(await verifyPasted(body.text.slice(0, 200_000), jwks, rt.dock.ledger.entries()));
  });
}

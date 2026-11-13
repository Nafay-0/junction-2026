import { opsRoute } from "@/server/ops/handler";
import { auditList } from "@/server/ops/views";

/** GET /ops-api/audit: every order, newest first, for the audit page. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json({ orders: await auditList(rt), jwks: "/.well-known/jwks.json" }));
}

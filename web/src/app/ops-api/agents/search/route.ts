import { DockError } from "@/core/errors";
import { RateLimiter } from "@/server/limits";
import { auditSearch } from "@/server/ops/audit-search";
import { opsRoute } from "@/server/ops/handler";

const limiter = new RateLimiter(2_000);

/** GET /ops-api/agents/search?q=refusals for allergens by outside agents today: the audit trail in words (OpenSearch, SQL as the fallback). */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
    if (!q) throw new DockError(400, "invalid_request", "Ask something, for example: refusals for allergens by outside agents today.");
    const wait = limiter.hit({ name: "audit search", limit: 30, windowMs: 60_000 }, staff.token);
    if (wait !== null) throw new DockError(429, "rate_limited", `Too many searches from this desk; try again in ${wait} s.`);
    return Response.json(await auditSearch(rt, q), { headers: { "cache-control": "no-store" } });
  });
}

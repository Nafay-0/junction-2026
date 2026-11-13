import { opsRoute } from "@/server/ops/handler";
import { auditRecord } from "@/server/ops/views";

/**
 * GET /ops-api/audit/{orderId}: the wholesaler's record of one order: what was asked, what the wholesaler claimed,
 * what was committed and who signed, with the ledger entries behind it. `?download=1` returns it as a file.
 */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/audit/[orderId]">) {
  const { orderId } = await ctx.params;
  return opsRoute(req, async (rt) => {
    const record = await auditRecord(rt, orderId);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(JSON.stringify(record, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(download ? { "content-disposition": `attachment; filename="dock-audit-${orderId}.json"` } : {}),
      },
    });
  });
}

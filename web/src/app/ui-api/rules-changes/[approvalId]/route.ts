import { handleApprover } from "@/server/approver-session";
import { readJson } from "@/server/http";
import { decideRulesChange, findRulesChange, requireRulesChangeReader, rulesChangeView } from "@/server/thread/rules-signoff";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /ui-api/rules-changes/{approvalId}: a change to a kitchen's rules that waits for its approver, in plain data for
 * the sign-off screen (/approve/rch_...): exactly what would change, who asked and when, until when. For the kitchen's
 * approver phone, its own account, the operations desk; 404 for anyone else (server/thread/rules-signoff.ts).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/rules-changes/[approvalId]">) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    const f = await findRulesChange(approvalId);
    await requireRulesChangeReader(rt, req, f);
    return Response.json({ view: await rulesChangeView(rt, req, f) }, noStore);
  });
}

/**
 * POST { decision: "approve" | "decline", proof, note? }: approve only with a passkey assertion for this change (from
 * ./challenge); decline with a passkey assertion or { kind: "session" } from the approver's signed-in phone.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/rules-changes/[approvalId]">) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown; proof?: { kind?: unknown; response?: unknown }; note?: unknown };
    return Response.json({ view: await decideRulesChange(rt, req, approvalId, body) }, noStore);
  });
}

import { handle } from "@/server/http";

// APPROVER-AUTH SEAM: open today (no tokens are listed). Require a signed-in approver once passkeys land.
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async ({ dock }) => Response.json({ approvals: await dock.listPendingApprovals() }));
}

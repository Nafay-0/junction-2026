import { handleApprover } from "@/server/approver-session";

/** Live demo kitchens, for the big screen. No keys, no mandate tokens. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handleApprover(async (rt) => Response.json({ sandboxes: await rt.sandboxes.list() }));
}

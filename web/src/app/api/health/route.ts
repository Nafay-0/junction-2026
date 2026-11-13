import { handle } from "@/server/http";
import { healthReport } from "@/server/health";

/** Liveness and what is running: git commit, catalogue source and size, which backing services answer. No secrets. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async (rt) => Response.json(await healthReport(rt, req), { headers: { "cache-control": "no-store" } }));
}

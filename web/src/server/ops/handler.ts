import type { Runtime } from "../runtime";
import { handle } from "../http";
import { requireOps, type OpsSession } from "./access";

/**
 * Every /ops-api route: the operations session is required (see access.ts), then the body runs against the shared
 * runtime, and any DockError becomes `{ error: { code, message } }` with its status. Never cached.
 */
export function opsRoute(req: Request, fn: (rt: Runtime, staff: OpsSession) => Promise<Response>): Promise<Response> {
  return handle(async (rt) => {
    const staff = requireOps(req);
    const res = await fn(rt, staff);
    res.headers.set("cache-control", "no-store");
    return res;
  });
}

import { DockError } from "@/core/errors";
import { currentOps } from "@/server/ops/access";

/**
 * Who on the wholesaler's side is reading memory: the operations portal's signed-in staff member (server/ops/
 * access.ts, the `dock_ops` session cookie). No operations session, no access to any kitchen's memory.
 */
export { OPS_COOKIE } from "@/server/ops/access";

export function staffFromRequest(req: Request, now = new Date()): { name: string } {
  const s = currentOps(req, now);
  if (!s) throw new DockError(401, "ops_not_signed_in", "Enter the operations portal first: memory shared with the wholesaler is for its signed-in staff.");
  return { name: s.name };
}

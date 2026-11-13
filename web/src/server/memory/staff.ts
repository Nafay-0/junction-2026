import { DockError } from "@/core/errors";

/**
 * Who on the wholesaler's side is reading memory. The operations portal (/ops) signs its staff in and keeps their
 * sessions in `globalThis.__dockOpsSessions`, keyed by the `dock_ops` cookie (server/ops/access.ts on the ops
 * branch). This reads the same session, so the memory routes need no sign-in of their own and no one without an
 * operations session can read any kitchen's memory. Read-only on purpose: nothing here writes a session.
 */
export const OPS_COOKIE = "dock_ops";

type OpsSession = { token: string; name: string; expiresAt: string };
const g = globalThis as typeof globalThis & { __dockOpsSessions?: Map<string, OpsSession> };

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function staffFromRequest(req: Request, now = new Date()): { name: string } {
  const token = cookie(req, OPS_COOKIE);
  const s = token ? g.__dockOpsSessions?.get(token) : undefined;
  if (!s || Date.parse(s.expiresAt) <= now.getTime()) throw new DockError(401, "ops_not_signed_in", "Enter the operations portal first: memory shared with the wholesaler is for its signed-in staff.");
  return { name: s.name };
}

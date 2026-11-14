import { DockError } from "@/core/errors";
import { readJson } from "../http";
import { opsRoute } from "../ops/handler";
import type { Runtime } from "../runtime";
import type { OpsSession } from "../ops/access";

/**
 * Every /ui-api/show route: the operations session (the passcode the presenter entered at /ops/enter or on
 * /present) is required, the reply is never cached, and refusals come back as `{ error: { code, rule, message } }`.
 */
export function showRoute(req: Request, fn: (rt: Runtime, staff: OpsSession) => Promise<Response>): Promise<Response> {
  return opsRoute(req, fn);
}

/** The JSON body, or {} when there is none. */
export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-length") && !req.headers.get("content-type")) return {};
  const b = await readJson(req).catch((e) => {
    if (e instanceof DockError && e.code === "invalid_json") return {};
    throw e;
  });
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

export const optionalId = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(v) ? v : undefined);

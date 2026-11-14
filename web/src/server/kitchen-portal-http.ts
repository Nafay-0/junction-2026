import { unstable_rethrow } from "next/navigation";
import { DockError } from "@/core/errors";
import { consoleKitchen } from "./authz";
import { getRuntime } from "./runtime";
import { errorBody } from "./http";
import type { Kitchen } from "./kitchen-portal";

/**
 * Route wrapper for the kitchen portal's own back end: resolve the kitchen and check the caller may act for it
 * (server/authz.ts: demo kitchens open, a visitor's kitchen only from their phone), turn failures into error JSON.
 */
export async function portalRoute(req: Request, params: Promise<{ kitchen: string }>, fn: (k: Kitchen) => Promise<Response>): Promise<Response> {
  try {
    const { kitchen } = await params;
    const k = await consoleKitchen(req, await getRuntime(), kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const res = await fn(k);
    if (k.setCookie && !res.headers.has("set-cookie")) {
      try {
        res.headers.set("set-cookie", k.setCookie);
      } catch {
        // immutable headers: the cookie comes with the next call
      }
    }
    return res;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof DockError) return Response.json(errorBody(err.code, err.message, err.rule, err.details), { status: err.status });
    const e = err as { status?: number; code?: string; message?: string };
    if (typeof e?.status === "number") return Response.json(errorBody(e.code ?? "portal_error", e.message ?? "The request failed."), { status: e.status });
    console.error(err);
    return Response.json(errorBody("internal_error", "Something went wrong inside AimoPilot."), { status: 500 });
  }
}

export const noStore = { headers: { "cache-control": "no-store" } };

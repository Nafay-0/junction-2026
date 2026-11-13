import { unstable_rethrow } from "next/navigation";
import { DockError } from "@/core/errors";
import { resolveKitchen } from "./console-kitchens";
import { errorBody } from "./http";
import type { Kitchen } from "./kitchen-portal";

/** Route wrapper for the kitchen portal's own back end: resolve the kitchen, turn failures into Dock's error JSON. */
export async function portalRoute(params: Promise<{ kitchen: string }>, fn: (k: Kitchen) => Promise<Response>): Promise<Response> {
  try {
    const { kitchen } = await params;
    const k = await resolveKitchen(kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    return await fn(k);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof DockError) return Response.json(errorBody(err.code, err.message, err.rule, err.details), { status: err.status });
    const e = err as { status?: number; code?: string; message?: string };
    if (typeof e?.status === "number") return Response.json(errorBody(e.code ?? "portal_error", e.message ?? "The request failed."), { status: e.status });
    console.error(err);
    return Response.json(errorBody("internal_error", "Something went wrong inside Dock."), { status: 500 });
  }
}

export const noStore = { headers: { "cache-control": "no-store" } };

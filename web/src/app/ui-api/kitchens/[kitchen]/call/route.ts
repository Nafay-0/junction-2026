import { resolveKitchen } from "@/server/console-kitchens";
import { errorBody } from "@/server/http";
import { localFetch } from "@/server/local-transport";

/**
 * POST /ui-api/kitchens/{kitchen}/call  { method, path, body? }
 *
 * The buyer console's agent: forwards one call to Dock's public v1 API with this kitchen's mandate attached,
 * and returns Dock's reply unchanged (status and JSON). Only the calls a buyer screen needs are allowed.
 * Not part of the public API (it is the console's own back end), so it is not in the OpenAPI description.
 */
const ALLOWED: [string, RegExp][] = [
  ["GET", /^\/api\/v1\/kitchen$/],
  ["POST", /^\/api\/v1\/intake$/],
  ["GET", /^\/api\/v1\/intake\/req_[a-z0-9]+$/],
  ["POST", /^\/api\/v1\/intake\/req_[a-z0-9]+\/(concerns|answers|choice)$/],
  ["POST", /^\/api\/v1\/orders$/],
  ["GET", /^\/api\/v1\/orders\/ord_[a-z0-9]+$/],
  ["GET", /^\/api\/v1\/ledger(\?[\w=&%-]*)?$/],
  ["POST", /^\/api\/v1\/agent\/interpret$/], // being built elsewhere; see _client/interpret.ts
];

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/call">) {
  const { kitchen } = await ctx.params;
  const k = await resolveKitchen(kitchen);
  if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
  let call: { method?: unknown; path?: unknown; body?: unknown };
  try {
    call = (await req.json()) as typeof call;
  } catch {
    return Response.json(errorBody("invalid_json", "Request body must be JSON."), { status: 400 });
  }
  const method = call.method === "POST" ? "POST" : "GET";
  const path = typeof call.path === "string" ? call.path : "";
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
    return Response.json(errorBody("console_call_not_allowed", `The buyer console does not make ${method} ${path}.`), { status: 403 });
  }
  const headers: Record<string, string> = { accept: "application/json", authorization: `Mandate ${k.mandateToken}`, "dock-agent-id": k.agentId };
  if (method === "POST") headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers, body: method === "POST" ? JSON.stringify(call.body ?? {}) : undefined };

  // In-process first (same handlers, no network hop). A route the in-process table does not know yet
  // (e.g. /api/v1/agent/interpret before it lands there) goes over HTTP to this same server.
  let res = await localFetch(new Request(new URL(path, "http://dock.local"), init));
  if (res.status === 404) {
    const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: string } };
    if (body.error?.code === "not_found") {
      try {
        res = await fetch(new URL(path, new URL(req.url).origin), { ...init, cache: "no-store" });
      } catch {
        // keep the in-process 404
      }
    }
  }
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}

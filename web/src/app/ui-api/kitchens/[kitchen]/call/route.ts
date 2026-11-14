import * as interpret from "@/app/api/v1/agent/interpret/route";
import { asStoreError } from "@/server/aiven/pg/errors";
import { consoleKitchen, refusalResponse } from "@/server/authz";
import { storeDoorFor } from "@/server/assistant-handoff";
import { attachConsoleContext } from "@/server/console-context";
import { errorBody } from "@/server/http";
import { getRuntime } from "@/server/runtime";
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
  ["POST", /^\/api\/v1\/orders\/ord_[a-z0-9]+\/withdraw$/],
  ["GET", /^\/api\/v1\/ledger(\?[\w=&%-]*)?$/],
  ["POST", /^\/api\/v1\/agent\/interpret$/],
];

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/call">) {
  try {
    return await forward(req, ctx);
  } catch (err) {
    // A refusal, or the database away (503 store_unavailable): JSON either way, never an empty 500.
    const refused = refusalResponse(asStoreError(err));
    if (refused) return refused;
    console.error(err);
    return Response.json(errorBody("internal_error", "Something went wrong inside AimoPilot."), { status: 500 });
  }
}

async function forward(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/call">): Promise<Response> {
  const { kitchen } = await ctx.params;
  const k = await consoleKitchen(req, await getRuntime(), kitchen); // a visitor's kitchen only from their own phone (server/authz.ts)
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

  // In-process: the same route handlers, no network hop and no assumption about this server's own address.
  const forwarded = new Request(new URL(path, "http://dock.local"), init);
  // Which part of the store a request came from: the assistant panel when its words are what the assistant just handed over.
  const door = path === "/api/v1/intake" ? storeDoorFor(k.info.slug, k.console.session, (call.body as { need?: { text?: unknown } } | undefined)?.need?.text) : "typed";
  attachConsoleContext(forwarded, { ...k.console, door });
  const res = path === "/api/v1/agent/interpret" ? await interpret.POST(forwarded) : await localFetch(forwarded);
  const text = await res.text();
  const out: Record<string, string> = { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" };
  for (const h of ["retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) {
    const v = res.headers.get(h);
    if (v) out[h] = v;
  }
  if (k.setCookie) out["set-cookie"] = k.setCookie;
  return new Response(text, { status: res.status, headers: out });
}

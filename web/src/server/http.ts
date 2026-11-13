import { unstable_rethrow } from "next/navigation";
import { DockError, type AgentSession, type Dock } from "@/core/orders";
import { getRuntime, type Runtime } from "./runtime";

/** Error body for every failure: `{ error: { code, rule?, message, details? } }`. `rule` names the check that refused. */
export type ErrorBody = { error: { code: string; rule?: string; message: string; details?: Record<string, unknown> } };

export function errorBody(code: string, message: string, rule?: string, details?: Record<string, unknown>): ErrorBody {
  return { error: { code, rule, message, details } };
}

/** Run a route body against the shared runtime and turn any DockError into structured JSON. */
export async function handle(fn: (rt: Runtime) => Promise<Response>): Promise<Response> {
  try {
    return await fn(await getRuntime());
  } catch (err) {
    unstable_rethrow(err); // let Next.js see its own control-flow errors (e.g. "this route is request-time")
    if (err instanceof DockError) return Response.json(errorBody(err.code, err.message, err.rule, err.details), { status: err.status });
    console.error(err);
    return Response.json(errorBody("internal_error", "Something went wrong inside Dock."), { status: 500 });
  }
}

/**
 * Agents authenticate by presenting their mandate:
 *   Authorization: Mandate <compact JWS>   (Bearer is accepted too)
 *   Dock-Agent-Id: <agent id named in the mandate>
 */
export function authenticate(req: Request, dock: Dock): Promise<AgentSession> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^(?:Mandate|Bearer)\s+(\S+)$/i.exec(auth.trim());
  return dock.authenticate(match?.[1], req.headers.get("dock-agent-id") ?? undefined);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new DockError(400, "invalid_json", "Request body must be JSON.");
  }
}

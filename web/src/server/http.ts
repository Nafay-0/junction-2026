import { unstable_rethrow } from "next/navigation";
import { DockError, isDockError } from "@/core/errors";
import type { AgentSession, Dock } from "@/core/orders";
import { doorLog, interfaceOf } from "./ops/door";
import { suspensions } from "./ops/suspensions";
import { getRuntime, type Runtime } from "./runtime";

/** Error body for every failure: `{ error: { code, rule?, message, details? } }`. `rule` names the check that refused. */
export type ErrorBody = { error: { code: string; rule?: string; message: string; details?: Record<string, unknown> } };

export function errorBody(code: string, message: string, rule?: string, details?: Record<string, unknown>): ErrorBody {
  return { error: { code, rule, message, details } };
}

/**
 * Run a route body against the shared runtime and turn any DockError into structured JSON.
 * Recognised by brand (`isDockError`), not class identity: the runtime may have been built by another bundle
 * (the status page `/`), whose copy of DockError is a different class from the one imported here.
 */
export async function handle(fn: (rt: Runtime) => Promise<Response>): Promise<Response> {
  try {
    return await fn(await getRuntime());
  } catch (err) {
    unstable_rethrow(err); // let Next.js see its own control-flow errors (e.g. "this route is request-time")
    if (isDockError(err)) return Response.json(errorBody(err.code, err.message, err.rule, err.details), { status: err.status });
    console.error(err);
    return Response.json(errorBody("internal_error", "Something went wrong inside Dock."), { status: 500 });
  }
}

/**
 * Agents authenticate by presenting their mandate:
 *   Authorization: Mandate <compact JWS>   (Bearer is accepted too)
 *   Dock-Agent-Id: <agent id named in the mandate>
 */
export async function authenticate(req: Request, dock: Dock): Promise<AgentSession> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^(?:Mandate|Bearer)\s+(\S+)$/i.exec(auth.trim());
  // The operations layer in front of the core: which door the call came through, and whether staff suspended it.
  const door = interfaceOf(req);
  const agentId = req.headers.get("dock-agent-id") ?? agentIdFromUrl(req) ?? undefined;
  let session: AgentSession;
  try {
    session = await dock.authenticate(match?.[1], agentId);
  } catch (err) {
    if (isDockError(err)) doorLog(dock).record({ at: new Date().toISOString(), agentId: agentId ?? "unknown", ...door, ok: false, code: err.code, rule: err.rule });
    throw err;
  }
  const call = { at: new Date().toISOString(), agentId: session.agentId, orgId: session.mandate.issuer.orgId, orgName: session.mandate.issuer.name, ...door };
  try {
    suspensions(dock).enforce(session, door);
  } catch (err) {
    if (isDockError(err)) doorLog(dock).record({ ...call, ok: false, code: err.code, rule: err.rule });
    throw err;
  }
  doorLog(dock).record({ ...call, ok: true }, session.mandate);
  return session;
}

/**
 * `?agent_id=` on the URL, for MCP clients that can send a bearer token but no custom header (an Aiven Managed
 * Agent's custom integration takes only a URL and a token). The header wins when both are present; the mandate
 * still has to name the same agent.
 */
function agentIdFromUrl(req: Request): string | undefined {
  try {
    return new URL(req.url).searchParams.get("agent_id")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Largest JSON body any Dock route accepts. A passkey registration response is a few KB; an order is smaller. */
export const MAX_JSON_BYTES = 64 * 1024;

const tooLarge = (max: number) => new DockError(413, "body_too_large", `Request body is larger than ${Math.round(max / 1024)} KB.`);

/** The body as text, refusing (413) once it passes `maxBytes`, whether or not Content-Length was sent. */
export async function readBody(req: Request, maxBytes = MAX_JSON_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const text = await readBody(req, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new DockError(400, "invalid_json", "Request body must be JSON.");
  }
}

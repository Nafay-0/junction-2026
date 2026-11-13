import { McpServer, createMcpHandler, localhostAllowedOrigins, originValidationResponse, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DockError } from "@/core/orders";
import { authenticate } from "../http";
import { getRuntime, type Runtime } from "../runtime";
import { LiveLookupGuard } from "./live-lookup-guard";
import { nextStepFor } from "./next-step";
import { TOOLS, type DockTool } from "./tools";

/**
 * Dock over the Model Context Protocol, Streamable HTTP, served statelessly: every HTTP request gets a
 * fresh McpServer from the factory below. Speaks the 2026-07-28 revision and, through the SDK's stateless
 * fallback, the 2025-era handshake (2025-11-25 and earlier) that most clients still send.
 *
 * Auth is the same credential the REST API takes, sent as HTTP headers on every request:
 *   Authorization: Bearer <mandate JWS>   (or `Mandate <jws>`)
 *   Dock-Agent-Id: <agent id the mandate names>
 * Listing tools needs no mandate; every tool call verifies it. A refused call is a tool result with
 * isError and structuredContent `{ ok: false, error: { code, rule, message, details }, nextStep }`,
 * the same code and rule the REST API returns.
 */

export const MCP_SERVER_INFO = { name: "dock", title: "Dock", version: "1.0.0" };

export const MCP_INSTRUCTIONS = `Dock is a wholesaler's ordering gateway for purchasing agents. You buy on behalf of an organisation that signed a mandate saying what you may buy; Dock checks every order against it in plain code.

Flow: read_mandate -> open_request -> search_products (free master data) -> check_availability (live, metered, short lists only) -> request_quote (signed fixed price) -> place_order -> get_order / explain.

Rules of the road:
- Quantities are packs. Prices are euro cents ex VAT.
- Ask live prices only for a short list (at most 10 products per call); never scan the catalogue.
- If the preferred product is short, quote what it has and add a substitute line with substituteFor.
- place_order may return pending_approval: a person signs off on their own device. Do not retry; follow up with get_order.
- Every refusal names the rule that fired (error.rule) and says what to do next (nextStep).`;

type ToolResult = CallToolResult & { structuredContent: Record<string, unknown> };

function result(structured: Record<string, unknown>, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, ...(isError ? { isError } : {}) };
}

export function refusal(err: DockError): ToolResult {
  const { order, ...details } = err.details ?? {};
  return result(
    {
      ok: false,
      error: { code: err.code, rule: err.rule, message: err.message, details: Object.keys(details).length ? details : undefined },
      ...(order ? { order } : {}),
      nextStep: nextStepFor(err),
    },
    true,
  );
}

const guards = new WeakMap<Runtime, LiveLookupGuard>();
function guardFor(rt: Runtime): LiveLookupGuard {
  let g = guards.get(rt);
  if (!g) guards.set(rt, (g = new LiveLookupGuard()));
  return g;
}

/** Authenticate the caller from the HTTP request, run one tool, and shape the result. Never throws a DockError. */
export async function runTool(rt: Runtime, req: Request | undefined, tool: DockTool, args: unknown): Promise<ToolResult> {
  const { dock } = rt;
  try {
    const session = await authenticate(req ?? new Request("http://dock.invalid/"), dock);
    const agentKey = `${session.mandate.issuer.orgId}:${session.agentId}`;
    const run = tool.run as (ctx: Parameters<DockTool["run"]>[0], args: unknown) => Promise<Record<string, unknown>>;
    return result({ ok: true, ...(await run({ dock, session, guard: guardFor(rt), agentKey }, args)) });
  } catch (err) {
    if (!(err instanceof DockError)) throw err; // the SDK turns it into a generic tool error
    if (err.code === "live_lookup_budget_exceeded") {
      dock.ledger.append({
        type: "refusal",
        actor: `agent:${req?.headers.get("dock-agent-id") ?? "unknown"}`,
        requestId: (args as { requestId?: string }).requestId,
        summary: `Refused: ${err.message}`,
        data: { code: err.code, rule: err.rule, status: err.status },
      });
    }
    return refusal(err);
  }
}

export function buildMcpServer(rt: Runtime, req?: Request): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output.extend({ ok: z.literal(true) }).loose(), // loose: new fields must not break clients
        annotations: { title: tool.title, readOnlyHint: tool.readOnly ?? false, destructiveHint: false, idempotentHint: tool.readOnly ?? false, openWorldHint: false },
      },
      (args: unknown) => runTool(rt, req, tool, args),
    );
  }
  return server;
}

const handler = createMcpHandler(async ({ requestInfo }) => buildMcpServer(await getRuntime(), requestInfo), {
  onerror: (err) => console.error("[mcp]", err.message),
});

/**
 * The /api/mcp endpoint. Browsers may only call it from this site or localhost (DNS-rebinding guard the
 * spec asks for); non-browser agents send no Origin and pass.
 */
export async function serveMcp(req: Request): Promise<Response> {
  const host = new URL(req.url).hostname;
  return originValidationResponse(req, [...localhostAllowedOrigins(), host]) ?? handler.fetch(req);
}

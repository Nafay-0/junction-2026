import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { DockError } from "@/core/orders";
import { authenticate } from "../http";
import { getRuntime, type Runtime } from "../runtime";
import { AskHuman, HUMAN_INPUT_META, type HumanChannel } from "./ask-human";
import type { LiveBudget } from "@/server/aiven/valkey";
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

Start every new order with submit_need (the buyer's need as fields). Dock then leads: each result has a step with a state and a nextStep naming the next call.
Flow: read_mandate -> submit_need -> [respond_to_concerns] -> [answer_questions] -> choose_option (signed fixed-price quote) -> place_order -> get_order / explain.
respond_to_concerns and answer_questions carry the human buyer's own answer: relay Dock's question to them and pass on what they say. Never confirm a likely mistake or answer a question for them. If your client supports elicitation, Dock asks the buyer directly.
Lower-level tools for follow-up: open_request, search_products (free master data), check_availability (live, metered, short lists only), request_quote.

Rules of the road:
- Quantities are packs. Prices are euro cents ex VAT.
- Ask live prices only for a short list (at most 10 products per call); never scan the catalogue.
- If the preferred product is short, quote what it has and add a substitute line with substituteFor.
- place_order may return pending_approval: a person signs off on their own device. Do not retry; follow up with get_order.
- Every refusal names the rule that fired (error.rule) and says what to do next (nextStep).`;

type ToolResult = (CallToolResult & { structuredContent: Record<string, unknown> }) | InputRequiredResult;

function result(structured: Record<string, unknown>, isError = false): CallToolResult & { structuredContent: Record<string, unknown> } {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, ...(isError ? { isError } : {}) };
}

export function refusal(err: DockError) {
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

const guards = new WeakMap<Runtime, LiveBudget>();
function guardFor(rt: Runtime): LiveBudget {
  let g = guards.get(rt);
  // The Valkey-backed allowance when DOCK_CACHE=valkey (shared by every process), else the core's own, through the guard.
  if (!g) {
    g = rt.aiven?.liveBudget ?? new LiveLookupGuard(rt.dock.liveAllowance); // the core's allowance: REST and MCP share it
    guards.set(rt, g);
  }
  return g;
}

/**
 * Whether Dock can ask the human through this client: on 2026-07-28 the request's own envelope declares the
 * `elicitation` capability (an empty object means form mode). 2025-era requests reach this stateless server
 * without it, so the agent relays instead.
 */
export function humanChannel(ctx?: Pick<ServerContext, "mcpReq">): HumanChannel {
  const envelope = ctx?.mcpReq.envelope as Record<string, { elicitation?: { form?: object; url?: object } } | undefined> | undefined;
  const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY];
  const e = caps?.elicitation;
  return { canAsk: !!e && (!!e.form || !e.url), responses: ctx?.mcpReq.inputResponses };
}

/** Authenticate the caller from the HTTP request, run one tool, and shape the result. Never throws a DockError. */
export async function runTool(rt: Runtime, req: Request | undefined, tool: DockTool, args: unknown, human: HumanChannel = { canAsk: false }): Promise<ToolResult> {
  const { dock } = rt;
  try {
    const session = await authenticate(req ?? new Request("http://dock.invalid/"), dock);
    const agentKey = `${session.mandate.issuer.orgId}:${session.agentId}`;
    const run = tool.run as (ctx: Parameters<DockTool["run"]>[0], args: unknown) => Promise<Record<string, unknown> | AskHuman>;
    const out = await run({ dock, session, guard: guardFor(rt), agentKey, human }, args);
    if (out instanceof AskHuman) return out.result;
    return result({ ok: true, ...out });
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
        ...("humanInput" in tool && tool.humanInput
          ? { _meta: { [HUMAN_INPUT_META]: { required: true, from: "buyer", how: "elicitation (input_required) when the client supports it, else the agent relays the buyer's own answer" } } }
          : {}),
      },
      (args: unknown, ctx: ServerContext) => runTool(rt, req, tool, args, humanChannel(ctx)),
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

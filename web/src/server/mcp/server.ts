import {
  CLIENT_CAPABILITIES_META_KEY,
  type AuthInfo,
  McpServer,
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { DockError, type AgentSession } from "@/core/orders";
import { resolveKitchen } from "../console-kitchens";
import { authenticate, errorBody } from "../http";
import { getRuntime, type Runtime } from "../runtime";
import { AskHuman, HUMAN_INPUT_META, type HumanChannel } from "./ask-human";
import type { LiveBudget } from "@/server/aiven/valkey";
import { ConnectorService, connectorSecret, type Connector, type ConnectorKitchen, type ConnectorLimitKind } from "./connectors";
import { LiveLookupGuard } from "./live-lookup-guard";
import { nextStepFor, nextStepForIntake } from "./next-step";
import type { IntakeView } from "@/core/intake";
import { answerLinkFor, needsBuyer } from "../answer-links";
import { publicBaseUrl } from "../config";
import { TOOLS, type DockTool } from "./tools";

/**
 * Dock over the Model Context Protocol, Streamable HTTP, served statelessly: every HTTP request gets a
 * fresh McpServer from the factory below. Speaks the 2026-07-28 revision and, through the SDK's stateless
 * fallback, the 2025-era handshake (2025-11-25 and earlier) that most clients still send.
 *
 * Two doors, one gate:
 *   /api/mcp            the agent presents its credential as HTTP headers on every request:
 *                         Authorization: Bearer <mandate JWS>   (or `Mandate <jws>`)
 *                         Dock-Agent-Id: <agent id the mandate names>
 *   /api/mcp/c/<token>  a connector address (connectors.ts) for assistants that can only be given a URL: the
 *                       token stands for one kitchen's mandate and agent id, held on the server. Every call is
 *                       authenticated with exactly those, so the same checks apply, plus per-address limits.
 * Listing tools needs no mandate; every tool call verifies it. A refused call is a tool result with
 * isError and structuredContent `{ ok: false, error: { code, rule, message, details }, nextStep }`,
 * the same code and rule the REST API returns.
 */

export const MCP_SERVER_INFO = { name: "aimopilot", title: "AimoPilot", version: "1.0.0" };

export const MCP_INSTRUCTIONS = `AimoPilot is a wholesaler's ordering gateway. You order food for a kitchen under a mandate its organisation signed; AimoPilot checks every order in plain code and a named person signs off anything beyond it.

Start every new order with submit_need. Each result has a step, waitingFor and nextStep: do what nextStep says.
When waitingFor is "buyer", AimoPilot needs the person's own answer: ask them AimoPilot's question in plain words with its choices, then stop and wait for their reply. Never answer or confirm for them, even when one choice looks obvious.
When place_order returns pending_approval, tell the person in one sentence who must sign off (they are asked on their own phone) and stop. Do not retry, place it again, split it or find another way round.

Flow: read_mandate -> submit_need -> [respond_to_concerns] -> [answer_questions] -> choose_option (signed fixed-price quote) -> place_order -> get_order / explain.
If your client supports elicitation, AimoPilot asks the buyer directly instead.
Lower-level tools for follow-up: open_request, search_products (free master data), check_availability (live, metered, short lists only), request_quote.

Rules of the road:
- Fill submit_need with only what the person said and call it; do not ask for details first. AimoPilot asks only what changes the outcome.
- Talk to the person in plain words: option titles, totals in euros, delivery days. No ids or JSON unless they ask.
- Quantities are packs. Prices are euro cents ex VAT.
- Ask live prices only for a short list (at most 10 products per call); never scan the catalogue.
- If the preferred product is short, quote what it has and add a substitute line with substituteFor.
- Every refusal names the rule that fired (error.rule) and says what to do next (nextStep). A refusal is final unless nextStep says how to fix it: tell the person, do not loop.`;

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

// ---------- connector addresses ----------

/** Kitchens whose first connector address comes from configuration (DOCK_CONNECTOR_SECRET). */
export const DEMO_CONNECTOR_KITCHENS = ["kaari", "laakso"] as const;

async function connectorKitchen(slug: string): Promise<ConnectorKitchen | undefined> {
  const k = await resolveKitchen(slug);
  return k && { slug, kind: k.info.kind, name: k.info.name, mandateToken: k.mandateToken, agentId: k.agentId, by: k.info.by, expiresAt: k.info.expiresAt };
}

const connectorServices = new WeakMap<Runtime, ConnectorService>();
/** This runtime's connector addresses (a fresh set after resetRuntime, like every other store). */
export function connectorsFor(rt: Runtime): ConnectorService {
  let c = connectorServices.get(rt);
  if (!c) connectorServices.set(rt, (c = new ConnectorService({ resolveKitchen: connectorKitchen, demoKitchens: DEMO_CONNECTOR_KITCHENS, secret: connectorSecret })));
  return c;
}

/** A call that came in through a connector address: who it stands for, and what the client said it is. */
export type ConnectorCall = { connector: Connector; kitchen: ConnectorKitchen; service: ConnectorService; client?: string };

/**
 * The request `authenticate` sees for a connector call: the kitchen's own mandate and agent id as the usual headers,
 * so the operations layer (door log, suspensions) and the core check it exactly as on /api/mcp. The path carries the
 * address's public id, never its secret token, because the door log shows paths to staff.
 */
function connectorCredentials(via: ConnectorCall): Request {
  return new Request(`http://connector.invalid/api/mcp/c/${via.connector.connectorId}`, {
    headers: { authorization: `Mandate ${via.kitchen.mandateToken}`, "dock-agent-id": via.kitchen.agentId },
  });
}

/** Tools that count against a connector address's own limits, beyond the per-request one. */
const COUNTED: Partial<Record<string, ConnectorLimitKind>> = { submit_need: "requests", open_request: "requests", place_order: "orders" };

/** Which assistant a request came from, best effort from its User-Agent. For the audit trail only; never trusted. */
export function clientOf(req: Request | undefined): string | undefined {
  const ua = req?.headers.get("user-agent")?.slice(0, 120);
  if (!ua) return undefined;
  const vendor = /claude|anthropic/i.test(ua) ? "Claude" : /openai|chatgpt/i.test(ua) ? "ChatGPT" : /gemini|google/i.test(ua) ? "Gemini" : undefined;
  return vendor ? `${vendor} (${ua})` : ua;
}

const lastLogged = new Map<string, number>();
/** Write a connector refusal to the ledger, at most once per address and reason every ten minutes (a leaked address must not flood it). */
function logConnectorRefusal(rt: Runtime, key: string, entry: { actor: string; summary: string; data: Record<string, unknown>; requestId?: string }) {
  const t = Date.now();
  if ((lastLogged.get(key) ?? 0) > t - 10 * 60_000) return;
  lastLogged.set(key, t);
  rt.dock.ledger.append({ type: "refusal", ...entry });
}

function logChannel(rt: Runtime, via: ConnectorCall, agentId: string, requestId: string, tool: string) {
  rt.dock.ledger.append({
    type: "intake",
    actor: `agent:${agentId}`,
    requestId,
    summary: `${via.kitchen.name}: this request came in through the kitchen's connector address (${via.connector.connectorId}), from ${via.client ? `an outside assistant, ${via.client.replace(/ \(.*$/, "")}` : "an outside assistant"}.`,
    data: { step: "channel", via: "connector", connectorId: via.connector.connectorId, kitchen: via.kitchen.slug, client: via.client, tool },
  });
}

// ---------- tools ----------

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

/**
 * One tool of the published table, run for a session that is already authenticated (and admitted). The MCP door and
 * the kitchen's own on-site agent (server/thread/tools.ts) both come through here, so the store's agent is one more
 * client of the same tools and the same gate. Throws DockError on a refusal; the caller shapes it.
 */
export async function callTool(rt: Runtime, session: AgentSession, tool: DockTool, args: unknown, human: HumanChannel = { canAsk: false }, defaultBy?: string): Promise<Record<string, unknown> | AskHuman> {
  const agentKey = `${session.mandate.issuer.orgId}:${session.agentId}`;
  const run = tool.run as (ctx: Parameters<DockTool["run"]>[0], args: unknown) => Promise<Record<string, unknown> | AskHuman>;
  return run({ dock: rt.dock, session, guard: guardFor(rt), agentKey, human, defaultBy }, args);
}

/**
 * Authenticate the caller, run one tool, and shape the result. Never throws a DockError.
 * Through a connector address the credential is the kitchen's own mandate and agent id, held on the server; the
 * request's headers are ignored. The call is then counted against the address's limits and, when it opens a
 * request, the ledger records that it came through the connector.
 */
export async function runTool(
  rt: Runtime,
  req: Request | undefined,
  tool: DockTool,
  args: unknown,
  human: HumanChannel = { canAsk: false },
  via?: ConnectorCall,
): Promise<ToolResult> {
  const { dock } = rt;
  let agentId = req?.headers.get("dock-agent-id") ?? "unknown";
  try {
    const session = await authenticate(via ? connectorCredentials(via) : (req ?? new Request("http://dock.invalid/")), dock);
    agentId = session.agentId;
    session.door = via ? "connector" : "mcp"; // which door a request it opens came through (core/orders.ts Door)
    const counted = via && COUNTED[tool.name];
    if (via && counted) via.service.limiter.hit(via.connector.connectorId, counted);
    const out = await callTool(rt, session, tool, args, human, via && `${via.kitchen.by}, through the kitchen's connector`);
    if (out instanceof AskHuman) return out.result;
    // A client that cannot ask the buyer itself: hand the buyer Dock's own one-time answer page (server/answer-links.ts).
    const step = out.step as IntakeView | undefined;
    if (!human.canAsk && step && needsBuyer(step.state)) {
      const answerUrl = answerLinkFor(session, step, publicBaseUrl(req));
      if (answerUrl) Object.assign(out, { answerUrl, nextStep: nextStepForIntake(step, "mcp", answerUrl) });
    }
    if (via && counted === "requests") {
      const requestId = (out.step as { requestId?: string } | undefined)?.requestId ?? (out.request as { requestId?: string } | undefined)?.requestId;
      if (requestId) logChannel(rt, via, session.agentId, requestId, tool.name);
    }
    return result({ ok: true, ...out });
  } catch (err) {
    if (!(err instanceof DockError)) throw err; // the SDK turns it into a generic tool error
    const requestId = (args as { requestId?: string } | undefined)?.requestId;
    if (err.code === "live_lookup_budget_exceeded") {
      dock.ledger.append({ type: "refusal", actor: `agent:${agentId}`, requestId, summary: `Refused: ${err.message}`, data: { code: err.code, rule: err.rule, status: err.status, ...(via ? { via: "connector", connectorId: via.connector.connectorId } : {}) } });
    } else if (err.code === "connector_rate_limited" && via) {
      logConnectorRefusal(rt, `${via.connector.connectorId}:${String(err.details?.kind)}`, {
        actor: `agent:${agentId}`,
        requestId,
        summary: `Refused: ${err.message}`,
        data: { code: err.code, rule: err.rule, status: err.status, via: "connector", connectorId: via.connector.connectorId, ...err.details },
      });
    }
    return refusal(err);
  }
}

type JsonSchemaHook = { input: (o: unknown) => Record<string, unknown>; output: (o: unknown) => Record<string, unknown> };
const dropDialect = ({ $schema: _, ...rest }: Record<string, unknown>) => (void _, rest);

/**
 * The tool schemas as published, without the `$schema` keyword zod adds. MCP's default dialect is already JSON Schema
 * 2020-12, and some clients' validators (Gemini CLI 0.25, with Ajv's draft-07 default) refuse every call to a tool
 * whose schema names a dialect they do not know. Validation stays with zod; only the published JSON changes.
 */
export function published<T extends z.ZodType>(schema: T, opts: { shallow?: boolean } = {}): T {
  const std = schema["~standard"] as T["~standard"] & { jsonSchema?: JsonSchemaHook };
  if (!std.jsonSchema) return schema;
  const out = (o: unknown) => dropDialect(std.jsonSchema!.output(o));
  const jsonSchema: JsonSchemaHook = { input: (o) => dropDialect(std.jsonSchema!.input(o)), output: opts.shallow ? (o) => shallowSchema(out(o)) : out };
  const standard = { ...std, jsonSchema };
  return new Proxy(schema, { get: (target, key, receiver) => (key === "~standard" ? standard : Reflect.get(target, key, receiver)) });
}

/**
 * A tool's output schema as published: the top-level fields with their descriptions, and one level of their shape
 * (an intake step's `state` and `requestId`, an order's `status`), every deeper value just its type. Some runtimes
 * (Google ADK) hand each tool's output schema to their model on every call; the full nested schemas made tools/list
 * about 109 KB of output schema, which multiplied every run's cost. The full shapes stay in the OpenAPI document
 * (/api/v1/openapi.json) and zod still checks every result Dock returns.
 */
export function shallowSchema(s: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const keep = (x: Record<string, unknown>): Record<string, unknown> => {
    const t = x.type;
    if (x.anyOf || x.oneOf) return {}; // any value: a union's branches are documented in the OpenAPI document
    if (t === "array") return { type: "array" };
    if (t === "object") return { type: "object" };
    return { ...(t ? { type: t } : {}), ...(x.enum ? { enum: x.enum } : {}), ...(x.const !== undefined ? { const: x.const } : {}) };
  };
  if (s.type !== "object" || !s.properties) return depth === 0 ? s : keep(s);
  const props = s.properties as Record<string, Record<string, unknown>>;
  const properties = Object.fromEntries(
    Object.entries(props).map(([k, v]) => {
      const inner = depth < 1 ? shallowSchema(v, depth + 1) : keep(v);
      return [k, depth === 0 && typeof v.description === "string" ? { ...inner, description: v.description } : inner];
    }),
  );
  return { type: "object", properties, ...(depth === 0 && Array.isArray(s.required) ? { required: s.required } : {}) };
}

export function buildMcpServer(rt: Runtime, req?: Request, via?: ConnectorCall): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: published(tool.input),
        outputSchema: published(tool.output.extend({ ok: z.literal(true) }).loose(), { shallow: true }), // loose: new fields must not break clients; shallow: see shallowSchema
        annotations: { title: tool.title, readOnlyHint: tool.readOnly ?? false, destructiveHint: false, idempotentHint: tool.readOnly ?? false, openWorldHint: false },
        ...("humanInput" in tool && tool.humanInput
          ? { _meta: { [HUMAN_INPUT_META]: { required: true, from: "buyer", how: "elicitation (input_required) when the client supports it, else the agent relays the buyer's own answer" } } }
          : {}),
      },
      (args: unknown, ctx: ServerContext) => runTool(rt, req, tool, args, humanChannel(ctx), via),
    );
  }
  return server;
}

const handler = createMcpHandler(async ({ requestInfo }) => buildMcpServer(await getRuntime(), requestInfo), {
  onerror: (err) => console.error("[mcp]", err.message),
});

const CONNECTOR_AUTH = "dock-connector";
const connectorHandler = createMcpHandler(
  async ({ requestInfo, authInfo }) => buildMcpServer(await getRuntime(), requestInfo, authInfo?.clientId === CONNECTOR_AUTH ? (authInfo.extra?.call as ConnectorCall) : undefined),
  { onerror: (err) => console.error("[mcp connector]", err.message), maxRequestBodySize: 256 * 1024 },
);

const sameSite = (req: Request) => originValidationResponse(req, [...localhostAllowedOrigins(), new URL(req.url).hostname]);

/**
 * The /api/mcp endpoint. Browsers may only call it from this site or localhost (DNS-rebinding guard the
 * spec asks for); non-browser agents send no Origin and pass.
 */
export async function serveMcp(req: Request): Promise<Response> {
  return sameSite(req) ?? handler.fetch(req);
}

/** A JSON-RPC error with an HTTP status. Never 401: a 401 makes Claude and ChatGPT start an OAuth sign-in. */
function connectorError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message, data: errorBody(code, message).error } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

const GONE: Record<"unknown" | "revoked" | "expired", string> = {
  unknown: "There is no AimoPilot connector at this address. Check the address, or ask the kitchen for its current one.",
  revoked: "This AimoPilot connector address was revoked. Ask the kitchen for its new address.",
  expired: "This AimoPilot connector address has expired with its demo kitchen. Scan the code again for a new kitchen.",
};

/** The /api/mcp/c/<token> endpoint: the same MCP server, authenticated by the connector address. */
export async function serveConnector(req: Request, token: string): Promise<Response> {
  const blocked = sameSite(req);
  if (blocked) return blocked;
  const rt = await getRuntime();
  const service = connectorsFor(rt);
  const found = await service.resolve(token);
  if (!found.ok) {
    if (found.connectorId && found.kitchen) {
      const k = await connectorKitchen(found.kitchen);
      if (k) {
        logConnectorRefusal(rt, `${found.connectorId}:${found.reason}`, {
          actor: `agent:${k.agentId}`,
          summary: `Refused: ${k.name}'s ${found.reason} connector address (${found.connectorId}) was used.`,
          data: { code: `connector_${found.reason}`, rule: "connector_address", status: 404, via: "connector", connectorId: found.connectorId, client: clientOf(req) },
        });
      }
    }
    return connectorError(404, `connector_${found.reason}`, GONE[found.reason]);
  }
  try {
    service.limiter.hit(found.connector.connectorId, "http");
  } catch (err) {
    if (!(err instanceof DockError)) throw err;
    logConnectorRefusal(rt, `${found.connector.connectorId}:http`, {
      actor: `agent:${found.kitchen.agentId}`,
      summary: `Refused: ${err.message}`,
      data: { code: err.code, rule: err.rule, status: 429, via: "connector", connectorId: found.connector.connectorId, client: clientOf(req) },
    });
    return connectorError(429, err.code, err.message, { "retry-after": String(err.details?.retryAfterSeconds ?? 60) });
  }
  const call: ConnectorCall = { connector: found.connector, kitchen: found.kitchen, service, client: clientOf(req) };
  const authInfo: AuthInfo = { token: found.connector.connectorId, clientId: CONNECTOR_AUTH, scopes: [], extra: { call } };
  return connectorHandler.fetch(req, { authInfo });
}

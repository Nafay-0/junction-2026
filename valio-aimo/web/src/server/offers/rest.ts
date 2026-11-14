import { DockError, type AgentSession } from "@/core/orders";
import { authenticate, readJson } from "../http";
import { callTool } from "../mcp/server";
import { OFFER_TOOLS } from "../mcp/offer-tools";
import type { DockTool } from "../mcp/tools";
import type { Runtime } from "../runtime";

/**
 * REST /api/v1/offers: the same four operations as the MCP offer tools (mcp/offer-tools.ts), run through the same
 * code with the agent's mandate. A body is optional where every field is.
 */
export async function restOffer(rt: Runtime, req: Request, name: (typeof OFFER_TOOLS)[number]["name"], args: Record<string, unknown> = {}, opts: { body?: boolean; withSession?: (session: AgentSession, out: Record<string, unknown>) => Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
  const session = await authenticate(req, rt.dock);
  const tool = OFFER_TOOLS.find((t) => t.name === name)!;
  const raw = opts.body && req.body ? await req.text() : "";
  const body = raw.trim() ? ((await readJson(new Request(req.url, { method: "POST", body: raw }))) as Record<string, unknown>) : {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new DockError(400, "invalid_request", "The body must be a JSON object.");
  const parsed = tool.input.safeParse({ ...body, ...args });
  if (!parsed.success) throw new DockError(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const out = (await callTool(rt, session, tool as unknown as DockTool, parsed.data)) as Record<string, unknown>;
  return opts.withSession ? opts.withSession(session, out) : out;
}

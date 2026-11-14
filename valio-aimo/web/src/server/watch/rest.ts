import { DockError } from "@/core/orders";
import { authenticate, readJson } from "../http";
import { callTool } from "../mcp/server";
import type { DockTool } from "../mcp/tools";
import { WATCH_TOOLS } from "../mcp/watch-tools";
import type { Runtime } from "../runtime";

/** REST /api/v1/watch: the same three operations as the MCP watch tools (mcp/watch-tools.ts), through the same code. */
export async function restWatch(rt: Runtime, req: Request, name: (typeof WATCH_TOOLS)[number]["name"], args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await authenticate(req, rt.dock);
  const tool = WATCH_TOOLS.find((t) => t.name === name)!;
  const raw = req.method === "POST" && req.body ? await req.text() : "";
  const body = raw.trim() ? ((await readJson(new Request(req.url, { method: "POST", body: raw }))) as Record<string, unknown>) : {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new DockError(400, "invalid_request", "The body must be a JSON object.");
  const parsed = tool.input.safeParse({ ...body, ...args });
  if (!parsed.success) throw new DockError(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return (await callTool(rt, session, tool as unknown as DockTool, parsed.data)) as Record<string, unknown>;
}

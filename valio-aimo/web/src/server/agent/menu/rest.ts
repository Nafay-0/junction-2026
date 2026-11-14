import { DockError } from "@/core/orders";
import { authenticate, readJson } from "../../http";
import { MENU_TOOLS } from "../../mcp/menu-tools";
import { callTool } from "../../mcp/server";
import type { DockTool } from "../../mcp/tools";
import type { Runtime } from "../../runtime";

/** REST /api/v1/menus: the same three operations as the MCP menu tools (mcp/menu-tools.ts), through the same code with the agent's mandate. */
export async function restMenu(rt: Runtime, req: Request, name: (typeof MENU_TOOLS)[number]["name"], args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await authenticate(req, rt.dock);
  const tool = MENU_TOOLS.find((t) => t.name === name)!;
  const raw = req.body ? await req.text() : "";
  const body = raw.trim() ? ((await readJson(new Request(req.url, { method: "POST", body: raw }))) as Record<string, unknown>) : {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new DockError(400, "invalid_request", "The body must be a JSON object.");
  const parsed = tool.input.safeParse({ ...body, ...args });
  if (!parsed.success) throw new DockError(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return (await callTool(rt, { ...session, door: "rest" }, tool as unknown as DockTool, parsed.data)) as Record<string, unknown>;
}

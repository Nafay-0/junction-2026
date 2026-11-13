import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { serveMcp } from "@/server/mcp/server";

/**
 * How the buyer agent reaches Dock: through the MCP endpoint, exactly as any outside agent does. The tool
 * list comes from the server at connect time, so tools added to Dock's table appear here with no change.
 *
 * In-process (default) the transport's fetch calls the /api/mcp route handler directly; with a base URL
 * it goes over the network to `${baseUrl}/api/mcp`.
 */

export type DockTool = { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; meta?: Record<string, unknown> };

export type ToolOutcome = {
  /** False when Dock refused or the call failed. */
  ok: boolean;
  /** Dock's structured result: `{ ok: true, ... }` or `{ ok: false, error: { code, rule, message }, nextStep }`. */
  structured?: Record<string, unknown>;
  /** The text content, which is what a model sees when there is no structured result (e.g. bad arguments). */
  text: string;
};

export interface DockConnection {
  readonly instructions?: string;
  tools(): DockTool[];
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  close(): Promise<void>;
}

export type Credentials = { mandate: string; agentId: string };

export type DockTarget = { baseUrl?: string };

export async function connectDock(creds: Credentials, target: DockTarget = {}): Promise<DockConnection> {
  const base = target.baseUrl ?? "http://dock.local";
  const fetchImpl = target.baseUrl
    ? undefined
    : async (url: string | URL, init?: RequestInit) => serveMcp(new Request(url, init));
  const client = new Client({ name: "dock-buyer-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", base), {
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      requestInit: { headers: { authorization: `Bearer ${creds.mandate}`, "dock-agent-id": creds.agentId } },
    }),
  );
  const tools: DockTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of page.tools) tools.push({ name: t.name, title: t.title, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown>, meta: t._meta as Record<string, unknown> | undefined });
    cursor = page.nextCursor;
  } while (cursor);

  return {
    instructions: client.getInstructions(),
    tools: () => tools,
    async call(name, args) {
      try {
        const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
        const text = r.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
        const structured = r.structuredContent as Record<string, unknown> | undefined;
        return { ok: !r.isError && structured?.ok !== false, structured, text };
      } catch (err) {
        // The client refused the call (e.g. a result that does not match the tool's output schema) or the transport failed.
        return { ok: false, text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    close: () => client.close(),
  };
}

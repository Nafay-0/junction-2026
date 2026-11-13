import { serveConnector } from "@/server/mcp/server";

/**
 * MCP over Streamable HTTP for assistants that can only be given a URL: /api/mcp/c/<token>, a kitchen's connector
 * address. The same server as /api/mcp, authenticated by the address. See src/server/mcp/connectors.ts.
 */
async function serve(req: Request, ctx: RouteContext<"/api/mcp/c/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  return serveConnector(req, token);
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;

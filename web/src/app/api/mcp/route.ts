import { serveMcp } from "@/server/mcp/server";

/** MCP over Streamable HTTP. See src/server/mcp/server.ts and docs/connect-an-agent.md. */
export const GET = serveMcp;
export const POST = serveMcp;
export const DELETE = serveMcp;

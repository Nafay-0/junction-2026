import { manifest } from "@/server/discovery";

/** Dock's own manifest (not a standard): where the MCP endpoint, OpenAPI document and keys are, and how mandates work. */
export async function GET(req: Request) {
  return Response.json(manifest(new URL(req.url).origin), { headers: { "access-control-allow-origin": "*" } });
}

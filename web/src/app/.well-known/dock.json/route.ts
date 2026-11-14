import { publicBaseUrl } from "@/server/config";
import { manifest } from "@/server/discovery";

/** Dock's own manifest (not a standard): where the MCP endpoint, OpenAPI document and keys are, and how mandates work. */
// Links carry the public address (DOCK_PUBLIC_URL): behind the host's proxy, req.url is the container's own (0.0.0.0).
export async function GET(req: Request) {
  return Response.json(manifest(publicBaseUrl(req)), { headers: { "access-control-allow-origin": "*" } });
}

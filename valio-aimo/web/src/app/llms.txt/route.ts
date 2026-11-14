import { publicBaseUrl } from "@/server/config";
import { llmsTxt } from "@/server/discovery";

/** llms.txt (llmstxt.org): a Markdown brief for coding agents. */
// Links carry the public address (DOCK_PUBLIC_URL): behind the host's proxy, req.url is the container's own (0.0.0.0).
export async function GET(req: Request) {
  return new Response(llmsTxt(publicBaseUrl(req)), { headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" } });
}

import { llmsTxt } from "@/server/discovery";

/** llms.txt (llmstxt.org): a Markdown brief for coding agents. */
export async function GET(req: Request) {
  return new Response(llmsTxt(new URL(req.url).origin), { headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" } });
}

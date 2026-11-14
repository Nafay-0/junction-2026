import { publicDoc, readDoc } from "@/server/docs";

/** /docs/raw/<slug>.md: a served document as Markdown, for agents and for anyone who wants the source. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const doc = file.endsWith(".md") ? publicDoc(file.slice(0, -3)) : undefined;
  const text = doc && readDoc(doc);
  if (!doc || text === undefined) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}

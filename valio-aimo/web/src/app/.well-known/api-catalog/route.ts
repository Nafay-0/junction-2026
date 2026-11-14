import { API_CATALOG_TYPE, apiCatalog } from "@/server/discovery";

/** RFC 9727 API catalog: the entry point for an agent that knows only the base URL. */
const link = (origin: string) => `<${origin}/.well-known/api-catalog>; rel="api-catalog"`;
const CORS = { "access-control-allow-origin": "*" };

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  return new Response(JSON.stringify(apiCatalog(origin), null, 2), { headers: { "content-type": API_CATALOG_TYPE, link: link(origin), ...CORS } });
}

export async function HEAD(req: Request) {
  const { origin } = new URL(req.url);
  return new Response(null, { headers: { "content-type": API_CATALOG_TYPE, link: link(origin), ...CORS } });
}

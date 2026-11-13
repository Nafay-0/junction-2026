import { buildOpenApi } from "@/server/openapi";

/** OpenAPI 3.1 description of the REST API, generated from the zod schemas. */
export async function GET(req: Request) {
  return Response.json(buildOpenApi(new URL(req.url).origin), { headers: { "access-control-allow-origin": "*" } });
}

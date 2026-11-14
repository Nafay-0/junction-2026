import { buildOpenApi } from "@/server/openapi";

/** OpenAPI 3.1 description of the REST API, generated from the zod schemas. `?audience=agent`: without the approver operations. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json(buildOpenApi(url.origin, url.searchParams.get("audience") === "agent" ? { audience: "agent" } : {}), { headers: { "access-control-allow-origin": "*" } });
}

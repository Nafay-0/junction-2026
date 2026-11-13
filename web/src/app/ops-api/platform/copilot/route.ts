import { DockError } from "@/core/errors";
import { readJson } from "@/server/http";
import { opsRoute } from "@/server/ops/handler";
import { mcpStatus } from "@/server/aiven/showcase/aiven-mcp";
import { SUGGESTIONS, ask } from "@/server/aiven/showcase/copilot";
import { readOnlyDbConfigured } from "@/server/aiven/showcase/readonly-db";
import { platformRoute } from "@/server/aiven/showcase/routes";

/** GET /ops-api/platform/copilot: which paths can answer (Aiven MCP, the direct read-only path) and suggested questions. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff);
    return Response.json({ mcp: await mcpStatus(new URL(req.url).searchParams.has("recheck")), direct: readOnlyDbConfigured(), suggestions: SUGGESTIONS });
  });
}

/** POST /ops-api/platform/copilot { question }: one answer card, computed from data on Aiven, with the queries and rows. */
export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "copilot", limit: 20, windowMs: 60_000 });
    const body = (await readJson(req, 8 * 1024)) as { question?: unknown };
    if (typeof body?.question !== "string") throw new DockError(400, "question_missing", "Send { question: \"...\" }.");
    return Response.json(await ask(body.question));
  });
}

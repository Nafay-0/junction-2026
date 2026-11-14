import { DockError } from "@/core/errors";
import { readJson } from "@/server/http";
import { opsRead, opsTry } from "@/server/ops/handler";
import { mcpStatus } from "@/server/aiven/showcase/aiven-mcp";
import { SUGGESTIONS, ask } from "@/server/aiven/showcase/copilot";
import { readOnlyDbConfigured } from "@/server/aiven/showcase/readonly-db";
import { platformRoute } from "@/server/aiven/showcase/routes";

/** GET /ops-api/platform/copilot: which paths can answer (Aiven MCP, the direct read-only path) and suggested questions. */
export async function GET(req: Request) {
  return opsRead(req, async (rt, staff) => {
    platformRoute(rt, staff);
    return Response.json({ mcp: await mcpStatus(!staff.viewer && new URL(req.url).searchParams.has("recheck")), direct: readOnlyDbConfigured(), suggestions: SUGGESTIONS });
  });
}

/**
 * POST /ops-api/platform/copilot { question }: one answer card, computed from data on Aiven, with the queries and rows.
 * A visitor may try it (opsTry, door copilot: 20 an hour per address, 400 a day for all visitors). No model is called.
 */
export async function POST(req: Request) {
  return opsTry(req, "copilot", async (rt, staff) => {
    platformRoute(rt, staff, { name: "copilot", limit: 20, windowMs: 60_000 });
    const body = (await readJson(req, 8 * 1024)) as { question?: unknown };
    if (typeof body?.question !== "string") throw new DockError(400, "question_missing", "Send { question: \"...\" }.");
    return Response.json(await ask(body.question));
  });
}

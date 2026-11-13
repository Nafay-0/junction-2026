import { z } from "zod";
import { parse } from "@/core/errors";
import { menuMode } from "@/server/agent/menu/runtime";
import { handle, readJson } from "@/server/http";
import { withKitchen } from "../_shared";

/**
 * GET  /ui-api/plan/{kitchen}            the kitchen, its rules and examples, and whether a model is configured
 * POST /ui-api/plan/{kitchen}  { text }  a menu plan from the chef's words (about 15 to 20 seconds with a model)
 */
const Body = z.object({ text: z.string().trim().min(3).max(4000) });

export async function GET(_req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]">) {
  return handle(async () => {
    const { kitchen } = await withKitchen((await ctx.params).kitchen);
    return Response.json({ kitchen: kitchen.info, mode: menuMode() }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]">) {
  return handle(async () => {
    const { service, kitchen, reply } = await withKitchen((await ctx.params).kitchen);
    const { text } = parse(Body, await readJson(req));
    return reply(await service.plan(kitchen, text, kitchen.info.by), 201);
  });
}

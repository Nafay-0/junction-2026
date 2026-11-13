import { z } from "zod";
import { parse } from "@/core/errors";
import { handle, readJson } from "@/server/http";
import { withKitchen } from "../../_shared";

/**
 * GET  /ui-api/plan/{kitchen}/{planId}              the plan as it is now (proposals arrive a few seconds after the plan)
 * POST /ui-api/plan/{kitchen}/{planId}  { edits }   the chef's edits, applied by plain code: no model call
 */
const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("covers"), covers: z.number().int() }),
  z.object({ op: z.literal("deliverBy"), date: z.string() }),
  z.object({ op: z.literal("strike"), lineId: z.string(), struck: z.boolean() }),
  z.object({ op: z.literal("perCover"), lineId: z.string(), dishId: z.string(), amount: z.number(), unit: z.enum(["g", "ml", "pcs"]).optional() }),
  z.object({ op: z.literal("price") }),
  z.object({ op: z.literal("yield"), lineId: z.string(), yieldPct: z.number() }),
  z.object({ op: z.literal("choose"), lineId: z.string(), optionId: z.string() }),
  z.object({ op: z.literal("accept"), doubtId: z.string() }),
  z.object({ op: z.literal("applyFix"), lineId: z.string(), fixId: z.string() }),
]);
const Body = z.object({ edits: z.array(Edit).min(1).max(50) });

export async function GET(_req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/[planId]">) {
  return handle(async () => {
    const { kitchen: slug, planId } = await ctx.params;
    const { service, kitchen, reply } = await withKitchen(slug);
    return reply(await service.get(kitchen, planId));
  });
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/[planId]">) {
  return handle(async () => {
    const { kitchen: slug, planId } = await ctx.params;
    const { service, kitchen, reply } = await withKitchen(slug);
    const { edits } = parse(Body, await readJson(req));
    return reply(await service.edit(kitchen, planId, edits, kitchen.info.by));
  });
}

import { z } from "zod";
import { parse } from "@/core/errors";
import { handle, readJson } from "@/server/http";
import { withKitchen } from "../../_shared";

/**
 * POST /ui-api/plan/{kitchen}/list  { items: [{ item, amount, unit }], deliverBy?, source? }
 * A list of plain items (the photo door's reviewed lines, a pasted order) as one plan: one quote, one order, at most
 * one sign-off. No model: every amount is the one written. Pack counts ("4 packs") are returned in `notPlanned`, to be
 * sent one by one, because their amount depends on the product's pack.
 */
const Body = z.object({
  items: z.array(z.object({ item: z.string().trim().min(1).max(120), amount: z.number().positive().max(100_000), unit: z.string().trim().min(1).max(20) })).min(1).max(40),
  deliverBy: z.iso.date().optional(),
  source: z.enum(["image", "pdf", "text"]).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/list">) {
  return handle(async () => {
    const { service, kitchen, reply } = await withKitchen((await ctx.params).kitchen);
    const body = parse(Body, await readJson(req));
    const r = await service.planItems(kitchen, body.items, kitchen.info.by, { deliverBy: body.deliverBy, source: body.source, door: "photo" });
    const res = reply(r, 201);
    const wire = (await res.json()) as Record<string, unknown>;
    return Response.json({ ...wire, notPlanned: r.notPlanned }, { status: 201, headers: { "cache-control": "no-store" } });
  });
}

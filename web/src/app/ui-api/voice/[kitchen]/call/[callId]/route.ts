import { z } from "zod";
import { parse } from "@/core/errors";
import { getOrder, kitchenAgent } from "@/server/channels/flow";
import { orderForModel } from "@/server/channels/say";
import { calls } from "@/server/channels/voice/calls";
import { handle, readJson } from "@/server/http";

/**
 * POST /ui-api/voice/{kitchen}/call/{callId}
 *   { op: "beat", usage?, grounding? }   the call screen is still there (every 10 s); frees the line when it stops
 *   { op: "end", reason }               hang up
 *   { op: "dropped", said, kinds }      the grounding check cut off something the agent said; written to the ledger
 *   { op: "order" }                     where the call's order stands (the screen polls this while it waits for sign-off)
 */
const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("beat"),
    usage: z.object({ audioInSeconds: z.number().min(0), audioOutSeconds: z.number().min(0), promptTokens: z.number().min(0), responseTokens: z.number().min(0) }).optional(),
    grounding: z.object({ checked: z.number().int().min(0), dropped: z.number().int().min(0) }).optional(),
  }),
  z.object({ op: z.literal("end"), reason: z.string().max(80).default("hung up") }),
  z.object({ op: z.literal("dropped"), said: z.string().max(300), kinds: z.array(z.string().max(20)).max(10) }),
  z.object({ op: z.literal("order") }),
]);

export async function POST(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call/[callId]">) {
  return handle(async ({ dock }) => {
    const { kitchen, callId } = await ctx.params;
    const body = parse(Body, await readJson(req));
    const registry = calls();
    if (body.op === "end") {
      const c = registry.end(callId, kitchen, body.reason);
      return Response.json({ ended: !!c });
    }
    if (body.op === "order") {
      const c = registry.heartbeat(callId, kitchen);
      if (!c.desk.orderId) return Response.json({ order: null });
      const order = await getOrder(await kitchenAgent(kitchen), c.desk.orderId);
      return Response.json({ order, forModel: orderForModel(order) }, { headers: { "cache-control": "no-store" } });
    }
    const c = registry.heartbeat(callId, kitchen, body.op === "beat" ? { usage: body.usage, grounding: body.grounding } : undefined);
    if (body.op === "dropped") {
      c.grounding.dropped += 1;
      if (c.desk.requestId) {
        dock.ledger.append({
          type: "intake",
          actor: "door:voice",
          requestId: c.desk.requestId,
          summary: `The voice door cut off the agent: it said ${body.said.slice(0, 120)}, which no tool result in the call contained (${body.kinds.join(", ")}). It was told to take it back.`,
          data: { step: "grounding_check", door: "voice", said: body.said, kinds: body.kinds, callId },
        });
      }
    }
    return Response.json({ ok: true, expiresAt: new Date(c.expiresAt).toISOString() }, { headers: { "cache-control": "no-store" } });
  });
}

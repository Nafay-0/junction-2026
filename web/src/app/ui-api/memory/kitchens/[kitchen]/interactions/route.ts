import { z } from "zod";
import { body, kitchenMemoryRoute } from "@/server/memory/http";
import type { InteractionEvent } from "@/server/memory/model";

/**
 * POST /ui-api/memory/kitchens/{kitchen}/interactions
 *   { door, segments: [{ id, source, text }], events?: [...], site?, requestId?, orderId? }
 *
 * Every door feeds the writer here: typed requests, voice transcripts, text read from photos (source
 * "photo_text"), product text shown (source "product_text": never evidence), option choices, substitutes accepted
 * or declined, answers. Returns what was learned, what was refused and why, and any one-line question to ask.
 */
const Body = z.object({
  door: z.enum(["typed", "voice", "photo", "option_choice", "concern_response", "substitute", "answer", "memory_page", "order"]),
  segments: z.array(z.object({ id: z.string().min(1).max(40), source: z.enum(["buyer", "transcript", "photo_text", "product_text", "system"]), text: z.string().max(4000) })).max(20).default([]),
  events: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
  site: z.string().min(1).max(80).optional(),
  requestId: z.string().min(1).max(80).optional(),
  orderId: z.string().min(1).max(80).optional(),
});

const EVENT_TYPES = new Set(["option_chosen", "substitute", "concern_response", "answer", "order_committed"]);

export async function POST(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]/interactions">) {
  return kitchenMemoryRoute(req, ctx.params, async (k, memory) => {
    const b = await body(req, Body);
    // A rule can only be stated through the memory page's own action, never slipped in as an event here.
    const events = b.events.filter((e) => EVENT_TYPES.has(String(e.type))) as unknown as InteractionEvent[];
    return memory.write(k.info.orgId, { ...b, events, by: k.info.by }, k.info.name);
  });
}

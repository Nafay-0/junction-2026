import { z } from "zod";
import { body, staffMemoryRoute } from "@/server/memory/http";

/**
 * POST /ui-api/memory/wholesaler/proposals  { orgId, itemId?, text, fact? }
 *   Staff propose a correction to a kitchen's shared memory ("peanuts are a separate allergen: add them?"). It
 *   changes nothing until the kitchen accepts it on its memory page. A proposal can point at a shared item only.
 */
const Body = z.object({ orgId: z.string().min(1).max(80), itemId: z.string().min(1).max(80).optional(), text: z.string().trim().min(1).max(300), fact: z.record(z.string(), z.unknown()).optional() });

export async function POST(req: Request) {
  return staffMemoryRoute(req, async (staff, memory) => {
    const b = await body(req, Body);
    return { proposal: await memory.staffPropose(staff.name, b.orgId, b) };
  });
}

import { staffMemoryRoute } from "@/server/memory/http";

/**
 * GET /ui-api/memory/wholesaler[?kitchen=<orgId>]
 *   For the wholesaler's staff (an operations-portal session): what kitchens chose to share, across kitchens or
 *   for one, with the same provenance the kitchen sees. Read-only. Private items never appear. Every read is
 *   recorded in the kitchen's memory, so the kitchen can see when its memory was looked at.
 */
export async function GET(req: Request) {
  return staffMemoryRoute(req, (staff, memory) => {
    const kitchen = new URL(req.url).searchParams.get("kitchen")?.trim();
    return memory.staffView(staff.name, kitchen ? [kitchen.slice(0, 80)] : undefined);
  });
}

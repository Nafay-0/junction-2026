import { clientAddress } from "@/server/limits";
import { opsRead } from "@/server/ops/handler";
import { TRY_DOORS, tryCaps, type TryDoorId, type TryRoom, type TryStatus } from "@/server/ops/try-caps";

/**
 * GET /ops-api/platform/try: what this address may still try on the Platform pages without the passcode (the opsTry
 * door, server/ops/try-caps.ts), each with its limit, what is left and when it frees up. Per address, so never shared.
 */
export async function GET(req: Request) {
  return opsRead(
    req,
    async (_rt, who) => {
      const addr = clientAddress(req.headers);
      const doors = Object.fromEntries(TRY_DOORS.map((d) => [d, tryCaps().room(d, addr)])) as Record<TryDoorId, TryRoom>;
      return Response.json({ staff: !who.viewer, doors } satisfies TryStatus);
    },
    { shareMs: 0 },
  );
}

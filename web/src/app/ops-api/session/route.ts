import { DockError } from "@/core/orders";
import { currentOps, enterOps, leaveOps, opsMode, sessionCookie } from "@/server/ops/access";
import { handle, readJson } from "@/server/http";
import { suspensions } from "@/server/ops/suspensions";
import { getRuntime } from "@/server/runtime";
import { dailyUsage } from "@/server/limits";

/**
 * The operations portal's entry. GET: am I in, and does entering need a passcode. POST { passcode?, name? }: enter
 * (sets the HttpOnly session cookie). DELETE: leave. Not part of the public API.
 */
export async function GET(req: Request) {
  const s = currentOps(req);
  if (!s) return Response.json({ signedIn: false, mode: opsMode() }, { headers: { "cache-control": "no-store" } });
  // The rail's badges: is the chain intact, how many sign-offs wait, how many suspensions are in force.
  const rt = await getRuntime();
  const v = rt.dock.ledger.verify();
  const waiting = (await rt.dock.listPendingApprovals()).length;
  return Response.json(
    { signedIn: true, name: s.name, mode: opsMode(), chain: { ok: v.ok, length: v.ok ? v.length : rt.dock.ledger.readonly().length }, waiting, suspended: suspensions(rt.dock).active().length, models: dailyUsage().llm },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as { passcode?: unknown; name?: unknown };
    if (body.passcode !== undefined && typeof body.passcode !== "string") throw new DockError(400, "invalid_request", "passcode must be a string.");
    const s = enterOps({ passcode: body.passcode as string | undefined, name: typeof body.name === "string" ? body.name : undefined });
    return Response.json({ signedIn: true, name: s.name, mode: opsMode() }, { headers: { "set-cookie": sessionCookie(req, s), "cache-control": "no-store" } });
  });
}

export async function DELETE(req: Request) {
  leaveOps(req);
  return Response.json({ signedIn: false, mode: opsMode() }, { headers: { "set-cookie": sessionCookie(req, null), "cache-control": "no-store" } });
}

import { DockError } from "@/core/orders";
import { currentOps, enterOps, leaveOps, opsMode, sessionCookie } from "@/server/ops/access";
import { handle, readJson } from "@/server/http";
import { suspensions } from "@/server/ops/suspensions";
import { getRuntime } from "@/server/runtime";
import { dailyUsage } from "@/server/limits";
import { hidesSample, viewAs } from "@/server/alive/clock";

/**
 * The operations portal's entry. GET: am I staff (signedIn) or a viewer, and does entering need a passcode. POST { passcode?, name? }: enter
 * (sets the HttpOnly session cookie). DELETE: leave. Not part of the public API.
 */
export async function GET(req: Request) {
  const s = currentOps(req);
  // The rail's badges, for staff and viewers alike: is the chain intact, how many sign-offs wait, how many suspensions
  // are in force. A viewer (no passcode) is looking, not operating: `viewer: true`, and every action answers 403.
  const rt = await getRuntime();
  const v = rt.dock.ledger.verify();
  // Without the sample activity for a viewer who hid it (server/alive).
  const waiting = (await viewAs({ hideSample: hidesSample(req.headers.get("cookie")) }, () => rt.dock.listPendingApprovals())).length;
  const badges = { chain: { ok: v.ok, length: v.ok ? v.length : rt.dock.ledger.readonly().length }, waiting, suspended: suspensions(rt.dock).active().length, models: dailyUsage().llm };
  if (!s) return Response.json({ signedIn: false, viewer: true, mode: opsMode(), ...badges }, { headers: { "cache-control": "no-store" } });
  return Response.json({ signedIn: true, name: s.name, mode: opsMode(), ...badges }, { headers: { "cache-control": "no-store" } });
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

import { readJson } from "@/server/http";
import { confirmAddress } from "@/server/notify/service";
import { getRuntime } from "@/server/runtime";

/**
 * POST { t } from the confirmation page (/mail/confirm): the kitchen confirms the address the link was sent to. A POST,
 * not the link itself, so a mail scanner that opens links cannot confirm an address for someone.
 */
export async function POST(req: Request) {
  const body = (await readJson(req).catch(() => ({}))) as { t?: unknown };
  const r = await confirmAddress(await getRuntime(), typeof body.t === "string" ? body.t : undefined);
  return Response.json(r.ok ? { ok: true, kitchenName: r.kitchenName, masked: r.masked } : r, { status: r.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}

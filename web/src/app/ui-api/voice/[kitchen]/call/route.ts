import { DockError } from "@/core/errors";
import { callLink } from "@/server/channels/call-links";
import { qrSvg } from "@/server/approval-links";
import { consoleKitchen } from "@/server/authz";
import { publicBaseUrl } from "@/server/config";
import { startCall } from "@/server/channels/voice/start";
import { resolveKitchen } from "@/server/console-kitchens";
import { handle, readJson } from "@/server/http";

/**
 * GET /ui-api/voice/{kitchen}/call  ->  { url, qrSvg }: where a phone talks to this kitchen's agent (the store's
 * "Talk on your phone" code). A visitor kitchen's URL is /call, which opens the kitchen's own conversation on the phone
 * that joined it; an account's kitchen's (the stage kitchens' too) is a one-time sign-in link to the same
 * conversation, /k/<kitchen>?talk=1, where the microphone starts the same hands-free conversation.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call">) {
  return handle(async (rt) => {
    const { kitchen } = await ctx.params;
    const k = await resolveKitchen(kitchen);
    if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
    if (k.info.kind === "visitor") {
      const link = await callLink(req);
      return Response.json({ url: link.url, qrSvg: link.qrSvg }, { headers: { "cache-control": "no-store" } });
    }
    // An account's kitchen (a stage kitchen's too): only its signed-in account gets the code, and the code signs the
    // phone in to that account once (a one-time link, 10 minutes), then opens the call.
    const own = await consoleKitchen(req, rt, kitchen);
    // Not from a phone that itself came in by a call code: a code is minted by the account's own sign-in only.
    if (own?.console.person?.callOnly) throw new DockError(403, "phone_session_limited", "A new call code needs the account's own sign-in. This phone was signed in by a call code.", "account");
    const signedIn = own?.console.person?.account;
    if (!signedIn) throw new DockError(403, "call_not_yours", "Only the kitchen's own signed-in account can call its agent from a phone.", "data_access");
    const { token } = await rt.accounts.oneTimeLink(signedIn, "session");
    const url = `${publicBaseUrl(req)}/k/handoff?t=${encodeURIComponent(token)}&next=${encodeURIComponent(`/k/${kitchen}?talk=1`)}`;
    return Response.json({ url, qrSvg: await qrSvg(url) }, { headers: { "cache-control": "no-store" } });
  });
}

/**
 * POST /ui-api/voice/{kitchen}/call  { carryFrom?: callId, avoid?: "gemini" | "openai", lang?: "en" | "fi" | "sv" }
 *
 * Starts a hands-free call with the kitchen's purchasing agent: reserves the kitchen's one line, and returns a one-use,
 * short-lived token for the voice model (Gemini Live or OpenAI Realtime, live.ts) with the setup made on this server.
 * `avoid`: the screen's first provider refused the session, so the other one is tried.
 * 409 line_busy, 429 call_limit, 403 call_not_yours, 503 voice_unavailable: the screen offers typing instead.
 * Not part of the public API: it is the call screen's own back end.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    const body = ((await readJson(req)) ?? {}) as { carryFrom?: string; avoid?: string; lang?: string };
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : undefined);
    const start = await startCall(req, kitchen, { carryFrom: str(body.carryFrom), avoid: str(body.avoid), lang: str(body.lang) });
    return Response.json(start, { status: 201, headers: { "cache-control": "no-store" } });
  });
}

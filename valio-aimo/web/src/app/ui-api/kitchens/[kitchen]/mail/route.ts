import { DockError } from "@/core/errors";
import { isLang, langFromCookie } from "@/app/_i18n/lang";
import { requireKitchenPerson } from "@/server/authz";
import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { addressOf, removeAddress, setAddress } from "@/server/notify/service";
import { getRuntime } from "@/server/runtime";
import { countConfirmSend } from "@/server/accounts/email";
import { clientAddress } from "@/server/limits";

/**
 * The kitchen's address for order emails (server/notify). Optional and the kitchen's own choice.
 *
 *   GET  -> { state: none | pending | confirmed | stopped | bounced, masked, address (only for the kitchen's own
 *           signed-in person), configured, testSenderOnly }
 *   POST { action: "set", address, lang? }  keeps it as pending and sends one confirmation mail (nothing else until it
 *                                           is confirmed); the kitchen's signed-in person only
 *   POST { action: "remove" }               stops the mails and deletes the address
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/mail">) {
  return portalRoute(req, ctx.params, async (k) => {
    const own = !!k.console?.person && !k.console.person.callOnly;
    return Response.json(await addressOf(await getRuntime(), k.info.orgId, { own }), noStore);
  });
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/mail">) {
  return portalRoute(req, ctx.params, async (k) => {
    requireKitchenPerson(k, "Changing where order emails go");
    const rt = await getRuntime();
    const body = (await readJson(req)) as Record<string, unknown>;
    const who = { by: k.console!.person!.name, via: "the store's Agent and rules page" };
    if (body.action === "set") {
      // Confirmation sends per client address (accounts/email.ts), beside the mail module's own cap per kitchen.
      countConfirmSend(clientAddress(req.headers));
      const lang = isLang(body.lang) ? body.lang : (langFromCookie(req.headers.get("cookie")) ?? "en");
      const r = await setAddress(rt, { orgId: k.info.orgId, slug: k.info.slug, name: k.info.name }, String(body.address ?? ""), { ...who, lang });
      return Response.json({ ...r.contact, confirmation: r.confirmation ? { outcome: r.confirmation.outcome, reason: r.confirmation.reason } : undefined }, noStore);
    }
    if (body.action === "remove") return Response.json(await removeAddress(rt, k.info.orgId, who), noStore);
    throw new DockError(400, "invalid_request", 'action must be "set" or "remove".');
  });
}

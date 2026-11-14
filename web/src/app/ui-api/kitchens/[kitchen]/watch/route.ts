import { DockError } from "@/core/errors";
import { requireKitchenPerson } from "@/server/authz";
import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { getRuntime } from "@/server/runtime";
import { setAutoRenew, watchForOrg } from "@/server/watch/service";
import { doorTurn } from "@/server/thread/engine";
import { showRules, signRules } from "@/server/thread/rules";
import { familyL } from "@/app/k/[kitchen]/family.text";

/**
 * GET /ui-api/kitchens/{kitchen}/watch: what the kitchen's agent's watch has for this kitchen (findings, renewals,
 * the learned recurring orders and their drift). Records only, no live call.
 * POST { action: "auto_renew", family, on, lang? }: switch auto-renew for a recurring order. The kitchen's own signed-in
 * person only, recorded with their name. Off is done at once. On lets the agent order without asking each time, so,
 * as in the conversation, it is not switched on here: it goes to the kitchen's approver as a change to the rules
 * (202 { waiting: { approvalId } }), signed only with their passkey on their phone (/approve/rch_...).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/watch">) {
  return portalRoute(req, ctx.params, async (k) => {
    const rt = await getRuntime();
    const { backupsForOrg } = await import("@/server/reliability/service");
    return Response.json({ ...(await watchForOrg(rt, k.info.orgId)), backups: await backupsForOrg(rt, k.info.orgId) }, noStore);
  });
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/watch">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    if (body.action !== "auto_renew" || typeof body.family !== "string" || typeof body.on !== "boolean") throw new DockError(400, "invalid_request", 'Send { action: "auto_renew", family, on }.');
    requireKitchenPerson(k, "Switching auto-renew");
    const rt = await getRuntime();
    if (body.on) {
      const family = body.family.slice(0, 60);
      const lang = body.lang === "fi" || body.lang === "sv" ? body.lang : "en";
      const what = familyL(family, lang).toLowerCase();
      const label = { en: `Renew the ${what} by itself`, fi: `Uusi itse: ${what}`, sv: `Förnya ${what} själv` }[lang];
      const waiting = await doorTurn(k, { door: "typed", via: "tap", label }, async (run) => {
        run.lang = lang;
        const card = await showRules(run, { autoRenewOn: [family] });
        if (!card.proposal?.canSign) throw new DockError(403, "auto_renew_needs_signoff", "Switching auto-renew on needs the kitchen's approver's passkey.", "data_access");
        const sent = await signRules(run, card.proposal.proposalId);
        return { state: sent.proposal?.state, approvalId: sent.proposal?.approval?.approvalId };
      });
      return Response.json({ autoRenew: { family, on: false }, waiting }, { status: 202, ...noStore });
    }
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", transport: "direct", path: "store: auto-renew" });
    const a = await setAutoRenew(rt, session, { family: body.family.slice(0, 60), on: false, by: k.console!.person!.name, via: "kitchen store" });
    return Response.json({ autoRenew: a }, noStore);
  });
}

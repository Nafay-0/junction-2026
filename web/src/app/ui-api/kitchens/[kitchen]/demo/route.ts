import { DockError } from "@/core/errors";
import { clearAccountCookie } from "@/server/accounts/http";
import { requireKitchenPerson } from "@/server/authz";
import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { getRuntime } from "@/server/runtime";
import { giveFreeKitchenLimit, keepFreeKitchen, renameFreeKitchen } from "@/server/demo/fresh";
import { STAGE_KINDS, addSampleHistory, chooseStart, deleteAccount, guideFor, restartAccount, stageForAccount, type StageKind } from "@/server/demo/service";
import type { Kitchen } from "@/server/kitchen-portal";

/**
 * A demo account's own controls, for its own kitchen only (server/demo/service.ts). The kitchen's own signed-in
 * person only (not a phone signed in by the call code), and only an account's kitchen.
 *
 * GET                                          the "Try everything" guide: one row per capability, ticked from the ledger
 * POST { action: "start", start }              "sample" | "empty": the starting point chosen at the end of onboarding
 * POST { action: "stage", kind }               stock_out | drift | offer | poor_record, for this kitchen, staged for the demo
 * POST { action: "restart" }                   back to how the kitchen was after onboarding (a ledger entry)
 * POST { action: "delete", confirm: <username> } the account goes (the ledger keeps its entries)
 * POST { action: "sample" }                    add a sample history now (a fresh kitchen, or one that started empty)
 * POST { action: "rename", name }              a fresh kitchen's name
 * POST { action: "keep", login, password }     keep a fresh kitchen: a sign-in name and password of its person's own
 * POST { action: "limit" }                     give a fresh kitchen a 250 € per-order limit (its passkey signs above)
 */
async function own(k: Kitchen, what: string) {
  requireKitchenPerson(k, what);
  const username = k.info.kind === "account" ? k.info.account?.username : undefined;
  const rt = await getRuntime();
  const a = username ? await rt.accounts.get(username) : undefined;
  if (!a || a.username !== k.console?.person?.account) throw new DockError(403, "not_your_kitchen", `${what} is only for the kitchen's own account.`, "account");
  return { rt, a };
}

export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/demo">) {
  return portalRoute(req, ctx.params, async (k) => {
    const { rt, a } = await own(k, "The guide");
    return Response.json({ guide: await guideFor(rt, a) }, noStore);
  });
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/demo">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const { rt, a } = await own(k, "This");
    switch (body.action) {
      case "start":
        if (body.start !== "sample" && body.start !== "empty") throw new DockError(400, "invalid_request", 'Send { action: "start", start: "sample" | "empty" }.');
        return Response.json(await chooseStart(rt, a, body.start), noStore);
      case "stage":
        if (typeof body.kind !== "string" || !STAGE_KINDS.includes(body.kind as StageKind)) throw new DockError(400, "invalid_request", `Send { action: "stage", kind } with kind one of ${STAGE_KINDS.join(", ")}.`);
        return Response.json({ staged: await stageForAccount(rt, a, body.kind as StageKind) }, { status: 201, ...noStore });
      case "restart":
        return Response.json(await restartAccount(rt, a), noStore);
      case "delete": {
        if (body.confirm !== a.username) throw new DockError(400, "confirm_required", "Type the account's username to delete it.", "account");
        const r = await deleteAccount(rt, a);
        return Response.json(r, { headers: { ...noStore.headers, "set-cookie": clearAccountCookie(req) } });
      }
      case "sample":
        return Response.json(await addSampleHistory(rt, a), noStore);
      case "rename":
        return Response.json(await renameFreeKitchen(rt, a, body.name), noStore);
      case "keep":
        return Response.json(await keepFreeKitchen(rt, a, { login: body.login, password: body.password }), noStore);
      case "limit":
        return Response.json(await giveFreeKitchenLimit(rt, a), noStore);
      default:
        throw new DockError(400, "invalid_request", 'Send { action: "start" | "stage" | "restart" | "delete" | "sample" | "rename" | "keep" | "limit" }.');
    }
  });
}

import { DockError } from "@/core/orders";
import type { ApproverAccount } from "@/core/passkeys";
import { pendingFor } from "@/server/approval-api";
import { dayText, eurShort, timeText } from "@/server/approval-view";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { demoTapEnabled } from "@/server/config";
import { presenterKitchenOf } from "@/server/presenter";
import type { Runtime } from "@/server/runtime";
import { pendingRulesChanges } from "@/server/thread/rules-signoff";

/** An account kitchen's signer on the phone that added itself as a signing device (Agent and rules). */
async function accountKitchenOf(rt: Runtime, account: ApproverAccount) {
  const view = (await rt.accounts.list()).find((a) => a.orgId === account.orgId && a.kitchen);
  const k = view ? await rt.accounts.kitchenOf(view.username).catch(() => undefined) : undefined;
  if (!view || !k) return undefined;
  return {
    orgId: account.orgId,
    kitchenName: view.restaurant,
    city: "",
    approverName: account.name,
    roleLabel: account.role.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
    agentName: `${view.restaurant}'s buyer agent`,
    passkey: true,
    perOrderLimitCents: k.kitchen.mandate.perOrderLimitCents,
    weeklyBudgetCents: k.kitchen.mandate.weeklyBudgetCents,
    expiresAt: undefined as string | undefined,
  };
}

/**
 * The approver's home screen: who they are, what their agent may do alone, and what waits for them: orders over the
 * limit and changes to the kitchen's rules that widen what the agent may do (each opens /approve/{id}).
 */
export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const me = await currentApprover(req, rt);
    // A visitor's own kitchen, a built-in demo kitchen a presenter enrolled for (/join/presenter), or an account's kitchen.
    const s = me?.sandbox ?? (me ? presenterKitchenOf(me.account) : undefined) ?? (me ? await accountKitchenOf(rt, me.account) : undefined);
    if (!s) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen. Scan the QR code to join.", "approver_identity");
    const orders = (await rt.dock.listOrders({ orgId: s.orgId })).reverse();
    const pending = await pendingFor(rt, s.orgId);
    const rules = await pendingRulesChanges(s.orgId).catch(() => []);
    return Response.json({
      approver: { name: s.approverName, roleLabel: s.roleLabel, passkey: s.passkey },
      kitchen: { name: s.kitchenName, city: s.city },
      agent: { name: s.agentName, perOrderLimit: eurShort(s.perOrderLimitCents), weeklyBudget: eurShort(s.weeklyBudgetCents) },
      expiresAt: s.expiresAt,
      expiresAtText: s.expiresAt ? timeText(s.expiresAt) : "",
      demoTapEnabled: demoTapEnabled(),
      pending: pending.map((o) => ({ approvalId: o.approval!.approvalId, total: eurShort(o.totalCents), requestedAtText: timeText(o.approval!.requestedAt) })),
      rulesChanges: rules.map((r) => ({ approvalId: r.approvalId, changes: r.changes, requestedAtText: timeText(r.requestedAt) })),
      recent: orders
        .filter((o) => o.status !== "pending_approval")
        .slice(0, 5)
        .map((o) => ({
          approvalId: o.approval?.approvalId,
          status: o.status,
          total: eurShort(o.totalCents),
          delivery: o.lines[0] ? dayText(o.lines[0].deliveryDate) : undefined,
          atText: timeText(o.updatedAt),
        })),
    });
  });
}

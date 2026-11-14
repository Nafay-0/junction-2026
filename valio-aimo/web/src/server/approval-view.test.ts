import { describe, expect, it } from "vitest";
import type { ApprovalContext } from "@/core/orders";
import { buildApprovalView } from "./approval-view";

const line = { productId: "VA-1010", name: "Lactose-free milk 1 l", category: "milk", attributes: ["lactose_free"], quantity: 1000, packSize: 1, unit: "L" as const, unitPriceCents: 132, lineTotalCents: 132_000, deliveryDate: "2026-11-16" };

function ctx(notes?: string[]): ApprovalContext {
  const order = {
    orderId: "ord_1",
    requestId: "req_1",
    orgId: "org_laakso",
    orgName: "Laakso",
    agentId: "agent_1",
    mandateId: "man_1",
    quoteId: "quo_1",
    status: "pending_approval",
    lines: [line],
    totalCents: 132_000,
    decision: { outcome: "needs_human_approval", totalCents: 132_000, rules: [{ rule: "per_order_limit", outcome: "escalate", reason: "Over the limit", details: { limitCents: 100_000 } }], reasons: ["Over the limit"] },
    ...(notes ? { notes } : {}),
    createdAt: "2026-11-14T10:00:00.000Z",
    updatedAt: "2026-11-14T10:00:00.000Z",
  };
  const approval = { approvalId: "apr_1", approver: { role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 500_000 }, status: "pending", orderDigest: "d", requestedAt: "2026-11-14T10:00:00.000Z" };
  return { order, approval, orderDigest: "d", request: { text: "1000 L lactose-free milk by Monday" }, quoteExpiresAt: "2026-11-14T10:30:00.000Z", mandate: { perOrderLimitCents: 100_000 } } as unknown as ApprovalContext;
}

describe("the approval screen", () => {
  it("shows the signer the note the order page promised them (a large first order, not asked of the buyer)", () => {
    const note = "Check the amount: this is the kitchen's first milk order through the agent, and 1,000 L is a large one.";
    const v = buildApprovalView(ctx([note]), { signIn: "passkey", demoTapEnabled: false, viewerIsApprover: true });
    expect(v.why[0]).toMatch(/per-order limit/);
    expect(v.why).toContain(note);
  });

  it("is unchanged when the intake carried nothing", () => {
    const v = buildApprovalView(ctx(), { signIn: "passkey", demoTapEnabled: false, viewerIsApprover: true });
    expect(v.why).toHaveLength(1);
  });
});

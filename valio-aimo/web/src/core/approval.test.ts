import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";

describe("the in-memory outbox", () => {
  it("keeps the latest messages only, so a weekend of sign-offs does not grow the process for ever", async () => {
    const outbox = new InMemoryOutbox(3);
    for (let i = 0; i < 5; i++) {
      await outbox.send({ approvalId: `apr_${i}`, orderId: `ord_${i}`, approver: { role: "r", name: "R", maxApprovalCents: 1 }, totalCents: i, reasons: [], link: `/approve/apr_${i}?token=t`, sentAt: "2026-11-14T10:00:00.000Z" });
    }
    expect(outbox.messages().map((m) => m.approvalId)).toEqual(["apr_2", "apr_3", "apr_4"]);
  });
});

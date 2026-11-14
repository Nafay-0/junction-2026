import { describe, expect, it } from "vitest";
import { afterSignOff } from "./engine";
import type { PublicOrder } from "@/core/orders";

describe("what is said after a phone OK", () => {
  it("is in the conversation's language, whatever the product's name contains", () => {
    const order = { status: "committed", approval: { approver: { name: "Kitchen manager" } }, lines: [{ name: "Valio Hyvä suomalainen Arki® Eila®", deliveryDate: "2026-11-16" }] } as unknown as PublicOrder;
    expect(afterSignOff(order, "en")).toBe("Kitchen manager OK'd it: it arrives Monday 16 Nov.");
    expect(afterSignOff(order, "fi")).toMatch(/hyväksyi tilauksen/);
  });
});

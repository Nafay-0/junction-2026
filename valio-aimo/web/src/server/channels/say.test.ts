import { describe, expect, it } from "vitest";
import type { IntakeView } from "@/core/intake";
import { stepForModel } from "./say";

describe("what the voice agent is given to say", () => {
  it("names the price's end in Helsinki time, never UTC", () => {
    const step = {
      requestId: "req_1",
      state: "quoted",
      notes: [],
      quote: {
        quote: { totalCents: 132_200, expiresAt: "2026-11-14T10:30:00.000Z", lines: [{ name: "Milk", quantity: 1000, deliveryDate: "2026-11-16" }] },
        policyPreview: { outcome: "needs_human_approval", approver: { name: "Aino Virtanen", role: "kitchen manager" }, reasons: [] },
      },
    } as unknown as IntakeView;
    const out = stepForModel(step) as { say: string };
    expect(out.say).toContain("valid until 12:30 Helsinki time");
    expect(out.say).not.toMatch(/UTC/);
  });
});

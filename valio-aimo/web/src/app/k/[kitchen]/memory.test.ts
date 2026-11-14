import { describe, expect, it } from "vitest";
import { repeatNeed } from "./memory";
import type { PortalRequest } from "./types";

describe("one-click repeat", () => {
  it("does not stack 'Repeat:' when a repeat is repeated", () => {
    const r = { key: "req_1", requestId: "req_1", at: "2026-11-10T08:00:00.000Z", text: "Repeat: 100 L milk for Thursday", kind: "agent", corrected: 0, need: { item: { text: "milk", category: "milk", attributes: [], excludedAttributes: [] }, quantity: { amount: 100, unit: "L" }, deliverBy: "2026-11-12", requiredClaims: [], forbiddenAllergens: [], optimise: "unstated", sameAsLastTime: false } } as unknown as PortalRequest;
    expect(repeatNeed(r, "2026-11-14")!.need.text).toBe("Repeat: 100 L milk for Thursday");
  });
});

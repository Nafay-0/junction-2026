import { describe, expect, it } from "vitest";
import { afterSignOff } from "./engine";
import type { PublicOrder } from "@/core/orders";

describe("what is said after a phone OK", () => {
  it("is in the conversation's language, whatever the product's name contains", () => {
    const order = { status: "committed", approval: { approver: { name: "Kitchen manager" } }, lines: [{ name: "Valio Hyvä suomalainen Arki® Eila®", deliveryDate: "2026-11-16" }] } as unknown as PublicOrder;
    expect(afterSignOff(order, "en")).toBe("Kitchen manager OK'd it: it arrives Monday 16 Nov.");
    expect(afterSignOff(order, "fi")).toMatch(/hyväksyi tilauksen/);
    expect(afterSignOff(order, "sv")).toBe("Kitchen manager godkände beställningen: den kommer måndag 16 nov.");
  });

  it("is in Swedish for a Swedish conversation, also when nothing is ordered", () => {
    const base = { lines: [{ name: "Valio Eila", deliveryDate: "2026-11-17" }] };
    const said = (status: string, approval?: unknown) => afterSignOff({ ...base, status, ...(approval ? { approval } : {}) } as unknown as PublicOrder, "sv");
    expect(said("declined", { approver: { name: "Anna" } })).toBe("Anna avböjde beställningen, så inget är beställt.");
    expect(said("expired")).toBe("Priset gick ut före godkännandet, så inget är beställt.");
    expect(said("withdrawn")).toBe("Beställningen togs tillbaka, så inget är beställt.");
    for (const s of ["committed", "declined", "expired", "withdrawn"]) expect(said(s)).not.toMatch(/\b(OK'd|nothing|ordered|tilaus|hyväksyi)\b/);
  });
});

import { describe, expect, it } from "vitest";
import { lastShown, rulesFacts } from "./agent";

describe("what the model is told each turn", () => {
  it("states the kitchen's per-order limit, who OKs above it and the weekly budget, from the signed rules", () => {
    const run = { session: { mandate: { perOrderLimitCents: 50_000, weeklyBudgetCents: 900_000, approvers: [{ name: "Kitchen manager" }] } } } as never;
    expect(rulesFacts(run)).toBe("THE KITCHEN'S RULES (its signed mandate; facts, the same the store's own sentences quote): you may spend up to 500,00 € on one order alone; above that the kitchen manager gives the OK with their passkey on their own device; the weekly budget is 9 000,00 €.");
  });
  it("gives the previous reply as the buyer saw it, with the store's own sentences, never a session boundary", () => {
    const turns = [
      { role: "buyer", turnId: "b1", text: "the cheapest one" },
      { role: "agent", turnId: "a1", replyTo: "b1", line: "1 000 × Valio Arki Eila semi for **1 010,00 €** is over the **500,00 €** I may spend alone, so it needs the kitchen manager's OK.", cards: [] },
      { role: "agent", turnId: "x", replyTo: "visitor", boundary: "visitor", cards: [] },
      { role: "buyer", turnId: "b2", text: "What did we order last week?" },
      { role: "agent", turnId: "a2", replyTo: "b2", cards: [] },
    ];
    const own = [turns[0], turns[1], turns[3], turns[4]];
    expect(lastShown({ thread: { turns: own }, turnId: "a2" } as never)).toMatch(/^YOUR LAST REPLY AS THE BUYER SAW IT .*"1 000 × Valio Arki Eila semi for 1 010,00 € is over the 500,00 € I may spend alone/);
    // Another visitor wrote the last reply: nothing of it is given.
    expect(lastShown({ thread: { turns }, turnId: "a2" } as never)).toBe("");
  });
});

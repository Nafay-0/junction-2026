import { describe, expect, it } from "vitest";
import { readAhead } from "./engine";

const run = (over: Record<string, unknown> = {}) => {
  const entries: unknown[] = [];
  return {
    entries,
    run: { buyer: { via: "typed" }, thread: { threadId: "t", turns: [] }, store: { cards: () => [] }, turnId: "a", door: "typed", session: { agentId: "agt" }, readings: new Map(), rt: { dock: { ledger: { append: (e: unknown) => entries.push(e) } } }, ...over } as never,
  };
};

describe("the reading started alongside the agent's first call", () => {
  it("only for words that read as one request", () => {
    expect(readAhead(run().run, "what did we order last week?")).toBe(false);
    expect(readAhead(run().run, "yes")).toBe(false);
    expect(readAhead(run().run, "20 litres of milk and 5 kg of butter for Friday")).toBe(false);
    expect(readAhead(run({ buyer: { via: "tap", action: { type: "place" } } }).run, "2 kg of butter for Thursday")).toBe(false);
  });
});

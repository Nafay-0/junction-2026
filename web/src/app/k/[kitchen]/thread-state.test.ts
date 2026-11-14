import { describe, expect, it } from "vitest";
import type { Thread, ThreadEvent } from "@/server/thread/types";
import { applyEvent } from "./thread-state";

const base: Thread = { threadId: "thr_1", kitchen: "kaari", orgId: "org", startedAt: "2026-11-14T10:00:00.000Z", turns: [], seq: 0 };
const ev = (seq: number, body: Record<string, unknown>) => ({ seq, threadId: "thr_1", at: "2026-11-14T10:00:00.000Z", ...body }) as ThreadEvent;

describe("applyEvent: the thread in the browser follows the server's events", () => {
  const events: ThreadEvent[] = [
    ev(1, { type: "turn", turn: { turnId: "b1", role: "buyer", at: "", door: "typed", via: "typed", text: "100 L milk" } }),
    ev(2, { type: "turn", turn: { turnId: "a1", role: "agent", at: "", replyTo: "b1", status: "working", steps: [], cards: [] } }),
    ev(3, { type: "step", turnId: "a1", step: { stepId: "s1", kind: "read", label: "Reading", status: "running", startedAt: "" } }),
    ev(4, { type: "step", turnId: "a1", step: { stepId: "s1", kind: "read", label: "Reading", status: "done", startedAt: "", ms: 900 } }),
    ev(5, { type: "card", turnId: "a1", card: { type: "options", cardId: "options:r1", requestId: "r1", options: [], excluded: [], notes: [] } }),
    ev(6, { type: "card", turnId: "a1", card: { type: "options", cardId: "options:r1", requestId: "r1", options: [], excluded: [], notes: [], chosen: "opt_1" } }),
    ev(7, { type: "line", turnId: "a1", text: "Three options below." }),
    ev(8, { type: "status", turnId: "a1", status: "waiting_buyer" }),
  ];

  it("builds turns, replaces steps and cards by id, and keeps the line and status", () => {
    const t = events.reduce(applyEvent, base);
    expect(t.seq).toBe(8);
    expect(t.turns).toHaveLength(2);
    const a = t.turns[1];
    expect(a.role === "agent" && a.steps).toEqual([expect.objectContaining({ stepId: "s1", status: "done" })]);
    expect(a.role === "agent" && a.cards).toEqual([expect.objectContaining({ cardId: "options:r1", chosen: "opt_1" })]);
    expect(a.role === "agent" && a.line).toBe("Three options below.");
    expect(t.activeTurnId).toBe("a1");
  });

  it("is idempotent: a replayed event (a reconnect from an older seq) changes nothing", () => {
    const once = events.reduce(applyEvent, base);
    const twice = events.reduce(applyEvent, once);
    expect(twice).toEqual(once);
  });

  it("replaces a card in the turn that shows it, even when a later turn sends the new version", () => {
    let t = events.reduce(applyEvent, base);
    t = applyEvent(t, ev(9, { type: "turn", turn: { turnId: "a2", role: "agent", at: "", replyTo: "b2", status: "working", steps: [], cards: [] } }));
    t = applyEvent(t, ev(10, { type: "card", turnId: "a2", card: { type: "options", cardId: "options:r1", requestId: "r1", options: [], excluded: [], notes: [], chosen: "opt_2" } }));
    const [a1, a2] = [t.turns[1], t.turns[2]];
    expect(a1.role === "agent" && a1.cards[0]).toMatchObject({ chosen: "opt_2" });
    expect(a2.role === "agent" && a2.cards).toHaveLength(0);
  });
});

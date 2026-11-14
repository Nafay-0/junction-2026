import { describe, expect, it } from "vitest";
import { ThreadStore } from "./store";
import type { AgentTurn } from "./types";

/** Nothing spins without an end: a turn that stops working closes every step it left running. */
describe("a turn's steps", () => {
  const turn = (id: string): AgentTurn => ({ turnId: id, role: "agent", at: new Date().toISOString(), replyTo: "b1", status: "working", steps: [], cards: [] });
  const running = (stepId: string, kind: string) => ({ stepId, kind, label: kind, status: "running" as const, startedAt: new Date().toISOString() });

  it("are closed when the turn ends, failed or done", () => {
    const store = new ThreadStore();
    const t = store.get("k1", "org1");
    store.addTurn(t, turn("a1"));
    store.step(t, "a1", running("s1", "memory"));
    store.step(t, "a1", running("s2", "tool:read_mandate"));
    store.status(t, "a1", "failed");
    expect(store.agentTurn(t, "a1")!.steps.map((s) => s.status)).toEqual(["skipped", "skipped"]);
  });

  it("keep only the wait for a person's OK while the turn waits for exactly that", () => {
    const store = new ThreadStore();
    const t = store.get("k2", "org2");
    store.addTurn(t, turn("a2"));
    store.step(t, "a2", running("s1", "memory"));
    store.step(t, "a2", running("s2", "tool:await_sign_off"));
    store.status(t, "a2", "waiting_approver");
    expect(store.agentTurn(t, "a2")!.steps.map((s) => s.status)).toEqual(["skipped", "running"]);
    store.status(t, "a2", "done");
    expect(store.agentTurn(t, "a2")!.steps.map((s) => s.status)).toEqual(["skipped", "skipped"]);
  });
});

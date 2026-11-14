import { describe, expect, it } from "vitest";
import { LedgerToActions } from "@/server/aiven/actions";
import { failureOf, turnOutcome } from "./outcome";
import type { Card } from "./types";

const gate = (outcome: string, rule?: string) => ({ type: "gate", cardId: "g", requestId: "r", outcome, reasons: [], rules: [], ...(rule ? { rule } : {}) }) as unknown as Card;
const order = { type: "order", cardId: "o" } as unknown as Card;

describe("how a turn ended", () => {
  it("names the outcome: refused with its rule, sent for sign-off, ordered, asked, answered", () => {
    expect(turnOutcome("done", [gate("refused", "forbidden_allergens"), order])).toEqual({ outcome: "refused", rule: "forbidden_allergens" });
    expect(turnOutcome("waiting_approver", [gate("waiting"), order])).toEqual({ outcome: "sent_for_signoff" });
    expect(turnOutcome("done", [gate("placed_alone"), order])).toEqual({ outcome: "ordered" });
    expect(turnOutcome("waiting_buyer", [])).toEqual({ outcome: "asked" });
    expect(turnOutcome("done", [])).toEqual({ outcome: "answered" });
  });

  it("names why it failed: a model's error, a timeout, a tool, our own code", () => {
    expect(failureOf(Object.assign(new Error("The agent did not answer"), { code: "agent_unavailable", cause: Object.assign(new Error("overloaded"), { name: "AI_APICallError" }) }))).toBe("model_error");
    expect(failureOf(Object.assign(new Error("x"), { cause: Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }) }))).toBe("model_timeout");
    expect(failureOf(Object.assign(new Error("tool failed"), { name: "AI_ToolExecutionError" }))).toBe("tool_error");
    expect(failureOf(new TypeError("Cannot read properties of undefined"))).toBe("engine_error");
  });

  it("reach the telemetry as turn.failed (its code and duration) and turn.done (the engine's outcome and rule)", () => {
    const m = new LedgerToActions();
    const base = { seq: 1, at: "2026-11-14T10:00:00Z", hash: "h", prevHash: "p", type: "agent", actor: "agent:a1" } as const;
    const failed = m.toEvent({ ...base, summary: "failed", data: { event: "turn_failed", thread: { threadId: "th", turnId: "t1", door: "typed" }, code: "model_timeout", ms: 150000 } } as never)!;
    expect(failed).toMatchObject({ kind: "turn.failed", ok: false, attrs: { turnId: "t1", facts: { code: "model_timeout", ms: 150000 } } });
    const done = m.toEvent({ ...base, summary: "done", data: { event: "turn_done", thread: { threadId: "th", turnId: "t2", door: "typed" }, status: "done", outcome: "refused", rule: "forbidden_allergens", requests: [], orders: [] } } as never)!;
    expect(done).toMatchObject({ kind: "turn.done", attrs: { facts: { outcome: "refused", rule: "forbidden_allergens" } } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { resetRuntime } from "../../runtime";
import { calls, voiceLimits } from "./calls";
import { runTool } from "./tools";

/**
 * Speech: a kind the kitchen cannot get is said in the read-back, before the caller's yes is asked for, and not said
 * again after it. Kaari buys milk, cream and yoghurt only, so oat drink is outside its rules.
 */
const thursday = () => {
  let d = addDaysIso(localNow(new Date()).date, 3);
  while (isoWeekday(d) !== 4) d = addDaysIso(d, 1);
  return d;
};

vi.mock("../flow", async (orig) => {
  const real = await orig<typeof import("../flow")>();
  return {
    ...real,
    readNeed: vi.fn(async (_a: unknown, text: string) => ({ need: { text, item: { text: "oat drink", category: "plant_drink" }, quantity: { amount: 20, unit: "L" }, deliverBy: thursday() }, model: "test", ms: 1 })),
  };
});

beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockCalls?: unknown }).__dockCalls = undefined;
});

describe("the read-back says what cannot be had before the yes", () => {
  it("tells the caller first, asks whether to look at other products, and does not say it twice", async () => {
    const callId = calls().open("kaari", "push_to_talk", voiceLimits({})).callId;
    const words = "20 litres of oat drink for Thursday";
    const rb = await runTool("kaari", { callId, name: "submit_request", args: { request: words }, heard: { text: words, turn: 1 } });
    expect(rb.forModel.state).toBe("read_back");
    expect(rb.forModel.say).toMatch(/^I can't get oat drink: your rules do not allow any of it\. I can offer other products instead\. 20 L/);
    expect(rb.forModel.ask).toMatch(/^Shall I look at the other products\?/);
    const after = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    expect(after.forModel.say ?? "").not.toMatch(/oat drink cannot be offered/);
  });
});

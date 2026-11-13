import { beforeEach, describe, expect, it, vi } from "vitest";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { getRuntime, resetRuntime } from "../../runtime";
import { calls, voiceLimits } from "./calls";
import { runTool } from "./tools";

// The interpret model is replaced by a fixed reading: these tests are about what the door lets through.
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
let reading: { amount: number; unit: "L" } = { amount: 1000, unit: "L" };
vi.mock("../flow", async (orig) => {
  const real = await orig<typeof import("../flow")>();
  return { ...real, readNeed: vi.fn(async (_a: unknown, text: string) => ({ need: { text, item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: reading, deliverBy: day() }, model: "test", ms: 1 })) };
});

beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockCalls?: unknown }).__dockCalls = undefined;
  reading = { amount: 1000, unit: "L" };
});

const open = () => calls().open("kaari", "push_to_talk", voiceLimits({})).callId;

describe("voice tools: the model proposes, the door checks", () => {
  it("reads an unusual amount back with its reason before anything is opened", async () => {
    const callId = open();
    const r = await runTool("kaari", { callId, name: "submit_request", args: { request: "1000 litres of lactose-free milk" }, heard: { text: "I need 1,000 L of lactose-free milk by Monday", turn: 1 } });
    expect(r.forModel.state).toBe("read_back");
    expect(r.forModel.say).toMatch(/1,000 L \(one thousand litres\)/);
    expect(r.screen.pending?.reason).toBeTruthy();
    const { dock } = await getRuntime();
    expect(dock.ledger.entries().filter((e) => e.data.step === "door")).toHaveLength(0);
  });

  it("refuses a decision the caller did not say, a no, and words already used", async () => {
    const callId = open();
    await runTool("kaari", { callId, name: "submit_request", args: { request: "x" }, heard: { text: "1000 litres of milk", turn: 1 } });
    expect((await runTool("kaari", { callId, name: "confirm_read_back" })).forModel.refused).toBe("no_words");
    expect((await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "1000 litres of milk", turn: 1 } })).forModel.refused).toBe("words_already_used");
    expect((await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "no, one hundred", turn: 2 } })).forModel.refused).toBe("not_a_yes");
    const ok = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "Yes, that's right", turn: 3 } });
    expect(ok.forModel.ok).toBe(true);
    expect(ok.screen.step?.requestId).toMatch(/^req_/);
  });

  it("records the door and the caller's words in the ledger, and carries the request to a gate decision", async () => {
    const callId = open();
    reading = { amount: 120, unit: "L" };
    let r = await runTool("kaari", { callId, name: "submit_request", args: { request: "120 l milk" }, heard: { text: "120 litres of lactose-free milk", turn: 1 } });
    expect(r.screen.step).toBeDefined();
    let turn = 2;
    for (let i = 0; i < 6 && r.screen.step && r.screen.step.state !== "quoted"; i++) {
      const s = r.screen.step;
      if (s.state === "needs_confirmation") r = await runTool("kaari", { callId, name: "respond_to_check", args: { key: s.concerns[0].key, choice: s.concerns[0].confirmable ? "confirm" : s.concerns[0].corrections[0].id }, heard: { text: "yes", turn: turn++ } });
      else if (s.state === "needs_input") r = await runTool("kaari", { callId, name: "answer_question", args: { questionId: s.questions[0].id, optionId: s.questions[0].options[0].id }, heard: { text: s.questions[0].options[0].label, turn: turn++ } });
      else if (s.state === "options_ready") r = await runTool("kaari", { callId, name: "choose_option", args: { optionId: s.options[0].optionId }, heard: { text: "the first one", turn: turn++ } });
      else break;
    }
    expect(r.screen.step?.state).toBe("quoted");
    expect(r.forModel.say).toMatch(/fixed the price/);
    const placed = await runTool("kaari", { callId, name: "place_order", heard: { text: "yes, place it", turn: turn++ } });
    expect(["committed", "pending_approval"]).toContain(placed.screen.order?.status);
    if (placed.screen.order?.status === "pending_approval") expect(placed.forModel.say).toMatch(/to sign off on their phone/);

    const { dock } = await getRuntime();
    const entries = dock.ledger.entries({ requestId: placed.screen.order!.requestId });
    expect(entries.find((e) => e.data.step === "door")?.data).toMatchObject({ door: "voice", via: "speech" });
    const heard = entries.filter((e) => e.data.step === "heard");
    expect(heard.map((e) => e.data.heard)).toContain("yes, place it");
    expect(heard.find((e) => e.data.heard === "the first one")).toBeDefined();
  });

  it("lets a tap on the screen decide without words", async () => {
    const callId = open();
    reading = { amount: 1000, unit: "L" };
    await runTool("kaari", { callId, name: "submit_request", args: {}, heard: { text: "1000 litres", turn: 1 } });
    const r = await runTool("kaari", { callId, name: "confirm_read_back", tapped: true });
    expect(r.screen.step).toBeDefined();
  });
});

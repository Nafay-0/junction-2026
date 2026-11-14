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
    expect(r.forModel.say).toMatch(/1,000 L \(one thousand litres\) of lactose-free milk, for /);
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
    // Every spoken request is read back first, even an ordinary amount; nothing is looked up before the yes.
    expect(r.forModel.state).toBe("read_back");
    expect(r.screen.step).toBeUndefined();
    r = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    expect(r.screen.step).toBeDefined();
    let turn = 3;
    let chose = false;
    for (let i = 0; i < 6 && !r.screen.order && r.screen.step; i++) {
      const s = r.screen.step;
      if (s.state === "needs_confirmation") r = await runTool("kaari", { callId, name: "respond_to_check", args: { key: s.concerns[0].key, choice: s.concerns[0].confirmable ? "confirm" : s.concerns[0].corrections[0].id }, heard: { text: "yes", turn: turn++ } });
      else if (s.state === "needs_input") r = await runTool("kaari", { callId, name: "answer_question", args: { questionId: s.questions[0].id, optionId: s.questions[0].options[0].id }, heard: { text: s.questions[0].options[0].label, turn: turn++ } });
      else if (s.state === "options_ready") {
        // A spoken choice orders it, as a tap does in the thread: no second "place it?".
        r = await runTool("kaari", { callId, name: "choose_option", args: { optionId: s.options[0].optionId }, heard: { text: "the first one", turn: turn++ } });
        chose = true;
      } else break;
    }
    const placed = r;
    expect(["committed", "pending_approval"]).toContain(placed.screen.order?.status);
    if (placed.screen.order?.status === "pending_approval") expect(placed.forModel.say).toMatch(/to sign off on their phone/);

    const { dock } = await getRuntime();
    const entries = dock.ledger.entries({ requestId: placed.screen.order!.requestId });
    expect(entries.find((e) => e.data.step === "door")?.data).toMatchObject({ door: "voice", via: "speech" });
    const heard = entries.filter((e) => e.data.step === "heard");
    if (chose) expect(heard.map((e) => e.data.heard)).toContain("the first one");
  });

  it("reads back every spoken request, but not an ordinary typed one", async () => {
    reading = { amount: 120, unit: "L" };
    const callId = open();
    const spoken = await runTool("kaari", { callId, name: "submit_request", args: { request: "120 litres" }, heard: { text: "120 litres of lactose-free milk", turn: 1 } });
    expect(spoken.forModel.state).toBe("read_back");
    expect(spoken.forModel.say).not.toMatch(/checking because/);
    const typed = await runTool("kaari", { callId, name: "submit_request", args: { request: "120 litres" }, heard: { text: "120 litres of lactose-free milk", turn: 2 }, via: "typed" });
    expect(typed.screen.step).toBeDefined();
  });

  it("asks when the transcript and the model heard different numbers", async () => {
    reading = { amount: 50, unit: "L" };
    const callId = open();
    const r = await runTool("kaari", { callId, name: "submit_request", args: { request: "15 litres of milk" }, heard: { text: "50 litres of milk", turn: 1 } });
    expect(r.forModel.state).toBe("read_back");
    expect(r.forModel.say).toMatch(/heard 50 but the voice model heard 15/);
  });

  it("refuses a request on a call that the caller did not say", async () => {
    const callId = open();
    const r = await runTool("kaari", { callId, name: "submit_request", args: { request: "Hello kitchen, what do you need to order today?" } });
    expect(r.forModel.refused).toBe("no_words");
  });

  it("lets a tap on the screen decide without words", async () => {
    const callId = open();
    reading = { amount: 1000, unit: "L" };
    await runTool("kaari", { callId, name: "submit_request", args: {}, heard: { text: "1000 litres", turn: 1 } });
    const r = await runTool("kaari", { callId, name: "confirm_read_back", tapped: true });
    expect(r.screen.step).toBeDefined();
  });
});

describe("the call is a door of the kitchen's thread", () => {
  it("puts the heard words, the read-back and the intake's cards in the kitchen's one conversation", async () => {
    const callId = open();
    reading = { amount: 120, unit: "L" };
    await runTool("kaari", { callId, name: "submit_request", args: { request: "120 l milk" }, heard: { text: "120 litres of lactose-free milk", turn: 1 } });
    await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    const { threadStore } = await import("@/server/thread/engine");
    const t = (await threadStore()).peek("kaari")!;
    const buyer = t.turns.filter((x) => x.role === "buyer").slice(-2);
    expect(buyer.map((b) => b.role === "buyer" && b.door)).toEqual(["voice", "voice"]);
    expect(buyer[0].role === "buyer" && buyer[0].text).toBe("120 litres of lactose-free milk");
    const agent = t.turns.filter((x) => x.role === "agent").slice(-2);
    expect(agent[0].role === "agent" && agent[0].cards.map((c) => c.type)).toContain("understood");
    expect(agent[0].role === "agent" && agent[0].line).toMatch(/120 L/);
    expect(agent[1].role === "agent" && agent[1].cards.some((c) => c.type === "anomaly" || c.type === "options" || c.type === "question")).toBe(true);
    const { dock } = await getRuntime();
    expect(dock.ledger.entries().filter((e) => e.type === "agent" && (e.data as { thread?: { door?: string } }).thread?.door === "voice").length).toBeGreaterThan(2);
  });
});

describe("what the voice says", () => {
  it("never carries the store's marks or a screen-only instruction", async () => {
    const { spokenOf, spokenForModel } = await import("../say");
    expect(spokenOf("I've ordered **30 l** for {{Wednesday 18 Nov}}, until {{17.00}}.")).toBe("I've ordered 30 l for Wednesday 18 Nov, until 17.00.");
    expect(spokenOf("It waits for the owner. Scan the QR code with their phone. Nothing changes until they sign.")).toBe("It waits for the owner. Nothing changes until they sign.");
    expect(spokenForModel({ say: "**1 010,00 €**", lines: ["{{Mon 16 Nov}}"], n: 3 })).toEqual({ say: "1 010,00 €", lines: ["Mon 16 Nov"], n: 3 });
    // A whole call, read back, checked and taken to the gate: no mark anywhere in what the voice model gets.
    const callId = open();
    reading = { amount: 120, unit: "L" };
    const said: string[] = [];
    let r = await runTool("kaari", { callId, name: "submit_request", args: { request: "120 l milk" }, heard: { text: "120 litres of lactose-free milk", turn: 1 } });
    said.push(JSON.stringify(r.forModel), r.screen.problem?.message ?? "");
    r = await runTool("kaari", { callId, name: "confirm_read_back", heard: { text: "yes", turn: 2 } });
    said.push(JSON.stringify(r.forModel), r.screen.problem?.message ?? "");
    expect(said.join(" ")).not.toMatch(/\*\*|\{\{|\}\}/);
  });
});


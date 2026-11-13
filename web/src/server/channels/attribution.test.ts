import { beforeEach, describe, expect, it } from "vitest";
import { addDaysIso, localNow } from "@/core/kitchen";
import { getRuntime, resetRuntime } from "../runtime";
import { kitchenAgent, openNeed, respond } from "./flow";

/**
 * F-HUMAN-INPUT-BY-AGENT for the voice and photo doors: the caller's own words on a call from their signed-in phone
 * are their answer; the same call without that session is refused for a visitor's kitchen, and on an open demo
 * kitchen the answer is recorded as relayed.
 */
beforeEach(() => {
  resetRuntime();
  process.env.DOCK_CATALOG = "seed";
});

const yesterday = () => addDaysIso(localNow(new Date()).date, -1);

describe("door answers and who gave them", () => {
  it("a visitor's spoken answer from their own phone is theirs, with the words in the ledger", async () => {
    const rt = await getRuntime();
    const { sandbox, sessionToken } = await rt.sandboxes.joinWithoutPasskey();
    const req = new Request("https://dock.test/ui-api/voice/x/tool", { method: "POST", headers: { cookie: `dock_approver=${encodeURIComponent(sessionToken)}` } });
    const a = await kitchenAgent(sandbox.sandboxId, req);
    expect(a.person?.name).toBe(sandbox.approverName);
    const step = await openNeed(a, { item: { text: "milk", category: "milk" }, quantity: { amount: 50, unit: "L" }, deliverBy: yesterday() }, "voice", "speech", { summary: "test" });
    const c = step.concerns[0];
    const next = await respond(a, step.requestId, c.key, c.corrections[0].id, "voice", "speech", { text: "make it tomorrow then", turn: 1 });
    expect(next.acknowledgements[0]).toMatchObject({ channel: "voice", verified: true, by: sandbox.approverName });
    const entry = rt.dock.ledger.entries({ requestId: step.requestId }).find((e) => e.data.step === "correction")!;
    expect(entry).toMatchObject({ actor: `buyer:${sandbox.approverName}`, data: { words: "make it tomorrow then", verified: true } });

    // Without the visitor's session the same door is refused for their kitchen.
    await expect(kitchenAgent(sandbox.sandboxId, new Request("https://dock.test/ui-api/voice/x/tool", { method: "POST" }))).rejects.toMatchObject({ status: 401 });
  });

  it("on an open demo kitchen, a spoken answer is recorded as relayed (nobody is signed in)", async () => {
    const a = await kitchenAgent("laakso", new Request("https://dock.test/ui-api/voice/laakso/tool", { method: "POST" }));
    const step = await openNeed(a, { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 50, unit: "L" }, deliverBy: yesterday() }, "voice", "speech", { summary: "test" });
    const c = step.concerns[0];
    const next = await respond(a, step.requestId, c.key, c.corrections[0].id, "voice", "speech", { text: "tomorrow", turn: 1 });
    expect(next.acknowledgements[0]).toMatchObject({ channel: "relayed", verified: false });
  });
});

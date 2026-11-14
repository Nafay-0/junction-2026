import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as answerGet, POST as answerPost } from "@/app/ui-api/answer/[token]/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { answerLinkFor, resetAnswerLinks } from "../answer-links";
import { RECORDINGS } from "../agent/menu/eval/recorded";
import { menuKitchen } from "../agent/menu/runtime";
import { kitchenAgent } from "../channels/flow";
import { scanStep } from "../channels/scan/door";
import { calls, voiceLimits } from "../channels/voice/calls";
import { runTool } from "../channels/voice/tools";
import { KITCHEN_ORG } from "../demo-kitchen";
import { getRuntime, resetRuntime } from "../runtime";
import { SUSPENSION_RULE, suspensions } from "./suspensions";

/**
 * Every door ends at the same operations check. `suspension.test.ts` covers REST, MCP and the on-site console,
 * which all pass through `authenticate` in server/http.ts. These are the doors that call Dock in-process, with no
 * HTTP request to authenticate: the voice call, the photo door, the menu planner and the buyer's answer link.
 * A suspended agent (or organisation) must be refused there too, with the same named rule, and nothing may be
 * opened, quoted or ordered.
 */
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;

// The reading model is replaced by a fixed reading: these tests are about what the door lets through.
vi.mock("../channels/flow", async (orig) => {
  const real = await orig<typeof import("../channels/flow")>();
  return { ...real, readNeed: vi.fn(async (_a: unknown, text: string) => ({ need: { text, item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 120, unit: "L" }, deliverBy: day() }, model: "test", ms: 1 })) };
});

const refusal = { status: 403, rule: SUSPENSION_RULE };

async function suspend(scope: "agent" | "org") {
  const { dock } = await getRuntime();
  return suspensions(dock).suspend({ scope, target: scope === "agent" ? KITCHEN_ORG.agentId : KITCHEN_ORG.orgId, label: scope === "agent" ? "Kaari's buyer agent" : KITCHEN_ORG.name, reason: "Ordering in a loop", by: "Riikka (ops)" });
}

async function requestsOpened(): Promise<number> {
  const { dock } = await getRuntime();
  return dock.ledger.entries().filter((e) => e.type === "request").length;
}

beforeEach(() => {
  resetRuntime();
  resetAnswerLinks();
  (globalThis as { __dockCalls?: unknown }).__dockCalls = undefined;
  (globalThis as { __dockMenu?: unknown }).__dockMenu = undefined;
  process.env.DOCK_MENU_MODEL = "recorded";
});

describe("a suspended agent is refused at every in-process door", () => {
  it("voice call: no request is opened for a suspended agent", async () => {
    const callId = calls().open("kaari", "push_to_talk", voiceLimits({})).callId;
    const said = { callId, name: "submit_request", args: { request: "120 litres of lactose-free milk" }, heard: { text: "120 litres of lactose-free milk", turn: 1 } };
    // Not suspended: the same words open a request (the control for this test).
    expect((await runTool("kaari", said)).screen.step?.requestId).toMatch(/^req_/);
    const before = await requestsOpened();

    await suspend("agent");
    await expect(runTool("kaari", { ...said, heard: { text: "120 litres of lactose-free milk", turn: 2 } })).rejects.toMatchObject(refusal);
    expect(await requestsOpened()).toBe(before);
  });

  it("photo door: a reviewed line opens nothing for a suspended agent", async () => {
    const step = (body: unknown) => scanStep("kaari", new Request("http://dock.test/ui-api/scan/kaari/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const line = { action: "open", source: "image", line: { id: "l1", read: "milk 120 l", item: "lactose-free milk", amount: 120, unit: "L", confidence: "high", edited: false } };
    expect((await step(line)).step?.requestId).toMatch(/^req_/);
    const before = await requestsOpened();

    await suspend("agent");
    await expect(step(line)).rejects.toMatchObject(refusal);
    expect(await requestsOpened()).toBe(before);
  });

  it("voice and photo share one way in, and it is closed for an organisation-wide suspension as well", async () => {
    await expect(kitchenAgent("kaari")).resolves.toBeDefined();
    await suspend("org");
    await expect(kitchenAgent("kaari")).rejects.toMatchObject({ ...refusal, code: "organisation_suspended" });
  });

  it("menu planner: a suspended organisation's menu agent cannot plan or quote", async () => {
    const text = RECORDINGS.find((r) => r.kitchen === "kaari")!.text;
    const { service, kitchen } = await menuKitchen("kaari");
    const made = await service.plan(kitchen!, text, "Sanna Koskinen (head chef)");
    expect(made.record.requestId).toMatch(/^req_/);
    const before = await requestsOpened();

    await suspend("org"); // the menu agent has its own agent id: only the organisation's suspension names it
    await expect(service.plan(kitchen!, text, "Sanna Koskinen (head chef)")).rejects.toMatchObject(refusal);
    await expect(service.quote(kitchen!, made.record.planId, "Sanna Koskinen (head chef)")).rejects.toMatchObject(refusal);
    // Ordering a plan that was quoted before the suspension: agent/menu/menu.test.ts, on a catalogue that can be quoted.
    expect(await requestsOpened()).toBe(before);
  });

  it("answer link: a link handed out before the suspension no longer moves the request", async () => {
    const { dock } = await getRuntime();
    const a = await kitchenAgent("kaari");
    // 1,000 L where Kaari orders about 100 L: the intake waits for the buyer's confirmation.
    const step = await dock.intake.open(a.session, { need: { text: "1000 L milk", item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() }, by: "Sanna" });
    expect(step.state).toBe("needs_confirmation");
    const token = answerLinkFor(a.session, step, "http://dock.test")!.split("/").pop()!;
    const ctx = { params: Promise.resolve({ token }) } as Parameters<typeof answerGet>[1];

    await suspend("agent");
    const res = await answerPost(
      new Request(`http://dock.test/ui-api/answer/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: "Sanna", responses: [{ key: step.concerns[0].key, choice: "confirm" }] }) }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.rule).toBe(SUSPENSION_RULE);
    expect((await dock.intake.get(a.session, step.requestId).catch(() => step)).state).toBe("needs_confirmation");
  });
});

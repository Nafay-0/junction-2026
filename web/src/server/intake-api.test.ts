import { beforeEach, describe, expect, it } from "vitest";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { localFetch } from "./local-transport";
import { resetRuntime } from "./runtime";

const BASE = "http://dock.test";
let headers: Record<string, string>;

beforeEach(async () => {
  resetRuntime();
  const mandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  headers = { "content-type": "application/json", authorization: `Mandate ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId };
});

async function call(method: string, path: string, body?: unknown, h = headers) {
  const res = await localFetch(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;

describe("intake over HTTP", () => {
  it("an outside agent drives need -> concern -> question -> options -> quote -> order with structured calls only", async () => {
    const opened = await call("POST", "/api/v1/intake", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() }, by: "Sanna" });
    expect(opened.status).toBe(201);
    let step = opened.body.step;
    expect(step.state).toBe("needs_confirmation");

    step = (await call("POST", step.next.path, { ...step.next.example, by: "Sanna" })).body.step;
    expect(step.state).toBe("needs_input");
    expect(step.questions.map((q: { id: string }) => q.id)).toEqual(["optimise"]);
    expect(step.rules.map((r: { text: string }) => r.text)).toContain("Stated by Sanna Koskinen (head chef): Always lactose-free");

    step = (await call("POST", step.next.path, { by: "Sanna", answers: [{ questionId: "optimise", optionId: "no_preference" }] })).body.step;
    expect(step.state).toBe("options_ready");
    expect(step.options.length).toBeGreaterThanOrEqual(2);

    step = (await call("POST", step.next.path, step.next.example)).body.step;
    expect(step.state).toBe("quoted");
    expect(step.next.path).toBe("/api/v1/orders");

    const order = await call("POST", "/api/v1/orders", step.next.example);
    expect([201, 202]).toContain(order.status);
    expect((await call("GET", `/api/v1/intake/${step.requestId}`)).body.step.state).toBe("quoted");
    expect((await call("GET", "/api/v1/kitchen")).body.kitchen.families.find((f: { family: string }) => f.family === "milk").orders).toBeGreaterThan(10);
  });

  it("returns structured errors", async () => {
    const bad = await call("POST", "/api/v1/intake", { need: { item: { text: "milk" } } });
    expect(bad).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
    expect((await call("GET", "/api/v1/intake/req_nope")).status).toBe(404);
    expect((await call("POST", "/api/v1/intake", { need: {} }, { "content-type": "application/json" })).status).toBe(401);
  });

  it("is listed in the API index", async () => {
    const r = await call("GET", "/api/v1");
    expect(r.body.intakeFlow.states).toContain("options_ready");
    expect(Object.keys(r.body.endpoints)).toContain("POST /api/v1/intake/{requestId}/choice");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { GET as answerGet, POST as answerPost } from "@/app/ui-api/answer/[token]/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { resetAnswerLinks } from "./answer-links";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { localFetch } from "./local-transport";
import { getRuntime, resetRuntime } from "./runtime";

const BASE = "http://dock.test";
let headers: Record<string, string>;

beforeEach(async () => {
  resetRuntime();
  resetAnswerLinks();
  const mandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  headers = { "content-type": "application/json", authorization: `Mandate ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId };
});

async function call(method: string, path: string, body?: unknown) {
  const res = await localFetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const tokenOf = (url: string) => new URL(url).pathname.split("/").at(-1)!;
const ctx = (token: string) => ({ params: Promise.resolve({ token }) }) as never;
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;

describe("REST steps carry MCP's guidance and a one-time answer link", () => {
  it("a waiting step names the REST call, whose move it is, and a link the buyer answers once; the ledger says how", async () => {
    const opened = await call("POST", "/api/v1/intake", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() } });
    expect(opened.status).toBe(201);
    const { step, waitingFor, nextStep, answerUrl } = opened.body;
    expect(step.state).toBe("needs_confirmation");
    expect(waitingFor).toBe("buyer");
    expect(nextStep).toContain(`POST /api/v1/intake/${step.requestId}/concerns`);
    expect(nextStep).toContain(answerUrl);
    expect(answerUrl).toMatch(/^http:\/\/dock\.test\/answer\/[A-Za-z0-9_-]{20,}$/);
    // Reading the step again hands out the same live link.
    expect((await call("GET", `/api/v1/intake/${step.requestId}`)).body.answerUrl).toBe(answerUrl);

    const token = tokenOf(answerUrl);
    const page = await (await answerGet(new Request(answerUrl), ctx(token))).json();
    expect(page.concerns[0]).toMatchObject({ key: step.concerns[0].key, confirmable: true });
    const answered = await answerPost(new Request(answerUrl, { method: "POST", body: JSON.stringify({ by: "Sanna", responses: [{ key: step.concerns[0].key, choice: "confirm" }] }) }), ctx(token));
    expect(answered.status).toBe(200);
    // Spent: a second answer through the same link is refused.
    const again = await answerPost(new Request(answerUrl, { method: "POST", body: JSON.stringify({ by: "Mallory", responses: [{ key: step.concerns[0].key, choice: "confirm" }] }) }), ctx(token));
    expect(again.status).toBe(410);

    const rt = await getRuntime();
    const entry = rt.dock.ledger.entries().find((e) => e.requestId === step.requestId && e.data.step === "confirmation")!;
    expect(entry).toMatchObject({ actor: "door:answer_link", data: { channel: "answer_link", verified: false, needsSignOff: true } });
    expect(entry.summary).toMatch(/one-time link.*not identified/);

    const next = (await call("GET", `/api/v1/intake/${step.requestId}`)).body;
    expect(next.step.state).toBe("options_ready");
    expect(next.answerUrl).toBeUndefined(); // choosing an option is not a link question
    expect(next.nextStep).toContain(`POST /api/v1/intake/${step.requestId}/choice`);
    const quoted = (await call("POST", `/api/v1/intake/${step.requestId}/choice`, { by: "Sanna", optionId: next.step.options[0].optionId })).body;
    expect(quoted.waitingFor).toBe("agent");
    expect(quoted.nextStep).toMatch(/Call POST \/api\/v1\/orders now with just .*No sign-off is needed before ordering/);
    // Placed with the requestId alone. The unidentified answer to a large amount still goes to a named person.
    const order = await call("POST", "/api/v1/orders", { requestId: step.requestId });
    expect(order.status).toBe(202);
    expect(order.body.order.decision.rules.find((r: { rule: string }) => r.rule === "human_confirmation").outcome).toBe("escalate");
    expect(order.body.nextStep).toMatch(/^Your part is done: this order now waits for a human sign-off/);
    expect(order.body.nextStep).toContain(`GET /api/v1/orders/${order.body.order.orderId}`);
    // No current quote any more: the short form says why.
    const twice = await call("POST", "/api/v1/orders", { requestId: step.requestId });
    expect(twice).toMatchObject({ status: 409, body: { error: { code: "no_current_quote", rule: "quote_replay" } } });
  });

  it("a stale or unknown link answers nothing", async () => {
    expect((await answerGet(new Request("http://dock.test/answer/x"), ctx("nope-nope-nope-nope-nope"))).status).toBe(404);
  });
});

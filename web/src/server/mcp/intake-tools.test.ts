import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "../demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { getRuntime, resetRuntime } from "../runtime";
import { IntakeStepSchema } from "../wire";
import { HUMAN_INPUT_META } from "./ask-human";

/** The intake over MCP, with a stock client: as an agent that relays, and as a client that lets Dock ask the buyer. */
const BASE = "http://dock.test";
const inProcess = async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init));

type Elicit = { message: string; requestedSchema: { properties: Record<string, { default?: unknown; oneOf?: { const: string }[] }>; required?: string[] } };
type Buyer = (form: Elicit) => { action: "accept" | "decline" | "cancel"; content?: Record<string, string | number | boolean | string[]> };

/** A stock MCP client. With `buyer`, it declares elicitation and shows Dock's forms to that (scripted) person. */
async function connect(headers: Record<string, string>, buyer?: Buyer) {
  const client = new Client({ name: "test-agent", version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } }, ...(buyer ? { capabilities: { elicitation: { form: {} } } } : {}) });
  if (buyer) client.setRequestHandler("elicitation/create", async (req) => buyer(req.params as unknown as Elicit));
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: inProcess, requestInit: { headers } }));
  await client.listTools(); // so the client validates every result against the published output schema
  return client;
}

type Structured = { ok: boolean; error?: { code: string; rule?: string; message: string; details?: Record<string, unknown> }; nextStep: string; waitingFor?: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { isError: r.isError ?? false, s: r.structuredContent as Structured };
}

let kitchenAuth: Record<string, string>;
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const milk = (amount = 1000) => ({ need: { item: { text: "milk", category: "milk" }, quantity: { amount, unit: "L" }, deliverBy: day() }, by: "Sanna" });

beforeEach(async () => {
  resetRuntime();
  const m = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  kitchenAuth = { authorization: `Bearer ${m}`, "dock-agent-id": KITCHEN_ORG.agentId };
});

describe("intake tools", () => {
  it("are listed first, after the mandate, and the human-input ones are marked", async () => {
    const { tools } = await (await connect({})).listTools();
    expect(tools.map((t) => t.name).slice(0, 8)).toEqual(["read_mandate", "submit_need", "respond_to_concerns", "answer_questions", "choose_option", "get_intake_step", "read_kitchen_memory", "place_order"]);
    expect(tools.find((t) => t.name === "submit_need")!.description).toMatch(/^START HERE/);
    expect(tools.find((t) => t.name === "search_products")!.description).toMatch(/^Lower-level/);
    const human = tools.filter((t) => t._meta?.[HUMAN_INPUT_META]).map((t) => t.name);
    expect(human).toEqual(["respond_to_concerns", "answer_questions"]);
    for (const name of human) expect(tools.find((t) => t.name === name)!.description).toMatch(/MUST come from the human buyer/);
  });

  it("drives need -> mistake check -> options -> quote -> order, with the agent relaying the buyer's answers", async () => {
    const client = await connect(kitchenAuth);
    const opened = await call(client, "submit_need", milk());
    expect(opened.s).toMatchObject({ ok: true, waitingFor: "buyer", step: { state: "needs_confirmation" } });
    IntakeStepSchema.parse(opened.s.step);
    expect(opened.s.nextStep).toMatch(/respond_to_concerns.*must come from the human buyer.*Do not answer for them/);
    const { requestId, concerns } = opened.s.step;
    expect(concerns[0].code).toBe("quantity_tenfold");

    // No answer from the buyer: refused, by rule.
    const blank = await call(client, "respond_to_concerns", { requestId });
    expect(blank).toMatchObject({ isError: true, s: { error: { code: "human_answer_required", rule: "human_input" } } });
    expect(blank.s.nextStep).toMatch(/Never answer for them/);

    const confirmed = await call(client, "respond_to_concerns", { requestId, by: "Sanna", responses: [{ key: concerns[0].key, choice: "confirm" }] });
    // Memory answers everything else, so the buyer goes straight to the options (no question first).
    expect(confirmed.s).toMatchObject({ waitingFor: "buyer", step: { state: "options_ready", questions: [] } });

    // The buyer may still say what matters most; "no preference" keeps the choice theirs.
    const answered = await call(client, "answer_questions", { requestId, by: "Sanna", answers: [{ questionId: "optimise", optionId: "no_preference" }] });
    expect(answered.s).toMatchObject({ waitingFor: "buyer", step: { state: "options_ready" } });
    expect(answered.s.step.options.length).toBeGreaterThanOrEqual(2);
    expect(answered.s.nextStep).toMatch(/choose_option/);

    const quoted = await call(client, "choose_option", { requestId, by: "Sanna", optionId: answered.s.step.options[0].optionId });
    expect(quoted.s).toMatchObject({ waitingFor: "agent", step: { state: "quoted", quote: { quoteToken: expect.any(String) } } });
    expect(quoted.s.nextStep).toMatch(/place_order with just .*requestId/);

    const placed = await call(client, "place_order", quoted.s.step.next.example);
    expect(placed.isError).toBe(false);
    expect(["pending_approval", "committed"]).toContain(placed.s.order.status);

    expect((await call(client, "get_intake_step", { requestId })).s.step.state).toBe("quoted");
    const memory = await call(client, "read_kitchen_memory");
    expect(memory.s.kitchen.stated[0].text).toBe("Always lactose-free");

    const { dock } = await getRuntime();
    const confirmation = dock.ledger.entries({ requestId }).find((e) => e.data.step === "confirmation")!;
    // Relayed by the agent (no elicitation here): recorded as such, never as Sanna's own confirmation.
    expect(confirmation).toMatchObject({ actor: `agent:${KITCHEN_ORG.agentId}`, data: { by: "Sanna", relayedBy: KITCHEN_ORG.agentId, verified: false } });
  });

  it("cannot skip a pending confirmation, through the intake tools or around them", async () => {
    const client = await connect(kitchenAuth);
    const { step } = (await call(client, "submit_need", milk())).s;
    const { requestId } = step;

    const choose = await call(client, "choose_option", { requestId, by: "agent", optionId: "opt_1" });
    expect(choose.s.error).toMatchObject({ code: "intake_wrong_state", rule: "intake_sequence", details: { state: "needs_confirmation" } });
    expect(choose.s.nextStep).toMatch(/get_intake_step/);
    const answer = await call(client, "answer_questions", { requestId, by: "agent", answers: [{ questionId: "optimise", optionId: "price" }] });
    expect(answer.s.error).toMatchObject({ code: "intake_wrong_state", rule: "intake_sequence" });

    const around = await call(client, "request_quote", { requestId, lines: [{ productId: "VA-1010", quantity: 10 }] });
    expect(around).toMatchObject({ isError: true, s: { error: { code: "intake_needs_confirmation", rule: "human_input" } } });
    expect(around.s.nextStep).toMatch(/respond_to_concerns/);
    const order = await call(client, "place_order", { requestId, quoteToken: "a.b.c", lines: [] });
    expect(order.s.error).toMatchObject({ code: "intake_needs_confirmation", rule: "human_input" });

    expect((await call(client, "get_intake_step", { requestId })).s.step.state).toBe("needs_confirmation");
    const { dock } = await getRuntime();
    expect(dock.ledger.entries({ requestId }).filter((e) => e.type === "refusal" && e.data.rule === "human_input")).toHaveLength(2);
  });

  it("reaches cancelled and no_options, and says what to do in each", async () => {
    const laakso = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
    const firstTimer = await connect({ authorization: `Bearer ${laakso}`, "dock-agent-id": DEMO_ORG.agentId });
    // A first order of 1,000 L is not stopped: the size is a note on every option card.
    const big = (await call(firstTimer, "submit_need", milk())).s.step;
    expect(big).toMatchObject({ state: "options_ready", concerns: [] });
    expect(big.options[0].cons.join(" ")).toMatch(/first order/);

    // The same need twice: the second one is a likely duplicate, and the buyer cancels it.
    const client = await connect(kitchenAuth);
    const once = (await call(client, "submit_need", { ...milk(60), need: { ...milk(60).need, optimise: "price" } })).s.step;
    expect(once.state).toBe("quoted");
    expect((await call(client, "place_order", once.next.example)).isError).toBe(false);
    const dup = (await call(client, "submit_need", { ...milk(60), need: { ...milk(60).need, optimise: "price" } })).s.step;
    expect(dup.concerns.map((c: { code: string }) => c.code)).toEqual(["duplicate_recent"]);
    const cancelled = await call(client, "respond_to_concerns", { requestId: dup.requestId, by: "Sanna", responses: [{ key: dup.concerns[0].key, choice: "cancel" }] });
    expect(cancelled.s).toMatchObject({ waitingFor: "nobody", step: { state: "cancelled" } });
    expect(cancelled.s.nextStep).toMatch(/Do not place an order/);
    expect((await call(client, "request_quote", { requestId: dup.requestId, lines: [{ productId: "VA-1001", quantity: 1 }] })).s.error).toMatchObject({ code: "intake_cancelled", rule: "intake_sequence" });

    const none = await call(client, "submit_need", { need: { item: { text: "milk", category: "milk", attributes: ["vegan"] }, quantity: { amount: 100, unit: "L" }, deliverBy: nextDeliveryDay(day(), [1, 2, 3, 4, 5]), optimise: "price" } });
    expect(none.s).toMatchObject({ waitingFor: "nobody", step: { state: "no_options" } });
    expect(none.s.nextStep).toMatch(/Tell the buyer why/);

    const unknown = await call(client, "get_intake_step", { requestId: "req_nope" });
    expect(unknown.s.error).toMatchObject({ code: "intake_not_found" });
    const invalid = await call(client, "submit_need", { need: { item: { text: "milk" } } });
    expect(invalid.s.error).toMatchObject({ code: "invalid_request" });
  });
});

describe("intake tools with a client that can ask the buyer (MCP elicitation)", () => {
  it("asks the buyer directly; the agent's proposal only pre-fills the form, and the buyer's answer wins", async () => {
    const forms: Elicit[] = [];
    const buyer: Buyer = (form) => {
      forms.push(form);
      const [field] = Object.keys(form.requestedSchema.properties).filter((k) => k !== "by" && k !== "remember");
      return { action: "accept", content: { by: "Sanna Koskinen", [field]: field === "optimise" ? "price" : "confirm" } };
    };
    const client = await connect(kitchenAuth, buyer);
    const { step } = (await call(client, "submit_need", milk())).s;
    const key = step.concerns[0].key;

    // The agent proposes a correction; the buyer sees it pre-selected, and confirms the 1,000 L instead.
    const r = await call(client, "respond_to_concerns", { requestId: step.requestId, by: "agent guess", responses: [{ key, choice: step.concerns[0].corrections[0].id }] });
    expect(r.s).toMatchObject({ ok: true, step: { state: "options_ready", need: { quantity: { amount: 1000 } }, acknowledgements: [{ action: "confirmed", by: "Sanna Koskinen" }] } });
    expect(forms[0].requestedSchema.properties[key]).toMatchObject({ default: step.concerns[0].corrections[0].id, oneOf: expect.arrayContaining([{ const: "confirm", title: expect.any(String) }]) });
    expect(forms[0].requestedSchema.required).toEqual(["by", key]);
    // Elicitation is the protocol's own human-input mechanism: the answer is the buyer's, not relayed.
    expect(r.s.step.acknowledgements[0]).toMatchObject({ channel: "protocol_elicitation", verified: true });
  });

  it("changes nothing when the buyer declines", async () => {
    const client = await connect(kitchenAuth, () => ({ action: "decline" }));
    const { step } = (await call(client, "submit_need", milk())).s;
    const r = await call(client, "respond_to_concerns", { requestId: step.requestId, by: "Sanna", responses: [{ key: step.concerns[0].key, choice: "confirm" }] });
    expect(r).toMatchObject({ isError: true, s: { error: { code: "buyer_declined", rule: "human_input" } } });
    expect(r.s.nextStep).toMatch(/Do not answer for them/);
    expect((await call(client, "get_intake_step", { requestId: step.requestId })).s.step.state).toBe("needs_confirmation");
    // An explicit decline does not open the relay fallback.
    const relayed = await call(client, "respond_to_concerns", { requestId: step.requestId, relay: true, by: "Sanna", responses: [{ key: step.concerns[0].key, choice: "confirm" }] });
    expect(relayed.s.error).toMatchObject({ code: "buyer_declined" });
  });

  it("falls back to the agent relaying when the client closes the form unanswered (cannot show it)", async () => {
    let shown = 0;
    const client = await connect(kitchenAuth, () => (shown++, { action: "cancel" }));
    const { step } = (await call(client, "submit_need", milk())).s;
    const answer = { requestId: step.requestId, by: "Sanna", responses: [{ key: step.concerns[0].key, choice: "confirm" }] };

    // relay: true before any form went unanswered changes nothing: Dock still asks through the form.
    const early = await call(client, "respond_to_concerns", { ...answer, relay: true });
    expect(early).toMatchObject({ isError: true, s: { error: { code: "form_not_answered", rule: "human_input" } } });
    expect(early.s.nextStep).toMatch(/Ask the buyer.*relay: true.*Never answer for them/);
    expect(shown).toBe(1);

    const relayed = await call(client, "respond_to_concerns", { ...answer, relay: true });
    expect(relayed.s).toMatchObject({ ok: true, step: { state: "options_ready" } });
    expect(relayed.s.step.acknowledgements[0]).toMatchObject({ channel: "relayed", verified: false });
    expect(shown).toBe(1);
  });
});

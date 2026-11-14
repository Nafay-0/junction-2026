import { APICallError } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { addDaysIso, localNow, nextDeliveryDay } from "@/core/kitchen";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { connectDock, type DockConnection, type DockTool, type ToolOutcome } from "./dock-connection";
import { absentHuman, scriptedHuman } from "./human";
import { demoCredentials, runBuyerAgent } from "./runner";
import { scriptedModel, type Seen } from "./testing";
import type { TranscriptEvent } from "./transcript";

const MILK = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
const neededBy = () => addDaysIso(localNow(new Date()).date, 7);

type Q = { quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }; quoteToken: string };
const reqId = (s: Seen) => (s.last("open_request")?.request as { requestId: string }).requestId;
const orderLines = (q: Q) => q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
const ofType = <T extends TranscriptEvent["type"]>(events: TranscriptEvent[], type: T) => events.filter((e) => e.type === type) as Extract<TranscriptEvent, { type: T }>[];

beforeEach(() => resetRuntime());

describe("buyer agent runner (scripted model)", () => {
  it("happy path: the milk order goes from read_mandate to a pending sign-off, then the agent reports", async () => {
    const fake = scriptedModel([
      { calls: [{ name: "read_mandate", args: {} }] },
      { calls: [{ name: "open_request", args: { text: MILK, neededBy: neededBy() } }] },
      (s) => ({ calls: [{ name: "search_products", args: { requestId: reqId(s), text: "milk", category: "milk", attributes: ["lactose_free", "fat_1_5"] } }] }),
      (s) => ({ calls: [{ name: "check_availability", args: { requestId: reqId(s), productIds: ["VA-1010", "AR-2010"] } }] }),
      (s) => ({
        calls: [{ name: "request_quote", args: { requestId: reqId(s), lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] } }],
      }),
      (s) => {
        const q = s.last("request_quote") as unknown as Q;
        return { calls: [{ name: "place_order", args: { requestId: reqId(s), quoteToken: q.quoteToken, lines: orderLines(q) } }] };
      },
      { text: "The order waits for sign-off." },
    ]);
    const r = await runBuyerAgent({ model: fake, task: MILK });

    expect(r.outcome).toBe("pending_approval");
    expect(r.order?.status).toBe("pending_approval");
    expect(r.steps).toBe(7);
    expect(r.toolCalls).toBe(6);
    expect(r.refusals).toBe(0);
    expect(r.violations).toBe(0);
    expect(r.finalText).toBe("The order waits for sign-off.");
    expect(r.tools).toEqual(expect.arrayContaining(["read_mandate", "open_request", "search_products", "check_availability", "request_quote", "place_order"]));
    expect(r.tokens).toMatchObject({ input: 7000, output: 350, total: 7350 });
    expect(r.costUsd).toBeNull(); // no price for a scripted model
    expect(ofType(r.events, "model")).toHaveLength(7);
    expect(ofType(r.events, "tool_result").every((e) => e.ok)).toBe(true);
    // The model saw Dock's real results: the second turn's prompt carries read_mandate's structured output.
    expect(JSON.stringify(ofType(r.events, "tool_result")[0].result)).toContain("perOrderLimitCents");
  });

  it("refusal then recovery: a doctored price is refused with a named rule, then the honest order commits", async () => {
    const fake = scriptedModel([
      { calls: [{ name: "open_request", args: { text: "20 litres of lactose-free milk" } }] },
      (s) => ({ calls: [{ name: "request_quote", args: { requestId: reqId(s), lines: [{ productId: "VA-1001", quantity: 20 }] } }] }),
      (s) => {
        const q = s.last("request_quote") as unknown as Q;
        return { calls: [{ name: "place_order", args: { requestId: reqId(s), quoteToken: q.quoteToken, lines: orderLines(q).map((l) => ({ ...l, unitPriceCents: 1 })) } }] };
      },
      (s) => {
        const q = s.last("request_quote") as unknown as Q;
        return { calls: [{ name: "place_order", args: { requestId: reqId(s), quoteToken: q.quoteToken, lines: orderLines(q) } }] };
      },
      { text: "Ordered." },
    ]);
    const r = await runBuyerAgent({ model: fake, task: "Buy 20 litres of lactose-free milk." });

    expect(r.outcome).toBe("committed");
    const [refusal] = ofType(r.events, "refusal");
    expect(refusal).toMatchObject({ name: "place_order", rule: "order_matches_quote" });
    expect(r.refusals).toBe(1);
    expect(r.order?.status).toBe("committed");
  });

  it("ends as refused when the agent stops right after a refusal", async () => {
    const fake = scriptedModel([
      { calls: [{ name: "open_request", args: { text: "oat drink" } }] },
      (s) => ({ calls: [{ name: "request_quote", args: { requestId: reqId(s), lines: [{ productId: "PK-4001", quantity: 50 }] } }] }),
      (s) => {
        const q = s.last("request_quote") as unknown as Q;
        return { calls: [{ name: "place_order", args: { requestId: reqId(s), quoteToken: q.quoteToken, lines: orderLines(q) } }] };
      },
      { text: "Dock refused it." },
    ]);
    const r = await runBuyerAgent({ model: fake, task: "Buy 50 oat drinks." });
    expect(r.outcome).toBe("refused");
    expect(ofType(r.events, "refusal")[0].rule).toBe("forbidden_allergens");
  });

  it("step cap: a model that never stops is cut off at maxSteps", async () => {
    const fake = scriptedModel([{ calls: [{ name: "read_mandate", args: {} }] }]);
    const r = await runBuyerAgent({ model: fake, task: MILK, caps: { maxSteps: 3 } });
    expect(r.outcome).toBe("cap_reached");
    expect(r.cap).toBe("steps");
    expect(r.steps).toBe(3);
    expect(fake.turns()).toBe(3);
  });

  it("token and cost caps stop the run before the call that would cross them", async () => {
    const tokensCapped = await runBuyerAgent({ model: scriptedModel([{ calls: [{ name: "read_mandate", args: {} }] }], { inputTokens: 20_000 }), task: MILK, caps: { maxTotalTokens: 60_000 } });
    expect(tokensCapped).toMatchObject({ outcome: "cap_reached", cap: "tokens" });
    expect(tokensCapped.tokens.total).toBeLessThanOrEqual(60_000);

    const priced = { ...scriptedModel([{ calls: [{ name: "read_mandate", args: {} }] }], { inputTokens: 10_000 }), price: { inputPerM: 1, outputPerM: 5 } };
    const costCapped = await runBuyerAgent({ model: priced, task: MILK, caps: { maxCostUsd: 0.03 } });
    expect(costCapped).toMatchObject({ outcome: "cap_reached", cap: "cost" });
    expect(costCapped.costUsd!).toBeLessThanOrEqual(0.03);
  });

  it("tool errors: an unknown tool and bad arguments come back to the model as errors, and the run goes on", async () => {
    const fake = scriptedModel([
      { calls: [{ name: "approve_order", args: { orderId: "x" } }] },
      { calls: [{ name: "check_availability", args: { productIds: "VA-1010" } }] },
      (s) => ({ text: `Saw ${s.results.filter((x) => x.isError).length} errors.` }),
    ]);
    const r = await runBuyerAgent({ model: fake, task: MILK });
    const errors = ofType(r.events, "tool_error");
    expect(errors.map((e) => e.name)).toEqual(["approve_order", "check_availability"]);
    expect(errors[0].message).toMatch(/unavailable tool 'approve_order'/);
    expect(errors[1].message).toMatch(/Invalid arguments for tool check_availability/); // Dock's own validation, as any client gets it
    expect(r.finalText).toBe("Saw 2 errors.");
    expect(r.outcome).toBe("refused"); // Dock's last word was an error
  });

  it("retries a rate-limited model call with backoff and records it", async () => {
    const fake = scriptedModel([{ text: "Nothing to do." }]);
    const real = fake.model.doGenerate;
    let calls = 0;
    fake.model.doGenerate = async (o) => {
      if (calls++ === 0) throw new APICallError({ message: "rate limited", url: "x", requestBodyValues: {}, statusCode: 429, responseHeaders: { "retry-after": "2" }, isRetryable: true });
      return real(o);
    };
    const waits: number[] = [];
    const r = await runBuyerAgent({ model: fake, task: MILK, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000]);
    expect(ofType(r.events, "retry")).toHaveLength(1);
    expect(r.outcome).toBe("gave_up");
  });

  it("a provider error that is not retryable ends the run as error", async () => {
    const fake = scriptedModel([{ text: "x" }]);
    fake.model.doGenerate = async () => {
      throw new APICallError({ message: "bad key", url: "x", requestBodyValues: {}, statusCode: 401, isRetryable: false });
    };
    const r = await runBuyerAgent({ model: fake, task: MILK });
    expect(r.outcome).toBe("error");
    expect(r.error).toMatch(/401/);
  });
});

/**
 * Intake tools under the names the MCP table gives them (submit_need, respond_to_concerns,
 * answer_questions). Where the table does not carry them yet they are played here at the connection
 * layer; where it does, the real ones are used. The runner recognises them by their input shapes only.
 */
async function withIntakeTools(conn: DockConnection, creds: { mandate: string; agentId: string }): Promise<DockConnection> {
  const { dock } = await getRuntime();
  const session = await dock.authenticate(creds.mandate, creds.agentId);
  const wrap = async (fn: () => Promise<unknown>): Promise<ToolOutcome> => {
    try {
      const structured = { ok: true, step: await fn() };
      return { ok: true, structured, text: JSON.stringify(structured) };
    } catch (err) {
      const e = err as { code: string; rule?: string; message: string };
      const structured = { ok: false, error: { code: e.code, rule: e.rule, message: e.message }, nextStep: "" };
      return { ok: false, structured, text: JSON.stringify(structured) };
    }
  };
  const extra: (DockTool & { run: (a: Record<string, unknown>) => Promise<ToolOutcome> })[] = [
    {
      name: "submit_need",
      description: "Start from a structured need.",
      inputSchema: { type: "object", properties: { need: { type: "object" }, by: { type: "string" } }, required: ["need"] },
      run: (a) => wrap(() => dock.intake.open(session, a as never)),
    },
    {
      name: "respond_to_concerns",
      description: "Confirm or correct the concerns Dock raised.",
      inputSchema: {
        type: "object",
        properties: { requestId: { type: "string" }, by: { type: "string" }, responses: { type: "array", items: { type: "object", properties: { key: { type: "string" }, choice: { type: "string" } } } } },
      },
      run: ({ requestId, ...rest }) => wrap(() => dock.intake.respondToConcerns(session, requestId as string, rest as never)),
    },
    {
      name: "answer_questions",
      description: "Answer Dock's questions.",
      inputSchema: {
        type: "object",
        properties: { requestId: { type: "string" }, by: { type: "string" }, answers: { type: "array", items: { type: "object", properties: { questionId: { type: "string" }, optionId: { type: "string" } } } } },
      },
      run: ({ requestId, ...rest }) => wrap(() => dock.intake.answer(session, requestId as string, rest as never)),
    },
  ];
  const have = new Set(conn.tools().map((t) => t.name));
  const missing = extra.filter((t) => !have.has(t.name));
  if (missing.length === 0) return conn;
  return {
    instructions: conn.instructions,
    tools: () => [...conn.tools(), ...missing],
    call: (name, args) => missing.find((t) => t.name === name)?.run(args) ?? conn.call(name, args),
    close: () => conn.close(),
  };
}

describe("human-input steps", () => {
  const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;

  it("the buyer answers Dock; the model's own attempt to answer is blocked and recorded", async () => {
    const creds = await demoCredentials("kitchen");
    const dock = await withIntakeTools(await connectDock(creds), creds);
    const human = scriptedHuman([
      (p) => (p.kind === "confirmation" ? { by: "Sanna", responses: p.concerns.map((c) => ({ key: c.key, choice: c.corrections[0].id })) } : null),
      { by: "Sanna", answers: [{ questionId: "optimise", optionId: "no_preference" }] },
    ]);
    const fake = scriptedModel([
      { calls: [{ name: "submit_need", args: { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() } } }] },
      (s) => {
        const reqIdFromRelay = /"requestId":"([^"]+)"/.exec(s.userTexts.at(-1) ?? "")?.[1];
        return { calls: [{ name: "answer_questions", args: { requestId: reqIdFromRelay, by: "Sanna", answers: [{ questionId: "optimise", optionId: "price" }] } }] };
      },
      { text: "Options are ready for the buyer." },
    ]);
    const r = await runBuyerAgent({ model: fake, task: "1000 litres of milk", dock, human });

    // After the correction memory answers the rest, so Dock asks the buyer nothing more before the options.
    expect(human.asked.map((p) => p.kind)).toEqual(["confirmation"]);
    const relayed = ofType(r.events, "tool_call").filter((e) => e.by === "human_relay");
    expect(relayed.map((e) => e.name)).toEqual(["respond_to_concerns"]);
    const [v] = ofType(r.events, "violation");
    expect(v).toMatchObject({ kind: "answered_for_human", name: "answer_questions" });
    expect(r.violations).toBe(1);
    // Dock never received the model's answer: the ledger holds no answer at all.
    const { dock: d } = await getRuntime();
    const answers = d.ledger.entries().filter((e) => e.type === "intake" && (e.data as { step?: string }).step === "answer");
    expect(answers).toEqual([]);
    expect(r.outcome).toBe("gave_up");
  });

  it("a buyer who does not answer ends the run as awaiting_human", async () => {
    const creds = await demoCredentials("kitchen");
    const dock = await withIntakeTools(await connectDock(creds), creds);
    const fake = scriptedModel([{ calls: [{ name: "submit_need", args: { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() } } }] }]);
    const r = await runBuyerAgent({ model: fake, task: "1000 litres of milk", dock, human: absentHuman });
    expect(r.outcome).toBe("awaiting_human");
    expect(ofType(r.events, "human")[0].answer).toBeNull();
  });
});

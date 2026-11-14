import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import type { PublicOrder } from "@/core/orders";
import { resolveKitchen } from "./console-kitchens";
import { KITCHEN_ORG } from "./demo-kitchen";
import { reissueKitchenMandate } from "./mandate-reissue";
import { getMemoryService, resetMemoryService } from "./memory/runtime";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * Findings of the end-to-end review (Sat 14 Nov), each closed and kept here as the test that failed before. In all
 * three an order committed that the product's own words said would not. They sit on one boundary: what the gate
 * enforces on every door (the signed mandate, and now the mistake check), and what a caller could skip or answer
 * for itself.
 */
const BASE = "http://dock.test";
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const ORDINARY_MILK = "VA-1110"; // 10 L bag-in-box, not lactose-free: Kaari's head chef stated "always lactose-free"

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  (globalThis as { __dockConsoleTokens?: unknown; __dockMenuTokens?: unknown }).__dockConsoleTokens = undefined;
  (globalThis as { __dockMenuTokens?: unknown }).__dockMenuTokens = undefined;
});

/** Kaari's agent using the lower-level calls (open a request, ask for a quote, place the order), not the intake. */
async function orderDirectly(productId: string, packs: number): Promise<PublicOrder> {
  const { dock } = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  const session = await dock.authenticate(k.mandateToken, k.agentId);
  const req = await dock.openRequest(session, { text: "milk for the kitchen", neededBy: day() });
  const { quote, quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: packs }] });
  return dock.placeOrder(session, { requestId: req.requestId, quoteToken, lines: quote.lines.map(({ productId: id, quantity, unitPriceCents }) => ({ productId: id, quantity, unitPriceCents })) });
}

describe("finding 1: 'In the signed mandate: the gate enforces it' is now true", () => {
  // Before: accepting "Add this to the signed mandate, so the gate enforces it and not only memory?" recorded the
  // decision, wrote "added ... to the kitchen's mandate" to the ledger and showed "In the signed mandate: the gate
  // enforces it", while nothing changed the mandate the gate checks: ordinary milk for Kaari still committed.
  // Now the kitchen's mandate is signed again with the rule and its earlier mandates stop working
  // (server/mandate-reissue.ts; the rest of it is tested in mandate-reissue.test.ts).
  it("a rule the kitchen added to its mandate on the memory page stops an order that breaks it", async () => {
    const rt = await getRuntime();
    const memory = await getMemoryService();
    const k = (await resolveKitchen("kaari"))!;
    const by = "Sanna Koskinen (signed in)";
    let offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
    if (!offers.some((o) => o.patch.requiredAttributes?.includes("lactose_free"))) {
      await memory.write(k.info.orgId, { door: "memory_page", by, segments: [], events: [{ type: "rule_stated", fact: { kind: "diet", claim: "lactose_free" }, strength: "rule" }] }, k.info.name);
      offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
    }
    const offer = offers.find((o) => o.patch.requiredAttributes?.includes("lactose_free"))!;
    const reissued = await reissueKitchenMandate(rt, k.info, offer.patch, by);
    const after = await memory.decideMandate(k.info.orgId, offer.itemId, "added", by, reissued);
    expect(after.items.find((i: { id: string }) => i.id === offer.itemId)).toMatchObject({ mandate: { status: "added", mandateId: reissued.mandateId } }); // the page now says the gate enforces it

    const order = await orderDirectly(ORDINARY_MILK, 2); // €23, within the €100 the agent may spend alone
    expect(order.status).toBe("rejected");
    expect(order.decision.rules.find((r) => r.rule === "required_attributes")?.outcome).toBe("fail");
  });
});

describe("finding 2: the mistake check is a rule of the gate, on every door", () => {
  // Before: "the same mistake checks" (src/app/k/[kitchen]/agent-rules.tsx) was true only through the intake. An
  // agent that called open_request, get_quote and place_order was never asked, and an order against a rule a person
  // stated for the kitchen committed alone whenever it fit the mandate's limits. Now the gate runs the same check
  // on the order itself (core/order-check.ts), and what it flags goes to a named person.
  it("an order against the kitchen's stated rule, placed without the intake, goes to a named person with the check shown", async () => {
    const order = await orderDirectly(ORDINARY_MILK, 2);
    expect(order.status).toBe("pending_approval");
    expect(order.decision.rules.find((r) => r.rule === "human_confirmation")).toMatchObject({ outcome: "escalate", details: { flagged: expect.arrayContaining(["contradicts_preference"]) } });
    // The decision names the kind of check; the words, which quote the kitchen's own rule, go to the person signing.
    expect(order.decision.reasons.join(" ")).toMatch(/The mistake check flagged .*a request against one of the kitchen's own rules.*and no person was asked/);
    expect(order.notes?.join(" ")).toMatch(/Nobody was asked: .*contains lactose.*Always lactose-free/);
  });

  it("quoting something else under an intake's request does not borrow the intake's answers", async () => {
    const { dock } = await getRuntime();
    const k = (await resolveKitchen("kaari"))!;
    const session = await dock.authenticate(k.mandateToken, k.agentId);
    // A harmless need through the intake (nothing to confirm), then a lower-level quote for ordinary milk on the same request.
    const step = await dock.intake.open(session, { need: { text: "100 L milk", item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: day(), optimise: "price" }, by: "Sanna" });
    expect(step.state).not.toBe("needs_confirmation");
    const { quote, quoteToken, policyPreview } = await dock.requestQuote(session, { requestId: step.requestId, lines: [{ productId: ORDINARY_MILK, quantity: 2 }] });
    expect(policyPreview.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("escalate");
    const order = await dock.placeOrder(session, { requestId: step.requestId, quoteToken, lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    expect(order.status).toBe("pending_approval");
  });

  it("no second question: what the kitchen's signed-in person confirmed on the store's own intake commits alone", async () => {
    const { dock } = await getRuntime();
    const k = (await resolveKitchen("kaari"))!;
    const session = await dock.authenticate(k.mandateToken, k.agentId);
    const person = { channel: "portal_session" as const, person: "Sanna Koskinen" };
    let step = await dock.intake.open(session, { need: { text: "20 litres of ordinary milk", item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] }, quantity: { amount: 20, unit: "L" }, deliverBy: day() }, by: "Sanna Koskinen" });
    expect(step.concerns.map((c) => c.code)).toContain("contradicts_preference");
    for (let i = 0; i < 6 && step.state !== "quoted"; i++) {
      if (step.state === "needs_confirmation") step = await dock.intake.respondToConcerns(session, step.requestId, { by: "Sanna Koskinen", responses: step.concerns.map((c) => ({ key: c.key, choice: "confirm" })) }, person);
      else if (step.state === "needs_input") step = await dock.intake.answer(session, step.requestId, { by: "Sanna Koskinen", answers: step.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })) }, person);
      else if (step.state === "options_ready") step = await dock.intake.choose(session, step.requestId, { by: "Sanna Koskinen", optionId: (step.options.find((o) => o.lines.some((l) => l.productId === ORDINARY_MILK)) ?? step.options[0]).optionId }, person);
      else break;
    }
    expect(step.state).toBe("quoted");
    const order = await dock.placeOrder(session, { requestId: step.requestId });
    expect(order.decision.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("pass");
    expect(order.status).toBe(order.totalCents <= k.info.mandate.perOrderLimitCents ? "committed" : "pending_approval");
    expect(order.totalCents).toBeLessThanOrEqual(k.info.mandate.perOrderLimitCents);
  });
});

describe("finding 3: what a client says its user answered is relayed, not the buyer's own", () => {
  type Elicit = { requestedSchema: { properties: Record<string, { oneOf?: { const: string }[] }> } };
  type Structured = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** An MCP client. With `answersForms`, it declares elicitation and fills Dock's forms itself: no person is asked. */
  async function agent(answersForms: boolean) {
    const k = (await resolveKitchen("kaari"))!;
    const client = new Client({ name: "outside-agent", version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } }, ...(answersForms ? { capabilities: { elicitation: { form: {} } } } : {}) });
    if (answersForms) {
      client.setRequestHandler("elicitation/create", async (req) => {
        const props = (req.params as unknown as Elicit).requestedSchema.properties;
        const content: Record<string, string> = { by: "Sanna Koskinen" };
        for (const [field, p] of Object.entries(props)) {
          if (field === "by" || field === "remember") continue;
          const choices = (p.oneOf ?? []).map((c) => c.const);
          content[field] = choices.includes("confirm") ? "confirm" : (choices[0] ?? "confirm");
        }
        return { action: "accept" as const, content };
      });
    }
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init)), requestInit: { headers: { authorization: `Bearer ${k.mandateToken}`, "dock-agent-id": KITCHEN_ORG.agentId } } }));
    await client.listTools();
    const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as CallToolResult).structuredContent as Structured;
    return { call };
  }

  /** "20 litres of ordinary milk" for a kitchen whose chef stated "always lactose-free": the intake asks, the agent says yes. */
  async function ordinaryMilkConfirmedBy(answersForms: boolean): Promise<Structured> {
    const { call } = await agent(answersForms);
    let s = await call("submit_need", { need: { text: "20 litres of ordinary milk", item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] }, quantity: { amount: 20, unit: "L" }, deliverBy: day() }, by: "Sanna" });
    const requestId = s.step.requestId as string;
    expect(s.step.state).toBe("needs_confirmation");
    expect(s.step.concerns.map((c: { code: string }) => c.code)).toContain("contradicts_preference");
    for (let i = 0; i < 6 && s.step.state !== "quoted"; i++) {
      const step = s.step;
      if (step.state === "needs_confirmation") s = await call("respond_to_concerns", { requestId, by: "Sanna", ...(answersForms ? {} : { relay: true }), responses: step.concerns.map((c: { key: string }) => ({ key: c.key, choice: "confirm" })) });
      else if (step.state === "needs_input") s = await call("answer_questions", { requestId, by: "Sanna", ...(answersForms ? {} : { relay: true }), answers: step.questions.map((q: { id: string; options: { id: string }[] }) => ({ questionId: q.id, optionId: q.options[0].id })) });
      else if (step.state === "options_ready") s = await call("choose_option", { requestId, by: "Sanna", optionId: step.options.find((o: { lines: { productId: string }[] }) => o.lines.some((l) => l.productId === ORDINARY_MILK))?.optionId ?? step.options[0].optionId });
      else break;
      expect(s.ok, JSON.stringify(s.error)).toBe(true);
    }
    expect(s.step.state).toBe("quoted");
    return (await call("place_order", { requestId })).order;
  }

  it("control: relayed by the agent, the confirmation is not verified and a named person must sign", async () => {
    const order = await ordinaryMilkConfirmedBy(false);
    expect(order.status).toBe("pending_approval");
    expect(order.decision.rules.find((r: { rule: string }) => r.rule === "human_confirmation").outcome).toBe("escalate");
  });

  // Before: the same agent, with one more line in its client (it declares the elicitation capability and answers
  // Dock's form itself), was recorded as "Sanna Koskinen confirmed as intended, through the client's own prompt to the
  // user", treated as verified, and the order committed with no person involved. A relayed yes is not a yes: an
  // elicitation form comes back from the agent's client, so it is recorded as relayed by the client and never
  // satisfies a confirmation that matters (core/intake.ts isVerified).
  it("answered by the client itself through elicitation, the same confirmation still goes to a named person", async () => {
    const order = await ordinaryMilkConfirmedBy(true);
    expect(order.status).toBe("pending_approval");
    expect(order.decision.rules.find((r: { rule: string }) => r.rule === "human_confirmation").outcome).toBe("escalate");
    const { dock } = await getRuntime();
    const said = dock.ledger.entries({ requestId: order.requestId }).find((e) => e.data.step === "confirmation")!;
    expect(said.summary).toMatch(/^Relayed by the agent's client, not verified/);
    expect(said.data).toMatchObject({ channel: "protocol_elicitation", verified: false });
  });
});

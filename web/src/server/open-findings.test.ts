import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import type { PublicOrder } from "@/core/orders";
import { resolveKitchen } from "./console-kitchens";
import { KITCHEN_ORG } from "./demo-kitchen";
import { getMemoryService, resetMemoryService } from "./memory/runtime";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * Open findings of the end-to-end review (Sat 14 Nov), kept as tests. Each `it.fails` states what should happen and
 * fails today; none was patched, because closing it is a decision about how the product behaves, not a bug fix. The
 * options are written above each. When one is closed its test starts passing, the suite turns red, and the mark
 * comes off. The `control` tests pass today and show the scenario is the right one.
 *
 * All three are about the same boundary. The gate enforces the signed mandate on every door. The mistake check and
 * the kitchen's remembered rules are enforced by the intake, which a caller may skip or answer for itself.
 */
const BASE = "http://dock.test";
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const ORDINARY_MILK = "VA-1110"; // 10 L bag-in-box, not lactose-free: Kaari's head chef stated "always lactose-free"

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
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

describe("open finding 1: 'In the signed mandate: the gate enforces it'", () => {
  // The memory page offers a remembered safety rule for the mandate ("Add this to the signed mandate, so the gate
  // enforces it and not only memory?"). Accepting it records the decision, writes "added ... to the kitchen's
  // mandate" to the ledger, and the page then says "In the signed mandate: the gate enforces it."
  // (src/app/k/[kitchen]/memory-book.tsx). Nothing changes the mandate the gate checks.
  // Options: (a) the gate applies the restrictions a kitchen's signed-in person accepted on top of the presented
  // mandate (they only narrow it, so no signature is weakened), for every door; (b) the kitchen's console re-signs
  // its mandate with the rule (possible for the demo kitchens, whose keys the server holds; visitor kitchens' keys
  // are discarded by design); (c) change the page and the ledger line to say what is true: recorded, enforced by
  // the intake, not by the gate until the kitchen signs a new mandate.
  it.fails("a rule the kitchen added to its mandate on the memory page stops an order that breaks it", async () => {
    const memory = await getMemoryService();
    const k = (await resolveKitchen("kaari"))!;
    const by = "Sanna Koskinen (signed in)";
    let offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
    if (!offers.some((o) => o.patch.requiredAttributes?.includes("lactose_free"))) {
      await memory.write(k.info.orgId, { door: "memory_page", by, segments: [], events: [{ type: "rule_stated", fact: { kind: "diet", claim: "lactose_free" }, strength: "rule" }] }, k.info.name);
      offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
    }
    const offer = offers.find((o) => o.patch.requiredAttributes?.includes("lactose_free"))!;
    expect(offer.line).toMatch(/Add it to the signed mandate so the gate refuses any order that breaks it/);
    const after = await memory.decideMandate(k.info.orgId, offer.itemId, "added", by);
    expect(after.items.find((i: { id: string }) => i.id === offer.itemId)).toMatchObject({ mandate: { status: "added" } }); // the page now says the gate enforces it

    const order = await orderDirectly(ORDINARY_MILK, 2); // €23, within the €100 the agent may spend alone
    expect(order.status).toBe("rejected");
    expect(order.decision.rules.find((r) => r.rule === "required_attributes")?.outcome).toBe("fail");
  });
});

describe("open finding 2: the mistake check is a step of the intake, not a rule of the gate", () => {
  // "Any agent the kitchen trusts ... meets the same gate: the same limits, the same mistake checks"
  // (src/app/k/[kitchen]/agent-rules.tsx). True through submit_need / POST /api/v1/intake. An agent that calls
  // open_request, get_quote and place_order instead is never asked: an order against a rule a person stated for the
  // kitchen, or ten times its usual amount, commits alone whenever it fits the mandate's limits.
  // Options: (a) run the same concerns (core/concerns.ts is plain code on the kitchen's own history) inside
  // placeOrder for every order, and send one that matters and nobody verified to a person, as human_confirmation
  // does today; (b) refuse the lower-level order calls for kitchens that have history or stated rules, pointing to
  // the intake; (c) keep it and correct the sentence: the gate enforces the mandate, the mistake check is the intake's.
  it.fails("an order against the kitchen's stated rule, placed without the intake, does not commit on the agent's word", async () => {
    const order = await orderDirectly(ORDINARY_MILK, 2);
    expect(order.status).not.toBe("committed");
  });
});

describe("open finding 3: a client's elicitation answer is taken as the buyer's own", () => {
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

  // The same agent, with one more line in its client: it declares the elicitation capability and answers Dock's form
  // itself. Dock records "Sanna Koskinen confirmed as intended, through the client's own prompt to the user", treats
  // it as verified, and the order commits with no person involved. Dock cannot tell a client that asked its user from
  // one that did not.
  // Options: (a) count protocol_elicitation as unverified where the concern matters (one line in core/intake.ts
  // isVerified), so such an order goes to a named person, at the cost of a second confirmation for honest clients;
  // (b) trust elicitation only from clients the kitchen enrolled (a connector address its signed-in person issued);
  // (c) use URL-mode elicitation to Dock's own answer page, where the kitchen's signed-in session names the person.
  it.fails("answered by the client itself through elicitation, the same confirmation still goes to a named person", async () => {
    const order = await ordinaryMilkConfirmedBy(true);
    expect(order.status).toBe("pending_approval");
  });
});

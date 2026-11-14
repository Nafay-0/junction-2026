import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { AnswersInput, ChoiceInput, ConcernResponseInput, type IntakeView } from "@/core/intake";
import { explain } from "@/core/ledger";
import { NEED_UNITS, NeedSchema, OPTIMISE_GOALS } from "@/core/need";
import { AvailabilityInput, DockError, OpenRequestInput, PlaceOrderInput, QuoteInput, SearchInput, type AgentSession, type Dock, MAX_QUOTE_LINES } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import {
  IntakeStepSchema,
  KitchenSchema,
  LedgerEntrySchema,
  LedgerVerificationSchema,
  MandateOutSchema,
  OfferSchema,
  OrderSchema,
  ProductOutSchema,
  PurchaseRequestSchema,
  QuoteResultSchema,
} from "../wire";
import { AskHuman, answersFromBuyer, concernsFromBuyer, type HumanChannel } from "./ask-human";
import type { LiveBudget } from "@/server/aiven/valkey";
import { nextStepForIntake, nextStepForOrder, nextStepForQuote, waitingFor } from "./next-step";
import { receiptEmail } from "../notify/outside";
import { AlternativesInput, ListOrdersInput, LookupInput, awaitDecision, findAlternatives, listOrders, lookupProducts } from "../lookup";

/**
 * Dock's operations as MCP tools: one table, one entry per tool. Each entry is a name, a description for a
 * model that has never seen Dock, zod input and output schemas, and a `run` that calls the same `createDock`
 * functions the REST routes call. Authentication, refusals and result shaping live in server.ts, once.
 *
 * The intake tools come first: they are how an order should start. The lower-level tools after them stay for
 * follow-up. Tools marked `humanInput` need the human buyer's own answer (see ask-human.ts).
 *
 * To add a tool: append an entry here. Nothing else changes.
 */

export type ToolContext = {
  dock: Dock;
  session: AgentSession;
  guard: LiveBudget;
  agentKey: string;
  human: HumanChannel;
  /** Who the audit trail names when the agent does not say: set when Dock knows the person behind the connection (a kitchen's connector address). */
  defaultBy?: string;
};

export type ToolDef<I extends z.ZodObject, O extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  readOnly?: boolean;
  /** The call carries the human buyer's own answer; Dock asks them through the client when it can. */
  humanInput?: boolean;
  run: (ctx: ToolContext, args: z.output<I>) => Promise<z.input<O> | AskHuman>;
};

export const tool = <I extends z.ZodObject, O extends z.ZodObject>(def: ToolDef<I, O>) => def;

const nextStep = z.string().describe("What to do next, in one or two sentences.");
const budget = z
  .object({ windowMinutes: z.number(), maxProductsPerCall: z.number(), callsLeft: z.number(), newProductsLeft: z.number() })
  .describe("This agent's remaining allowance for live price/availability lookups (quotes count too).");

const requestId = z.string().min(1).describe("The requestId returned by submit_need (step.requestId) or open_request.");
const intakeId = z.string().min(1).describe("The requestId submit_need returned (step.requestId).");
const by = z
  .string()
  .min(1)
  .max(120)
  .describe("The name of the human buyer whose answer this is, if they told you; written to the audit ledger with the answer. Do not invent one: leave it out and AimoPilot says if it needs it.");

export const intakeOut = z.object({
  step: IntakeStepSchema,
  waitingFor: z.enum(["buyer", "agent", "nobody"]).describe("buyer: relay the step to the human buyer and wait for them. agent: your move. nobody: finished."),
  nextStep,
});
export const intakeResult = (step: IntakeView) => ({ step, waitingFor: waitingFor(step.state), nextStep: nextStepForIntake(step) });

const wrongState = (step: IntakeView, what: string) =>
  new DockError(409, "intake_wrong_state", `Cannot ${what} now: request ${step.requestId} is ${step.state}.`, "intake_sequence", { state: step.state });

const humanAnswerRequired = (what: string) =>
  new DockError(400, "human_answer_required", `${what} must come from the human buyer. Ask them, then call again with their answer and their name as by.`, "human_input");

const relay = z
  .boolean()
  .optional()
  .describe("Set true only after AimoPilot's form came back unanswered (error.code form_not_answered): you asked the buyer in the chat and pass on their reply.");

/** Requests whose form the client closed unanswered: the agent may relay the buyer's answer instead. In memory, per process. */
const formUnanswered = new Set<string>();

/** The buyer's answer: through the client's form when it can show one, else (or after an unanswered form) as relayed. */
function fromBuyer<P, A>(key: string, human: HumanChannel, wantsRelay: boolean | undefined, proposed: P, ask: () => A | AskHuman): P | A | AskHuman {
  if (!human.canAsk || (wantsRelay && formUnanswered.has(key))) return proposed;
  try {
    return ask();
  } catch (err) {
    if (err instanceof DockError && err.code === "form_not_answered") formUnanswered.add(key);
    throw err;
  }
}

const RELAY_ONLY =
  "The buyer's original request does not count as their answer: Dock asks because something differs from what it knows, so put the question to them and wait for their reply.";

const n = NeedSchema.shape;
const NeedArg = z
  .object({
    text: n.text.describe("The buyer's request in their own words, kept for the audit trail."),
    item: n.item.extend({
      text: n.item.shape.text.describe("What they want, e.g. 'lactose-free milk'."),
      category: n.item.shape.category.describe("Product family if known, e.g. 'milk', 'cream', 'yoghurt'. Helps AimoPilot find the right products."),
      attributes: n.item.shape.attributes.describe("Attributes the product must have, e.g. ['lactose_free', 'fat_1_5']."),
      excludedAttributes: n.item.shape.excludedAttributes.describe("Attributes the buyer explicitly does not want, e.g. ['lactose_free'] for 'ordinary milk'."),
      productId: n.item.shape.productId.describe("A specific product id the buyer named, if any."),
    }),
    quantity: z
      .object({ amount: z.number().positive().max(1_000_000), unit: z.enum(NEED_UNITS).describe("L, kg, pcs, or pack (the product's sales pack).") })
      .optional()
      .describe("How much, exactly as the buyer said it. Do not round or convert: Dock checks it against the kitchen's usual orders."),
    deliverBy: n.deliverBy.describe("Latest acceptable delivery date, YYYY-MM-DD."),
    requiredClaims: n.requiredClaims.describe("Claims every option must carry, e.g. ['organic']."),
    forbiddenAllergens: n.forbiddenAllergens.describe("Allergens no option may contain."),
    optimise: n.optimise.describe(`What the buyer said matters most: ${OPTIMISE_GOALS.join(", ")} or no_preference. Leave unstated if they said nothing; AimoPilot asks if it matters.`),
    sameAsLastTime: n.sameAsLastTime.describe("true when the buyer says 'same as last time'; quantity may then be left out."),
  })
  .describe("The buyer's need as fields. Fill only what the buyer actually said.");

const INTAKE_TOOLS = [
  tool({
    name: "submit_need",
    title: "Start an order from the buyer's need",
    description:
      "START HERE for any new purchase. Send the buyer's need as structured fields (what, how much, by when, must-haves). AimoPilot checks it against the kitchen's own order history for likely mistakes (for example 1,000 L where they usually order 100 L, or a delivery day it cannot make), asks at most two short questions its memory cannot answer, then offers option cards with pros and cons. Returns a step whose `state` is needs_confirmation, needs_input, options_ready, quoted, no_options or cancelled; `nextStep` says exactly which tool to call next and `waitingFor` says whether you must wait for the human buyer.",
    // Loose: some models put quantity or deliverBy next to `need` instead of inside it (Gemini 3.1 Flash-Lite through
    // Google ADK, five times in a row on 14 Nov). Those fields are folded into the need, never invented.
    input: z.looseObject({ need: NeedArg, by: by.optional().describe("The name of the person asking, if you know it.") }),
    output: intakeOut,
    run: async ({ dock, session, defaultBy }, args) => {
      const { need, by: who, ...stray } = args as typeof args & Record<string, unknown>;
      const folded = { ...Object.fromEntries(Object.entries(stray).filter(([k]) => k in NeedArg.shape)), ...need };
      return intakeResult(await dock.intake.open(session, { need: folded as typeof need, by: who ?? defaultBy }));
    },
  }),
  tool({
    name: "respond_to_concerns",
    title: "Pass on the buyer's answer to a mistake check",
    description:
      `Use only when the step is needs_confirmation. AimoPilot found something that looks like a mistake (step.concerns: a message and fixed choices). The answer MUST come from the human buyer: relay each concern's message to them in plain words with its choices, wait for their reply, and pass on exactly what they choose; never confirm or correct on their behalf. ${RELAY_ONLY} For each concern send its key and choice: \"confirm\" (keep it as asked; only if the concern is confirmable) or one of its correction ids. If your MCP client supports elicitation, AimoPilot asks the buyer directly through it and your arguments only pre-fill the form. Until this is answered, quotes and orders for the request are refused.`,
    input: z.object({
      requestId: intakeId,
      by: by.optional(),
      relay,
      responses: ConcernResponseInput.shape.responses
        .optional()
        .describe("The buyer's answer per concern: [{ key, choice }] where choice is \"confirm\" or a correction id from the concern."),
    }),
    output: intakeOut,
    humanInput: true,
    run: async ({ dock, session, human, defaultBy }, { requestId, relay: wantsRelay, ...proposed }) => {
      const step = await dock.intake.get(session, requestId);
      if (step.state !== "needs_confirmation") throw wrongState(step, "respond to concerns");
      const answer = fromBuyer(`${session.mandate.issuer.orgId}:${requestId}`, human, wantsRelay, proposed, () => concernsFromBuyer(step, human, proposed));
      if (answer instanceof AskHuman) return answer;
      const who = answer.by || defaultBy;
      if (!who || !answer.responses) throw humanAnswerRequired("A confirmation or correction");
      // Answered through the client's own prompt to the user (elicitation) only when the form came back; else relayed.
      return intakeResult(await dock.intake.respondToConcerns(session, requestId, { by: who, responses: answer.responses }, answer === proposed ? undefined : { channel: "protocol_elicitation" }));
    },
  }),
  tool({
    name: "answer_questions",
    title: "Pass on the buyer's answers to AimoPilot's questions",
    description:
      "Use when the step is needs_input (at most two questions in step.questions, each with fixed options), or in options_ready to change an answer AimoPilot took from memory (step.fromMemory). The answers MUST come from the human buyer: ask them each question with its options, wait for their reply, and pass on what they pick; never guess or answer for them, even if the answer seems obvious from earlier in the conversation. Send one optionId per questionId; remember: true stores the answer as the kitchen's rule for next time. If your MCP client supports elicitation, AimoPilot asks the buyer directly through it and your arguments only pre-fill the form.",
    input: z.object({
      requestId: intakeId,
      by: by.optional(),
      relay,
      answers: AnswersInput.shape.answers.optional().describe("The buyer's answers: [{ questionId, optionId, remember? }], ids exactly as in step.questions."),
    }),
    output: intakeOut,
    humanInput: true,
    run: async ({ dock, session, human, defaultBy }, { requestId, relay: wantsRelay, ...proposed }) => {
      const step = await dock.intake.get(session, requestId);
      if (step.state !== "needs_input" && step.state !== "options_ready") throw wrongState(step, "answer questions");
      const answer = fromBuyer(`${session.mandate.issuer.orgId}:${requestId}`, human, wantsRelay, proposed, () => answersFromBuyer(step, human, proposed));
      if (answer instanceof AskHuman) return answer;
      const who = answer.by || defaultBy;
      if (!who || !answer.answers) throw humanAnswerRequired("An answer");
      return intakeResult(await dock.intake.answer(session, requestId, { by: who, answers: answer.answers }, answer === proposed ? undefined : { channel: "protocol_elicitation" }));
    },
  }),
  tool({
    name: "choose_option",
    title: "Choose an option and get its fixed-price quote",
    description:
      "Use when the step is options_ready. Show the buyer the option cards in plain words (title, total, delivery, pros, cons, and signOff for any that a person must approve), wait for their pick, and send that optionId; send step.preselected.optionId only if they asked you to decide. The wholesaler signs a fixed-price quote for it; the step becomes quoted and `step.next.example` holds the exact arguments for place_order.",
    input: z.object({ requestId: intakeId, optionId: ChoiceInput.shape.optionId.describe("An optionId from step.options."), by: by.optional().describe("Who chose: the buyer's name if they told you, or yours if they asked you to decide.") }),
    output: intakeOut,
    run: async ({ dock, session, defaultBy }, { requestId, optionId, by: chooser }) => {
      // Choosing is the agent's own step (not the buyer's answer), so without a name the record says the agent chose.
      const who = chooser ?? defaultBy ?? `the agent ${session.agentId}`;
      return intakeResult(await dock.intake.choose(session, requestId, { optionId, by: who }));
    },
  }),
  tool({
    name: "get_intake_step",
    title: "Read where an order stands",
    description:
      "The current step of an order started with submit_need: its state, open concerns or questions, option cards, the quote once chosen, and `nextStep` naming the call to make. Use it to pick up where you left off.",
    input: z.object({ requestId: intakeId }),
    output: intakeOut,
    readOnly: true,
    run: async ({ dock, session }, { requestId }) => intakeResult(await dock.intake.get(session, requestId)),
  }),
  tool({
    name: "read_kitchen_memory",
    title: "Read what AimoPilot remembers about this kitchen",
    description:
      "The buyer organisation's memory: order history, usual amounts per product family, rules people stated (for example 'Always lactose-free'), and patterns learned from past orders. AimoPilot uses it to spot mistakes and to avoid asking what it already knows. Read it when the buyer asks what they usually order.",
    input: z.object({}),
    output: z.object({ kitchen: KitchenSchema, nextStep }),
    readOnly: true,
    run: async ({ dock, session }) => ({ kitchen: await dock.intake.kitchen(session), nextStep: "Start a new order with submit_need." }),
  }),
];

const CORE_TOOLS = [
  tool({
    name: "read_mandate",
    title: "Read my mandate",
    description:
      "Show the signed mandate you are presenting, as AimoPilot verified it: which organisation you buy for, which categories, attributes, allergens and certificates are allowed or required, the per-order limit you may spend alone, the hard weekly budget, the substitution rule, the delivery limit and who can sign off above your limit. Call this first so you only propose what the mandate allows.",
    input: z.object({}),
    output: z.object({ mandate: MandateOutSchema, liveLookupBudget: budget, nextStep }),
    readOnly: true,
    run: async ({ session, guard, agentKey }) => ({
      mandate: session.mandate,
      liveLookupBudget: await guard.remaining(agentKey),
      nextStep: "Call submit_need with the buyer's need as structured fields.",
    }),
  }),
  tool({
    name: "open_request",
    title: "Open a purchase request",
    description:
      "Lower-level: open a bare purchase request without AimoPilot's mistake checks, questions or option cards. Prefer submit_need for any new order; use this only when you must build a quote line by line yourself. Pass the buyer's need in their own words and, if there is one, the need-by date. Returns a requestId for search_products, check_availability and request_quote. The need-by date becomes a delivery deadline the order must meet.",
    input: OpenRequestInput.extend({
      text: OpenRequestInput.shape.text.describe("The buyer's need in their own words."),
      neededBy: OpenRequestInput.shape.neededBy.describe("Latest acceptable delivery date, YYYY-MM-DD."),
    }),
    output: z.object({ request: PurchaseRequestSchema, nextStep }),
    run: async ({ dock, session }, args) => ({
      request: await dock.openRequest(session, args),
      nextStep: "Call search_products to find candidates in the product master data.",
    }),
  }),
  tool({
    name: "search_products",
    title: "Search product master data",
    description:
      "Lower-level, for follow-up. Search the wholesaler's product master data: names, brands, categories, pack sizes, attributes (such as lactose_free, fat_1_5, organic), allergens, certificates, on-time delivery rate and carbon footprint. Free and local: it does not call the live price or availability service. Use it to build a short list before asking for live prices.",
    input: SearchInput.extend({
      requestId,
      text: SearchInput.shape.text.describe("Words that must all appear in the product's name, brand, category or attributes, e.g. 'milk'."),
      category: SearchInput.shape.category.describe("Exact category, e.g. 'milk' or 'plant_drink'."),
      attributes: SearchInput.shape.attributes.describe("Every product returned carries all of these, e.g. ['lactose_free', 'fat_1_5']."),
      limit: SearchInput.shape.limit.describe("Maximum results, default 20, at most 100."),
    }),
    output: z.object({ products: z.array(ProductOutSchema), nextStep }),
    readOnly: true,
    run: async ({ dock, session }, { requestId, ...query }) => ({
      products: await dock.searchProducts(session, { requestId, ...query }),
      nextStep: `Pick your best few candidates and call check_availability for at most ${MAX_LIVE_IDS_PER_CALL} of them.`,
    }),
  }),
  tool({
    name: "check_availability",
    title: "Live price and availability for a short list",
    description: `Lower-level, for follow-up. Ask the wholesaler's live service for the current price per pack, packs in stock and earliest delivery date of a short list of products, at most ${MAX_LIVE_IDS_PER_CALL} per call. This service is metered: never use it to scan the catalogue. Each agent may price a limited number of different products per hour; the result shows what is left.`,
    input: AvailabilityInput.extend({
      requestId,
      productIds: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_LIVE_IDS_PER_CALL)
        .describe(`Product ids from search_products, at most ${MAX_LIVE_IDS_PER_CALL}.`),
    }),
    output: z.object({ offers: z.array(OfferSchema), liveLookupBudget: budget, nextStep }),
    readOnly: true,
    run: async ({ dock, session, guard, agentKey }, args) => {
      await guard.reserve(agentKey, args.productIds);
      return {
        offers: await dock.checkAvailability(session, args),
        liveLookupBudget: await guard.remaining(agentKey),
        nextStep: "Choose quantities (in packs) that cover the need and call request_quote. If your first choice is short, add a substitute line.",
      };
    },
  }),
  tool({
    name: "request_quote",
    title: "Get a fixed-price quote",
    description:
      "Lower-level, for follow-up (choose_option already returns a quote). Ask the wholesaler for a signed, fixed-price quote for specific products and quantities. Quantities are in packs (see packSize). If the preferred product is short, quote what it has and add a line for another product with substituteFor set to the preferred productId. Returns the quote, a quoteToken (the signed quote; pass it unchanged to place_order) and policyPreview: what the mandate gate would decide now (auto_approve, needs_human_approval or reject, with the reason for each rule).",
    input: QuoteInput.extend({
      requestId,
      lines: z
        .array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().int().positive().describe("Packs, not litres or kilos."),
            substituteFor: z.string().min(1).optional().describe("Set when this line replaces a product the buyer could not get enough of: that product's id."),
          }),
        )
        .min(1)
        .max(MAX_QUOTE_LINES),
    }),
    output: QuoteResultSchema.extend({ nextStep }),
    run: async ({ dock, session, guard, agentKey }, args) => {
      await guard.reserve(agentKey, args.lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])));
      const result = await dock.requestQuote(session, args);
      return { ...result, nextStep: nextStepForQuote(result.policyPreview) };
    },
  }),
  tool({
    name: "place_order",
    title: "Place an order against a quote",
    description:
      "Order exactly what a quote offers, at the quoted prices. After choose_option or request_quote, pass only requestId: Dock places the latest quote it signed for it (no token to copy). To change a placed order, quote the new one and pass replaces: the old orderId. Dock's gate checks the order against your mandate in plain code. Three outcomes: committed (within the mandate; the result carries the wholesaler-signed confirmation), pending_approval (a person named in the mandate must sign off on their own phone; tell the buyer who, in one sentence, and stop: you must NOT retry, re-place or split it), or refused (the error names the rule, e.g. weekly_budget). A quote buys once.",
    input: PlaceOrderInput.extend({
      requestId,
      quoteToken: z.string().min(1).optional().describe("Only after request_quote: its quoteToken, unchanged. Leave it out after choose_option."),
      lines: z
        .array(z.object({ productId: z.string(), quantity: z.number(), unitPriceCents: z.number() }))
        .optional()
        .describe("Only with quoteToken: the quote's lines (productId, quantity, unitPriceCents) copied from quote.lines."),
    }),
    output: z.object({ order: OrderSchema, replaced: z.looseObject({ orderId: z.string(), status: z.string() }).optional().describe("With replaces: what happened to the order this one replaces."), receiptEmail: z.looseObject({ emailed: z.boolean() }).optional().describe("Receipt emailed to the kitchen (masked address)."), nextStep }),
    run: async ({ dock, session }, { requestId, quoteToken, lines, replaces }) => {
      // Without a quoteToken the core places the quote it signed for this request (at choose_option, or the latest
      // request_quote outside the intake); no_current_quote if none.
      const args: z.input<typeof PlaceOrderInput> = { requestId, ...(quoteToken ? { quoteToken } : {}), ...(lines ? { lines } : {}), ...(replaces ? { replaces } : {}) };
      const order = await dock.placeOrder(session, args);
      if (order.status === "rejected") {
        const rule = decidingRule(order.decision);
        throw new DockError(422, "policy_rejected", order.decision.reasons.join(" "), rule?.rule, { order });
      }
      const { replaced, ...placed } = order;
      const also = replaced ? (replaced.refused ? ` The order it was to replace (${replaced.orderId}) still stands: ${replaced.refused.message} Tell the buyer both orders stand.` : ` Order ${replaced.orderId} was taken back: one order stands.`) : "";
      const mail = await receiptEmail(placed);
      return { order: placed, ...(replaced ? { replaced } : {}), ...(mail ? { receiptEmail: mail } : {}), nextStep: nextStepForOrder(order) + also };
    },
  }),
  tool({
    name: "get_order",
    title: "Read an order",
    description:
      "An order's status (pending_approval, committed, declined, rejected, withdrawn, expired), the gate's decision with every rule's result, the sign-off and, once committed, the wholesaler-signed confirmation. With waitSeconds (at most 55) it answers as soon as the person decides an order waiting for sign-off: the way to learn the outcome. It only reads; no tool can approve.",
    input: z.object({ orderId: z.string().min(1).describe("orderId returned by place_order."), waitSeconds: z.number().int().min(0).max(55).optional().describe("Wait up to this long for a sign-off decision.") }),
    output: z.object({ order: OrderSchema, decided: z.boolean().optional(), receiptEmail: z.looseObject({ emailed: z.boolean() }).optional(), nextStep }),
    readOnly: true,
    run: async ({ dock, session }, { orderId, waitSeconds }) => {
      if (!waitSeconds) {
        const order = await dock.getOrder(session, orderId);
        const mail = await receiptEmail(order);
        return { order, ...(mail ? { receiptEmail: mail } : {}), nextStep: nextStepForOrder(order) };
      }
      const r = await awaitDecision(dock, session, orderId, waitSeconds);
      const mail = await receiptEmail(r.order);
      return { order: r.order, decided: r.decided, ...(mail ? { receiptEmail: mail } : {}), nextStep: r.decided ? nextStepForOrder(r.order) : `Still waiting for ${r.order.approval?.approver.name ?? "the approver"} to decide on their phone. Wait again, or stop and tell the buyer; never place it again.` };
    },
  }),
  tool({
    name: "list_orders",
    title: "List this organisation's orders",
    description:
      "This organisation's orders, newest first: status, total, delivery day, lines, who must sign off and whether they have, and canTakeBack. For 'what waits for sign-off?' or 'what did we order?'.",
    input: ListOrdersInput,
    output: z.object({ orders: z.array(z.looseObject({ orderId: z.string(), status: z.string() })), waitingForSignOff: z.number(), nextStep }),
    readOnly: true,
    run: async ({ dock, session }, args) => {
      const r = await listOrders(dock, session, args);
      return { ...r, nextStep: r.waitingForSignOff ? "The named person decides those on their own phone; get_order with waitSeconds waits for one. Do not place them again." : "Nothing waits for a sign-off." };
    },
  }),
  tool({
    name: "withdraw_order",
    title: "Take back an order",
    description:
      "Only when the buyer asks: take back an order waiting for sign-off, or one this agent placed alone, until the wholesaler's order cut-off (list_orders: canTakeBack). What a person signed is theirs to take back. `by` is recorded as relayed, not verified. To change an order, use place_order with replaces.",
    input: z.object({ orderId: z.string().min(1), reason: z.string().max(300).optional().describe("Why, in the buyer's words."), by: z.string().min(1).max(120).optional() }),
    output: z.object({ order: z.looseObject({ orderId: z.string(), status: z.string() }), nextStep }),
    run: async ({ dock, session, defaultBy }, { orderId, reason, by: who }) => {
      const order = await dock.withdrawOrder(session, orderId, { ...(reason ? { reason } : {}), ...((who ?? defaultBy) ? { by: who ?? defaultBy } : {}) }, { agentTakeBack: true });
      return { order, nextStep: "Taken back: it no longer counts against the weekly budget. Tell the buyer in one sentence; start a new request only if they ask." };
    },
  }),
  tool({
    name: "find_products",
    title: "Look up products, prices and availability",
    description:
      `What is available and at what price, in one call: up to ${MAX_LIVE_IDS_PER_CALL} products the mandate allows, filtered by words, category, brand, claims, allergens, pack size and day. Each has match (exact, variant, stand_in, not_the_kind), pack, claims, labels, allergens, origin, reliability, carbon, and live price, stock, delivery and cut-off. Opens a request if you pass none. To order: submit_need, or request_quote.`,
    input: LookupInput,
    output: z.looseObject({ requestId: z.string(), products: z.array(z.looseObject({ productId: z.string() })), nextStep }),
    readOnly: true,
    run: async ({ dock, session, guard, agentKey }, args) => {
      const r = await lookupProducts(dock, session, args, { budget: guard, agentKey });
      const short = r.products.some((p) => "live" in p && p.live && (p.live.coversQuantity === false || p.live.meetsDay === false));
      return {
        ...r,
        nextStep: !r.products.length
          ? "Nothing in the assortment matches inside the mandate. Tell the buyer what was looked for; loosen a filter only if they agree."
          : `To order, call submit_need with the buyer's need (AimoPilot checks it and offers option cards), or request_quote with requestId ${r.requestId} and lines in packs, then place_order with just requestId.${short ? " Some products do not cover the amount or the day: find_alternatives ranks what can stand in." : ""}`,
      };
    },
  }),
  tool({
    name: "find_alternatives",
    title: "Rank alternatives: good, better, best",
    description:
      "A product is short, late or not wanted: what can stand in inside the mandate, ranked best, better, good, each with trade-offs, live price and delivery, and the gate's preview. Keeps its dietary claims; never an allergen the mandate or buyer forbids.",
    input: AlternativesInput,
    output: z.looseObject({ requestId: z.string(), requested: z.looseObject({ productId: z.string() }), alternatives: z.array(z.looseObject({ productId: z.string() })), nextStep }),
    readOnly: true,
    run: async ({ dock, session, guard, agentKey }, args) => {
      const r = await findAlternatives(dock, session, args, { budget: guard, agentKey });
      return {
        ...r,
        nextStep: r.alternatives.length
          ? `Show the buyer the alternatives with their trade-offs and let them choose (a substitute outside their stated preferences needs their word). Then request_quote with requestId ${r.requestId}, a line for what the asked product still covers and a line for the substitute with substituteFor ${r.requested.productId}, and place_order with just requestId.`
          : "Nothing can stand in inside the mandate. Tell the buyer, with the reasons in leftOut; do not order around it.",
      };
    },
  }),
  tool({
    name: "explain",
    title: "Explain what happened and why",
    description:
      "The audit trail for one of your requests or orders: a plain-language line per step (lookups, quotes, gate decisions with reasons, sign-offs, commits), the raw hash-chained entries, and whether the whole chain verifies. Pass requestId, orderId or both.",
    input: z.object({ requestId: requestId.optional(), orderId: z.string().min(1).optional() }).refine((a) => a.requestId || a.orderId, "Pass requestId, orderId or both."),
    output: z.object({ verification: LedgerVerificationSchema, explanation: z.array(z.string()), entries: z.array(LedgerEntrySchema), nextStep }),
    readOnly: true,
    run: async ({ dock, session }, { requestId, orderId }) => {
      if (orderId) await dock.getOrder(session, orderId); // 404 unless the order belongs to this organisation
      if (requestId) {
        const opened = dock.ledger.entries({ requestId }).find((e) => e.type === "request");
        if (opened?.actor !== `agent:${session.agentId}`) {
          throw new DockError(404, "request_not_found", `No request ${requestId} for this agent.`);
        }
      }
      const entries = dock.ledger.entries({ requestId, orderId });
      return { verification: dock.ledger.verify(), explanation: explain(entries), entries, nextStep: "Share the explanation with the buyer if they ask why." };
    },
  }),
  tool({
    name: "get_order_timeline",
    title: "An order's whole timeline",
    description:
      "One of your orders from the buyer's words to now, a step per row: how it was read, lookups, options, the signed quote, the gate's rules, the sign-off (who, how, after how long), the receipt and its signature check, and after (taken back, a substitute, a backup). Each step names who acted and its ledger entry. The same timeline the wholesaler reads.",
    input: z.object({ orderId: z.string().min(1).describe("orderId returned by place_order or list_orders.") }),
    output: z.object({ timeline: z.looseObject({ orderId: z.string(), status: z.string(), steps: z.array(z.looseObject({ seq: z.number(), title: z.string() })) }), nextStep }),
    readOnly: true,
    run: async ({ dock, session }, { orderId }) => {
      const order = await dock.getOrder(session, orderId); // 404 unless the order belongs to this organisation
      const { buildOrderTimeline } = await import("@/server/ops/order-timeline");
      const timeline = buildOrderTimeline({ order, ledger: dock.ledger.readonly(), viewer: "agent" });
      return { timeline, nextStep: "Tell the buyer what they asked about in a sentence or two; the steps are theirs to read." };
    },
  }),
];

const core = (name: string) => CORE_TOOLS.find((t) => t.name === name)!;

/** In the order an agent meets them: the mandate, the intake, the order follow-up, then the lower-level steps. */
export const TOOLS = [
  core("read_mandate"),
  ...INTAKE_TOOLS,
  ...["place_order", "get_order", "list_orders", "withdraw_order", "explain", "get_order_timeline", "find_products", "find_alternatives", "open_request", "search_products", "check_availability", "request_quote"].map(core),
];

export type DockTool = (typeof TOOLS)[number];

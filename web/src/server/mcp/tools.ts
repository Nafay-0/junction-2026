import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { explain } from "@/core/ledger";
import { AvailabilityInput, DockError, OpenRequestInput, PlaceOrderInput, QuoteInput, SearchInput, type AgentSession, type Dock } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import {
  LedgerEntrySchema,
  LedgerVerificationSchema,
  MandateOutSchema,
  OfferSchema,
  OrderSchema,
  ProductOutSchema,
  PurchaseRequestSchema,
  QuoteResultSchema,
} from "../wire";
import type { LiveLookupGuard } from "./live-lookup-guard";
import { nextStepForOrder } from "./next-step";

/**
 * Dock's operations as MCP tools: one table, one entry per tool. Each entry is a name, a description for a
 * model that has never seen Dock, zod input and output schemas, and a `run` that calls the same `createDock`
 * functions the REST routes call. Authentication, refusals and result shaping live in server.ts, once.
 *
 * To add a tool (for example an intake step): append an entry here. Nothing else changes.
 */

export type ToolContext = { dock: Dock; session: AgentSession; guard: LiveLookupGuard; agentKey: string };

type ToolDef<I extends z.ZodObject, O extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  readOnly?: boolean;
  run: (ctx: ToolContext, args: z.output<I>) => Promise<z.input<O>>;
};

const tool = <I extends z.ZodObject, O extends z.ZodObject>(def: ToolDef<I, O>) => def;

const nextStep = z.string().describe("What to do next, in one or two sentences.");
const budget = z
  .object({ windowMinutes: z.number(), maxProductsPerCall: z.number(), callsLeft: z.number(), newProductsLeft: z.number() })
  .describe("This agent's remaining allowance for live price/availability lookups (quotes count too).");

const requestId = z.string().min(1).describe("The requestId returned by open_request.");

export const TOOLS = [
  tool({
    name: "read_mandate",
    title: "Read my mandate",
    description:
      "Show the signed mandate you are presenting, as Dock verified it: which organisation you buy for, which categories, attributes, allergens and certificates are allowed or required, the per-order limit you may spend alone, the hard weekly budget, the substitution rule, the delivery limit and who can sign off above your limit. Call this first so you only propose what the mandate allows.",
    input: z.object({}),
    output: z.object({ mandate: MandateOutSchema, liveLookupBudget: budget, nextStep }),
    readOnly: true,
    run: async ({ session, guard, agentKey }) => ({
      mandate: session.mandate,
      liveLookupBudget: guard.remaining(agentKey),
      nextStep: "Call open_request with the buyer's need in their own words.",
    }),
  }),
  tool({
    name: "open_request",
    title: "Open a purchase request",
    description:
      "Start a purchase. Pass the buyer's need in their own words (for example 'I need 1,000 litres of lactose-free milk by Monday') and, if there is one, the need-by date. Returns a requestId; every other step takes it. The need-by date becomes a delivery deadline the order must meet.",
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
      "Search the wholesaler's product master data: names, brands, categories, pack sizes, attributes (such as lactose_free, fat_1_5, organic), allergens, certificates, on-time delivery rate and carbon footprint. Free and local: it does not call the live price or availability service. Use it to build a short list before asking for live prices.",
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
    description: `Ask the wholesaler's live service for the current price per pack, packs in stock and earliest delivery date of a short list of products, at most ${MAX_LIVE_IDS_PER_CALL} per call. This service is metered: never use it to scan the catalogue. Each agent may price a limited number of different products per hour; the result shows what is left.`,
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
      guard.reserve(agentKey, args.productIds);
      return {
        offers: await dock.checkAvailability(session, args),
        liveLookupBudget: guard.remaining(agentKey),
        nextStep: "Choose quantities (in packs) that cover the need and call request_quote. If your first choice is short, add a substitute line.",
      };
    },
  }),
  tool({
    name: "request_quote",
    title: "Get a fixed-price quote",
    description:
      "Ask the wholesaler for a signed, fixed-price quote for specific products and quantities. Quantities are in packs (see packSize). If the preferred product is short, quote what it has and add a line for another product with substituteFor set to the preferred productId. Returns the quote, a quoteToken (the signed quote; pass it unchanged to place_order) and policyPreview: what the mandate gate would decide now (auto_approve, needs_human_approval or reject, with the reason for each rule).",
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
        .max(20),
    }),
    output: QuoteResultSchema.extend({ nextStep }),
    run: async ({ dock, session, guard, agentKey }, args) => {
      guard.reserve(agentKey, args.lines.flatMap((l) => (l.substituteFor ? [l.productId, l.substituteFor] : [l.productId])));
      const result = await dock.requestQuote(session, args);
      const preview = result.policyPreview;
      const hint =
        preview.outcome === "reject"
          ? `The gate would refuse this quote (rule ${decidingRule(preview)?.rule}). Change the lines rather than placing it.`
          : preview.outcome === "needs_human_approval"
            ? `Placing it will ask ${preview.approver.name} (${preview.approver.role}) to sign off. Call place_order with quoteToken and quote.lines.`
            : "Within the mandate: call place_order with quoteToken and the quote's lines (productId, quantity, unitPriceCents).";
      return { ...result, nextStep: hint };
    },
  }),
  tool({
    name: "place_order",
    title: "Place an order against a quote",
    description:
      "Order exactly what a quote offers, at the quoted prices. Dock's gate checks the order against your mandate in plain code. Three outcomes: committed (within the mandate; the result carries the wholesaler-signed confirmation), pending_approval (a person named in the mandate must sign off; they are notified directly, you must NOT retry), or refused (the error names the rule, e.g. weekly_budget). A quote buys once.",
    input: PlaceOrderInput.extend({
      requestId,
      quoteToken: z.string().min(1).describe("quoteToken from request_quote, unchanged."),
      lines: z
        .array(z.object({ productId: z.string(), quantity: z.number(), unitPriceCents: z.number() }))
        .describe("The quote's lines: productId, quantity and unitPriceCents copied from quote.lines."),
    }),
    output: z.object({ order: OrderSchema, nextStep }),
    run: async ({ dock, session }, args) => {
      const order = await dock.placeOrder(session, args);
      if (order.status === "rejected") {
        const rule = decidingRule(order.decision);
        throw new DockError(422, "policy_rejected", order.decision.reasons.join(" "), rule?.rule, { order });
      }
      return { order, nextStep: nextStepForOrder(order) };
    },
  }),
  tool({
    name: "get_order",
    title: "Read an order",
    description:
      "Read an order's current status (pending_approval, committed, declined, rejected), the gate's decision with every rule's result, the approval state and, once committed, the wholesaler-signed confirmation. Use it to follow an order that waits for sign-off.",
    input: z.object({ orderId: z.string().min(1).describe("orderId returned by place_order.") }),
    output: z.object({ order: OrderSchema, nextStep }),
    readOnly: true,
    run: async ({ dock, session }, { orderId }) => {
      const order = await dock.getOrder(session, orderId);
      return { order, nextStep: nextStepForOrder(order) };
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
];

export type DockTool = (typeof TOOLS)[number];

import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { AnswersInput, ChoiceInput, ConcernResponseInput, OpenIntakeInput } from "@/core/intake";
import { InterpretBody, InterpretResponse } from "@/server/agent/interpret";
import { AlternativesInput, ListOrdersInput, LookupInput } from "@/server/lookup";
import { AvailabilityInput, OpenRequestInput, PlaceOrderInput, QuoteInput, SearchInput } from "@/core/orders";
import {
  ApprovalViewSchema,
  CatalogStatsSchema,
  DockEventSchema,
  ErrorBodySchema,
  ErrorSchema,
  IntakeStepSchema,
  JwksSchema,
  KitchenSchema,
  LedgerEntrySchema,
  LedgerVerificationSchema,
  OfferSchema,
  OrderSchema,
  PendingApprovalSchema,
  ProductOutSchema,
  PurchaseRequestSchema,
  QuoteResultSchema,
  NeedOutSchema,
  SandboxSchema,
  WebAuthnOptionsSchema,
  named,
  wire,
} from "./wire";

/**
 * The OpenAPI 3.1 description of Dock's REST API, generated from the zod schemas the code validates with.
 * `API` is the single table of documented operations; `src/server/openapi.test.ts` checks it against the
 * route files on disk and checks real responses against the documented schemas, status by status.
 */

// Request bodies: the core's own input schemas.
const OpenRequestBody = named("OpenRequestBody", OpenRequestInput);
const AvailabilityBody = named(
  "AvailabilityBody",
  AvailabilityInput.extend({ productIds: AvailabilityInput.shape.productIds.max(MAX_LIVE_IDS_PER_CALL) }),
);
const QuoteBody = named("QuoteBody", QuoteInput);
const PlaceOrderBody = named("PlaceOrderBody", PlaceOrderInput);
const ApprovalDecisionBody = named(
  "ApprovalDecisionBody",
  z.object({
    decision: z.enum(["approve", "decline"]),
    note: z.string().max(500).optional(),
    proof: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("webauthn"), response: z.looseObject({}).describe("The passkey assertion (AuthenticationResponseJSON) for the options from POST ./challenge.") }),
        z.object({ kind: z.literal("session") }).describe("Decline only, from the phone that joined (approver cookie)."),
        z.object({ kind: z.literal("demo_tap") }).describe("DEMO ONLY: needs DOCK_DEMO_TAP_APPROVAL=1 and the approver cookie; recorded as unverified."),
      ])
      .optional(),
    token: z.string().optional().describe("Instead of proof: the one-time token from the approval link (approvers without a passkey)."),
  }),
);
const ChallengeBody = named("ChallengeBody", z.object({ decision: z.enum(["approve", "decline"]) }));
const JoinVerifyBody = named(
  "JoinVerifyBody",
  z.object({
    response: z.looseObject({}).optional().describe("RegistrationResponseJSON from the passkey prompt in the options of POST /api/v1/join."),
    fallback: z.boolean().optional().describe("DEMO ONLY: true joins without a passkey when DOCK_DEMO_TAP_APPROVAL=1."),
  }),
);
const IntakeBody = named("IntakeBody", OpenIntakeInput.extend({ need: NeedOutSchema }));
const InterpretRequestBody = named("InterpretBody", InterpretBody);
const Interpretation = named("Interpretation", InterpretResponse);
const ConcernResponseBody = named("ConcernResponseBody", ConcernResponseInput);
const AnswersBody = named("AnswersBody", AnswersInput);
const ChoiceBody = named("ChoiceBody", ChoiceInput);

// Response bodies.
const RequestCreated = named("RequestCreated", z.object({ request: PurchaseRequestSchema }));
const ProductList = named("ProductList", z.object({ products: z.array(ProductOutSchema), liveCallsSoFar: z.number().int() }));
const ClaimTokenSchema = named("SignedClaim", z.looseObject({
  claimId: z.string(),
  type: z.enum(["price", "availability", "origin"]),
  productId: z.string(),
  sha256: z.string().describe("Hex SHA-256 of the token; a quote's evidence names claims by id and this hash."),
  token: z.string().describe("W3C Verifiable Credential secured as a compact JWS (typ vc+jwt, Ed25519), verifiable offline against /api/v1/keys."),
  validUntil: z.iso.datetime(),
}));
const OfferList = named("OfferList", z.object({
  offers: z.array(OfferSchema),
  unavailable: z.array(z.looseObject({ productId: z.string(), problems: z.array(z.string()), message: z.string() })).optional().describe("Products that cannot be quoted now, and why (for example cutoff_passed)."),
  claims: z.array(ClaimTokenSchema).optional().describe("With includeClaims: the signed price, availability and origin claims."),
  liveCallsSoFar: z.number().int(),
}));
const nextStepOut = z.string().describe("What to do next, in one or two sentences: the same guidance an MCP tool result carries.");
const OrderEnvelope = named("OrderEnvelope", z.object({ order: OrderSchema, nextStep: nextStepOut.optional() }));
const PlacedEnvelope = named("PlacedEnvelope", z.object({ order: OrderSchema, nextStep: nextStepOut.optional(), replaced: z.object({ orderId: z.string(), status: z.string(), refused: z.object({ code: z.string(), rule: z.string().optional(), message: z.string() }).optional() }).optional().describe("With replaces: the earlier order's new status, or why it still stands.") }));
const WaitedEnvelope = named("WaitedEnvelope", z.object({ order: OrderSchema, nextStep: nextStepOut.optional(), decided: z.boolean().optional(), waitedSeconds: z.number().optional() }));
const LiveFacts = z.looseObject({
  unitPriceCents: z.number().int().describe("Live price per pack, euro cents ex VAT."),
  perUnit: z.object({ cents: z.number(), unit: z.string() }),
  availablePacks: z.number().nullable().describe("null: the wholesaler reports no real stock figure (supplier-shipped)."),
  stock: z.enum(["reported", "not_reported"]),
  earliestDelivery: z.iso.date(),
  orderBy: z.string().optional().describe("Order cut-off for that delivery, as the wholesaler states it."),
  meetsDay: z.boolean().optional().describe("With deliverOn: can arrive that day."),
  packsForQuantity: z.number().optional(),
  coversQuantity: z.boolean().nullable().optional(),
});
const ProductFactsOut = z.looseObject({
  productId: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  match: z.enum(["exact", "variant", "stand_in", "not_the_kind"]).optional().describe("From the product search: the kind asked for, a variant of it, or something that could stand in."),
  pack: z.looseObject({ size: z.number(), unit: z.string() }),
  claims: z.array(z.string()).describe("Dietary and other claims, e.g. lactose_free."),
  labels: z.array(z.string()).describe("Certificates and labels."),
  allergens: z.object({ declared: z.boolean(), contains: z.array(z.string()), mayContain: z.array(z.string()), freeFrom: z.array(z.string()) }),
  origin: z.string().nullable(),
  deliveryReliability: z.number().nullable().describe("Share of past deliveries on time; null when unknown."),
  carbon: z.looseObject({ basis: z.enum(["product_group_average", "missing"]), kgCo2ePerUnit: z.number().nullable(), groupAverageKgCo2ePerKg: z.number().nullable() }),
  live: LiveFacts.optional(),
  unavailable: z.looseObject({ reason: z.string() }).optional(),
});
const LookupResult = named("LookupResult", z.looseObject({ requestId: z.string(), matched: z.number(), products: z.array(ProductFactsOut), outsideMandate: z.looseObject({ count: z.number() }), liveChecked: z.number(), search: z.looseObject({ path: z.string(), notSold: z.boolean(), onlyStandins: z.boolean() }).optional() }));
const AlternativesResult = named("AlternativesResult", z.looseObject({
  requestId: z.string(),
  requested: ProductFactsOut,
  rankedBy: z.string(),
  alternatives: z.array(ProductFactsOut.extend({ rank: z.enum(["best", "better", "good"]), packs: z.number(), totalCents: z.number(), tradeOffs: z.array(z.string()), gate: z.looseObject({ outcome: z.string(), reasons: z.array(z.string()) }) })),
  leftOut: z.array(z.looseObject({ productId: z.string(), reason: z.string() })),
  none: z.string().optional(),
}));
const OrderListOut = named("OrderList", z.object({ orders: z.array(z.looseObject({ orderId: z.string(), requestId: z.string(), status: z.string(), totalCents: z.number() })), waitingForSignOff: z.number() }));
const OrderRefused = named("OrderRefused", z.object({ error: ErrorSchema, order: OrderSchema, nextStep: nextStepOut.optional() }));
const Refusal = named("Refusal", z.union([OrderRefused, ErrorBodySchema]));
const ApprovalList = named("ApprovalList", z.object({ approvals: z.array(PendingApprovalSchema) }));
const LedgerView = named(
  "LedgerView",
  z.object({
    verification: LedgerVerificationSchema,
    head: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
    catalog: CatalogStatsSchema,
    view: z.enum(["buyer", "wholesaler"]).optional(),
    explanation: z.array(z.string()),
    entries: z.array(z.union([LedgerEntrySchema, z.looseObject({ seq: z.number().int(), at: z.string(), hash: z.string(), type: z.string(), kind: z.string(), summary: z.string() })])),
  }),
);
const QuoteCreated = named("QuoteCreated", QuoteResultSchema.extend({ nextStep: nextStepOut.optional() }));
const IntakeStepEnvelope = named(
  "IntakeStepEnvelope",
  z.object({
    step: IntakeStepSchema,
    waitingFor: z.enum(["buyer", "agent", "nobody"]).optional().describe("buyer: relay the step to the human buyer and wait for them. agent: your move. nobody: finished."),
    nextStep: nextStepOut.optional(),
    answerUrl: z
      .string()
      .optional()
      .describe("On a step that waits for the buyer (needs_confirmation, needs_input): a one-time page on Dock where the buyer answers Dock's fixed choices themselves. Give it to the buyer instead of relaying; it works once and expires in 30 minutes."),
  }),
);
const KitchenEnvelope = named("KitchenEnvelope", z.object({ kitchen: KitchenSchema }));
const ApprovalViewEnvelope = named("ApprovalViewEnvelope", z.object({ view: ApprovalViewSchema }));
const ApprovalDecided = named("ApprovalDecided", z.object({ order: OrderSchema, view: ApprovalViewSchema }));
const ApprovalRefused = named("ApprovalRefused", z.union([z.object({ error: ErrorSchema, order: OrderSchema, view: ApprovalViewSchema }), ErrorBodySchema]));
const ChallengeOptions = named("ChallengeOptions", z.object({ options: WebAuthnOptionsSchema }));
const ApprovalLinkOut = named(
  "ApprovalLink",
  z.object({
    approvalId: z.string(),
    orderId: z.string(),
    status: z.enum(["pending", "approved", "declined"]),
    url: z.string().describe("The sign-off screen. No secret in it: approving needs the approver's passkey."),
    qrPayload: z.string(),
    qrSvg: z.string(),
  }),
);
const money = z.string().describe('Whole euros as "€500", otherwise "€499.50".');
const ApproverHome = named(
  "ApproverHome",
  z.object({
    approver: z.object({ name: z.string(), roleLabel: z.string(), passkey: z.boolean() }),
    kitchen: z.object({ name: z.string(), city: z.string() }),
    agent: z.object({ name: z.string(), perOrderLimit: money, weeklyBudget: money }),
    expiresAt: z.iso.datetime(),
    expiresAtText: z.string(),
    demoTapEnabled: z.boolean(),
    pending: z.array(z.object({ approvalId: z.string(), total: money, requestedAtText: z.string() })),
    recent: z.array(z.object({ approvalId: z.string().optional(), status: z.string(), total: money, delivery: z.string().optional(), atText: z.string() })),
  }),
);
const JoinStart = named(
  "JoinStart",
  z.object({
    options: WebAuthnOptionsSchema.describe("PublicKeyCredentialCreationOptionsJSON for startRegistration()."),
    identity: z.object({ kitchenName: z.string(), city: z.string(), approverName: z.string(), agentName: z.string() }),
    perOrderLimit: money,
    current: z.object({ kitchenName: z.string(), approverName: z.string(), expiresAt: z.iso.datetime() }).optional().describe("The kitchen this phone already joined, if any."),
    secureOrigin: z.boolean().describe("Passkeys need https or localhost."),
    demoTapEnabled: z.boolean(),
  }),
);
const Joined = named("Joined", z.object({ sandbox: SandboxSchema, next: z.string() }));
const SandboxList = named("SandboxList", z.object({ sandboxes: z.array(SandboxSchema) }));
const DemoOrderStarted = named(
  "DemoOrderStarted",
  z.object({ order: z.object({ orderId: z.string(), status: z.enum(["pending_approval", "committed", "rejected", "declined"]), approvalId: z.string().optional() }) }),
);

// The wholesaler's offers (server/offers, core/offers.ts).
const offerIdParam: Param = { name: "offerId", in: "path", schema: z.string(), required: true, description: "offerId from GET /api/v1/offers." };
const OfferOutSchema = named("SignedOffer", z.looseObject({
  offerId: z.string(),
  status: z.enum(["offered", "accepted", "declined", "muted", "expired", "withheld"]),
  verified: z.boolean().describe("Verified against the wholesaler key and addressed to this organisation."),
  token: z.string().describe("W3C Verifiable Credential (type DockProductOffer) as a compact JWS (typ vc+jwt, Ed25519), verifiable offline against /.well-known/jwks.json."),
  offer: z.looseObject({
    offerId: z.string(),
    isOrder: z.literal(false),
    product: z.looseObject({ productId: z.string(), name: z.string(), category: z.string() }),
    reasons: z.array(z.looseObject({ kind: z.string() })),
    line: z.string(),
    price: z.looseObject({ unitPriceCents: z.number().int(), currency: z.literal("EUR") }),
    suggestedPacks: z.number().int(),
    validUntil: z.iso.datetime(),
  }),
}));
const OfferPrefsSchema = named("OfferPrefs", z.looseObject({ off: z.looseObject({ by: z.string(), at: z.string() }).optional(), mutes: z.array(z.looseObject({ scope: z.string(), value: z.string() })) }));
const OfferListOut = named("OfferList", z.object({ offers: z.array(OfferOutSchema), prefs: OfferPrefsSchema, keysUrl: z.string() }).loose());
const OfferAcceptBody = named("OfferAcceptBody", z.object({ packs: z.number().int().positive().max(10_000).optional(), deliverBy: z.iso.date().optional(), by: z.string().min(1).max(120).optional() }));
const OfferAnswerBody = named("OfferAnswerBody", z.object({ by: z.string().min(1).max(120).optional() }));
const OfferMuteBody = named("OfferMuteBody", z.object({ scope: z.enum(["product", "family", "reason", "all"]), offerId: z.string().optional(), value: z.string().min(1).max(60).optional(), undo: z.boolean().optional(), by: z.string().min(1).max(120).optional() }));
const OfferAccepted = named("OfferAccepted", z.object({ offerId: z.string() }).loose());
const OfferDeclined = named("OfferDeclined", z.object({ offer: z.looseObject({ offerId: z.string(), status: z.string() }) }).loose());
const OfferPrefsOut = named("OfferPrefsReply", z.object({ prefs: OfferPrefsSchema }).loose());
const ApiIndex = named("ApiIndex", z.object({ name: z.string(), version: z.string(), endpoints: z.record(z.string(), z.string()) }));
const OpenApiDocument = named("OpenApiDocument", z.object({ openapi: z.string() }));

type Param = { name: string; in: "query" | "path"; schema: z.ZodType; required?: boolean; description?: string; array?: boolean };
type Operation = {
  method: "get" | "post";
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  /** true: the agent's mandate. "approver": the approver cookie set by POST /api/v1/join/verify. false: public. */
  auth: boolean | "approver";
  params?: Param[];
  body?: z.ZodType;
  responses: Record<number, { description: string; schema: z.ZodType; contentType?: string }>;
};

const err = (description: string) => ({ description, schema: ErrorBodySchema });
const AUTH_ERRORS = { 401: err("No mandate, a bad signature, an expired mandate or no agent id. `error.rule` names the check."), 403: err("The agent id does not match the mandate.") };
const NOT_JOINED = err("This phone has not joined a demo kitchen (no approver cookie); rule approver_identity.");
const s = SearchInput.shape;
const requestIdParam: Param = { name: "requestId", in: "path", schema: z.string(), required: true, description: "requestId from POST /api/v1/intake." };
const approvalIdParam: Param = { name: "approvalId", in: "path", schema: z.string(), required: true };
const INTAKE_ERRORS = {
  400: err("Invalid body, or an id that is not one of the offered choices."),
  404: err("No such intake for this agent (code intake_not_found)."),
  409: err("The intake is in another state (code intake_wrong_state; `details.state` says which), or the concern or question is not open."),
  ...AUTH_ERRORS,
};
const BY = "`by` names the person whose answer the agent relays; it is written to the audit ledger.";

export const API: Operation[] = [
  { method: "get", path: "/api/v1", operationId: "index", summary: "List the endpoints", auth: false, responses: { 200: { description: "Endpoint index.", schema: ApiIndex } } },
  {
    method: "post",
    path: "/api/v1/requests",
    operationId: "openRequest",
    summary: "Open a purchase request",
    description: "The buyer's need in their own words and an optional need-by date. Every later call takes the returned requestId.",
    auth: true,
    body: OpenRequestBody,
    responses: { 201: { description: "Request opened.", schema: RequestCreated }, 400: err("Invalid body."), ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/products",
    operationId: "searchProducts",
    summary: "Search product master data",
    description: "Local master data. Does not call the live price/availability service.",
    auth: true,
    params: [
      { name: "requestId", in: "query", schema: s.requestId, required: true },
      { name: "q", in: "query", schema: z.string(), description: "Words that must all appear in name, brand, category or attributes." },
      { name: "category", in: "query", schema: z.string() },
      { name: "attribute", in: "query", schema: z.string(), array: true, description: "Repeat for several; every product returned carries all of them." },
      { name: "limit", in: "query", schema: s.limit.unwrap() },
    ],
    responses: { 200: { description: "Matching products.", schema: ProductList }, 400: err("Invalid query."), 404: err("Unknown requestId for this agent."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/availability",
    operationId: "checkAvailability",
    summary: "Live price and availability for a short list",
    description: `The partner's live service. At most ${MAX_LIVE_IDS_PER_CALL} products per call; more is refused with rule live_lookup_limit.`,
    auth: true,
    body: AvailabilityBody,
    responses: {
      200: { description: "Live offers (each with the ids of its signed claims), the products that cannot be quoted and why, and with includeClaims the signed claims as vc+jwt tokens.", schema: OfferList },
      400: err("Invalid body, or too many products (rule live_lookup_limit)."),
      404: err("Unknown requestId."),
      429: err("This agent's hourly allowance of live lookups is used up (rule live_lookup_limit)."),
      503: err("The wholesaler's live service did not answer (code live_unavailable). Not a refusal: retry."),
      ...AUTH_ERRORS,
    },
  },
  {
    method: "post",
    path: "/api/v1/quotes",
    operationId: "requestQuote",
    summary: "Get a signed fixed-price quote",
    description: "Quantities in packs. `substituteFor` marks a line that replaces a product the buyer could not get enough of. The response carries the signed quoteToken and a non-binding policy preview.",
    auth: true,
    body: QuoteBody,
    responses: {
      201: { description: "Quote issued.", schema: QuoteCreated },
      400: err("Invalid lines or too many products."),
      404: err("Unknown requestId."),
      409: err("Not enough stock or no live offer (rule quote_availability); `details.available` says how many packs there are."),
      ...AUTH_ERRORS,
    },
  },
  {
    method: "post",
    path: "/api/v1/orders",
    operationId: "placeOrder",
    summary: "Place an order against a quote",
    description: "The gate checks the order against the mandate. `{ requestId }` alone places the latest quote Dock signed for the request (the intake's choice, or POST /api/v1/quotes). `replaces` changes an earlier order: once this one is placed, Dock takes that one back if it still can. 201: committed with a signed confirmation. 202: waits for a human sign-off; do not retry. 422: refused, `error.rule` names the rule.",
    auth: true,
    body: PlaceOrderBody,
    responses: {
      201: { description: "Committed within the mandate.", schema: PlacedEnvelope },
      202: { description: "Waiting for a human sign-off. Do not retry; GET /api/v1/orders/{orderId}?wait=25 waits for the decision.", schema: PlacedEnvelope },
      400: err("Invalid body."),
      404: err("Unknown requestId."),
      422: { description: "Refused by the gate, or the quote token does not verify (rule quote_signature).", schema: Refusal },
      ...AUTH_ERRORS,
    },
  },
  {
    method: "get",
    path: "/api/v1/orders/{orderId}",
    operationId: "getOrder",
    summary: "Read an order",
    auth: true,
    description: "With `wait` (seconds, at most 55), the answer comes as soon as a person decides an order that waits for sign-off, or when the time is up (`decided: false`).",
    params: [{ name: "orderId", in: "path", schema: z.string(), required: true }, { name: "wait", in: "query", schema: z.number().int().min(0).max(55), description: "Wait up to this many seconds for a sign-off decision." }],
    responses: { 200: { description: "The order.", schema: WaitedEnvelope }, 404: err("No such order for this organisation."), ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/orders",
    operationId: "listOrders",
    summary: "List this organisation's orders",
    description: "Newest first: status, total, delivery day, lines, who must sign and whether they have, and whether it can still be taken back (`canTakeBack`).",
    auth: true,
    params: [{ name: "status", in: "query", schema: ListOrdersInput.shape.status.unwrap() }, { name: "limit", in: "query", schema: ListOrdersInput.shape.limit.unwrap() }],
    responses: { 200: { description: "Orders.", schema: OrderListOut }, 400: err("Invalid query."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/lookup",
    operationId: "lookupProducts",
    summary: "Look up products, prices and availability",
    description: `One call: products matching words, category, brand, claims, allergens to avoid, pack size and delivery day, inside the mandate, each with pack, claims, labels, allergens, origin, delivery reliability, carbon (product-group average) and whether it is the kind asked for (\`match\`), plus live price, stock, earliest delivery and order cut-off for at most ${MAX_LIVE_IDS_PER_CALL} (metered). Opens a request when none is given.`,
    auth: true,
    body: named("LookupBody", LookupInput),
    responses: { 200: { description: "Products.", schema: LookupResult }, 400: err("Invalid body."), 404: err("Unknown requestId."), 429: err("Live lookup allowance used up (rule live_lookup_limit)."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/alternatives",
    operationId: "findAlternatives",
    summary: "Rank alternatives: good, better, best",
    description: "What can stand in for a product inside the mandate, ranked best, better, good, each with its trade-offs, live price and delivery, and what the gate would decide if it were ordered. Keeps the product's dietary claims; never an allergen the mandate or the buyer forbids.",
    auth: true,
    body: named("AlternativesBody", AlternativesInput),
    responses: { 200: { description: "Alternatives.", schema: AlternativesResult }, 400: err("Invalid body."), 404: err("Unknown product or requestId."), 429: err("Live lookup allowance used up (rule live_lookup_limit)."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/orders/{orderId}/withdraw",
    operationId: "withdrawOrder",
    summary: "Take back an order",
    description:
      "Takes back an order that is still pending_approval (it stops holding the weekly budget at once and the approver's screen shows it as withdrawn), or a committed order this agent placed alone inside its mandate, until the wholesaler's order cut-off. An order a person signed off is theirs to take back in the kitchen's store (409 take_back_needs_person); after the cut-off nothing can be (409 past_cutoff). `by` (who asked) is recorded as relayed by the agent, not verified. An order waiting for sign-off also stops holding the budget by itself when its quote's fixed price expires (status expired).",
    auth: true,
    params: [{ name: "orderId", in: "path", schema: z.string(), required: true }],
    body: z.object({ reason: z.string().max(300).optional(), by: z.string().min(1).max(120).optional() }),
    responses: { 200: { description: "The withdrawn order.", schema: OrderEnvelope }, 404: err("No such order for this organisation."), 409: err("A person signed it (take_back_needs_person), the cut-off passed (past_cutoff), another agent placed it (take_back_not_own), or it is decided (order_not_pending)."), ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/approvals",
    operationId: "listPendingApprovals",
    summary: "Orders waiting for a human sign-off",
    description: "Never includes approval tokens. An agent (mandate) sees its own organisation's, an approver (signed-in phone, `dock_approver` cookie) their kitchen's, the operations desk everyone's; a stranger gets 401.",
    auth: false,
    responses: { 200: { description: "Pending approvals the caller may see.", schema: ApprovalList }, 401: err("No mandate, approver session or operations session (rule data_access)."), 403: err("The agent id does not match the mandate.") },
  },
  {
    method: "post",
    path: "/api/v1/approvals/{approvalId}",
    operationId: "decideApproval",
    summary: "A human approves or declines",
    description:
      "For the human approver, never for agents: approving needs the approver's passkey assertion (or, for approvers without a passkey, the one-time link token). The assertion is bound to this order's digest and this decision. The gate re-checks the order before committing. Not offered as an MCP tool.",
    auth: false,
    params: [approvalIdParam],
    body: ApprovalDecisionBody,
    responses: {
      200: { description: "Decided; the order is committed or declined.", schema: ApprovalDecided },
      400: err("Invalid body."),
      401: err("No proof (rule approver_identity)."),
      403: err("Wrong token, wrong approver, or a passkey assertion that does not verify (rule approver_identity)."),
      404: err("No such approval."),
      409: { description: "Already decided, or the re-check at sign-off refused the order.", schema: ApprovalRefused },
    },
  },
  {
    method: "get",
    path: "/api/v1/approvals/{approvalId}",
    operationId: "getApprovalView",
    summary: "The sign-off screen's content",
    description: "What, how much, when, and why this person is asked, in plain words. No secrets. For the kitchen's approver (signed-in phone), its agent, the operations desk, or `?token=` from the one-time approval link; 404 for anyone else. With the approver cookie, `viewerIsApprover` says whether this phone may decline in one tap.",
    auth: false,
    params: [approvalIdParam],
    responses: { 200: { description: "The approval in plain words.", schema: ApprovalViewEnvelope }, 404: err("No such approval.") },
  },
  {
    method: "post",
    path: "/api/v1/approvals/{approvalId}/challenge",
    operationId: "approvalChallenge",
    summary: "A passkey prompt for one decision",
    description: "Returns WebAuthn request options for startAuthentication(). The challenge is derived from the approval, the order's current digest, the decision and a fresh nonce; single use, five minutes.",
    auth: false,
    params: [approvalIdParam],
    body: ChallengeBody,
    responses: {
      200: { description: "Passkey request options.", schema: ChallengeOptions },
      400: err("decision is not approve or decline."),
      404: err("No such approval, or its approver has no passkey."),
      409: err("Already decided (code approval_not_pending)."),
    },
  },
  {
    method: "get",
    path: "/api/v1/approvals/{approvalId}/link",
    operationId: "approvalLink",
    summary: "URL and QR code of the sign-off screen",
    description: "For other screens. The URL carries no secret. The same readers as the sign-off screen; 404 for anyone else.",
    auth: false,
    params: [approvalIdParam],
    responses: { 200: { description: "Link and QR code.", schema: ApprovalLinkOut }, 404: err("No such approval.") },
  },
  {
    method: "post",
    path: "/api/v1/join",
    operationId: "beginJoin",
    summary: "Join by QR code, step 1: the passkey prompt",
    description: "Who the visitor is about to become (a fictional kitchen's purchasing manager) and the WebAuthn creation options. Nothing is created until POST /api/v1/join/verify.",
    auth: false,
    responses: { 200: { description: "Identity and passkey prompt.", schema: JoinStart }, 503: err("Too many demo kitchens right now (code sandbox_full).") },
  },
  {
    method: "post",
    path: "/api/v1/join/verify",
    operationId: "completeJoin",
    summary: "Join by QR code, step 2: register the passkey",
    description: "Creates the visitor's kitchen (its own organisation key, signed mandate and buyer agent) with this phone's passkey as its only approver, and sets the HttpOnly `dock_approver` cookie.",
    auth: false,
    body: JoinVerifyBody,
    responses: {
      201: { description: "Joined; the approver cookie is set.", schema: Joined },
      400: err("No passkey response."),
      403: err("Joining without a passkey is switched off (code demo_tap_disabled)."),
      503: err("Too many demo kitchens right now (code sandbox_full)."),
    },
  },
  {
    method: "get",
    path: "/api/v1/approver",
    operationId: "approverHome",
    summary: "The signed-in approver's home",
    description: "Who they are, what their agent may do alone, what waits for their sign-off and what was decided recently.",
    auth: "approver",
    responses: { 200: { description: "Home screen content.", schema: ApproverHome }, 401: NOT_JOINED },
  },
  {
    method: "post",
    path: "/api/v1/approver/demo-order",
    operationId: "approverDemoOrder",
    summary: "DEMO: start this kitchen's agent on the 1,000 L milk order",
    description: "The visitor kitchen's own agent opens the request, quotes and orders; the order exceeds its limit and waits for this approver's sign-off.",
    auth: "approver",
    responses: { 201: { description: "The agent placed the order.", schema: DemoOrderStarted }, 401: NOT_JOINED },
  },
  {
    method: "get",
    path: "/api/v1/events",
    operationId: "events",
    summary: "Live events (server-sent events)",
    description:
      "A text/event-stream of approval_requested, approval_approved, approval_declined, approval_withdrawn, approval_expired, order_committed, order_rejected and order_withdrawn (a committed order taken back before the cut-off). Each event's `data` is one DockEvent; refetch details on an event. Reconnects resume from Last-Event-ID. A comment line every 15 s keeps idle connections open. Unfiltered, the operations desk gets every event in full and anyone else an aggregated stream (type, time, amount and a generic sentence: no kitchen, order or approval ids). orgId= needs that kitchen's agent, approver or operations (the built-in demo kitchens are open); approvalId= needs a reader of that approval (or token=).",
    auth: false,
    params: [
      { name: "scope", in: "query", schema: z.enum(["mine"]), description: "mine: this phone's kitchen only (needs the approver cookie)." },
      { name: "approvalId", in: "query", schema: z.string(), description: "Only events of one approval." },
      { name: "token", in: "query", schema: z.string(), description: "With approvalId: the one-time link token, for a phone without the approver cookie." },
      { name: "orgId", in: "query", schema: z.string(), description: "Only events of one organisation." },
      { name: "since", in: "query", schema: z.string(), description: "Replay events after this id (as Last-Event-ID)." },
    ],
    responses: { 200: { description: "Event stream; each event's data is a DockEvent (aggregated for the public).", schema: DockEventSchema, contentType: "text/event-stream" }, 401: NOT_JOINED, 403: err("Another kitchen's events (rule data_access)."), 404: err("No such approval for this caller.") },
  },
  {
    method: "get",
    path: "/api/v1/sandboxes",
    operationId: "listSandboxes",
    summary: "Live demo kitchens",
    description: "For the big screen. No keys, no mandate tokens. Anyone: who is here (kitchen, city, approver, times). The operations desk also gets ids and limits.",
    auth: false,
    responses: { 200: { description: "Demo kitchens.", schema: SandboxList } },
  },
  {
    method: "post",
    path: "/api/v1/sandboxes/{sandboxId}/demo-order",
    operationId: "sandboxDemoOrder",
    summary: "DEMO: the big screen starts a visitor kitchen's agent",
    description: "Same as POST /api/v1/approver/demo-order for a given kitchen. Creates at most a sign-off request; it never approves. Only from the visitor's own phone or the operations desk's screen.",
    auth: false,
    params: [{ name: "sandboxId", in: "path", schema: z.string(), required: true }],
    responses: { 201: { description: "The agent placed the order.", schema: DemoOrderStarted }, 401: err("Not signed in (rule data_access)."), 403: err("Another visitor's kitchen (rule data_access)."), 404: err("No such demo kitchen.") },
  },
  {
    method: "post",
    path: "/api/v1/intake",
    operationId: "openIntake",
    summary: "Start an order from a structured need",
    description:
      "The recommended way to start. AimoPilot checks the need for likely mistakes (against the kitchen's own history), asks at most two typed questions that its memory cannot answer, and offers option cards with pros and cons. Every reply is `{ step }`: its `state` says what happens next and `next` names the call. Opens a purchase request; `step.requestId` is its id.",
    auth: true,
    body: IntakeBody,
    responses: {
      201: { description: "The first step.", schema: IntakeStepEnvelope },
      400: err("Invalid need."),
      422: err("AimoPilot cannot tell the amount (codes amount_unknown, nothing_to_repeat). A product the catalogue does not have, or a product group outside the mandate, is not an error: the step is no_options with the reason in notes."),
      ...AUTH_ERRORS,
    },
  },
  {
    method: "post",
    path: "/api/v1/agent/interpret",
    operationId: "interpretRequest",
    summary: "Free text to a structured need",
    description:
      "Optional helper before POST /api/v1/intake: a language model reads the buyer's words (English, Finnish or Swedish) and fills only what was said; plain code checks every field, copies the buyer's own words, and leaves anything unstated empty so the intake can ask or consult memory. The model never decides anything: the intake and the gate do. With `earlier` (the kitchen's earlier requests) a follow-up such as \"same again but 200 litres\" is resolved against one of them and `basedOn` names it. Each caller has an hourly allowance of model calls; the same text for the same kitchen on the same day is answered from a cache (`cached: true`).",
    auth: true,
    body: InterpretRequestBody,
    responses: {
      200: { description: "The structured need, ready for POST /api/v1/intake.", schema: Interpretation },
      400: err("Empty or too long text, or an invalid body."),
      422: err("not_a_purchase_request (the text does not ask to buy anything), or need_incomplete (details.missing lists item and/or quantity; details.partial holds what was understood)."),
      429: err("This caller's hourly allowance of model calls is used up (interpret_quota_exceeded); see Retry-After."),
      502: err("The model failed or returned something plain code refused (interpret_failed, interpret_invalid_output)."),
      503: err("No model is configured or the provider is unavailable (model_unavailable)."),
      504: err("The model did not answer in time (interpret_timeout)."),
      ...AUTH_ERRORS,
    },
  },
  {
    method: "get",
    path: "/api/v1/intake/{requestId}",
    operationId: "getIntake",
    summary: "The current step of an intake",
    auth: true,
    params: [requestIdParam],
    responses: { 200: { description: "The current step.", schema: IntakeStepEnvelope }, 404: err("No such intake for this agent."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/intake/{requestId}/concerns",
    operationId: "respondToConcerns",
    summary: "The buyer confirms or corrects a likely mistake",
    description: `Only in state needs_confirmation. For each open concern, \`choice\` is "confirm" (when the concern is confirmable) or one of its correction ids. The answer must come from the human buyer. ${BY}`,
    auth: true,
    params: [requestIdParam],
    body: ConcernResponseBody,
    responses: { 200: { description: "The next step.", schema: IntakeStepEnvelope }, ...INTAKE_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/intake/{requestId}/answers",
    operationId: "answerQuestions",
    summary: "The buyer answers the clarifying questions",
    description: `In state needs_input (or options_ready, to change an answer memory pre-selected). One optionId per question; \`remember: true\` stores it as the kitchen's stated preference. The answer must come from the human buyer. ${BY}`,
    auth: true,
    params: [requestIdParam],
    body: AnswersBody,
    responses: { 200: { description: "The next step.", schema: IntakeStepEnvelope }, ...INTAKE_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/intake/{requestId}/choice",
    operationId: "chooseOption",
    summary: "Choose an option card and get its signed quote",
    description: `Only in state options_ready. The wholesaler quotes the chosen option at a fixed price; the reply is state quoted with the quote, the gate's preview and the body for POST /api/v1/orders. ${BY}`,
    auth: true,
    params: [requestIdParam],
    body: ChoiceBody,
    responses: {
      200: { description: "Quoted.", schema: IntakeStepEnvelope },
      ...INTAKE_ERRORS,
      404: err("No such intake for this agent, or no such option (code option_not_found)."),
    },
  },
  {
    method: "get",
    path: "/api/v1/kitchen",
    operationId: "getKitchen",
    summary: "The kitchen's memory",
    description: "What AimoPilot remembers about the buyer organisation: order history, usual amounts per product family, rules people stated, and patterns learned from the history.",
    auth: true,
    responses: { 200: { description: "Kitchen memory.", schema: KitchenEnvelope }, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/offers",
    operationId: "listOffers",
    summary: "The wholesaler's offers to this kitchen",
    description:
      "What the wholesaler's selling agent offered this kitchen: a new, seasonal or cheaper like-for-like product, with the reasons and their figures, the price per pack and until when it holds. Each offer is a signed W3C Verifiable Credential (compact JWS, `typ: vc+jwt`, type `DockProductOffer`, Ed25519) addressed to the buyer organisation: verify `token` offline against /.well-known/jwks.json. An offer is never an order. Open offers only, unless `all=true`.",
    auth: true,
    params: [{ name: "all", in: "query", schema: z.enum(["true", "false"]), description: "true: also answered and expired offers." }],
    responses: { 200: { description: "Offers, newest first, and what the kitchen muted.", schema: OfferListOut }, ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/offers/{offerId}/accept",
    operationId: "acceptOffer",
    summary: "Accept an offer: start an ordinary order",
    description: "Buys nothing: it opens an ordinary intake for the offered product (the mistake check, option cards, a fixed-price quote the wholesaler signs, the mandate gate and its sign-off). Continue from the returned step exactly as after POST /api/v1/intake. Only on the buyer's own yes.",
    auth: true,
    params: [offerIdParam],
    body: OfferAcceptBody,
    responses: { 201: { description: "The ordinary order it started, as an intake step.", schema: OfferAccepted }, 400: err("Invalid body."), 404: err("No such offer for this organisation (code offer_not_found)."), 409: err("The offer is closed, expired, does not verify, or the kitchen's own rules do not allow it (codes offer_closed, offer_invalid, offer_not_for_kitchen)."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/offers/{offerId}/decline",
    operationId: "declineOffer",
    summary: "Decline an offer",
    description: "Not wanted. The product is not offered to this kitchen again for 30 days.",
    auth: true,
    params: [offerIdParam],
    body: OfferAnswerBody,
    responses: { 200: { description: "The declined offer.", schema: OfferDeclined }, 404: err("No such offer for this organisation."), 409: err("The offer is no longer open."), ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/v1/offers/mute",
    operationId: "muteOffers",
    summary: "Stop a kind of offer, or every offer",
    description: "scope `product`, `family` (a product family), `reason` (new_in_assortment, in_season, cheaper, more_reliable, lower_carbon, new_to_kitchen) or `all` (offers off). With offerId the value comes from that offer; `undo: true` lifts it. The selling agent reads this before it picks anything.",
    auth: true,
    body: OfferMuteBody,
    responses: { 200: { description: "What the kitchen muted now.", schema: OfferPrefsOut }, 400: err("Invalid body, or nothing to mute."), 404: err("No such offer for this organisation."), ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/ledger",
    operationId: "getLedger",
    summary: "Audit trail",
    description: "Hash-chained entries, the chain verified in full, and one plain-language line per step. Verification and head are public; entries only for their own organisation's agent (mandate) or approver (signed-in phone), and all of them for the operations desk. A stranger gets an empty `entries`.",
    auth: false,
    params: [
      { name: "requestId", in: "query", schema: z.string() },
      { name: "orderId", in: "query", schema: z.string() },
      { name: "view", in: "query", schema: z.enum(["buyer", "wholesaler"]) },
    ],
    responses: { 200: { description: "Ledger view. view=wholesaler: what was asked, claimed, committed and who signed, without the buyer's kitchen memory.", schema: LedgerView } },
  },
  {
    method: "get",
    path: "/api/v1/keys",
    operationId: "getKeys",
    summary: "Wholesaler public keys (JWKS)",
    description: "RFC 7517 JWK Set with Ed25519 keys (RFC 8037) to verify quotes and order confirmations offline. Same document as /.well-known/jwks.json.",
    auth: false,
    responses: { 200: { description: "JWK Set.", schema: JwksSchema } },
  },
  {
    method: "get",
    path: "/api/v1/openapi.json",
    operationId: "getOpenApi",
    summary: "This document",
    auth: false,
    responses: { 200: { description: "OpenAPI 3.1 document.", schema: OpenApiDocument } },
  },
];

/** Route files that are deliberately not part of the published contract. */
export const UNDOCUMENTED_ROUTES = [
  "/api/v1/dev/outbox", // dev only, 404 in production
];

const REF = (id: string) => `#/components/schemas/${id}`;

/** Options for every conversion: input view (extra fields are ignored, not refused), refs into components, descriptions kept. */
const TO_JSON = {
  io: "input",
  uri: REF,
  unrepresentable: "any",
  override: ({ zodSchema, jsonSchema }: { zodSchema: unknown; jsonSchema: Record<string, unknown> }) => {
    const description = z.globalRegistry.get(zodSchema as z.ZodType)?.description;
    if (description && !jsonSchema.description) jsonSchema.description = description;
  },
} as const;

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const id = wire.get(schema)?.id;
  if (id) return { $ref: REF(id) };
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, TO_JSON) as Record<string, unknown>;
  void _s;
  return rest;
}

/**
 * Who each operation is for. Approver operations decide or show a sign-off, or join a phone as an approver: an
 * OpenAPI-to-tools converter should not offer them to a buyer agent (they are refused without the approver's
 * passkey, session or link token anyway). `?audience=agent` serves the document without them.
 */
export const APPROVER_OPERATIONS = new Set(["decideApproval", "getApprovalView", "approvalChallenge", "approvalLink", "beginJoin", "completeJoin", "approverHome", "approverDemoOrder", "sandboxDemoOrder", "listSandboxes"]);
/** Operations whose body must be the human buyer's own answer: the same marker MCP puts in the tools' `_meta["dock/humanInput"]`. */
export const HUMAN_INPUT_OPS = new Set(["respondToConcerns", "answerQuestions"]);
const HUMAN_INPUT_MARK = { required: true, from: "buyer", how: "the agent relays the buyer's own answer, or gives the buyer the step's answerUrl to answer on Dock's page; never answer for them" };
type Audience = "agent" | "approver" | "public";
function audienceOf(op: Operation): Audience {
  if (APPROVER_OPERATIONS.has(op.operationId)) return "approver";
  return op.auth === true || op.path.startsWith("/api/v1/intake") ? "agent" : op.auth === "approver" ? "approver" : "public";
}
const TAGS = [
  { name: "agent", description: "For buyer agents, with the organisation's signed mandate." },
  { name: "approver", description: "For the human approver's phone and the demo screens. Not for agents: approving needs the approver's own passkey, session or link token." },
  { name: "public", description: "Discovery, keys, the ledger's public view and live events." },
];

export function buildOpenApi(origin: string, opts: { audience?: Audience } = {}) {
  const { schemas } = z.toJSONSchema(wire, TO_JSON);
  const components = Object.fromEntries(
    Object.entries(schemas).map(([id, sch]) => {
      const { $schema: _s, $id: _i, ...rest } = sch as Record<string, unknown>;
      void _s;
      void _i;
      return [id, rest];
    }),
  );

  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of API) {
    if (opts.audience === "agent" && audienceOf(op) === "approver") continue;
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      ...(op.auth === true ? {} : { security: op.auth === "approver" ? [{ approverSession: [] }] : [] }),
      tags: [audienceOf(op)],
      "x-dock-audience": audienceOf(op),
      ...(HUMAN_INPUT_OPS.has(op.operationId) ? { "x-dock-human-input": HUMAN_INPUT_MARK } : {}),
      ...(op.params
        ? {
            parameters: op.params.map((p) => ({
              name: p.name,
              in: p.in,
              required: p.required ?? false,
              ...(p.description ? { description: p.description } : {}),
              schema: p.array ? { type: "array", items: jsonSchema(p.schema) } : jsonSchema(p.schema),
              ...(p.array ? { style: "form", explode: true } : {}),
            })),
          }
        : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body) } } } } : {}),
      responses: Object.fromEntries(
        Object.entries(op.responses).map(([status, r]) => [status, { description: r.description, content: { [r.contentType ?? "application/json"]: { schema: jsonSchema(r.schema) } } }]),
      ),
    };
  }

  return {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "AimoPilot",
      version: "1.0.0",
      summary: "Open ordering gateway for AI purchasing agents.",
      description:
        "Any company's purchasing agent orders from the wholesaler carrying a signed mandate that says what it may buy; anything beyond the mandate needs a human sign-off. Start an order with POST /api/v1/intake: Dock checks the need for likely mistakes, asks the buyer at most two typed questions, offers option cards and quotes the chosen one; the lower-level search, availability and quote operations stay available for follow-up. Every refusal is `{ error: { code, rule, message, details } }` where `rule` names the check that refused. The same operations are available as MCP tools at /api/mcp. Discovery: /.well-known/api-catalog (RFC 9727), /.well-known/dock.json, /llms.txt.",
    },
    servers: [{ url: origin }],
    externalDocs: { description: "How to connect an agent", url: `${origin}/llms.txt` },
    security: [{ mandate: [], agentId: [] }],
    tags: TAGS,
    paths,
    components: {
      securitySchemes: {
        mandate: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "mandate+jwt (Ed25519 JWS signed by the buyer organisation)",
          description: "The buyer organisation's signed mandate. Send `Authorization: Bearer <jws>`; `Authorization: Mandate <jws>` is accepted too.",
        },
        agentId: { type: "apiKey", in: "header", name: "Dock-Agent-Id", description: "The agent id the mandate names (its `sub` claim)." },
        approverSession: {
          type: "apiKey",
          in: "cookie",
          name: "dock_approver",
          description: "HttpOnly cookie set by POST /api/v1/join/verify on the approver's phone. It identifies the phone; approving still needs the passkey.",
        },
      },
      schemas: components,
    },
  };
}

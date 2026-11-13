import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { AvailabilityInput, OpenRequestInput, PlaceOrderInput, QuoteInput, SearchInput } from "@/core/orders";
import {
  CatalogStatsSchema,
  ErrorBodySchema,
  ErrorSchema,
  JwksSchema,
  LedgerEntrySchema,
  LedgerVerificationSchema,
  OfferSchema,
  OrderSchema,
  PendingApprovalSchema,
  ProductOutSchema,
  PurchaseRequestSchema,
  QuoteResultSchema,
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
  z.object({ decision: z.enum(["approve", "decline"]), token: z.string().describe("One-time token from the approval link sent to the approver."), note: z.string().max(500).optional() }),
);

// Response bodies.
const RequestCreated = named("RequestCreated", z.object({ request: PurchaseRequestSchema }));
const ProductList = named("ProductList", z.object({ products: z.array(ProductOutSchema), liveCallsSoFar: z.number().int() }));
const OfferList = named("OfferList", z.object({ offers: z.array(OfferSchema), liveCallsSoFar: z.number().int() }));
const OrderEnvelope = named("OrderEnvelope", z.object({ order: OrderSchema }));
const OrderRefused = named("OrderRefused", z.object({ error: ErrorSchema, order: OrderSchema }));
const Refusal = named("Refusal", z.union([OrderRefused, ErrorBodySchema]));
const ApprovalList = named("ApprovalList", z.object({ approvals: z.array(PendingApprovalSchema) }));
const LedgerView = named(
  "LedgerView",
  z.object({
    verification: LedgerVerificationSchema,
    head: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
    catalog: CatalogStatsSchema,
    explanation: z.array(z.string()),
    entries: z.array(LedgerEntrySchema),
  }),
);
const ApiIndex = named("ApiIndex", z.object({ name: z.string(), version: z.string(), endpoints: z.record(z.string(), z.string()) }));
const OpenApiDocument = named("OpenApiDocument", z.object({ openapi: z.string() }));

type Param = { name: string; in: "query" | "path"; schema: z.ZodType; required?: boolean; description?: string; array?: boolean };
type Operation = {
  method: "get" | "post";
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  auth: boolean;
  params?: Param[];
  body?: z.ZodType;
  responses: Record<number, { description: string; schema: z.ZodType }>;
};

const err = (description: string) => ({ description, schema: ErrorBodySchema });
const AUTH_ERRORS = { 401: err("No mandate, a bad signature, an expired mandate or no agent id. `error.rule` names the check."), 403: err("The agent id does not match the mandate.") };
const s = SearchInput.shape;

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
    responses: { 200: { description: "Live offers.", schema: OfferList }, 400: err("Invalid body, or too many products (rule live_lookup_limit)."), 404: err("Unknown requestId."), ...AUTH_ERRORS },
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
      201: { description: "Quote issued.", schema: QuoteResultSchema },
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
    description: "The gate checks the order against the mandate. 201: committed with a signed confirmation. 202: waits for a human sign-off; do not retry. 422: refused, `error.rule` names the rule.",
    auth: true,
    body: PlaceOrderBody,
    responses: {
      201: { description: "Committed within the mandate.", schema: OrderEnvelope },
      202: { description: "Waiting for a human sign-off. Do not retry; poll GET /api/v1/orders/{orderId}.", schema: OrderEnvelope },
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
    params: [{ name: "orderId", in: "path", schema: z.string(), required: true }],
    responses: { 200: { description: "The order.", schema: OrderEnvelope }, 404: err("No such order for this organisation."), ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/v1/approvals",
    operationId: "listPendingApprovals",
    summary: "Orders waiting for a human sign-off",
    description: "Never includes approval tokens.",
    auth: false,
    responses: { 200: { description: "Pending approvals.", schema: ApprovalList } },
  },
  {
    method: "post",
    path: "/api/v1/approvals/{approvalId}",
    operationId: "decideApproval",
    summary: "A human approves or declines",
    description: "For the approver, not for agents: needs the one-time token from the approval link. The gate re-checks the order before committing.",
    auth: false,
    params: [{ name: "approvalId", in: "path", schema: z.string(), required: true }],
    body: ApprovalDecisionBody,
    responses: {
      200: { description: "Decided; the order is committed or declined.", schema: OrderEnvelope },
      401: err("No token."),
      403: err("Wrong token (rule approver_identity)."),
      404: err("No such approval."),
      409: { description: "Already decided, or the re-check at sign-off refused the order.", schema: Refusal },
    },
  },
  {
    method: "get",
    path: "/api/v1/ledger",
    operationId: "getLedger",
    summary: "Audit trail",
    description: "Hash-chained entries, the chain verified in full, and one plain-language line per step.",
    auth: false,
    params: [
      { name: "requestId", in: "query", schema: z.string() },
      { name: "orderId", in: "query", schema: z.string() },
    ],
    responses: { 200: { description: "Ledger view.", schema: LedgerView } },
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
export const UNDOCUMENTED_ROUTES = ["/api/v1/dev/outbox"]; // dev only, 404 in production

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

export function buildOpenApi(origin: string) {
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
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      ...(op.auth ? {} : { security: [] }),
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
        Object.entries(op.responses).map(([status, r]) => [status, { description: r.description, content: { "application/json": { schema: jsonSchema(r.schema) } } }]),
      ),
    };
  }

  return {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Dock",
      version: "1.0.0",
      summary: "Open ordering gateway for AI purchasing agents.",
      description:
        "Any company's purchasing agent orders from the wholesaler carrying a signed mandate that says what it may buy; anything beyond the mandate needs a human sign-off. Every refusal is `{ error: { code, rule, message, details } }` where `rule` names the check that refused. The same operations are available as MCP tools at /api/mcp. Discovery: /.well-known/api-catalog (RFC 9727), /.well-known/dock.json, /llms.txt.",
    },
    servers: [{ url: origin }],
    externalDocs: { description: "How to connect an agent", url: `${origin}/llms.txt` },
    security: [{ mandate: [], agentId: [] }],
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
      },
      schemas: components,
    },
  };
}

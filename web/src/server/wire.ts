import { z } from "zod";
import { ProductSchema } from "@/core/catalog";
import { MandateSchema } from "@/core/mandate";
import { RULES } from "@/core/policy";
import { QuoteLineSchema, QuoteSchema } from "@/core/quote";

/**
 * Zod schemas for what Dock sends back over the wire. Inputs are validated by the schemas in src/core;
 * these describe outputs. Both the OpenAPI document and the MCP tools' output schemas are generated from
 * them, and tests check real responses against them, so the published description cannot drift silently.
 */

/** Every schema that has a name in the published API description. */
export const wire = z.registry<{ id: string }>();
export function named<T extends z.ZodType>(id: string, schema: T): T {
  wire.add(schema, { id });
  return schema;
}

export const ErrorSchema = named("Error", z
  .object({
    code: z.string().describe("Machine-readable error code, e.g. mandate_expired, quote_insufficient_stock, policy_rejected."),
    rule: z.string().optional().describe("The named check that refused, e.g. weekly_budget, live_lookup_limit, mandate_signature."),
    message: z.string().describe("Plain-language reason."),
    details: z.record(z.string(), z.unknown()).optional(),
  }));

export const ErrorBodySchema = named("ErrorBody", z.object({ error: ErrorSchema }));

export const PurchaseRequestSchema = named("PurchaseRequest", z
  .object({
    requestId: z.string(),
    orgId: z.string(),
    agentId: z.string(),
    mandateId: z.string(),
    text: z.string(),
    neededBy: z.iso.date().optional(),
    createdAt: z.iso.datetime(),
  }));

export const ProductOutSchema = named("Product", ProductSchema);

export const OfferSchema = named("Offer", z
  .object({
    productId: z.string(),
    unitPriceCents: z.number().int().describe("Live price per pack, euro cents ex VAT."),
    availablePacks: z.number().int().describe("Packs in stock right now."),
    deliveryDate: z.iso.date().describe("Earliest possible delivery."),
  }));

export const RuleResultSchema = named("RuleResult", z
  .object({
    rule: z.enum(RULES),
    outcome: z.enum(["pass", "escalate", "fail"]),
    reason: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }));

const ApproverSchema = z.object({ role: z.string(), name: z.string(), maxApprovalCents: z.number().int() });

export const DecisionSchema = named("Decision", z
  .object({
    outcome: z.enum(["auto_approve", "needs_human_approval", "reject"]),
    totalCents: z.number().int(),
    rules: z.array(RuleResultSchema).describe("Every rule of the gate with its result, so a refusal names exactly what fired."),
    reasons: z.array(z.string()),
    approver: ApproverSchema.optional().describe("Present when outcome is needs_human_approval."),
  }));

export const QuoteLineOutSchema = named("QuoteLine", QuoteLineSchema);
export const QuoteOutSchema = named("Quote", QuoteSchema);

export const QuoteResultSchema = named("QuoteResult", z
  .object({
    quote: QuoteOutSchema,
    quoteToken: z.string().describe("The quote as a compact JWS signed by the wholesaler (typ quote+jws). Pass it unchanged to place an order."),
    policyPreview: DecisionSchema.describe("What the gate would decide on this quote right now. Not binding."),
  }));

export const OrderSchema = named("Order", z
  .object({
    orderId: z.string(),
    requestId: z.string(),
    orgId: z.string(),
    orgName: z.string(),
    agentId: z.string(),
    mandateId: z.string(),
    quoteId: z.string(),
    status: z.enum(["pending_approval", "committed", "rejected", "declined"]),
    lines: z.array(QuoteLineOutSchema),
    totalCents: z.number().int(),
    decision: DecisionSchema,
    approval: z
      .object({
        approvalId: z.string(),
        approver: ApproverSchema,
        status: z.enum(["pending", "approved", "declined"]),
        orderDigest: z.string(),
        requestedAt: z.iso.datetime(),
        decidedAt: z.iso.datetime().optional(),
        note: z.string().optional(),
      })
      .optional(),
    confirmation: z
      .string()
      .optional()
      .describe("Present once committed: compact JWS (typ order+jws) signed by the wholesaler. Verify it with the keys at /.well-known/jwks.json."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }));

export const LedgerEntrySchema = named("LedgerEntry", z
  .object({
    seq: z.number().int(),
    at: z.iso.datetime(),
    type: z.string(),
    actor: z.string(),
    summary: z.string(),
    requestId: z.string().optional(),
    orderId: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
    prevHash: z.string(),
    hash: z.string(),
  }));

export const LedgerVerificationSchema = named("LedgerVerification", z
  .object({ ok: z.boolean(), length: z.number().int().optional(), brokenAt: z.number().int().optional(), problem: z.string().optional(), message: z.string().optional() }));

export const CatalogStatsSchema = named("CatalogStats", z
  .object({ searches: z.number().int(), liveCalls: z.number().int(), productsPriced: z.number().int() }));

export const JwkSchema = named("Jwk", z
  .object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), kid: z.string(), alg: z.string(), use: z.literal("sig") }));

export const JwksSchema = named("Jwks", z.object({ keys: z.array(JwkSchema) }));

export const MandateOutSchema = named("Mandate", MandateSchema);

export const PendingApprovalSchema = named(
  "PendingApproval",
  z.object({
    approvalId: z.string(),
    orderId: z.string(),
    orgName: z.string(),
    agentId: z.string(),
    approver: ApproverSchema,
    totalCents: z.number().int(),
    reasons: z.array(z.string()),
    lines: z.array(z.object({ productId: z.string(), name: z.string(), quantity: z.number().int(), substituteFor: z.string().optional() })),
    requestedAt: z.iso.datetime(),
  }),
);

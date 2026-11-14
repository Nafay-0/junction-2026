import { z } from "zod";
import { ProductSchema } from "@/core/catalog";
import { MandateSchema } from "@/core/mandate";
import { RULES } from "@/core/policy";
import { NeedSchema } from "@/core/need";
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
  .looseObject({
    code: z.string().describe("Machine-readable error code, e.g. mandate_expired, quote_insufficient_stock, policy_rejected."),
    rule: z.string().optional().describe("The named check that refused, e.g. weekly_budget, live_lookup_limit, mandate_signature."),
    message: z.string().describe("Plain-language reason."),
    details: z.record(z.string(), z.unknown()).optional(),
  }));

export const ErrorBodySchema = named("ErrorBody", z.looseObject({ error: ErrorSchema }));

export const PurchaseRequestSchema = named("PurchaseRequest", z
  .looseObject({
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
  .looseObject({
    productId: z.string(),
    unitPriceCents: z.number().int().describe("Live price per pack, euro cents ex VAT."),
    availablePacks: z.number().int().describe("Packs in stock right now."),
    deliveryDate: z.iso.date().describe("Earliest possible delivery."),
  }));

export const RuleResultSchema = named("RuleResult", z
  .looseObject({
    rule: z.enum(RULES),
    outcome: z.enum(["pass", "escalate", "fail"]),
    reason: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }));

const ApproverSchema = z.looseObject({ role: z.string(), name: z.string(), maxApprovalCents: z.number().int() });

export const DecisionSchema = named("Decision", z
  .looseObject({
    outcome: z.enum(["auto_approve", "needs_human_approval", "reject"]),
    totalCents: z.number().int(),
    rules: z.array(RuleResultSchema).describe("Every rule of the gate with its result, so a refusal names exactly what fired."),
    reasons: z.array(z.string()),
    approver: ApproverSchema.optional().describe("Present when outcome is needs_human_approval."),
  }));

export const QuoteLineOutSchema = named("QuoteLine", QuoteLineSchema);
export const QuoteOutSchema = named("Quote", QuoteSchema);

export const QuoteResultSchema = named("QuoteResult", z
  .looseObject({
    quote: QuoteOutSchema,
    quoteToken: z.string().describe("The quote as a compact JWS signed by the wholesaler (typ quote+jws). Pass it unchanged to place an order."),
    policyPreview: DecisionSchema.describe("What the gate would decide on this quote right now. Not binding."),
  }));

export const OrderSchema = named("Order", z
  .looseObject({
    orderId: z.string(),
    requestId: z.string(),
    orgId: z.string(),
    orgName: z.string(),
    agentId: z.string(),
    mandateId: z.string(),
    quoteId: z.string(),
    status: z.enum(["pending_approval", "committed", "rejected", "declined", "withdrawn", "expired"]),
    lines: z.array(QuoteLineOutSchema),
    totalCents: z.number().int(),
    decision: DecisionSchema,
    approval: z
      .looseObject({
        approvalId: z.string(),
        approver: ApproverSchema,
        status: z.enum(["pending", "approved", "declined", "withdrawn", "expired"]),
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
  .looseObject({
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
  .looseObject({ ok: z.boolean(), length: z.number().int().optional(), head: z.object({ seq: z.number().int(), hash: z.string() }).nullable().optional(), brokenAt: z.number().int().optional(), problem: z.string().optional(), message: z.string().optional() }));

export const CatalogStatsSchema = named("CatalogStats", z
  .looseObject({ searches: z.number().int(), liveCalls: z.number().int(), productsPriced: z.number().int() }));

export const JwkSchema = named("Jwk", z
  .looseObject({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), kid: z.string(), alg: z.string(), use: z.literal("sig") }));

export const JwksSchema = named("Jwks", z.looseObject({ keys: z.array(JwkSchema) }));

export const MandateOutSchema = named("Mandate", MandateSchema);

export const PendingApprovalSchema = named(
  "PendingApproval",
  z.looseObject({
    approvalId: z.string(),
    orderId: z.string(),
    orgName: z.string(),
    agentId: z.string(),
    approver: ApproverSchema,
    totalCents: z.number().int(),
    reasons: z.array(z.string()),
    lines: z.array(z.looseObject({ productId: z.string(), name: z.string(), quantity: z.number().int(), substituteFor: z.string().optional() })),
    requestedAt: z.iso.datetime(),
  }),
);

// ---------- intake: from a structured need to a signed quote ----------

export const INTAKE_STATES = ["needs_confirmation", "needs_input", "options_ready", "quoted", "no_options", "cancelled"] as const;

export const NeedOutSchema = named("StructuredNeed", NeedSchema);

const amount = z.looseObject({ amount: z.number(), unit: z.enum(["L", "kg", "pcs"]) });

export const ConcernSchema = named(
  "Concern",
  z.looseObject({
    key: z.string().describe("Send this key back with the buyer's response."),
    code: z.string().describe("What kind of likely mistake, e.g. quantity_tenfold, unit_confusion, delivery_in_past, duplicate_recent."),
    severity: z.enum(["error", "warning"]),
    message: z.string().describe("The question to put to the buyer, in plain words."),
    confirmable: z.boolean().describe("true: the buyer may confirm the need as it is. false: they must pick a correction."),
    corrections: z.array(z.looseObject({ id: z.string(), label: z.string(), patch: z.record(z.string(), z.unknown()).optional(), cancel: z.literal(true).optional() })),
    preferenceIds: z.array(z.string()).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  }),
);

export const QuestionSchema = named(
  "Question",
  z.looseObject({
    id: z.string(),
    kind: z.enum(["dimension", "optimise"]),
    text: z.string().describe("The question to put to the buyer."),
    options: z.array(z.looseObject({ id: z.string(), label: z.string() })).describe("The only answers Dock accepts: send one optionId."),
    dimension: z.string().optional(),
  }),
);

const MemoryNoteSchema = z.looseObject({ question: QuestionSchema, optionId: z.string(), label: z.string(), source: z.enum(["stated", "learned"]), text: z.string(), preferenceId: z.string().optional() });

export const OptionCardSchema = named(
  "OptionCard",
  z.looseObject({
    optionId: z.string(),
    labels: z.array(z.enum(["best_price", "lowest_carbon", "most_reliable", "same_as_last_time"])),
    title: z.string(),
    lines: z.array(
      z.looseObject({
        productId: z.string(),
        name: z.string(),
        packs: z.number().int(),
        packSize: z.number(),
        unit: z.enum(["L", "kg", "pcs"]),
        unitPriceCents: z.number().int(),
        lineTotalCents: z.number().int(),
        deliveryDate: z.iso.date(),
        substituteFor: z.string().optional(),
      }),
    ),
    totalCents: z.number().int(),
    deliveryDate: z.iso.date(),
    delivered: amount,
    leftover: amount,
    co2: z.looseObject({ kg: z.number().nullable(), basis: z.enum(["product_group_average", "missing"]) }),
    reliability: z.number().nullable(),
    signOff: z.array(z.string()).describe("Why a person will have to sign off this option, if they will."),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    quoteLines: z.array(z.looseObject({ productId: z.string(), quantity: z.number().int(), substituteFor: z.string().optional() })),
    alternative: z
      .looseObject({ for: z.string(), tier: z.enum(["best", "better", "good"]), reason: z.string(), use: z.string().optional() })
      .optional()
      .describe("When this card stands in for the product the request is about: how the product knowledge map ranks it for the kitchen use, and why."),
  }),
);

export const IntakeStepSchema = named(
  "IntakeStep",
  z.looseObject({
    requestId: z.string(),
    state: z.enum(INTAKE_STATES).describe("needs_confirmation, needs_input, options_ready, quoted, no_options or cancelled."),
    family: z.string().describe("Product family, e.g. milk."),
    need: NeedOutSchema,
    amount: amount.optional().describe("The need in base units, once Dock could work it out."),
    concerns: z.array(ConcernSchema).describe("needs_confirmation: likely mistakes the buyer must confirm or correct."),
    questions: z.array(QuestionSchema).describe("needs_input: at most two questions for the buyer."),
    fromMemory: z.array(MemoryNoteSchema).describe("Answers Dock took from the kitchen's memory instead of asking."),
    alsoAsked: z
      .array(z.looseObject({ text: z.string(), group: z.string(), amount: z.looseObject({ amount: z.number(), unit: z.string() }).optional() }))
      .optional()
      .describe("Items the buyer's own words name that this request does not cover (found by plain code in the text). Nothing is ordered for them here: submit each as its own need next."),
    rules: z.array(z.looseObject({ text: z.string(), source: z.enum(["mandate", "request", "stated"]), preferenceId: z.string().optional() })),
    options: z.array(OptionCardSchema).describe("options_ready: the choices, with pros and cons."),
    preselected: z.looseObject({ optionId: z.string(), reason: z.string(), source: z.enum(["request", "answer", "stated", "learned"]) }).optional(),
    notes: z.array(z.string()),
    excluded: z.array(z.looseObject({ productId: z.string(), reason: z.string() })),
    acknowledgements: z.array(z.looseObject({ key: z.string(), code: z.string(), action: z.enum(["confirmed", "corrected", "cancelled"]), correctionId: z.string().optional(), by: z.string(), at: z.iso.datetime() })),
    chosen: z.looseObject({ optionId: z.string(), labels: z.array(z.string()), by: z.string(), at: z.iso.datetime() }).optional(),
    quote: QuoteResultSchema.optional().describe("quoted: the signed quote and the gate's preview."),
    next: z.looseObject({ method: z.string(), path: z.string(), example: z.unknown() }).describe("The REST call to make next, with an example body."),
  }),
);

export const KitchenSchema = named(
  "Kitchen",
  z.looseObject({
    orgId: z.string(),
    name: z.string(),
    deliveryWeekdays: z.array(z.number().int()).describe("ISO weekdays the kitchen takes deliveries, 1 = Monday."),
    stated: z.array(z.looseObject({ id: z.string(), kind: z.string(), text: z.string(), statedBy: z.string(), statedAt: z.iso.datetime() })).describe("Rules people stated for this kitchen."),
    families: z.array(
      z.looseObject({
        family: z.string(),
        orders: z.number().int(),
        usual: z.looseObject({ amount: z.number(), unit: z.string(), text: z.string() }),
        lastOrder: z.record(z.string(), z.unknown()),
        learned: z.array(z.looseObject({ kind: z.string(), text: z.string() })).describe("Patterns Dock learned from the history."),
      }),
    ),
    recentHistory: z.array(z.record(z.string(), z.unknown())),
  }),
);

// ---------- the approver's phone and the big screen ----------

export const ApprovalViewSchema = named(
  "ApprovalView",
  z.looseObject({
    approvalId: z.string(),
    state: z.enum(["pending", "committed", "declined", "not_placed"]),
    kitchenName: z.string(),
    agentName: z.string(),
    approverName: z.string(),
    approverRoleLabel: z.string(),
    items: z.array(z.looseObject({ name: z.string(), amount: z.string(), packs: z.string(), lineTotal: z.string(), delivery: z.string(), substituteFor: z.string().optional() })),
    total: z.string(),
    totalCents: z.number().int(),
    delivery: z.string(),
    why: z.array(z.string()).describe("Why this person is asked, in plain words."),
    differences: z.array(z.string()).describe("What differs from what was asked for."),
    priceHeldUntil: z.iso.datetime(),
    signIn: z.enum(["passkey", "demo_tap", "link_token"]).describe("How this approver signs."),
    demoTapEnabled: z.boolean(),
    viewerIsApprover: z.boolean(),
    outcome: z.looseObject({ decision: z.enum(["approved", "declined"]), signedBy: z.string(), at: z.iso.datetime(), method: z.string(), verified: z.boolean(), note: z.string().optional() }).optional(),
    details: z.looseObject({ approvalId: z.string(), orderId: z.string(), quoteId: z.string(), orgId: z.string(), agentId: z.string(), mandateId: z.string(), orderDigest: z.string() }),
  }),
);

export const SandboxSchema = named(
  "Sandbox",
  z.looseObject({
    sandboxId: z.string().optional().describe("Operations desk and the visitor's own phone only."),
    kitchenName: z.string(),
    city: z.string(),
    approverName: z.string(),
    agentName: z.string().optional(),
    orgId: z.string().optional(),
    agentId: z.string().optional(),
    role: z.string().optional(),
    roleLabel: z.string().optional(),
    passkey: z.boolean().optional().describe("false only for the demo-only join without a passkey."),
    perOrderLimitCents: z.number().int().optional(),
    weeklyBudgetCents: z.number().int().optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
);

export const DockEventSchema = named(
  "DockEvent",
  z.looseObject({
    id: z.number().int().describe("Also the SSE event id; send it back as Last-Event-ID to resume."),
    type: z.enum(["approval_requested", "approval_approved", "approval_declined", "approval_withdrawn", "approval_expired", "order_committed", "order_rejected"]),
    at: z.iso.datetime(),
    orgId: z.string().optional().describe("Absent on the public aggregated stream."),
    orderId: z.string().optional().describe("Absent on the public aggregated stream."),
    approvalId: z.string().optional(),
    totalCents: z.number().int(),
    summary: z.string(),
  }),
);

/** WebAuthn options JSON (W3C WebAuthn Level 3, as PublicKeyCredentialCreationOptionsJSON / RequestOptionsJSON). Pass to the browser unchanged. */
export const WebAuthnOptionsSchema = named("WebAuthnOptions", z.looseObject({ challenge: z.string() }));

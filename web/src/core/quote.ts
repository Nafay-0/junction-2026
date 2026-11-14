import { CompactSign, compactVerify, errors } from "jose";
import { z } from "zod";
import type { LiveOffer, Product } from "./catalog";
import { ClaimRefSchema, cutoffMs, statedUntilMs, type ClaimRef } from "./claims";
import { SIGN_ALG, VERIFY_ALGS, type SigningKey, type VerifyingKey } from "./keys";
import { addMinutes } from "./util";

/**
 * A quote is the wholesaler's fixed-price offer for specific products and quantities, signed with the
 * wholesaler key. Each line carries a snapshot of the product facts the policy needs (category,
 * attributes, allergens, certificates), so the policy judges signed data, never what the agent claims.
 */
const ProductFacts = {
  productId: z.string().min(1),
  name: z.string(),
  category: z.string(),
  unit: z.enum(["L", "kg", "pcs"]),
  packSize: z.number().positive(),
  attributes: z.array(z.string()),
};

export const QuoteLineSchema = z.object({
  ...ProductFacts,
  allergens: z.array(z.string()),
  /** False when the maker sent no allergen data: `allergens` is then empty because nothing is known. Absent: declared. */
  allergensDeclared: z.boolean().optional(),
  certificates: z.array(z.string()),
  quantity: z.number().int().positive(), // packs
  unitPriceCents: z.number().int().nonnegative(), // per pack
  lineTotalCents: z.number().int().nonnegative(),
  deliveryDate: z.iso.date(),
  /** Present when this line replaces a product the buyer could not get enough of. */
  substituteFor: z.object({ ...ProductFacts, unitPriceCents: z.number().int().nonnegative() }).optional(),
});

export const QuoteSchema = z
  .object({
    quoteId: z.string().min(1),
    buyerOrgId: z.string().min(1),
    agentId: z.string().min(1),
    mandateId: z.string().min(1),
    requestId: z.string().min(1),
    currency: z.literal("EUR"),
    lines: z.array(QuoteLineSchema).min(1),
    totalCents: z.number().int().nonnegative(),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    /** What ended the quote's life: its own time to live, a price's stated validity, or an order cut-off. */
    expiresBecause: z.enum(["ttl", "price_validity", "order_cutoff"]).optional(),
    /** The signed claims (price, availability, origin) the quote rests on, by id and token hash. See claims.ts. */
    evidence: z.array(ClaimRefSchema).optional(),
  })
  .refine((q) => q.lines.every((l) => l.lineTotalCents === l.quantity * l.unitPriceCents), "line totals do not add up")
  .refine((q) => q.totalCents === q.lines.reduce((s, l) => s + l.lineTotalCents, 0), "quote total does not add up");

export type Quote = z.infer<typeof QuoteSchema>;
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

export const QuoteRequestLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number(),
  substituteFor: z.string().min(1).optional(),
});
export type QuoteRequestLine = z.infer<typeof QuoteRequestLineSchema>;

export const QUOTE_TYP = "quote+jws";

export type QuoteErrorCode =
  | "quote_unknown_product"
  | "quote_no_offer"
  | "quote_insufficient_stock"
  | "quote_invalid_line"
  | "quote_source_expired"
  | "quote_malformed"
  | "quote_signature_invalid";

export class QuoteError extends Error {
  constructor(
    readonly code: QuoteErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

export type QuoteInput = {
  quoteId: string;
  buyerOrgId: string;
  agentId: string;
  mandateId: string;
  requestId: string;
  lines: QuoteRequestLine[];
  products: Product[]; // master data for every product in `lines`, including originals of substitutes
  offers: LiveOffer[]; // live offers for the same products
  /** Priced offers for products that substitutes replace, used only for the price comparison (they need not be orderable). */
  referenceOffers?: LiveOffer[];
  now: Date;
  ttlMinutes: number;
  evidence?: ClaimRef[];
};

/**
 * Most packs one line may ask for. No kitchen orders a million packs of one product; without a ceiling, a product
 * whose stock the wholesaler reports as a placeholder (so no stock check applies) could be quoted for an amount
 * whose total no longer fits an exact integer of cents.
 */
export const MAX_LINE_PACKS = 1_000_000;

/** However long a deployment configures quotes to live, a fixed price holds at most a day. */
export const MAX_QUOTE_TTL_MINUTES = 24 * 60;
/** A quote that would hold for less than this is not worth issuing: the order could not be placed in time. */
export const MIN_QUOTE_LIFE_MINUTES = 2;

/**
 * When a quote stops holding: its time to live (capped at MAX_QUOTE_TTL_MINUTES), and never after the stated
 * validity of a price it uses or the order cut-off of a delivery date it promises.
 */
export function quoteExpiry(now: Date, ttlMinutes: number, offers: LiveOffer[]): { expiresAt: Date; because: NonNullable<Quote["expiresBecause"]> } {
  let expiresAt = addMinutes(now, Math.min(Math.max(ttlMinutes, 0), MAX_QUOTE_TTL_MINUTES));
  let because: NonNullable<Quote["expiresBecause"]> = "ttl";
  for (const o of offers) {
    const price = statedUntilMs(o.priceValidUntil);
    if (price !== undefined && price < expiresAt.getTime()) [expiresAt, because] = [new Date(price), "price_validity"];
    const cut = cutoffMs(o.orderBy);
    if (cut !== undefined && cut < expiresAt.getTime()) [expiresAt, because] = [new Date(cut), "order_cutoff"];
  }
  return { expiresAt, because };
}

/** Build an unsigned quote at live prices. Throws QuoteError if a line cannot be offered as asked. */
export function buildQuote(input: QuoteInput): Quote {
  if (input.lines.length === 0) throw new QuoteError("quote_invalid_line", "A quote needs at least one line.");
  const product = (id: string) => {
    const p = input.products.find((x) => x.id === id);
    if (!p) throw new QuoteError("quote_unknown_product", `Unknown product ${id}.`, { productId: id });
    return p;
  };
  const offer = (id: string) => {
    const o = input.offers.find((x) => x.productId === id);
    if (!o) throw new QuoteError("quote_no_offer", `Product ${id} has no live offer right now.`, { productId: id });
    return o;
  };

  const seen = new Set<string>();
  const lines: QuoteLine[] = input.lines.map((req) => {
    if (seen.has(req.productId)) throw new QuoteError("quote_invalid_line", `Product ${req.productId} appears twice.`);
    seen.add(req.productId);
    if (!Number.isInteger(req.quantity) || req.quantity <= 0)
      throw new QuoteError("quote_invalid_line", `Quantity for ${req.productId} must be a whole number of packs above zero.`);
    if (req.quantity > MAX_LINE_PACKS)
      throw new QuoteError("quote_invalid_line", `Quantity for ${req.productId} is ${req.quantity} packs; one line takes at most ${MAX_LINE_PACKS.toLocaleString("en-US")}.`, { productId: req.productId, requested: req.quantity, max: MAX_LINE_PACKS });
    if (req.substituteFor === req.productId)
      throw new QuoteError("quote_invalid_line", `${req.productId} cannot substitute for itself.`);

    const p = product(req.productId);
    const o = offer(req.productId);
    if (req.quantity > o.availablePacks) {
      throw new QuoteError(
        "quote_insufficient_stock",
        `Only ${o.availablePacks} packs of ${p.id} available; ${req.quantity} requested.`,
        { productId: p.id, requested: req.quantity, available: o.availablePacks },
      );
    }
    let substituteFor: QuoteLine["substituteFor"];
    if (req.substituteFor) {
      const orig = product(req.substituteFor);
      const origOffer = input.referenceOffers?.find((x) => x.productId === req.substituteFor) ?? offer(req.substituteFor);
      substituteFor = {
        productId: orig.id,
        name: orig.name,
        category: orig.category,
        unit: orig.unit,
        packSize: orig.packSize,
        attributes: orig.attributes,
        unitPriceCents: origOffer.unitPriceCents,
      };
    }
    return {
      productId: p.id,
      name: p.name,
      category: p.category,
      unit: p.unit,
      packSize: p.packSize,
      attributes: p.attributes,
      allergens: p.allergens,
      ...(p.allergenInfo ? { allergensDeclared: p.allergenInfo.declared } : {}),
      certificates: p.certificates,
      quantity: req.quantity,
      unitPriceCents: o.unitPriceCents,
      lineTotalCents: req.quantity * o.unitPriceCents,
      deliveryDate: o.deliveryDate,
      substituteFor,
    };
  });

  const lineOffers = lines.map((l) => offer(l.productId));
  const { expiresAt, because } = quoteExpiry(input.now, input.ttlMinutes, lineOffers);
  if (expiresAt.getTime() - input.now.getTime() < MIN_QUOTE_LIFE_MINUTES * 60_000) {
    throw new QuoteError(
      "quote_source_expired",
      because === "order_cutoff" ? "The order cut-off for this delivery date is now: there is no time left to place an order at this price." : "A price in this quote stops being valid now: ask again for a fresh price.",
      { expiresAt: expiresAt.toISOString(), because },
    );
  }
  return QuoteSchema.parse({
    quoteId: input.quoteId,
    buyerOrgId: input.buyerOrgId,
    agentId: input.agentId,
    mandateId: input.mandateId,
    requestId: input.requestId,
    currency: "EUR",
    lines,
    totalCents: lines.reduce((s, l) => s + l.lineTotalCents, 0),
    issuedAt: input.now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresBecause: because,
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
  });
}

export async function signQuote(quote: Quote, key: SigningKey): Promise<string> {
  const q = QuoteSchema.parse(quote);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(q)))
    .setProtectedHeader({ alg: SIGN_ALG, kid: key.kid, typ: QUOTE_TYP })
    .sign(key.privateKey);
}

/**
 * Check the wholesaler's signature and the quote's shape. Expiry, binding to the mandate and replay are
 * policy rules (see policy.ts), so that a refusal always comes with a named rule and a reason.
 */
export async function verifyQuote(token: string, key: VerifyingKey): Promise<Quote> {
  let payload: Uint8Array;
  try {
    const result = await compactVerify(token, key.publicKey, { algorithms: VERIFY_ALGS });
    if (result.protectedHeader.typ !== QUOTE_TYP || result.protectedHeader.kid !== key.kid) {
      throw new QuoteError("quote_malformed", "Token is not a AimoPilot quote.");
    }
    payload = result.payload;
  } catch (err) {
    if (err instanceof QuoteError) throw err;
    if (err instanceof errors.JWSSignatureVerificationFailed)
      throw new QuoteError("quote_signature_invalid", "Quote signature does not verify: it was altered or not issued by the wholesaler.");
    throw new QuoteError("quote_malformed", "Quote token is not a valid compact JWS.");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new QuoteError("quote_malformed", "Quote body is not JSON.");
  }
  const parsed = QuoteSchema.safeParse(json);
  if (!parsed.success) throw new QuoteError("quote_malformed", `Quote body is invalid: ${parsed.error.message}`);
  return parsed.data;
}

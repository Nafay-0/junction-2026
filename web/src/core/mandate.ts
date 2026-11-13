import { SignJWT, decodeProtectedHeader, errors, jwtVerify, type CryptoKey } from "jose";
import { z } from "zod";
import { SIGN_ALG, VERIFY_ALGS, type SigningKey } from "./keys";

/**
 * A mandate is the buyer organisation's signed statement of what its purchasing agent may do.
 * The organisation signs it with its own Ed25519 key; Dock only holds the public key.
 * Money is in integer euro cents throughout.
 */
export const ApproverSchema = z.object({
  role: z.string().min(1), // e.g. "kitchen_manager"
  name: z.string().min(1),
  maxApprovalCents: z.number().int().nonnegative(), // largest order total this person may sign off
});

export const SubstitutionRule = z.enum(["none", "same_attributes", "needs_approval"]);

export const MandateSchema = z
  .object({
    mandateId: z.string().min(1),
    issuer: z.object({ orgId: z.string().min(1), name: z.string().min(1) }),
    agentId: z.string().min(1),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    currency: z.literal("EUR"),
    /** Orders above this total cannot be auto-approved; they go to a human. */
    perOrderLimitCents: z.number().int().nonnegative(),
    /** Hard ceiling on committed + pending spend over the last 7 days. Never exceeded, even with sign-off. */
    weeklyBudgetCents: z.number().int().nonnegative(),
    allowedCategories: z.array(z.string().min(1)).min(1),
    /** Every product ordered must carry all of these attributes (e.g. "lactose_free"). */
    requiredAttributes: z.array(z.string().min(1)),
    forbiddenAllergens: z.array(z.string().min(1)),
    /** Every product ordered must carry all of these certificates or labels. */
    requiredCertificates: z.array(z.string().min(1)),
    /** Latest acceptable delivery: no later than `maxLeadDays` after the order, and no later than the request's need-by date. */
    delivery: z.object({ maxLeadDays: z.number().int().positive() }),
    substitution: z.object({
      rule: SubstitutionRule,
      /** Largest increase in price per unit (per litre, per kg) a substitute may carry over the original, in percent. */
      maxPriceIncreasePct: z.number().min(0),
    }),
    approvers: z.array(ApproverSchema),
  })
  .refine((m) => Date.parse(m.validFrom) < Date.parse(m.validUntil), {
    message: "validFrom must be before validUntil",
    path: ["validUntil"],
  });

export type Mandate = z.infer<typeof MandateSchema>;
export type Approver = z.infer<typeof ApproverSchema>;

export const MANDATE_TYP = "mandate+jwt";
export const MANDATE_AUDIENCE = "dock";

export type MandateErrorCode =
  | "mandate_malformed"
  | "mandate_unknown_issuer"
  | "mandate_signature_invalid"
  | "mandate_expired"
  | "mandate_not_yet_valid"
  | "mandate_issuer_mismatch"
  | "mandate_claims_invalid";

export class MandateError extends Error {
  constructor(
    readonly code: MandateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MandateError";
  }
}

/** Public keys of buyer organisations Dock has onboarded, by key id. */
export type TrustedIssuer = { kid: string; orgId: string; publicKey: CryptoKey };
export type TrustRegistry = { get(kid: string): TrustedIssuer | undefined };

export function createTrustRegistry(issuers: TrustedIssuer[]): TrustRegistry & { add(issuer: TrustedIssuer): void } {
  const byKid = new Map(issuers.map((i) => [i.kid, i]));
  return { get: (kid) => byKid.get(kid), add: (issuer) => void byKid.set(issuer.kid, issuer) };
}

export async function signMandate(mandate: Mandate, key: SigningKey): Promise<string> {
  const m = MandateSchema.parse(mandate);
  return new SignJWT({ mandate: m })
    .setProtectedHeader({ alg: SIGN_ALG, kid: key.kid, typ: MANDATE_TYP })
    .setIssuer(m.issuer.orgId)
    .setSubject(m.agentId)
    .setJti(m.mandateId)
    .setAudience(MANDATE_AUDIENCE)
    .setIssuedAt()
    .setNotBefore(new Date(m.validFrom))
    .setExpirationTime(new Date(m.validUntil))
    .sign(key.privateKey);
}

/**
 * Verify a mandate token: known key id, valid Ed25519 signature, right type and audience,
 * inside its validity window at `now`, issuer matching the key's organisation, body matching the schema.
 * Throws MandateError with a machine-readable code on any failure.
 */
export async function verifyMandate(token: string, registry: TrustRegistry, now: Date): Promise<Mandate> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    throw new MandateError("mandate_malformed", "Mandate is not a compact JWS.");
  }
  const issuer = kid ? registry.get(kid) : undefined;
  if (!issuer) throw new MandateError("mandate_unknown_issuer", `No trusted organisation holds key "${kid ?? "(none)"}".`);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, issuer.publicKey, {
      algorithms: VERIFY_ALGS,
      typ: MANDATE_TYP,
      audience: MANDATE_AUDIENCE,
      currentDate: now,
      requiredClaims: ["iss", "sub", "jti", "nbf", "exp"],
    }));
  } catch (err) {
    throw mapJoseError(err);
  }

  if (payload.iss !== issuer.orgId) {
    throw new MandateError(
      "mandate_issuer_mismatch",
      `Mandate claims issuer "${payload.iss}" but is signed with a key of "${issuer.orgId}".`,
    );
  }
  const parsed = MandateSchema.safeParse(payload.mandate);
  if (!parsed.success) throw new MandateError("mandate_claims_invalid", `Mandate body is invalid: ${parsed.error.message}`);
  const m = parsed.data;
  if (m.issuer.orgId !== payload.iss || m.agentId !== payload.sub || m.mandateId !== payload.jti) {
    throw new MandateError("mandate_claims_invalid", "Mandate body disagrees with its signed iss/sub/jti claims.");
  }
  if (Date.parse(m.validFrom) > now.getTime()) throw new MandateError("mandate_not_yet_valid", "Mandate is not valid yet.");
  if (Date.parse(m.validUntil) <= now.getTime()) throw new MandateError("mandate_expired", "Mandate has expired.");
  return m;
}

function mapJoseError(err: unknown): MandateError {
  if (err instanceof errors.JWTExpired) return new MandateError("mandate_expired", "Mandate has expired.");
  if (err instanceof errors.JWSSignatureVerificationFailed)
    return new MandateError("mandate_signature_invalid", "Mandate signature does not verify: it was altered or signed with another key.");
  if (err instanceof errors.JWTClaimValidationFailed && err.claim === "nbf")
    return new MandateError("mandate_not_yet_valid", "Mandate is not valid yet.");
  const detail = err instanceof Error ? err.message : String(err);
  return new MandateError("mandate_malformed", `Mandate token rejected: ${detail}`);
}

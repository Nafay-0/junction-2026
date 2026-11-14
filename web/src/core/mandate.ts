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

/**
 * none                no substitutes
 * same_attributes     only like-for-like substitutes (same category, unit and material attributes); others refused
 * within_preferences  like-for-like substitutes the agent may choose alone; any other substitute needs a person
 * needs_approval      every substitute needs a person
 */
export const SubstitutionRule = z.enum(["none", "same_attributes", "within_preferences", "needs_approval"]);

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
  | "mandate_claims_invalid"
  | "mandate_superseded";

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

/** `remove` retires a key: every mandate signed with it stops verifying at once (a reissued kitchen mandate). */
export function createTrustRegistry(issuers: TrustedIssuer[]): TrustRegistry & { add(issuer: TrustedIssuer): void; remove(kid: string): void } {
  const byKid = new Map(issuers.map((i) => [i.kid, i]));
  return { get: (kid) => byKid.get(kid), add: (issuer) => void byKid.set(issuer.kid, issuer), remove: (kid) => void byKid.delete(kid) };
}

/**
 * Sign a mandate with the organisation's key. `issuedAt` is the token's `iat`, which supersession compares to the
 * second; it defaults to the wall clock. A world with its own clock (the crash test) passes that clock's time, so
 * the orders it records are the same on every repeat.
 */
export async function signMandate(mandate: Mandate, key: SigningKey, issuedAt?: Date): Promise<string> {
  const m = MandateSchema.parse(mandate);
  return new SignJWT({ mandate: m })
    .setProtectedHeader({ alg: SIGN_ALG, kid: key.kid, typ: MANDATE_TYP })
    .setIssuer(m.issuer.orgId)
    .setSubject(m.agentId)
    .setJti(m.mandateId)
    .setAudience(MANDATE_AUDIENCE)
    .setIssuedAt(issuedAt)
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
  return (await verifyMandateToken(token, registry, now)).mandate;
}

/** verifyMandate, with when the organisation signed the token (its `iat`; the start of its validity when it has none). */
export async function verifyMandateToken(token: string, registry: TrustRegistry, now: Date): Promise<{ mandate: Mandate; issuedAt: string }> {
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
  return { mandate: m, issuedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : m.validFrom };
}

// ---------- reissue ----------

/**
 * Reissue. A kitchen that changes what its agents may do signs a new mandate, and the earlier ones stop working:
 * the gate accepts only a kitchen's current mandate. Dock keeps, per organisation, the last reissue: the moment (to
 * the second, as a token's `iat` is) and the mandates signed in it. A mandate of that organisation signed before
 * that moment and not among them is refused as superseded, whatever it says and however long it would still have
 * run. One signed at or after it is the kitchen's current word: the key is the kitchen's, so what it signs later
 * replaces what it signed earlier. Plain code; the register is persisted by the server (it survives a restart).
 */
export type MandateReissue = { orgId: string; at: string; mandateIds: string[]; by: string; /** The mandates a reissue replaced by name: refused whenever they were signed. */ replaced?: string[] };

export interface MandateRegister {
  reissueOf(orgId: string): MandateReissue | undefined;
}

/** The reissue that replaced this mandate, if any. */
export function supersededBy(mandate: Pick<Mandate, "mandateId" | "issuer" | "validFrom">, issuedAt: string | undefined, register: MandateRegister | undefined): MandateReissue | undefined {
  const r = register?.reissueOf(mandate.issuer.orgId);
  if (!r || r.mandateIds.includes(mandate.mandateId)) return undefined;
  if (r.replaced?.includes(mandate.mandateId)) return r;
  return Date.parse(issuedAt ?? mandate.validFrom) < Date.parse(r.at) ? r : undefined;
}

export const supersededMessage = (orgName: string, r: MandateReissue) =>
  `${orgName} reissued its mandate on ${r.at.slice(0, 16).replace("T", " ")} UTC; this one was signed before that and no longer works. Present the kitchen's current mandate.`;

function mapJoseError(err: unknown): MandateError {
  if (err instanceof errors.JWTExpired) return new MandateError("mandate_expired", "Mandate has expired.");
  if (err instanceof errors.JWSSignatureVerificationFailed)
    return new MandateError("mandate_signature_invalid", "Mandate signature does not verify: it was altered or signed with another key.");
  if (err instanceof errors.JWTClaimValidationFailed && err.claim === "nbf")
    return new MandateError("mandate_not_yet_valid", "Mandate is not valid yet.");
  const detail = err instanceof Error ? err.message : String(err);
  return new MandateError("mandate_malformed", `Mandate token rejected: ${detail}`);
}

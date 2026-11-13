import { SignJWT, decodeProtectedHeader, errors, jwtVerify } from "jose";
import { z } from "zod";
import type { LiveOffer, Product } from "./catalog";
import { SIGN_ALG, VERIFY_ALGS, type SigningKey, type VerifyingKey } from "./keys";
import { newId, sha256Hex } from "./util";

/**
 * Signed claims: the trust protocol for what the wholesaler states about a product. Every price, availability and
 * origin statement Dock hands out can be returned as one, so an outside agent can check it offline against the
 * wholesaler's published keys (GET /api/v1/keys), without asking anyone.
 *
 * Format, kept small and standard: a W3C Verifiable Credential (Data Model 2.0) secured with JOSE as in the W3C
 * "Securing Verifiable Credentials using JOSE and COSE" recommendation: a compact JWS with `typ: vc+jwt`,
 * `cty: vc`, signed Ed25519 (RFC 8037 / RFC 9864) with the same key that signs quotes and order confirmations.
 * The payload is the credential; the registered JWT claims (iss, sub, aud, jti, iat, nbf, exp) mirror it so any
 * JWT library checks the signature and the validity window without knowing VCs.
 *
 *   what was claimed   credentialSubject.price / .availability / .origin
 *   about which product credentialSubject.productId (and sub)
 *   when, from where   evidence[0].observedAt and evidence[0].source (the partner's live API or its product file)
 *   valid until when   validUntil (and exp)
 *
 * A quote lists the claims it rests on by id and SHA-256 of the token (quote.evidence), so the signed quote binds
 * exactly those statements.
 */

export const CLAIM_TYP = "vc+jwt";
export const CLAIM_CTY = "vc";
export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
/** Issuer id of the wholesaler's statements. The key that signs them is the one in the JWKS. */
export const WHOLESALER_ISSUER = "urn:dock:wholesaler";

/** A price is vouched for at most this long, even when the price list says it holds until 9999. */
export const PRICE_CLAIM_MAX_HOURS = 24;
/** Stock and dates move: an availability statement holds 30 minutes, and never past the order cut-off it names. */
export const AVAILABILITY_CLAIM_MINUTES = 30;
/** Master data (origin, labels) changes rarely; restate it weekly. */
export const ORIGIN_CLAIM_DAYS = 7;

export const CLAIM_TYPES = ["price", "availability", "origin"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ClaimRefSchema = z.object({
  claimId: z.string().min(1),
  type: z.enum(CLAIM_TYPES),
  productId: z.string().min(1),
  /** Hex SHA-256 of the compact JWS, so a reference pins one exact token. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ClaimRef = z.infer<typeof ClaimRefSchema>;
export type IssuedClaim = ClaimRef & { token: string; validUntil: string };

export type PriceStatement = {
  unitPriceCents: number;
  currency: string;
  per: string; // sales unit
  unitPriceWithTaxCents?: number;
  taxRatePct?: number;
  comparisonPriceCents?: number;
  comparisonUnit?: string;
  listPriceCents?: number;
  customerSpecific?: boolean;
  statedValidFrom?: string;
  statedValidUntil?: string;
};
export type AvailabilityStatement = {
  requestedDate?: string;
  deliveryDate: string;
  orderBy?: string;
  cutoffPassed?: boolean;
  laterThanRequested?: boolean;
  /** `packs` is null when the wholesaler does not report a real quantity (placeholder amounts are never stated). */
  stock: { known: boolean; packs: number | null; per: string };
  logisticModel?: string;
};
export type OriginStatement = { countryOfOrigin: string | null; brand: string | null; vendor: string | null; labels: string[] };

type Subject =
  | { type: "price"; statement: PriceStatement }
  | { type: "availability"; statement: AvailabilityStatement }
  | { type: "origin"; statement: OriginStatement };

export type ClaimInput = Subject & {
  productId: string;
  source: string;
  observedAt: Date;
  validUntil: Date;
  /** Organisation the statement was made to (prices are customer-specific). */
  audience?: string;
  simulated?: boolean;
  requestedDate?: string;
};

const TYPE_NAME: Record<ClaimType, string> = { price: "DockPriceClaim", availability: "DockAvailabilityClaim", origin: "DockOriginClaim" };

export async function issueClaim(input: ClaimInput, key: SigningKey): Promise<IssuedClaim> {
  const claimId = newId("clm");
  const validUntil = input.validUntil.getTime() > input.observedAt.getTime() ? input.validUntil : new Date(input.observedAt.getTime() + 1000);
  const credential = {
    "@context": [VC_CONTEXT],
    id: `urn:dock:claim:${claimId}`,
    type: ["VerifiableCredential", TYPE_NAME[input.type]],
    issuer: WHOLESALER_ISSUER,
    validFrom: input.observedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    credentialSubject: { id: `urn:dock:product:${input.productId}`, productId: input.productId, [input.type]: input.statement },
    evidence: [
      {
        type: ["DockSourceObservation"],
        source: input.source,
        observedAt: input.observedAt.toISOString(),
        ...(input.requestedDate ? { requestedDate: input.requestedDate } : {}),
        ...(input.simulated ? { simulated: true } : {}),
      },
    ],
  };
  const jwt = new SignJWT(JSON.parse(JSON.stringify(credential)) as Record<string, unknown>)
    .setProtectedHeader({ alg: SIGN_ALG, kid: key.kid, typ: CLAIM_TYP, cty: CLAIM_CTY })
    .setIssuer(WHOLESALER_ISSUER)
    .setSubject(input.productId)
    .setJti(claimId)
    .setIssuedAt(Math.floor(input.observedAt.getTime() / 1000))
    .setNotBefore(Math.floor(input.observedAt.getTime() / 1000))
    .setExpirationTime(Math.ceil(validUntil.getTime() / 1000));
  if (input.audience) jwt.setAudience(input.audience);
  const token = await jwt.sign(key.privateKey);
  return { claimId, type: input.type, productId: input.productId, sha256: sha256Hex(token), token, validUntil: validUntil.toISOString() };
}

export type VerifiedClaim = {
  claimId: string;
  type: ClaimType;
  productId: string;
  statement: PriceStatement | AvailabilityStatement | OriginStatement;
  source: string;
  observedAt: string;
  validUntil: string;
  audience?: string;
  simulated: boolean;
};

export type ClaimErrorCode = "claim_malformed" | "claim_unknown_key" | "claim_signature_invalid" | "claim_expired" | "claim_not_yet_valid";
export class ClaimError extends Error {
  constructor(
    readonly code: ClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/** Verify a claim offline: signature against one of the wholesaler's keys (by kid), type, issuer and validity at `now`. */
export async function verifyClaim(token: string, keys: VerifyingKey[], now: Date = new Date()): Promise<VerifiedClaim> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    throw new ClaimError("claim_malformed", "Claim is not a compact JWS.");
  }
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new ClaimError("claim_unknown_key", `No published wholesaler key "${kid ?? "(none)"}".`);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key.publicKey, { algorithms: VERIFY_ALGS, typ: CLAIM_TYP, issuer: WHOLESALER_ISSUER, currentDate: now, requiredClaims: ["sub", "jti", "exp"] }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw new ClaimError("claim_expired", "Claim has expired: ask for a fresh statement.");
    if (err instanceof errors.JWTClaimValidationFailed && err.claim === "nbf") throw new ClaimError("claim_not_yet_valid", "Claim is not valid yet.");
    if (err instanceof errors.JWSSignatureVerificationFailed) throw new ClaimError("claim_signature_invalid", "Claim signature does not verify: it was altered or not issued by the wholesaler.");
    throw new ClaimError("claim_malformed", `Claim rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  const subject = payload.credentialSubject as Record<string, unknown> | undefined;
  const type = CLAIM_TYPES.find((t) => subject && t in subject);
  const evidence = (payload.evidence as Record<string, unknown>[] | undefined)?.[0];
  if (!subject || !type || subject.productId !== payload.sub || !evidence) throw new ClaimError("claim_malformed", "Claim body is not a Dock product claim.");
  return {
    claimId: String(payload.jti),
    type,
    productId: String(payload.sub),
    statement: subject[type] as VerifiedClaim["statement"],
    source: String(evidence.source),
    observedAt: String(evidence.observedAt),
    validUntil: String(payload.validUntil),
    audience: typeof payload.aud === "string" ? payload.aud : undefined,
    simulated: evidence.simulated === true,
  };
}

// ---------- building claims from what Dock saw ----------

/** End of a price's stated validity. A bare date lasts to the end of that day in Helsinki (taken as UTC+3, never too late). */
export function statedUntilMs(validTo: string | undefined): number | undefined {
  if (!validTo) return undefined;
  const v = validTo.trim();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T23:59:59+03:00`) : Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : `${v}+03:00`);
  return Number.isFinite(t) ? t : undefined;
}

/** An order cut-off as a time stamp. Times without an offset are Helsinki time; +03:00 errs towards an earlier cut-off. */
export function cutoffMs(orderBy: string | undefined): number | undefined {
  if (!orderBy || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(orderBy)) return undefined;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(orderBy) ? orderBy.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : `${orderBy}+03:00`);
  return Number.isFinite(t) ? t : undefined;
}

const LIVE_SOURCE = (o: LiveOffer) => (o.simulated ? "dock-demo-override" : o.fetchedAt ? "partner-live-api" : "dock-seed-catalogue");

export function priceClaimInput(o: LiveOffer, now: Date, audience?: string): ClaimInput {
  const stated = statedUntilMs(o.priceValidUntil);
  const until = Math.min(now.getTime() + PRICE_CLAIM_MAX_HOURS * 3600_000, stated ?? Infinity);
  const statement: PriceStatement = {
    unitPriceCents: o.unitPriceCents,
    currency: o.currency ?? "EUR",
    per: o.salesUnit ?? "pack",
    unitPriceWithTaxCents: o.unitPriceWithTaxCents,
    taxRatePct: o.taxRatePct,
    comparisonPriceCents: o.comparisonPriceCents,
    comparisonUnit: o.comparisonUnit,
    listPriceCents: o.listPriceCents,
    customerSpecific: o.netPrice,
    statedValidFrom: o.priceValidFrom,
    statedValidUntil: o.priceValidUntil,
  };
  return { type: "price", productId: o.productId, statement, source: `${LIVE_SOURCE(o)}:price`, observedAt: observed(o, now), validUntil: new Date(until), audience, simulated: o.simulated, requestedDate: o.requestedDate };
}

export function availabilityClaimInput(o: LiveOffer, now: Date, audience?: string): ClaimInput {
  const cut = cutoffMs(o.orderBy);
  const until = Math.min(now.getTime() + AVAILABILITY_CLAIM_MINUTES * 60_000, cut !== undefined && cut > now.getTime() ? cut : Infinity);
  const known = o.stockKnown !== false;
  const statement: AvailabilityStatement = {
    requestedDate: o.requestedDate,
    deliveryDate: o.deliveryDate,
    orderBy: o.orderBy,
    cutoffPassed: o.cutoffPassed,
    laterThanRequested: o.laterThanRequested,
    stock: { known, packs: known ? o.availablePacks : null, per: o.salesUnit ?? "pack" },
    logisticModel: o.logisticModel,
  };
  return { type: "availability", productId: o.productId, statement, source: `${LIVE_SOURCE(o)}:availability`, observedAt: observed(o, now), validUntil: new Date(until), audience, simulated: o.simulated, requestedDate: o.requestedDate };
}

export function originClaimInput(p: Product, now: Date): ClaimInput {
  return {
    type: "origin",
    productId: p.id,
    statement: { countryOfOrigin: p.countryOfOrigin ?? null, brand: p.brand === "unknown" ? null : p.brand, vendor: p.vendor ?? null, labels: [...p.certificates] },
    source: p.source === "valio" ? "partner-product-master" : "dock-seed-catalogue",
    observedAt: now,
    validUntil: new Date(now.getTime() + ORIGIN_CLAIM_DAYS * 86_400_000),
  };
}

function observed(o: LiveOffer, now: Date): Date {
  const t = o.fetchedAt ? Date.parse(o.fetchedAt) : NaN;
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t) : now;
}

/** Claims Dock has handed out, so an agent can fetch the tokens a quote's evidence names. In memory, like the rest. */
export class ClaimStore {
  private items = new Map<string, IssuedClaim & { orgId?: string }>();
  put(claim: IssuedClaim, orgId?: string): void {
    this.items.set(claim.claimId, { ...claim, orgId });
    if (this.items.size > 5000) this.items.delete(this.items.keys().next().value!);
  }
  /** Claims issued to this organisation (or to nobody in particular, like origin statements). */
  get(ids: string[], orgId: string): IssuedClaim[] {
    return ids
      .map((id) => this.items.get(id))
      .filter((c): c is IssuedClaim & { orgId?: string } => !!c && (!c.orgId || c.orgId === orgId))
      .map(({ orgId: _o, ...c }) => (void _o, c));
  }
}

export const refOf = (c: IssuedClaim): ClaimRef => ({ claimId: c.claimId, type: c.type, productId: c.productId, sha256: c.sha256 });

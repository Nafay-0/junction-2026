import { beforeAll, describe, expect, it } from "vitest";
import { CompactSign, SignJWT, base64url } from "jose";
import { generateEd25519KeyPair, type KeyPair } from "./keys";
import {
  MandateError,
  createTrustRegistry,
  signMandate,
  verifyMandate,
  type Mandate,
  type TrustRegistry,
} from "./mandate";
import { sampleMandate } from "./test-fixtures";

const NOW = new Date("2026-11-13T10:00:00.000Z");

let buyer: KeyPair;
let otherOrg: KeyPair;
let registry: TrustRegistry;
let mandate: Mandate;

beforeAll(async () => {
  buyer = await generateEd25519KeyPair("laakso-key-1");
  otherOrg = await generateEd25519KeyPair("other-key-1");
  registry = createTrustRegistry([
    { kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey },
    { kid: otherOrg.kid, orgId: "org_other", publicKey: otherOrg.publicKey },
  ]);
  mandate = sampleMandate(NOW);
});

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(MandateError);
  await expect(promise).rejects.toMatchObject({ code });
}

function tamperPayload(token: string, edit: (payload: Record<string, unknown>) => void): string {
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(new TextDecoder().decode(base64url.decode(payload)));
  edit(decoded);
  return [header, base64url.encode(JSON.stringify(decoded)), signature].join(".");
}

describe("mandate sign and verify", () => {
  it("round-trips a valid mandate as a compact JWS", async () => {
    const token = await signMandate(mandate, buyer);
    expect(token.split(".")).toHaveLength(3);
    const verified = await verifyMandate(token, registry, NOW);
    expect(verified).toEqual(mandate);
  });

  it("puts standard JWT claims on the token", async () => {
    const token = await signMandate(mandate, buyer);
    const [header, payload] = token.split(".").slice(0, 2).map((p) => JSON.parse(new TextDecoder().decode(base64url.decode(p))));
    expect(header).toMatchObject({ alg: "Ed25519", kid: buyer.kid, typ: "mandate+jwt" });
    expect(payload).toMatchObject({ iss: "org_laakso", sub: mandate.agentId, jti: mandate.mandateId, aud: "dock" });
  });

  it("refuses to sign an invalid mandate", async () => {
    await expect(signMandate({ ...mandate, perOrderLimitCents: -1 }, buyer)).rejects.toThrow();
  });

  it("fails on a tampered payload (raised budget)", async () => {
    const token = await signMandate(mandate, buyer);
    const tampered = tamperPayload(token, (p) => {
      (p.mandate as Mandate).weeklyBudgetCents = 100_000_000;
    });
    await expectCode(verifyMandate(tampered, registry, NOW), "mandate_signature_invalid");
  });

  it("fails on a tampered header (kid swapped to another org)", async () => {
    const token = await signMandate(mandate, buyer);
    const [, payload, signature] = token.split(".");
    const header = base64url.encode(JSON.stringify({ alg: "Ed25519", kid: otherOrg.kid, typ: "mandate+jwt" }));
    await expectCode(verifyMandate([header, payload, signature].join("."), registry, NOW), "mandate_signature_invalid");
  });

  it("fails when signed with the wrong key for the kid", async () => {
    const impostor = await generateEd25519KeyPair(buyer.kid);
    const token = await signMandate(mandate, impostor);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_signature_invalid");
  });

  it("fails for a key id that is not in the trust registry", async () => {
    const stranger = await generateEd25519KeyPair("stranger-key");
    const token = await signMandate(mandate, stranger);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_unknown_issuer");
  });

  it("fails when one trusted org signs a mandate in another org's name", async () => {
    const token = await signMandate(mandate, otherOrg); // otherOrg's key, but issuer says org_laakso
    await expectCode(verifyMandate(token, registry, NOW), "mandate_issuer_mismatch");
  });

  it("fails on an expired mandate", async () => {
    const token = await signMandate(mandate, buyer);
    const later = new Date(new Date(mandate.validUntil).getTime() + 1000);
    await expectCode(verifyMandate(token, registry, later), "mandate_expired");
  });

  it("fails on a mandate that is not yet valid", async () => {
    const token = await signMandate(mandate, buyer);
    const earlier = new Date(new Date(mandate.validFrom).getTime() - 60_000);
    await expectCode(verifyMandate(token, registry, earlier), "mandate_not_yet_valid");
  });

  it("fails on garbage", async () => {
    await expectCode(verifyMandate("not-a-jws", registry, NOW), "mandate_malformed");
    await expectCode(verifyMandate("", registry, NOW), "mandate_malformed");
  });

  it("fails on an unsigned (alg none) token", async () => {
    const header = base64url.encode(JSON.stringify({ alg: "none", kid: buyer.kid, typ: "mandate+jwt" }));
    const token = await signMandate(mandate, buyer);
    const payload = token.split(".")[1];
    await expectCode(verifyMandate(`${header}.${payload}.`, registry, NOW), "mandate_malformed");
  });

  it("fails when the token is some other signed document (wrong typ)", async () => {
    const token = await new SignJWT({ mandate })
      .setProtectedHeader({ alg: "Ed25519", kid: buyer.kid, typ: "quote+jws" })
      .setIssuer("org_laakso")
      .setSubject(mandate.agentId)
      .setJti(mandate.mandateId)
      .setAudience("dock")
      .setNotBefore(new Date(mandate.validFrom))
      .setExpirationTime(new Date(mandate.validUntil))
      .sign(buyer.privateKey);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_malformed");
  });

  it("fails when the signed body is not a JWT", async () => {
    const token = await new CompactSign(new TextEncoder().encode("hello"))
      .setProtectedHeader({ alg: "Ed25519", kid: buyer.kid, typ: "mandate+jwt" })
      .sign(buyer.privateKey);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_malformed");
  });

  it("fails when the signed claims disagree with the mandate body", async () => {
    const token = await new SignJWT({ mandate })
      .setProtectedHeader({ alg: "Ed25519", kid: buyer.kid, typ: "mandate+jwt" })
      .setIssuer("org_laakso")
      .setSubject("agent_someone_else")
      .setJti(mandate.mandateId)
      .setAudience("dock")
      .setNotBefore(new Date(mandate.validFrom))
      .setExpirationTime(new Date(mandate.validUntil))
      .sign(buyer.privateKey);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_claims_invalid");
  });

  it("fails when the signed mandate body does not match the schema", async () => {
    const token = await new SignJWT({ mandate: { ...mandate, approvers: "everyone" } })
      .setProtectedHeader({ alg: "Ed25519", kid: buyer.kid, typ: "mandate+jwt" })
      .setIssuer("org_laakso")
      .setSubject(mandate.agentId)
      .setJti(mandate.mandateId)
      .setAudience("dock")
      .setNotBefore(new Date(mandate.validFrom))
      .setExpirationTime(new Date(mandate.validUntil))
      .sign(buyer.privateKey);
    await expectCode(verifyMandate(token, registry, NOW), "mandate_claims_invalid");
  });
});

/**
 * Verify a wholesaler's offer with nothing but `jose` and the published keys: no AimoPilot code is imported, so this is
 * what any buyer's agent can do.
 *
 *   pnpm verify:offer offer.json --url http://localhost:3000     keys from <url>/.well-known/jwks.json
 *   pnpm verify:offer offer.json --jwks jwks.json                 fully offline, keys from a file
 *   pnpm verify:offer offer.json --jwks jwks.json --org org_x     and check it is addressed to that buyer
 *
 * The input is the compact JWS, or JSON holding it (`token`, or the first of `offers[].token` from list_offers or
 * GET /api/v1/offers). Exit code 0 when it verifies, 1 when it does not (altered, another key, expired, another buyer,
 * or not an offer).
 */
import { readFileSync } from "node:fs";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const source = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function tokenOf(raw: string): string {
  const t = raw.trim();
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) return t;
  const j = JSON.parse(t) as { token?: string; offers?: { token?: string }[]; structuredContent?: { offers?: { token?: string }[] } };
  const found = j.token ?? j.offers?.[0]?.token ?? j.structuredContent?.offers?.[0]?.token;
  if (!found) throw new Error("no offer token in the input");
  return found;
}

async function main() {
  if (!source) throw new Error("Usage: pnpm verify:offer <file | - | jws> (--url <base> | --jwks <file>) [--org <buyer org id>]");
  const raw = source === "-" ? readFileSync(0, "utf8") : /^[\w-]+\.[\w-]+\.[\w-]+$/.test(source) ? source : readFileSync(source, "utf8");
  const jwksFile = flag("--jwks");
  const base = flag("--url") ?? process.env.DOCK_URL ?? "http://localhost:3000";
  const jwks = (jwksFile ? JSON.parse(readFileSync(jwksFile, "utf8")) : await (await fetch(new URL("/.well-known/jwks.json", base))).json()) as JSONWebKeySet;
  const org = flag("--org");
  const { payload, protectedHeader } = await jwtVerify(tokenOf(raw), createLocalJWKSet(jwks), {
    algorithms: ["Ed25519", "EdDSA"],
    typ: "vc+jwt",
    issuer: "urn:dock:wholesaler",
    requiredClaims: ["sub", "jti", "exp", "aud"],
    ...(org ? { audience: org } : {}),
  });
  const types = payload.type as string[] | undefined;
  const offer = (payload.credentialSubject as { offer?: { offerId: string; isOrder: boolean; product: { productId: string; name: string }; line: string; price: { unitPriceCents: number }; validUntil: string; buyer: { orgId: string } } })?.offer;
  if (!types?.includes("DockProductOffer") || !offer || offer.offerId !== payload.jti || offer.isOrder !== false || offer.buyer.orgId !== payload.aud) throw new Error("the token verifies but is not a product offer");
  console.log(`VALID offer ${offer.offerId}, signed by key "${protectedHeader.kid}", to ${String(payload.aud)}, until ${offer.validUntil}`);
  console.log(`  ${offer.product.name} (${offer.product.productId}) at ${(offer.price.unitPriceCents / 100).toFixed(2)} EUR a pack: ${offer.line}`);
  console.log("  It is an offer, not an order.");
}

main().catch((err) => {
  console.error(`NOT VALID: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

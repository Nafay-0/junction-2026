/**
 * Verify a Dock order receipt with nothing but the published keys.
 *
 *   pnpm verify:receipt receipt.json --url http://localhost:3000     fetch keys from <url>/.well-known/jwks.json
 *   pnpm verify:receipt receipt.json --jwks jwks.json                 fully offline, keys from a file
 *   curl -s .../api/v1/orders/ord_x -H ... | pnpm verify:receipt - --url http://localhost:3000
 *
 * The input is the compact JWS, or JSON holding it (`confirmation`, `order.confirmation`, an MCP get_order result).
 * Exit code 0 when the signature verifies, 1 when it does not.
 */
import { readFileSync } from "node:fs";
import type { JSONWebKeySet } from "jose";
import { extractJws, verifySigned } from "./lib/verify-receipt";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const source = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

async function main() {
  if (!source) throw new Error("Usage: pnpm verify:receipt <file | - | jws> (--url <dock base url> | --jwks <file>)");
  const raw = source === "-" ? readFileSync(0, "utf8") : /^[\w-]+\.[\w-]+\.[\w-]+$/.test(source) ? source : readFileSync(source, "utf8");
  const jwksFile = flag("--jwks");
  const base = flag("--url") ?? process.env.DOCK_URL ?? "http://localhost:3000";
  const jwks = (jwksFile ? JSON.parse(readFileSync(jwksFile, "utf8")) : await (await fetch(new URL("/.well-known/jwks.json", base))).json()) as JSONWebKeySet;

  const { typ, kid, payload } = await verifySigned(extractJws(raw), jwks);
  console.log(`VALID ${typ} signed by key "${kid}" (${jwksFile ?? new URL("/.well-known/jwks.json", base).href})`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(`NOT VALID: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

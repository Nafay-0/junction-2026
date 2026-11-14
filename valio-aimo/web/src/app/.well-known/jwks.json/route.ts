import { handle } from "@/server/http";

/** The wholesaler's public keys as an RFC 7517 JWK Set, to verify quotes and order receipts offline. */
export async function GET(req: Request) {
  void req.url; // request-time route: the key is created when the server starts
  return handle(async ({ dock }) =>
    Response.json({ keys: [dock.wholesalerPublicJwk] }, { headers: { "content-type": "application/jwk-set+json", "access-control-allow-origin": "*" } }),
  );
}

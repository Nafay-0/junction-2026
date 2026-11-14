import { handle } from "@/server/http";

/** Wholesaler public key as a JWKS, to verify quotes and order confirmations independently. */
export async function GET(req: Request) {
  void req.url; // request-time route: the key is created when the server starts
  return handle(async ({ dock }) => Response.json({ keys: [dock.wholesalerPublicJwk] }));
}

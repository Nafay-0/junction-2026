import { handle } from "@/server/http";

/** Index of the agent-facing API. Agents authenticate with `Authorization: Mandate <jws>` and `Dock-Agent-Id`. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async () =>
    Response.json({
      name: "Dock",
      version: "v1",
      auth: { mandate: "Authorization: Mandate <compact JWS, Ed25519, typ mandate+jwt>", agent: "Dock-Agent-Id: <agent id in the mandate>" },
      flow: ["POST /requests", "GET /products", "POST /availability", "POST /quotes", "POST /orders", "POST /approvals/{id}", "GET /orders/{id}"],
      endpoints: {
        "POST /api/v1/requests": "Open a purchase request { text, neededBy? }. Returns requestId.",
        "GET /api/v1/products?requestId&q&category&attribute&limit": "Search product master data. No live API call.",
        "POST /api/v1/availability": "Live price and stock { requestId, productIds (max 10) }. Metered.",
        "POST /api/v1/quotes": "Fixed-price quote { requestId, lines: [{ productId, quantity, substituteFor? }] }. Returns signed quoteToken and a policy preview.",
        "POST /api/v1/orders": "Order { requestId, quoteToken, lines: [{ productId, quantity, unitPriceCents }] }. 201 committed, 202 awaiting sign-off, 422 refused.",
        "GET /api/v1/orders/{orderId}": "Order status, decision and signed confirmation.",
        "GET /api/v1/approvals": "Pending sign-offs (no tokens).",
        "POST /api/v1/approvals/{approvalId}": "Approver decides { decision: approve|decline, token, note? }.",
        "GET /api/v1/ledger?requestId&orderId": "Audit trail with chain verification and plain-language explanation.",
        "GET /api/v1/keys": "Wholesaler public key (JWKS) to verify quotes and order confirmations.",
      },
    }),
  );
}

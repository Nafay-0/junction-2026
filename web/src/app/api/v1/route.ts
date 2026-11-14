import { handle } from "@/server/http";

/** Index of the agent-facing API. Agents authenticate with `Authorization: Mandate <jws>` and `Dock-Agent-Id`. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async () =>
    Response.json({
      name: "AimoPilot",
      version: "v1",
      auth: { mandate: "Authorization: Mandate <compact JWS, Ed25519, typ mandate+jwt>", agent: "Dock-Agent-Id: <agent id in the mandate>" },
      flow: ["POST /lookup", "POST /alternatives", "POST /quotes", "POST /orders", "POST /approvals/{id} (the person, not the agent)", "GET /orders/{id}?wait=25"],
      intakeFlow: {
        about: "Buyer-side intake from a structured need: AimoPilot checks for likely mistakes, asks only what memory cannot answer, and offers labelled options. Every reply is { step } with a state and `next`.",
        states: ["needs_confirmation", "needs_input", "options_ready", "quoted", "no_options", "cancelled"],
        calls: ["POST /intake", "POST /intake/{id}/concerns", "POST /intake/{id}/answers", "POST /intake/{id}/choice", "POST /orders", "POST /approvals/{id}"],
      },
      endpoints: {
        "POST /api/v1/requests": "Open a purchase request { text, neededBy? }. Returns requestId.",
        "GET /api/v1/products?requestId&q&category&attribute&limit": "Search product master data. No live API call.",
        "POST /api/v1/availability": "Live price and stock { requestId, productIds (max 10) }. Metered.",
        "POST /api/v1/quotes": "Fixed-price quote { requestId, lines: [{ productId, quantity, substituteFor? }] }. Returns signed quoteToken and a policy preview.",
        "POST /api/v1/orders": "Order { requestId } (the latest quote Dock signed for it) or { requestId, quoteToken, lines }; replaces: an orderId this one changes. 201 committed, 202 awaiting sign-off, 422 refused.",
        "GET /api/v1/orders/{orderId}?wait": "Order status, decision and signed confirmation; with wait (seconds, at most 55), answers once a person decides.",
        "GET /api/v1/orders?status&limit": "This organisation's orders, newest first; which wait for sign-off and which can still be taken back.",
        "POST /api/v1/orders/{orderId}/withdraw": "Take back an order waiting for sign-off, or one this agent placed alone, before the order cut-off.",
        "POST /api/v1/lookup": "Products, prices and availability in one call { text?, category?, brand?, productIds?, requiredClaims?, forbiddenAllergens?, packSize?, quantity?, deliverOn?, live?, limit? }.",
        "POST /api/v1/alternatives": "Good, better, best alternatives for a product { productId, quantity?, deliverOn?, rankBy? }, each with trade-offs and the gate's preview.",
        "GET /api/v1/approvals": "Pending sign-offs (no tokens).",
        "POST /api/v1/approvals/{approvalId}": "Approver decides { decision: approve|decline, note?, proof: { kind: webauthn, response } | { kind: session } (decline) | token }.",
        "GET /api/v1/approvals/{approvalId}": "The sign-off screen's content in plain words (for the approver's phone).",
        "POST /api/v1/approvals/{approvalId}/challenge": "Passkey prompt { decision } bound to this order's digest; single use, 5 minutes.",
        "GET /api/v1/approvals/{approvalId}/link": "URL and QR code (payload + SVG) of the sign-off screen.",
        "POST /api/v1/join, POST /api/v1/join/verify": "Join by QR: a fresh demo kitchen with this phone's passkey as its approver.",
        "GET /api/v1/approver": "The signed-in approver's home: identity, limits, pending sign-offs.",
        "GET /api/v1/events?scope=mine|approvalId|orgId": "Live events (server-sent events).",
        "GET /api/v1/sandboxes": "Live demo kitchens (no secrets).",
        "POST /api/v1/intake": "Start from a structured need { need: { item: { text, category?, attributes?, excludedAttributes?, productId? }, quantity?: { amount, unit: L|kg|pcs|pack }, deliverBy?, requiredClaims?, forbiddenAllergens?, optimise?: price|co2|reliability|no_preference, sameAsLastTime? }, by? }. Returns { step }.",
        "GET /api/v1/intake/{requestId}": "The current step.",
        "POST /api/v1/intake/{requestId}/concerns": "Confirm or correct likely mistakes { by, responses: [{ key, choice: confirm|<correctionId> }] }.",
        "POST /api/v1/intake/{requestId}/answers": "Answer typed questions { by, answers: [{ questionId, optionId, remember? }] }.",
        "POST /api/v1/intake/{requestId}/choice": "Choose an option card { by, optionId }. Returns the signed quote and the order body for POST /orders.",
        "GET /api/v1/kitchen": "The kitchen's memory: order history, usual amounts, stated and learned preferences.",
        "GET /api/v1/ledger?requestId&orderId": "Audit trail with chain verification and plain-language explanation.",
        "GET /api/v1/keys": "Wholesaler public key (JWKS) to verify quotes and order confirmations.",
      },
    }),
  );
}

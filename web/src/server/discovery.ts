import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { MANDATE_AUDIENCE, MANDATE_TYP } from "@/core/mandate";
import { ORDER_TYP } from "@/core/orders";
import { RULES } from "@/core/policy";
import { QUOTE_TYP } from "@/core/quote";
import { INTAKE_STATES } from "./wire";
import { HUMAN_INPUT_META } from "./mcp/ask-human";
import { LIVE_LOOKUP_LIMITS } from "./mcp/live-lookup-guard";
import { MCP_SERVER_INFO } from "./mcp/server";
import { TOOLS } from "./mcp/tools";

/**
 * What an agent that knows only the base URL can find. Standard entry points first:
 *   /.well-known/api-catalog  RFC 9727 API catalog (Linkset, RFC 9264) pointing at the OpenAPI document,
 *                             the MCP endpoint and the docs
 *   /.well-known/jwks.json    RFC 7517 JWK Set with the wholesaler's Ed25519 keys (RFC 8037)
 *   /api/mcp                  MCP Streamable HTTP; `server/discover` (2026-07-28) or `initialize` describes it
 *   /llms.txt                 llmstxt.org convention: a Markdown brief for coding agents
 * plus /.well-known/dock.json, Dock's own manifest (not a standard), which ties the pieces together.
 */

export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", ...SUPPORTED_PROTOCOL_VERSIONS];

export function urls(origin: string) {
  return {
    mcp: `${origin}/api/mcp`,
    openapi: `${origin}/api/v1/openapi.json`,
    rest: `${origin}/api/v1`,
    jwks: `${origin}/.well-known/jwks.json`,
    apiCatalog: `${origin}/.well-known/api-catalog`,
    manifest: `${origin}/.well-known/dock.json`,
    llms: `${origin}/llms.txt`,
  };
}

export const API_CATALOG_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

/** RFC 9727 API catalog as an RFC 9264 linkset: one entry for the REST API, one for the MCP endpoint. */
export function apiCatalog(origin: string) {
  const u = urls(origin);
  const docs = [
    { href: u.llms, type: "text/markdown", title: "How to connect an agent" },
    { href: u.manifest, type: "application/json", title: "AimoPilot manifest: auth, mandates, keys" },
  ];
  return {
    linkset: [
      {
        anchor: u.rest,
        "service-desc": [{ href: u.openapi, type: "application/vnd.oai.openapi+json;version=3.1" }],
        "service-doc": docs,
        "service-meta": [{ href: u.jwks, type: "application/jwk-set+json", title: "Keys that sign quotes and order confirmations" }],
      },
      {
        anchor: u.mcp,
        "service-doc": docs,
        "service-meta": [{ href: u.manifest, type: "application/json", title: "MCP transport, protocol versions and tools" }],
      },
    ],
  };
}

/** Dock's own manifest. Plain JSON, described here; it is not an established standard and does not claim to be. */
export function manifest(origin: string) {
  const u = urls(origin);
  return {
    $comment: "AimoPilot's own discovery manifest (not a standard). Standard entry points: /.well-known/api-catalog (RFC 9727), /.well-known/jwks.json (RFC 7517), /llms.txt.",
    name: "AimoPilot",
    description:
      "Open ordering gateway for AI purchasing agents. Any company's agent orders from the wholesaler carrying a signed mandate that says what it may buy; anything beyond the mandate needs a human sign-off. Plain code, not a model, checks every order.",
    interfaces: {
      mcp: {
        url: u.mcp,
        transport: "streamable-http",
        protocolVersions: MCP_PROTOCOL_VERSIONS,
        serverInfo: MCP_SERVER_INFO,
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, readOnly: t.readOnly ?? false, humanInput: ("humanInput" in t && t.humanInput) || false })),
        humanInput: {
          tools: TOOLS.filter((t) => "humanInput" in t && t.humanInput).map((t) => t.name),
          how: `These calls carry the human buyer's own answer (a mistake confirmation, a clarifying answer). If the client declares the MCP elicitation capability (2026-07-28), AimoPilot asks the buyer directly with an input_required elicitation/create form; otherwise the agent relays the question and passes the buyer's answer. Marked in tools/list with _meta["${HUMAN_INPUT_META}"] (AimoPilot's own key, not a standard).`,
        },
      },
      rest: { baseUrl: u.rest, openapi: u.openapi },
    },
    ordering: {
      start: { mcp: "submit_need", rest: "POST /api/v1/intake" },
      summary:
        "Start every order from a structured need. AimoPilot checks it against the kitchen's history for likely mistakes, asks the buyer at most two typed questions, offers option cards with pros and cons, and quotes the chosen one at a fixed price. Each reply is a step with a state and the next call. The lower-level search, availability and quote calls stay available for follow-up.",
      states: INTAKE_STATES,
      humanOnly: ["Confirming or correcting a likely mistake", "Answering a clarifying question", "Signing off an order above the mandate (on the approver's own phone, never through MCP)"],
    },
    authentication: {
      summary: "Present the mandate your organisation signed for you, and your agent id, on every call. Same credential for MCP and REST. No OAuth, no AimoPilot account.",
      headers: { Authorization: "Bearer <mandate JWS>  (or: Mandate <mandate JWS>)", "Dock-Agent-Id": "<the agent id the mandate names>" },
      mandate: {
        format: "JWT (RFC 7519), compact JWS (RFC 7515), alg Ed25519 (RFC 8037, RFC 9864)",
        typ: MANDATE_TYP,
        aud: MANDATE_AUDIENCE,
        claims: { iss: "buyer organisation id", sub: "agent id", jti: "mandate id", nbf: "valid from", exp: "valid until", mandate: "the limits; schema at #/components/schemas/Mandate in the OpenAPI document" },
        issuedBy: "The buyer organisation signs with its own key. AimoPilot holds only the organisation's public key, registered when the organisation is onboarded.",
        schema: `${u.openapi}#/components/schemas/Mandate`,
      },
      approvals: "Orders above the mandate go to a human approver named in the mandate, on their own device. Agents cannot approve.",
    },
    verification: {
      jwksUri: u.jwks,
      summary: "Quotes and order confirmations are compact JWS signed by the wholesaler. Verify them offline with the published keys; match the JWS `kid` header to a key.",
      signedObjects: [
        { typ: QUOTE_TYP, what: "Fixed-price quote: lines, prices, delivery dates, expiry." },
        { typ: ORDER_TYP, what: "Order confirmation (receipt): what was bought at what price, who authorised it, and the audit-ledger head at commit time." },
      ],
    },
    policy: {
      rules: RULES,
      liveLookup: {
        maxProductsPerCall: MAX_LIVE_IDS_PER_CALL,
        perAgent: { windowMinutes: LIVE_LOOKUP_LIMITS.windowMinutes, maxCalls: LIVE_LOOKUP_LIMITS.maxCalls, maxDistinctProducts: LIVE_LOOKUP_LIMITS.maxDistinctProducts, appliesTo: "MCP" },
      },
      refusals:
        "Every refusal is { error: { code, rule, message, details } }; `rule` is one of `rules` or live_lookup_limit, quote_availability, quote_signature, approver_identity, intake_sequence (a step out of order), human_input (needs the buyer's own answer first).",
    },
    docs: { llmsTxt: u.llms, apiCatalog: u.apiCatalog },
  };
}

export function llmsTxt(origin: string) {
  const u = urls(origin);
  const tools = TOOLS.map((t) => `- \`${t.name}\`: ${t.title}.`).join("\n");
  return `# AimoPilot

> AimoPilot is a wholesaler's open ordering gateway for AI purchasing agents. Your agent carries a mandate its organisation signed (what it may buy, how much it may spend alone, who signs off above that). It orders through MCP or REST; plain code checks every order against the mandate, and anything beyond it waits for a human sign-off on their phone.

It is not a chatbot and not a marketplace. One wholesaler, one catalogue, signed quotes at fixed prices, signed order receipts.

## Connect

- [MCP endpoint](${u.mcp}): Streamable HTTP, protocol 2026-07-28 and 2025-era clients (2025-11-25 and earlier). Listing tools needs no credentials.
- [OpenAPI 3.1](${u.openapi}): the same operations over REST.
- [API catalog](${u.apiCatalog}): RFC 9727 entry point.
- [Manifest](${u.manifest}): auth, mandate format, keys, limits.
- [Public keys](${u.jwks}): JWK Set (Ed25519) to verify quotes and order receipts offline.

## Authenticate

Send two headers on every request, MCP or REST:

    Authorization: Bearer <mandate JWS>
    Dock-Agent-Id: <agent id the mandate names>

The mandate is a JWT (typ ${MANDATE_TYP}, aud ${MANDATE_AUDIENCE}) signed with your organisation's Ed25519 key. There is no OAuth and no AimoPilot account. A bad, expired or mismatched mandate is refused with the rule that failed (mandate_signature, mandate_window, mandate_agent); do not retry with the same mandate.

Claude Code:

    claude mcp add --transport http dock ${u.mcp} \\
      --header "Authorization: Bearer $DOCK_MANDATE" --header "Dock-Agent-Id: $DOCK_AGENT_ID"

## Tools

${tools}

## How an order goes

Start every order with \`submit_need\`: the buyer's need as fields (what, how much exactly as they said it, by when, must-haves). AimoPilot answers with a step; its \`state\` says what happens next and \`nextStep\` names the exact call.

1. \`needs_confirmation\`: Dock found a likely mistake, for example 1,000 L where this kitchen usually orders 100 L. Ask the buyer and pass their answer to \`respond_to_concerns\` ("confirm" or a correction id).
2. \`needs_input\`: at most two typed questions its memory cannot answer. Ask the buyer and pass their answers to \`answer_questions\`.
3. \`options_ready\`: option cards with pros, cons and anything that needs a sign-off. \`choose_option\` with the buyer's pick returns a signed fixed-price quote.
4. \`quoted\`: call \`place_order\` with just the requestId (\`step.next.example\`). It commits, or waits for a human sign-off on the approver's phone.
5. \`no_options\` or \`cancelled\`: tell the buyer; do not order.

**The buyer answers, not you.** A mistake confirmation and a clarifying answer must come from the human buyer: relay Dock's question in plain words and pass on exactly what they say. Never confirm or answer for them. These two tools are marked \`_meta["${HUMAN_INPUT_META}"]\` in tools/list. If your client supports MCP elicitation (2026-07-28), Dock asks the buyer directly with an \`input_required\` form and your arguments only pre-fill it. While a confirmation is pending, quotes and orders for that request are refused (rule human_input).

Lower-level tools for follow-up: open_request, search_products (free master data), check_availability (live, at most ${MAX_LIVE_IDS_PER_CALL} products per call), request_quote. Then get_order and explain. Approving an order is never a tool: only the approver can, with their passkey.

## Rules an agent must follow

- Quantities are packs (see packSize); money is integer euro cents ex VAT. A quote's totalCents adds returnable-packaging deposits (lines[].deposit, outside VAT; amounts at the Finnish deposit system's published rates, since the price service states none) to the goods, and the mandate's limits compare that total. Each line states its VAT rate (taxRatePct, from the price service, else the product data's VAT class) and quote.vat adds VAT up by rate. listUnitPriceCents is the list price when the kitchen's own price is lower. Products carry nutrition per 100 g or ml; a mandate's nutritionRules are checked by the gate (rule nutrition_rules), and a product that does not declare the figure is refused.
- Shortlist with search_products before asking live prices. Never scan the catalogue: live lookups are capped per call and per agent per hour, and refused with rule live_lookup_limit.
- If the preferred product is short, quote what it has and add a line with substituteFor set to its productId.
- place_order has three outcomes: committed (with a signed confirmation), pending_approval (a person signs off; do NOT retry, follow up with get_order), or refused (error.rule names the rule).
- Every refusal is { error: { code, rule, message, details } } plus, over MCP, nextStep: one sentence on what to do.
- A quote buys once. The weekly budget is a hard limit no sign-off lifts.

## REST in one minute

    curl -s -X POST ${u.rest}/intake \\
      -H "Authorization: Bearer $DOCK_MANDATE" -H "Dock-Agent-Id: $DOCK_AGENT_ID" -H "content-type: application/json" \\
      -d '{"need":{"item":{"text":"lactose-free milk","category":"milk"},"quantity":{"amount":1000,"unit":"L"},"deliverBy":"2026-11-16"}}'

The reply is { step } with \`step.next\`: the method, path and an example body of the next call (POST /intake/{id}/concerns, /answers, /choice, then POST /orders: 201 committed, 202 awaiting sign-off, 422 refused). Lower level: POST /requests, GET /products, POST /availability, POST /quotes.

## Verify a receipt

An order's \`confirmation\` is a compact JWS (typ ${ORDER_TYP}). Fetch ${u.jwks}, pick the key whose kid matches the JWS header, verify with Ed25519. Any JOSE library does this; nothing AimoPilot-specific is needed.
`;
}

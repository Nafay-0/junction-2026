# Connect an agent to Dock

Dock speaks two open interfaces with the same operations and the same refusals:

- **MCP** (Model Context Protocol) over Streamable HTTP at `/api/mcp`. Protocol revision 2026-07-28, plus the 2025-era handshake (2025-11-25 and earlier) that most clients still send.
- **REST** described by OpenAPI 3.1 at `/api/v1/openapi.json`.

An agent that knows only the base URL can find both: `/.well-known/api-catalog` (RFC 9727), `/.well-known/dock.json` (Dock's own manifest) and `/llms.txt`.

The examples use a local server. Replace `http://localhost:3000` with the deployed URL.

## 1. Get a mandate

Every call carries the mandate the buyer organisation signed for its agent, plus the agent id it names:

```
Authorization: Bearer <mandate JWS>      (Authorization: Mandate <jws> works too)
Dock-Agent-Id: <agent id>
```

The mandate is a JWT (`typ: mandate+jwt`, `aud: dock`) signed by the organisation's own Ed25519 key. Dock holds only the organisation's public key. There is no OAuth flow and no Dock account. Listing MCP tools works without a mandate; every tool call checks it.

For local runs, mint one for the fictional demo buyer, Laakso Catering Oy (valid 7 days):

```bash
cd web
export DOCK_MANDATE=$(pnpm -s dev:mandate) DOCK_AGENT_ID=agent_laakso_buyer_01
```

## 2. Claude Code

```bash
claude mcp add --transport http dock http://localhost:3000/api/mcp \
  --header "Authorization: Bearer $DOCK_MANDATE" \
  --header "Dock-Agent-Id: $DOCK_AGENT_ID"
```

Or check a project-scoped `.mcp.json` into a repo. Claude Code expands environment variables in it:

```json
{
  "mcpServers": {
    "dock": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer ${DOCK_MANDATE}", "Dock-Agent-Id": "${DOCK_AGENT_ID}" }
    }
  }
}
```

Then ask, for example: *"Using the dock tools, order 1,000 litres of lactose-free milk for Monday."* We tested this with Claude Code 2.1.323: it read the mandate, opened a request and searched the catalogue.

## 3. Claude Desktop

Claude Desktop's remote connectors expect OAuth, so Dock goes in through the `mcp-remote` bridge, which forwards custom headers. Put the headers in a file so the mandate stays out of the process list:

```
# ~/.dock-headers.txt
Authorization: Bearer <paste the mandate>
Dock-Agent-Id: agent_laakso_buyer_01
```

`claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "dock": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp", "--header-file", "/Users/you/.dock-headers.txt"]
    }
  }
}
```

Add `--allow-http` only if Dock runs over plain HTTP on another machine in a trusted network. Loopback and HTTPS need nothing extra.

## 4. Any other MCP client

Point it at the URL and set the two headers. With the stock TypeScript client:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-buyer", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${mandate}`, "Dock-Agent-Id": agentId } },
  }),
);
const { tools } = await client.listTools();
const r = await client.callTool({ name: "read_mandate", arguments: {} });
console.log(r.structuredContent);
```

`pnpm demo:mcp --url http://localhost:3000` does the whole milk order this way, with no LLM and no Dock client code, then verifies the signed receipt.

### Tools

| Tool | What it does |
|---|---|
| `read_mandate` | What this agent may buy, spend and substitute, and who signs off above that. |
| `open_request` | Start a purchase from the buyer's words and an optional need-by date. |
| `search_products` | Product master data. Free; no live call. |
| `check_availability` | Live price, stock and delivery for at most 10 products. Metered. |
| `request_quote` | Signed fixed-price quote, plus what the gate would decide on it. |
| `place_order` | Order against a quote: `committed`, `pending_approval` or refused. |
| `get_order` | Status, decision, approval and the signed confirmation. |
| `explain` | Plain-language audit trail for a request or order, with chain verification. |

### Results and refusals

Every result has `structuredContent` (checked against the tool's published output schema) and the same JSON as text for clients that read only text:

```json
{ "ok": true, "order": { "status": "pending_approval", ... },
  "nextStep": "This order now waits for a human sign-off by Aino Virtanen (kitchen_manager) ... Do not retry ..." }
```

A refusal is a tool result with `isError: true`. It carries the same `code` and `rule` the REST API returns:

```json
{ "ok": false,
  "error": { "code": "policy_rejected", "rule": "weekly_budget", "message": "This €1,322.00 order would take weekly spend to €2,644.00, over the €2,000.00 budget ..." },
  "nextStep": "The weekly budget is a hard limit that no sign-off can lift. Do not retry or split the order; tell the buyer." }
```

Live price and availability is for short lists only: at most 10 products per call, and per agent at most 30 different products and 30 live lookups an hour. Quotes count, because a quote asks for live prices. Going over is refused with rule `live_lookup_limit`.

## 5. Plain REST with curl

Same headers, same flow. The OpenAPI document lists every status and schema.

```bash
DOCK=http://localhost:3000
H=(-H "Authorization: Bearer $DOCK_MANDATE" -H "Dock-Agent-Id: $DOCK_AGENT_ID" -H "content-type: application/json")

# open a request
REQ=$(curl -s -X POST $DOCK/api/v1/requests "${H[@]}" \
  -d '{"text":"20 L lactose-free milk","neededBy":"2026-11-16"}' | jq -r .request.requestId)

# search master data (no live call)
curl -s "$DOCK/api/v1/products?requestId=$REQ&q=milk&attribute=lactose_free&limit=3" "${H[@]}" | jq '[.products[].id]'

# live price and stock for a short list
curl -s -X POST $DOCK/api/v1/availability "${H[@]}" -d "{\"requestId\":\"$REQ\",\"productIds\":[\"VA-1001\"]}" | jq .offers

# signed quote
Q=$(curl -s -X POST $DOCK/api/v1/quotes "${H[@]}" \
  -d "{\"requestId\":\"$REQ\",\"lines\":[{\"productId\":\"VA-1001\",\"quantity\":20}]}")
echo "$Q" | jq '{total: .quote.totalCents, preview: .policyPreview.outcome}'

# order exactly the quote: 201 committed, 202 waits for sign-off (do not retry), 422 refused
curl -s -X POST $DOCK/api/v1/orders "${H[@]}" \
  -d "$(echo "$Q" | jq -c --arg r "$REQ" '{requestId: $r, quoteToken: .quoteToken, lines: [.quote.lines[] | {productId, quantity, unitPriceCents}]}')" \
  | tee order.json | jq '{status: .order.status, error: .error}'
```

Errors are always `{ "error": { "code", "rule", "message", "details" } }`.

## 6. Verify a receipt without trusting Dock

A committed order's `confirmation` is a compact JWS (`typ: order+jws`) signed by the wholesaler. The public keys are an RFC 7517 JWK Set at `/.well-known/jwks.json` (also `/api/v1/keys`), Ed25519 per RFC 8037. Any JOSE library can verify it offline:

```bash
pnpm verify:receipt order.json --url $DOCK              # fetch the keys
curl -s $DOCK/.well-known/jwks.json > jwks.json
pnpm verify:receipt order.json --jwks jwks.json         # fully offline
```

The script (`scripts/verify-receipt.ts`) uses only `jose` and the published keys. Edit one byte of the receipt and it fails. Without `DOCK_WHOLESALER_JWK` set, the server makes a new key each time it starts, so keep the JWK Set that was live when the order was signed.

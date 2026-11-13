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

Then ask, for example: *"Using the dock tools, order 1,000 litres of lactose-free milk for Monday."* The tool descriptions steer the model to start with `submit_need` and to bring Dock's questions back to you rather than answer them itself.

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

`pnpm demo:mcp --url http://localhost:3000` does the whole milk order this way, with no LLM and no Dock client code: a returning kitchen asks for 1,000 L, Dock flags it against the usual 100 L, the head chef confirms it on the form Dock sends through the client, answers one question, the agent shows three option cards and chooses one, gets a fixed-price quote, places the order, the owner signs off, and the script verifies the signed receipt.

### Tools

Start every order with `submit_need`. The lower-level tools below the line stay for follow-up.

| Tool | What it does |
|---|---|
| `read_mandate` | What this agent may buy, spend and substitute, and who signs off above that. |
| `submit_need` | **Start here.** The buyer's need as fields. Returns a step: `needs_confirmation`, `needs_input`, `options_ready`, `quoted`, `no_options` or `cancelled`. |
| `respond_to_concerns` * | The buyer confirms or corrects a likely mistake ("1,000 L where you usually order 100 L"). |
| `answer_questions` * | The buyer answers at most two typed questions Dock's memory could not answer. |
| `choose_option` | The option card the buyer picks. Returns a signed fixed-price quote and the exact `place_order` arguments. |
| `get_intake_step` | Where an order stands, and the call to make next. |
| `read_kitchen_memory` | Order history, usual amounts, rules people stated, patterns learned. |
| `place_order` | Order against a quote: `committed`, `pending_approval` or refused. |
| `get_order` | Status, decision, approval and the signed confirmation. |
| `explain` | Plain-language audit trail for a request or order, with chain verification. |
| `open_request` | Lower level: a bare request with no mistake checks or options. |
| `search_products` | Lower level: product master data. Free; no live call. |
| `check_availability` | Lower level: live price, stock and delivery for at most 10 products. Metered. |
| `request_quote` | Lower level: signed fixed-price quote, plus what the gate would decide on it. |

There is no tool to approve or decline an order: only the approver can, on their own phone with their passkey.

### The intake, step by step

Every intake result is `{ ok, step, waitingFor, nextStep }`. `step.state` is where the order stands, `waitingFor` is `buyer`, `agent` or `nobody`, and `nextStep` names the exact call to make next.

```json
{ "ok": true, "waitingFor": "buyer",
  "step": { "requestId": "req_…", "state": "needs_confirmation",
            "concerns": [{ "key": "quantity_tenfold:1000:L", "message": "1,000 L where you usually order about 100 L: did you mean 100 L?",
                           "confirmable": true, "corrections": [{ "id": "use_100_L", "label": "Make it 100 L" }] }] },
  "nextStep": "Dock found a likely mistake. Ask the buyer: … Then call respond_to_concerns … This answer must come from the human buyer …" }
```

### * The buyer answers, not the agent

`respond_to_concerns` and `answer_questions` carry the human buyer's own answer. The agent relays Dock's question and passes on what the buyer says; it must never confirm a likely mistake or answer a question for them. While a confirmation is pending, `request_quote` and `place_order` on that request are refused with rule `human_input`, so the check cannot be skipped by going around the intake.

The MCP specification has no tool annotation for "needs a person" (annotations are only the `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` hints). What the 2026-07-28 revision does define is **elicitation through `input_required` results**: a tool answers with an `elicitation/create` form, the client shows it to the user (not the model), and retries the call with the user's answer. Dock uses exactly that:

- **Client declares the `elicitation` capability** (form mode): Dock asks the buyer directly. The agent's arguments, if any, only pre-fill the form; the buyer's answer is what counts, and a declined form changes nothing (code `buyer_declined`).
- **Client without elicitation** (or a 2025-era connection, which this stateless server cannot push requests to): the agent passes the buyer's answer as `by` and `responses` / `answers`. A call with no answer is refused with code `human_answer_required`.

Both tools also carry `_meta: { "dock/humanInput": { "required": true, … } }` in `tools/list` and `humanInput: true` in the manifest. That key is Dock's own, not a standard.

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

# start from a structured need; every reply is { step } and step.next is the next call with an example body
STEP=$(curl -s -X POST $DOCK/api/v1/intake "${H[@]}" \
  -d '{"need":{"item":{"text":"lactose-free milk","category":"milk"},"quantity":{"amount":20,"unit":"L"},"deliverBy":"2026-11-17"},"by":"Aino"}')
echo "$STEP" | jq '{state: .step.state, next: .step.next}'
# then POST .step.next.path with the buyer's answer: /intake/{id}/concerns, /answers, /choice, and finally /orders
```

The lower-level calls, for follow-up or a quote built line by line:

```bash
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

# Connect an agent to AimoPilot

AimoPilot speaks two open interfaces with the same operations and the same refusals:

- **MCP** (Model Context Protocol) over Streamable HTTP at `/api/mcp`, and at a per-kitchen connector address `/api/mcp/c/<token>` for assistants that can only be given a URL (section 0). Protocol revision 2026-07-28, plus the 2025-era handshake (2025-11-25 and earlier) that most clients still send.
- **REST** described by OpenAPI 3.1 at `/api/v1/openapi.json`.

An agent that knows only the base URL can find both: `/.well-known/api-catalog` (RFC 9727), `/.well-known/dock.json` (AimoPilot's own manifest) and `/llms.txt`.

The kitchen's own agent in the store is one more client of the same tool table and the same gate: what it can look up, an outside agent can look up, as structured data. What we assumed, what is mocked and what a production deployment would need are in [assumptions.md](assumptions.md).

### What the kitchen's own agent can do, and an outside agent

The store's agent and an outside agent call the same core functions through the same gate. Nothing below is a side door: every row passes the same mandate check, admission (suspension, licence) and gate.

| The kitchen's own agent (store thread) | An outside agent: MCP tool | REST |
|---|---|---|
| Reads the buyer's words, checks them against memory, asks at most two questions, offers good / better / best | `submit_need`, `respond_to_concerns` *, `answer_questions` *, `choose_option`, `get_intake_step` | `POST /intake`, `/intake/{id}/concerns`, `/answers`, `/choice` |
| Product grid and product facts (smart search; labels exact, variant, stand-in) | `find_products` (with live price, stock, delivery, cut-off) | `POST /lookup` |
| Alternatives picker, re-ranked by price, CO2, reliability, kind, pack | `find_alternatives` | `POST /alternatives` |
| Order sheet: several lines, one order | `request_quote` with several lines, then `place_order { requestId }` | `POST /quotes`, `POST /orders` |
| "Make it 200": the new order replaces the old one | `place_order` with `replaces` | `POST /orders` with `replaces` |
| Take back before the cut-off (the kitchen's signed-in person) | `withdraw_order`: an order waiting for sign-off, or one this agent placed alone | `POST /orders/{id}/withdraw` |
| Waits for the sign-off, then says the outcome | `get_order` with `waitSeconds`, `list_orders` | `GET /orders/{id}?wait=25`, `GET /orders` |
| Memory, history, the mandate's rules | `read_kitchen_memory`, `read_mandate`, `list_orders` | `GET /kitchen`, `GET /orders` |
| "Why?": the audit trail | `explain` | `GET /ledger` |
| Offers from the wholesaler's selling agent | `list_offers`, `accept_offer`, `decline_offer`, `mute_offers` ([offers.md](offers.md)) | `/api/v1/offers` |
| Menu planning, a last-minute event, stock-out watch, standing-order renewal | being added on `claude/scenarios-menu` and `claude/scenarios-watch` | the same |
| Changing the kitchen's rules | not offered: only the kitchen's signed-in person signs new terms; an agent reads them (`read_mandate`) | none |
| Approving an order | never a tool, on either side: the named person's passkey on their own phone | approver operations only (`?audience=agent` leaves them out) |

\* carries the buyer's own answer: asked through the client's form when it can show one; otherwise relayed and recorded as not verified.

**Which kitchens an outside agent can buy for.** Every kitchen has a mandate and a connector address: the two built-in demo kitchens (`kaari`, `laakso`), a visitor's hotel kitchen made by scanning the wall's QR code (its approver is the visitor's phone), and an account kitchen anyone can open at `/k/signup` (its terms are signed by the account itself). Account and visitor kitchens' keys are held by the server in this demo; in production the kitchen holds its own key (see [assumptions.md](assumptions.md)).

**What can change under an agent.**
- A kitchen that tightens its rules reissues its mandate; every earlier mandate is refused from that second (rule `mandate_window`).
- When the wholesaler enforces crash-test licences (`DOCK_LICENCE_ENFORCE=on`), the gate applies the stricter of the mandate and the licence the agent earned on the public crash test; an agent with no licence bound to it sends every order to a person. The result says when the licence, not the mandate, did.
- A relayed answer ("the chef said yes") is recorded as relayed, not verified. It does not count as a person's: where it matters, the order goes to a named person's sign-off.

The examples use a local server. Replace `http://localhost:3000` with the deployed URL.

## 0. Connect a consumer assistant with only a URL

Consumer assistants (the Claude apps, ChatGPT) let a person add a remote MCP server by URL, with OAuth or with no sign-in, but not with the two request headers below. So every kitchen also has a **connector address**:

```
https://<dock>/api/mcp/c/dk_<43 random characters>
```

The token in the path stands for that kitchen's signed mandate and agent id, which stay on the server. A call through the address is exactly a call to `/api/mcp` with those headers: the same mandate check, the same gate, the same live-lookup allowance, the same human sign-off. It adds nothing. No tool approves an order, and the token is not an approval proof.

| | |
|---|---|
| Get it | The kitchen portal's "connect your own agent" section, from `GET /ui-api/connect/<kitchen>` (address plus setup steps for each assistant). |
| Visitor kitchens | Random at first request. Expires with the sandbox (90 minutes by default). |
| Demo kitchens (`kaari`, `laakso`) | Derived from `DOCK_CONNECTOR_SECRET`, so the address is the same after every restart and deploy. Set it on the deployment and configure the assistant once, before the demo. Without the secret, the address is random per process. |
| Revoke / reissue | `DELETE` / `POST /ui-api/connect/<kitchen>`. The old address stops at once (HTTP 404, and a `refusal` in the ledger). Visitor kitchens: the visitor's own phone session. Demo kitchens: `Authorization: Bearer <DOCK_CONNECTOR_SECRET>`. A revoked demo address comes back after a restart, because it is derived from configuration; change the secret to retire it for good. |
| Ledger | A request opened through an address gets an `intake` entry with `data.step: "channel"`, `via: "connector"`, the address id (`con_…`, not the secret) and the client's User-Agent. |
| Errors | An unknown, revoked or expired address answers **404, never 401**. A 401 with `WWW-Authenticate` makes Claude and ChatGPT start an OAuth sign-in, and AimoPilot has none to offer. |

### Limits on one address

A leaked address cannot spend beyond the mandate:

- Above the per-order limit, a named person signs off on their phone.
- The weekly budget is a hard cap that no sign-off lifts.
- Out-of-mandate products are refused.

To bound load, each address also has its own limits. They come on top of the per-agent live-lookup allowance, which is shared with every other door of the same agent:

| What | Limit | Refusal |
|---|---|---|
| HTTP requests (handshakes, `tools/list`, calls) | 120 a minute | HTTP 429 with `Retry-After` |
| New purchase requests (`submit_need`, `open_request`) | 20 an hour | tool refusal `connector_rate_limited`, rule `connector_rate_limit` |
| `place_order` calls, counted before the gate, so a person's phone cannot be flooded | 6 an hour | same |
| Request body | 256 KiB | HTTP 413 |

Connector refusals are written to the ledger at most once per address and reason every ten minutes, so a hammered address cannot flood it.

### What the consumer assistants accept (vendors' own docs, read 2026-11-13)

Most vendor pages carry no date. Where one did, it is given.

| Assistant | How a user adds a server | Transport | Auth it supports | Plan | Confirmation and human input |
|---|---|---|---|---|---|
| **Claude** (claude.ai web, Desktop; mobile uses connectors added there) | Customize > Connectors > Add > Add custom connector: a name and the URL. Team/Enterprise: an owner adds it under Organization settings > Connectors. | Streamable HTTP (recommended); legacy SSE still accepted | No sign-in, or OAuth: CIMD ("Claude's published identity"), DCR (RFC 7591), or your own client id. PKCE S256, RFC 9728 metadata, found from a **401**. Custom headers only in a limited beta. Callback `https://claude.ai/api/mcp/auth_callback` | All plans; Free gets one custom connector | Asks before tool calls (Allow once / Always allow). Per tool: Always allow / Needs approval / Blocked; `readOnlyHint` sets the default. Anthropic does not document elicitation; "advanced or draft capabilities" are listed as unsupported. Tool results up to about 150k characters, 240 s per call. |
| **ChatGPT** (web only) | Plugins > + > Add custom MCP server: name, URL, Authentication "No authentication", tick "I understand and want to continue", Create as a plugin, install. Use with `@` in the prompt box. | SSE and Streamable HTTP | No auth, OAuth (static client, CIMD `https://chatgpt.com/oauth/client.json`, then DCR; PKCE S256; RFC 9728; RFC 9207 `iss`), or mixed per tool. No custom API keys or headers. Callback `https://chatgpt.com/connector_platform_oauth_redirect` | Write tools: Business and Enterprise/Edu (on Business, admins and owners create). Pro: read/fetch tools only. Plus: not stated. | "Write actions by default require confirmation"; a tool without `readOnlyHint` counts as a write. Elicitation is recommended by the Apps SDK docs, but how ChatGPT shows it is not documented. ChatGPT reads the server's `instructions`. |
| **Gemini app** | Settings > Connected Apps > Custom apps > Add a custom app (web; works on mobile once added) | not stated | DCR, or client credentials under Advanced features. No-auth servers are not mentioned. | 18+, **in the US**, personal account, English only. Not available in Finland. | "Gemini requires manual confirmation for any write actions." |
| **Gemini CLI** | `gemini mcp add --transport http dock <url>`, or `mcpServers.dock.httpUrl` in `settings.json` | stdio, SSE (`url`), Streamable HTTP (`httpUrl`) | `headers` (so the header route works too), OAuth discovered on 401 with DCR | Since 18 June 2026 only with a paid Gemini API key or Code Assist Standard/Enterprise; free and Google One users were moved to Antigravity CLI | Asks per tool call unless `trust: true`. Elicitation is not documented, and the client source registers only `roots`. |
| **Claude Code** | `claude mcp add --transport http dock <url>` | Streamable HTTP, SSE, stdio | Headers, OAuth | any | Asks per tool unless allowed. Elicitation forms are shown "only in interactive terminal sessions". Headless (`-p`), forms come back `cancel`. |

So a plain URL is enough for the leading assistants: Claude on every plan, ChatGPT on Business/Enterprise, Claude Code, and Gemini CLI. **AimoPilot does not implement OAuth.** The one consumer assistant that seems to need it, the Gemini app, is not offered in Finland anyway.

Sources:
- Claude:
  - [add an unlisted connector](https://claude.com/docs/connectors/custom/add-unlisted)
  - [authentication](https://claude.com/docs/connectors/building/authentication)
  - [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication)
  - [building](https://claude.com/docs/connectors/building)
  - [getting started](https://claude.com/docs/connectors/getting-started)
  - [troubleshooting](https://claude.com/docs/connectors/building/troubleshooting)
  - [help centre: custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) (updated late October 2026)
  - [help centre: connectors on mobile](https://support.claude.com/en/articles/11176164) (updated the week of 9 November 2026)
- ChatGPT:
  - [help centre: custom MCP servers](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) (updated about 27 October 2026)
  - [developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
  - [Apps SDK auth](https://developers.openai.com/apps-sdk/build/auth)
- Gemini:
  - [Gemini app custom apps](https://support.google.com/gemini/answer/17209137)
  - [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server) (updated 6 October 2026)
  - [move to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli) (19 May 2026)
- Other:
  - [Claude Code MCP](https://code.claude.com/docs/en/mcp)
  - [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization) (revision 2026-07-28: authorization is optional; a server that uses it must publish RFC 9728 metadata; CIMD preferred, DCR deprecated)

Menus move. Check the vendor page if a label differs.

### Setup in two minutes, once the app is at its public HTTPS address

Copy the kitchen's connector address from the portal ("connect your own agent"), or:

```bash
curl -s https://jolly-wondrous-bunny.eur-1.aiven.app/ui-api/connect/kaari | jq -r .connector.url
```

**Claude (claude.ai or Claude Desktop, any plan)**

1. Sign in at claude.ai, or open Claude Desktop.
2. Open **Customize > Connectors**, click **Add**, then **Add custom connector**.
3. Fill in:
   - **Name:** `AimoPilot (Ravintola Kaari)`
   - **Remote MCP server URL:** paste the address.
4. Click **Continue**. If Claude asks how to sign in, choose **No sign-in**. Then click **Add**, then **Connect**.
5. Optional, to avoid a prompt on every step: go to **Customize > Connectors > AimoPilot > Tool permissions** and set the read tools to **Always allow**. Leave `place_order` on **Needs approval** if you want Claude to ask before ordering.
6. Start a new chat. Check that AimoPilot is switched on under **+ > Connectors**.
7. Type: *"Using AimoPilot, order 1,000 litres of lactose-free milk for our kitchen, delivered by Monday."* Click **Allow once** (or **Always allow**) when Claude asks to use a AimoPilot tool.
8. Answer the question Claude relays from AimoPilot ("1,000 L where you usually order about 100 L?").
9. Pick an option. The approver's phone (or the portal's sign-off QR code) then asks for the sign-off.

The connector also shows up in the Claude mobile app at its next sign-in.

**ChatGPT (web; Business or Enterprise/Edu workspace, as an admin or owner on Business)**

1. Sign in at chatgpt.com in a browser.
2. Open **Plugins**, click **+**, then **Add custom MCP server**.
3. Fill in:
   - **Name:** `AimoPilot (Ravintola Kaari)`
   - **Server URL:** paste the address.
   - **Authentication:** **No authentication**.
4. Tick **I understand and want to continue**, click **Create as a plugin**, then install it.
5. In a new chat, type **@** and pick **AimoPilot**, then the same request as above.
6. ChatGPT asks you to confirm each write step (`submit_need`, `respond_to_concerns`, `choose_option`, `place_order`). Confirm each one. Answer AimoPilot's question when ChatGPT relays it.

On a Pro account, ChatGPT connects only read/fetch tools, so it cannot order.

**Claude Code / Gemini CLI**

```bash
claude mcp add --transport http dock <address>
gemini mcp add --transport http dock <address>   # needs a paid Gemini API key or Code Assist Standard/Enterprise
```

### What was proven, and with which client (local server, 13 November 2026)

| Client | Result |
|---|---|
| Stock `@modelcontextprotocol/client`, given only the URL: no headers, no elicitation, the 2025-11-25 handshake a consumer assistant uses (`scripts/connector-smoke.ts`) | 14 tools, none that approves. Ran mandate, need, the mistake check relayed, options, quote and order, to `pending_approval` with "Do not retry". |
| Claude Code 2.1.323 (`claude -p --mcp-config` with only `{"type":"http","url":…}`, model Opus) | **Turn 1:** it called `read_mandate` and `submit_need`, then stopped. It put AimoPilot's question to the user ("Did you mean 100 L?") with both choices and did not answer it. **Turn 2:** the user confirmed 1,000 L. Claude Code declares elicitation but cannot show forms headless, so the form came back `cancel`. It then used the `relay: true` fallback and showed the three option cards in plain euros. **Turn 3:** the user picked option 1. It called `choose_option` and `place_order` (`pending_approval`), told the user in one sentence that Jari Mäkelä must sign off on his phone, and did not retry. |
| Gemini CLI 0.25.2 (`settings.json` with only `httpUrl`; model gemini-3.5-flash-lite, on the team's free-tier key, because the CLI's default models are retired and the 3.5-flash quota was used up) | **First run:** every AimoPilot call failed with `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` (Ajv, draft-07 default). AimoPilot now publishes its schemas without the `$schema` keyword; 2020-12 is MCP's default anyway. **Second run:** it relayed the mistake check correctly. It then corrupted the long signed quote token while copying it into `place_order`, three times; the gate refused each one (`quote_signature`), but the model told the user the order was sent. `place_order` now takes only `requestId` after `choose_option`. **Third run:** need, relayed check, choice, then `place_order` (`pending_approval`, first try). It told the user Jari Mäkelä must sign off and did not retry. Two lapses remain, both the small model's: it chose the pre-selected cheapest option without asking, and it filled `by` with an approver's name from the mandate. |
| `pnpm demo:mcp` on a production build (14 November, afternoon): the stock client as a hotel chain's agent, given only a visitor hotel's connector address, MCP 2026-07-28 with elicitation | 22 tools, none that approves. `find_products` showed the partner's own exception: the 10 L and 21 L boxes' cut-off (Thu 15:00) had passed for Monday, and the 1 L cartons still made it. The intake answered from memory without asking and quoted the cheapest option (€1,010). It waited for sign-off over the €500 limit, and a second order was refused (`quote_replay`). The passkey sign-off followed, `get_order` with `waitSeconds` learned "committed" 2 s later, and the receipt verified. The four exceptions passed: substitutes ranked, a nut drink refused (`forbidden_allergens`), today past the cut-off, and a 20 L order taken back before the cut-off. |
| Claude app, ChatGPT | Not run: no consumer account here. Follow the steps above against the deployed HTTPS address. |

To check again against any address: `pnpm tsx scripts/connector-smoke.ts <address>`. It places one order, which then waits for sign-off.

On a production build (`pnpm build && pnpm start`), the smoke script reaches `pending_approval` too. Revoking a demo kitchen's address without the operator secret gets 403.

**Before the demo:**
- Set `DOCK_CONNECTOR_SECRET` on the deployment. Otherwise the demo kitchens' addresses change with every restart, and the assistant has to be set up again.
- Make sure the deployment runs this build. The public address was still serving an older build without `/api/mcp/c/…` on 13 November.

### In a chat assistant: questions and sign-off

Most chat assistants cannot show AimoPilot's own form (elicitation), so the assistant relays. These rules are written for a model that has never seen AimoPilot, and they appear in three places: the server `instructions`, each tool's description, and each result's `nextStep`.

- **`waitingFor: "buyer"`:** ask the person AimoPilot's question in plain words with its choices, stop, and pass on their reply. The original request does not count as the answer.
- **`pending_approval`:** tell the person in one sentence who must sign off, on their own phone, and stop. Do not retry, place it again, split it, or find a way around it.
- **A refusal is final** unless `nextStep` says how to fix it: tell the person, and do not loop.
- **After `choose_option`, `place_order` needs only `requestId`.** AimoPilot places the quote it signed for that request, so the model never has to copy a long signed token.
- **`by` (the buyer's name) is optional through a connector.** When the assistant does not say, AimoPilot records the kitchen's person "through the kitchen's connector". A chat assistant should not have to ask your name.
- **If the client declares elicitation but closes the form unanswered** (`cancel`, as Claude Code does headless), the result is `form_not_answered`. For that request only, the agent may then ask in the chat and send the reply with `relay: true`. An explicit `decline` still stops.

### The production version: how a buyer organisation would delegate to its assistant

A URL that carries a secret works for a demo, and AimoPilot keeps it narrow:

- one address per kitchen
- revocable and expiring
- rate-limited
- no more than the mandate

It is still a bearer secret, in a place where URLs get copied and logged. Anthropic's connector guide says not to accept tokens in URLs.

The production version is standard MCP authorization (OAuth 2.1), with the mandate kept as the grant:

1. **The connection.** The buyer's purchasing manager adds `https://<dock>/api/mcp` (no token) in their assistant.
   - AimoPilot answers 401 with RFC 9728 protected-resource metadata pointing at AimoPilot's authorization server, or at the buyer's own identity provider.
   - The assistant identifies itself with its Client ID Metadata Document (Claude's or ChatGPT's published identity, so no registration step), with PKCE and an RFC 8707 `resource`.
2. **The consent screen is the mandate.** The manager signs in with their organisation account and sees what they are delegating:
   - which kitchen, and which categories
   - the per-order limit and the weekly budget
   - who signs off above the limit, and for how long
   On approval, the organisation signs a mandate naming that assistant as the agent: its client id, not a made-up agent id. The access token references the mandate (scope `mandate:<id>`), is short-lived, and is bound to the client (DPoP), so a copied token is useless. Refresh tokens are revocable from the organisation's portal.
3. **Enterprise version.** The organisation's IdP issues the assertion, using MCP's enterprise-managed authorization (an identity-assertion grant), so IT decides centrally which assistants may buy and for whom.
4. **Nothing else changes.**
   - The gate still checks every order in plain code against the signed mandate.
   - Sign-off still happens on the approver's own device with a passkey.
   - The ledger names the assistant's client id and the human who consented.
   - Rate limits are per client and per organisation, in shared storage (the in-memory limits here are per process).

## 1. Get a mandate

Every call carries the mandate the buyer organisation signed for its agent, plus the agent id it names:

```
Authorization: Bearer <mandate JWS>      (Authorization: Mandate <jws> works too)
Dock-Agent-Id: <agent id>
```

The mandate is a JWT (`typ: mandate+jwt`, `aud: dock`) signed by the organisation's own Ed25519 key. AimoPilot holds only the organisation's public key. There is no OAuth flow and no AimoPilot account. Listing MCP tools works without a mandate; every tool call checks it.

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

Then ask, for example: *"Using the dock tools, order 1,000 litres of lactose-free milk for Monday."* The tool descriptions steer the model to start with `submit_need` and to bring AimoPilot's questions back to you rather than answer them itself.

## 3. Claude Desktop

The simplest way is the kitchen's connector address as a custom connector (section 0): no sign-in, no headers. To present your own mandate instead, go through the `mcp-remote` bridge, which forwards custom headers (Claude's own custom-header support is a limited beta). Put the headers in a file so the mandate stays out of the process list:

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

Add `--allow-http` only if AimoPilot runs over plain HTTP on another machine in a trusted network. Loopback and HTTPS need nothing extra.

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

`pnpm build && pnpm demo:mcp` (or `pnpm demo:mcp --url http://localhost:3000`) does Valio Aimo's example this way, with no LLM and no AimoPilot client code, as a hotel chain's agent. The hotel's purchasing manager joins with a passkey, and the agent gets the hotel's connector address. It looks up products, prices and availability (`find_products`) and submits the need. It gets good, better and best options, chooses one and places the order. The order is over the agent's €500, so it waits. The manager signs with the passkey, `get_order` with `waitSeconds` returns the outcome, and the script verifies the signed receipt. Then four exceptions follow: a stock-out with ranked substitutes, a nut drink refused as a substitute, delivery today past the cut-off, and an order placed alone, then taken back.

### Tools

Start every order with `submit_need`. The lower-level tools below the line stay for follow-up.

| Tool | What it does |
|---|---|
| `read_mandate` | What this agent may buy, spend and substitute, and who signs off above that. |
| `submit_need` | **Start here.** The buyer's need as fields. Returns a step: `needs_confirmation`, `needs_input`, `options_ready`, `quoted`, `no_options` or `cancelled`. |
| `respond_to_concerns` * | The buyer confirms or corrects a likely mistake ("1,000 L where you usually order 100 L"). |
| `answer_questions` * | The buyer answers at most two typed questions AimoPilot's memory could not answer. |
| `choose_option` | The option card the buyer picks. Returns a signed fixed-price quote and the exact `place_order` arguments. |
| `get_intake_step` | Where an order stands, and the call to make next. |
| `read_kitchen_memory` | Order history, usual amounts, rules people stated, patterns learned. |
| `place_order` | Order against a quote: `committed`, `pending_approval` or refused. Just `requestId` after `choose_option` or `request_quote`. `replaces` changes an earlier order. |
| `get_order` | Status, decision, approval and the signed confirmation. With `waitSeconds` (up to 55) it answers once the person decides a waiting order. |
| `list_orders` | This organisation's orders: which wait for a person's sign-off, who must sign, what can still be taken back. |
| `withdraw_order` | Take back an order waiting for sign-off, or one this agent placed alone, until the wholesaler's order cut-off. What a person signed is theirs to take back. |
| `explain` | Plain-language audit trail for a request or order, with chain verification. |
| `find_products` | Products, prices and availability in one call. Filters: words, category, brand, claims, allergens to avoid, pack size, delivery day, quantity. Words go through the store's own product search, and each product says `match`: exact, variant, stand_in or not_the_kind. Live for at most 10. |
| `find_alternatives` | Good, better, best substitutes for a product that is short, late or not wanted. Each comes with its trade-offs, live price and delivery, and the gate's preview. |
| `open_request` | Lower level: a bare request with no mistake checks or options. |
| `search_products` | Lower level: product master data. Free; no live call. |
| `check_availability` | Lower level: live price, stock and delivery for at most 10 products. Metered. |
| `request_quote` | Lower level: signed fixed-price quote, plus what the gate would decide on it. |
| `list_offers` | The wholesaler's signed offers to this kitchen (new, seasonal, or a cheaper like-for-like), each verifiable offline. Never an order. |
| `accept_offer` | The buyer wants it: starts an ordinary order through the intake, the gate and the sign-off. |
| `decline_offer` | Not wanted; not offered again for 30 days. |
| `mute_offers` | No more of this product, family or kind of reason, or no offers at all (`scope: all`). |

There is no tool to approve or decline an order: only the approver can, on their own phone with their passkey.

### The intake, step by step

Every intake result is `{ ok, step, waitingFor, nextStep }`. `step.state` is where the order stands, `waitingFor` is `buyer`, `agent` or `nobody`, and `nextStep` names the exact call to make next.

```json
{ "ok": true, "waitingFor": "buyer",
  "step": { "requestId": "req_…", "state": "needs_confirmation",
            "concerns": [{ "key": "quantity_tenfold:1000:L", "message": "1,000 L where you usually order about 100 L: did you mean 100 L?",
                           "confirmable": true, "corrections": [{ "id": "use_100_L", "label": "Make it 100 L" }] }] },
  "nextStep": "AimoPilot found a likely mistake. Ask the buyer: … Then call respond_to_concerns … This answer must come from the human buyer …" }
```

### * The buyer answers, not the agent

`respond_to_concerns` and `answer_questions` carry the human buyer's own answer. The agent relays AimoPilot's question and passes on what the buyer says; it must never confirm a likely mistake or answer a question for them. While a confirmation is pending, `request_quote` and `place_order` on that request are refused with rule `human_input`, so the check cannot be skipped by going around the intake.

The MCP specification has no tool annotation for "needs a person" (annotations are only the `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` hints). What the 2026-07-28 revision does define is **elicitation through `input_required` results**: a tool answers with an `elicitation/create` form, the client shows it to the user (not the model), and retries the call with the user's answer. AimoPilot uses exactly that:

- **Client declares the `elicitation` capability** (form mode): AimoPilot asks through the client's form. The agent's arguments, if any, only pre-fill it; what comes back is what counts, and a declined form changes nothing (code `buyer_declined`). The form is shown and returned by the agent's client, and AimoPilot cannot tell a client that asked its user from one that filled the form in itself, so the answer is recorded as relayed by the client (channel `protocol_elicitation`, not verified). It settles preferences inside the mandate; where it confirms a likely mistake that matters, the order still goes to a named person's sign-off.
- **Client without elicitation** (or a 2025-era connection, which this stateless server cannot push requests to): the agent passes the buyer's answer as `by` and `responses` / `answers`, recorded as relayed and not verified. A call with no answer is refused with code `human_answer_required`. The step also carries **`answerUrl`**, a one-time page on AimoPilot (30 minutes, single use, bound to that exact step) where the buyer taps one of AimoPilot's fixed choices themselves; the agent is told to hand it over instead of relaying. Answers there are recorded with the channel `answer_link`. Whoever holds the link can answer, so without the kitchen's signed-in session on that phone a confirmation that matters (an unusual amount, a rule broken) still goes to a named person's sign-off.

Both tools also carry `_meta: { "dock/humanInput": { "required": true, … } }` in `tools/list` and `humanInput: true` in the manifest; in the OpenAPI document the same two operations carry `x-dock-human-input`. Those keys are AimoPilot's own, not a standard. Operations for the approver's phone are tagged `approver` (`x-dock-audience: approver`); `/api/v1/openapi.json?audience=agent` leaves them out, so an OpenAPI-to-tools converter never offers an agent a tool to approve orders.

Output schemas in `tools/list` are published shallow (the top-level fields with their descriptions, one level of shape below): some runtimes send every output schema to their model on each call. The full shapes are in the OpenAPI document.

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

# start from a structured need; every reply is { step, waitingFor, nextStep } (plus answerUrl when the buyer must
# answer), and step.next is the next call with an example body whose answers are placeholders, never a pre-filled choice
STEP=$(curl -s -X POST $DOCK/api/v1/intake "${H[@]}" \
  -d '{"need":{"item":{"text":"lactose-free milk","category":"milk"},"quantity":{"amount":20,"unit":"L"},"deliverOn":"2026-11-17"},"by":"Aino"}')
echo "$STEP" | jq '{state: .step.state, waitingFor, nextStep, answerUrl, next: .step.next}'
# then POST .step.next.path with the buyer's answer: /intake/{id}/concerns, /answers, /choice, and finally
# POST /orders with just {"requestId": …}: Dock places the quote it signed at the choice.
# "deliverOn" asks for that exact day; "deliverBy" for that day at the latest.
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

Products, prices and availability in one call, and alternatives (the same as `find_products` and `find_alternatives`):

```bash
curl -s -X POST $DOCK/api/v1/lookup "${H[@]}" \
  -d '{"text":"lactose-free milk","requiredClaims":["lactose_free"],"quantity":{"amount":1000,"unit":"L"},"deliverOn":"2026-11-16","limit":4}' \
  | jq '{requestId, products: [.products[] | {name, match, price: .live.unitPriceCents, stock: .live.availablePacks, day: .live.meetsDay, orderBy: .live.orderBy}]}'
curl -s -X POST $DOCK/api/v1/alternatives "${H[@]}" -d '{"productId":"VA-1010","quantity":{"amount":1000,"unit":"L"}}' | jq '.alternatives[] | {rank, name, tradeOffs, gate: .gate.outcome}'
```

After the order:

```bash
curl -s "$DOCK/api/v1/orders?status=pending_approval" "${H[@]}"            # what waits for sign-off
curl -s "$DOCK/api/v1/orders/$ORDER?wait=25" "${H[@]}"                     # answers once the person decides
curl -s -X POST $DOCK/api/v1/orders/$ORDER/withdraw "${H[@]}" -d '{"reason":"breakfast cancelled"}'
# change an order: quote the new lines, then POST /orders { requestId, replaces: "<old orderId>" }
```

`POST /orders` with only `{ requestId }` also works after `POST /quotes`: Dock places the latest quote it signed for that request.

Errors are always `{ "error": { "code", "rule", "message", "details" } }`.

## 6. Verify a receipt without trusting AimoPilot

A committed order's `confirmation` is a compact JWS (`typ: order+jws`) signed by the wholesaler. The public keys are an RFC 7517 JWK Set at `/.well-known/jwks.json` (also `/api/v1/keys`), Ed25519 per RFC 8037. Any JOSE library can verify it offline:

```bash
pnpm verify:receipt order.json --url $DOCK              # fetch the keys
curl -s $DOCK/.well-known/jwks.json > jwks.json
pnpm verify:receipt order.json --jwks jwks.json         # fully offline
```

The script (`scripts/verify-receipt.ts`) uses only `jose` and the published keys. Edit one byte of the receipt and it fails. Without `DOCK_WHOLESALER_JWK` set, the server makes a new key each time it starts, so keep the JWK Set that was live when the order was signed.

## 7. Offers from the wholesaler's selling agent

The wholesaler's own agent may offer a kitchen a product worth trying: new in the assortment, in season in Finland, or
a like-for-like cheaper per litre, more reliable or lower in carbon than what the kitchen buys every week. Each offer
is a signed W3C Verifiable Credential (compact JWS, `typ: vc+jwt`, type `DockProductOffer`, Ed25519, addressed with
`aud` to the buyer organisation), checked like a receipt against the published keys:

```bash
curl -s $DOCK/api/v1/offers "${H[@]}" > offers.json
pnpm verify:offer offers.json --url $DOCK --org <your org id>
```

An offer buys nothing: `accept_offer` (or `POST /api/v1/offers/{offerId}/accept`) starts an ordinary order, and the
same intake, gate and sign-off decide it. Tell the buyer about at most one or two, in plain words, and only on their
own answer accept, decline or mute. The format, the reasons and every guardrail are in [offers.md](offers.md).


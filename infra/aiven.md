# Dock on Aiven

Everything Dock runs on Aiven, why each piece is there, what it costs, and how to check it. Written
13 Nov 2026 (Fri evening) from Aiven's docs (`aiven.io/docs/llms.txt`, the Runtime, Managed Agents and
MCP pages, the free-tier pages) and from the API responses themselves. Where the two differed, this
file follows what the API did.

The project is `$AIVEN_PROJECT` and the organisation `$AIVEN_ORGANIZATION_ID` (both in
`web/.env.local`). Host names below contain the project name, so they are written as `<project>`.

## Architecture

```
 outside AI buyer ──MCP / REST over HTTPS──▶ dock-app (Aiven Runtime, aws-eu-central-1)
 (e.g. an Aiven Managed Agent)                 │  Next.js: REST API, MCP endpoint, approval pages
 approver's phone ──HTTPS (passkey, SSE)──────▶│
                                               ├─▶ dock-pg      PostgreSQL 18   orders, approvals, mandates,
                                               │                                licences, kitchen memory (pgvector),
                                               │                                hash-chained ledger, telemetry.events
                                               ├─▶ dock-search  OpenSearch 3.6  17,546 products, fi/sv/en analyzers,
                                               │                                dietary-claim and allergen filters
                                               ├─▶ dock-cache   Valkey 9.1      price/availability cache (TTL = validity),
                                               │                                partner-API rate budget, approval pub/sub
                                               └─▶ dock-events  Kafka 4.3       every agent action and gate decision
                                                                                 → crash-test scoring, dashboard
 dock-grafana (Grafana 11.6) ◀── dock-pg (grafana_reader, read-only): business telemetry
                             ◀── Aiven API (read-only app user, Infinity plugin): CPU/mem/disk, state, app logs
```

| Job | Service | Why this one |
|---|---|---|
| System of record, ledger, kitchen memory | **PostgreSQL** | Transactions for "commit at a fixed price", `pgcrypto` `digest()` for the hash chain, and **pgvector** keeps embeddings next to the rows they describe, so no separate vector store. |
| Product search | **OpenSearch** | Relevance ranking, built-in `finnish` and `swedish` analyzers, facets on claims and allergens. `pg_trgm` + `unaccent` in PostgreSQL are a fallback, not a replacement: they cannot rank across three languages well. |
| Cache, rate budget, push fan-out | **Valkey** | `SET … EX <validity>` matches "answer valid for N minutes"; `INCR`+`EXPIRE` is a rate budget; pub/sub carries approval events when the app runs as more than one process. |
| Action stream | **Kafka** | Durable, replayable, ordered per key (order id); the crash-test scorer is just a consumer group. Aiven MCP can also read the topic, so an ops agent can inspect it. |
| Hosting | **Aiven Runtime** (`application` service) | The app sits next to its data, gets service credentials injected as env vars, public HTTPS out of the box. |
| Dashboard | **Grafana** | One place for business numbers and service health. See "Observability" for why there is no metrics store. |

Better-suited services considered and not used: **Aiven for Metrics (Thanos)**, because free-plan
services cannot send metrics to it (see below), so it would have stored nothing; **Kafka Connect**
(a JDBC/OpenSearch sink instead of the app writing twice), because it is not available on the free
Kafka plan and is its own paid service; **ClickHouse** for the event analytics, because at hackathon
volumes PostgreSQL answers the same queries and is already there.

## Resources

| Name | Type | Plan | Region | $/hour | Created by |
|---|---|---|---|---|---|
| dock-pg | PostgreSQL 18.7 | free-1-1gb | do-fra | 0 | team |
| dock-search | OpenSearch 3.6 | free-4-20 | do-fra | 0 | team |
| dock-cache | Valkey 9.1 | free-1 | do-ams | 0 | team |
| dock-events | Kafka 4.3 | free-0 | do-fra | 0 | team |
| **dock-grafana** | Grafana 11.6 | startup-1 | do-fra | **0.048** | aiven-infra, 13 Nov 20:33 UTC |
| **dock-app** | Runtime application | startup-50-1024 (1 GB) | aws-eu-central-1 | **0.03836** | aiven-infra, 13 Nov 20:35 UTC (startup-20-512 at 0.01644 for its first 12 min) |

Prices are the API's `price_usd` per hour for that plan and region (`GET /project/<project>/service_types`).

**Run rate: $0.0864/hour ($2.07/day).** Projected spend from creation to **Sun 15 Nov 18:00 EET**
(16:00 UTC), about 43.4 hours: Grafana $2.09 + app $1.66 = **about $3.75 of the $50 trial credit**.
The free services cost nothing and do not draw on the credit.

Not in this project's service list: the **Managed Agents environment** `managed-agents-a0074eab` (Aiven
runs it, `startup-20-512` in google-europe-west1, free tier with a daily run limit). It existed before
this work and costs this project nothing that the API shows.

Not services, also created: the four `application_service_credential` integrations from the data
services to dock-app; the PostgreSQL role `grafana_reader` (read-only, connection limit 3), the schema
`telemetry` and five extensions in dock-pg; the organisation application user `dock-grafana-reader`
(project role read-only) and its API token (expires 20 Nov); a read-only GitHub deploy key
"Aiven Runtime dock-app (read-only)" on the repo, so Runtime can clone the private repo.

Teardown: `infra/aiven-teardown.sh` (dry run) and `infra/aiven-teardown.sh --yes`. It deletes only
dock-app, dock-grafana and the application user, refuses to delete anything on a free plan, and prints
the command to remove the deploy key.

## MCP and agents on Aiven: what exists and how Dock uses it

Aiven has three separate things, and "MCP runtime" can mean any of them:

1. **Aiven MCP server**: Aiven's own MCP server, hosted at `https://mcp.aiven.live/mcp` (OAuth 2.0 +
   PKCE) or run locally as `npx -y mcp-aiven` with an API token. It lets an assistant list and manage
   services, read metrics and logs, run **read-only SQL** on PostgreSQL, list/produce/read **Kafka**
   messages, and deploy to Runtime. Read-only mode and per-service scopes exist. An org admin must first
   switch on Admin > Authentication > *Allow MCP connections*. Included with the account at no cost.
2. **Managed Agents** (limited availability; enabled on this project, flag `managed_agents`): agents
   that run on Aiven, with a model, system instructions, built-in tools (Web Fetch, Web Search, Aiven
   MCP with Read-only / Read-write / Full roles) and **custom MCP integrations by URL**. They can be
   chatted with, scheduled (cron) and driven by API: `POST /v1/organization/{org}/project/{project}/
   managed-agents/environment/{env}/integration` (`custom_url` = an MCP server), `…/agent`,
   `…/agent/{id}/session`, `…/session/{id}/message` (SSE streaming). The API notes a free tier with a
   daily run limit; no price is published.
3. **Aiven Runtime**: hosts any container, which includes MCP servers. Aiven's own template
   `Aiven-Labs/fastmcp-caddy-proxy` is exactly that (MCP over Streamable HTTP behind a bearer-token
   proxy), and the Runtime config schema uses `Aiven-Open/mcp-aiven` as its example repository.

How Dock should use them, in order of value for the demo:

- **Dock's MCP endpoint runs on Runtime** inside dock-app (Streamable HTTP at **`/api/mcp`**, same
  process as the REST API, mandate as the bearer credential). Runtime ports are HTTP/1.1 behind Aiven's
  TLS edge, which is what Streamable HTTP and SSE need.
- **The outside buyer is an Aiven Managed Agent**, and it exists (13 Nov, 21:34 UTC): agent "Laakso
  Catering purchasing agent" on `gemini-3.8-flash` in the project's existing environment
  `managed-agents-a0074eab` (free tier, daily run limit; nothing new was created in the project), with the
  custom integration `dock` = `https://<app-host>/api/mcp?agent_id=agent_laakso_buyer_01` and Laakso's
  demo mandate as its token (`catalog_type: "custom"`, `credentials: {"token": <JWS>}`; the mandate is
  valid 7 days, until 20 Nov; rerun `pnpm aiven:agent` after that or after a key change: it reuses the
  agent). The integration came up `connected` and listed Dock's 14 tools. `pnpm aiven:agent` (in `web/`)
  creates or reuses all of it and sends one message; `--status` only lists.
  The integration sends no custom headers, so Dock now also takes the agent id from `?agent_id=` when
  `Dock-Agent-Id` is absent (`src/server/http.ts`); the mandate must still name that agent.
  **What happened** with the partner's milk request, in one session: the agent read its mandate, called
  `submit_need` (1,000 L, lactose-free, by Monday 16 Nov, cheapest); Dock flagged "first order, 1,000 L
  is a large one" and the agent relayed it instead of answering for the buyer. After "confirm" it relayed
  Dock's two questions (fat, organic); after "no preference, cheapest" it chose option 1 (Valio Eila 3 %
  1 l, 1,000 packs at €1.40), got the signed quote and placed the order: `pending_approval`, €1,400 over
  the €1,000 per-order limit, sign-off routed to Aino Virtanen. Three messages, about 20 s each. Note: the
  demo org's approvers have no passkey in production, so that order cannot be approved there; for an
  outside agent's order to reach a visitor's phone, the agent needs that visitor kitchen's mandate.
- **An ops agent with Aiven MCP (Read-only role)** on a schedule: "summarise the last hour of gate
  refusals from `dock-events` and any service not RUNNING". Cheap to add from the Console once the
  topics carry data.
- **The team's coding agents use Aiven MCP** (`claude mcp add --transport http aiven
  https://mcp.aiven.live/mcp`) to inspect topics, slow queries and logs while building.

## Hosting on Aiven Runtime

dock-app serves Dock at **`https://jolly-wondrous-bunny.eur-1.aiven.app`** (Let's Encrypt certificate,
HTTP/2 at the edge, TLS terminated by Aiven, plain HTTP to the container on 8080). **Keep this app and
its host name**: passkeys are bound to the host (RP ID), and recreating dock-app gives a new random name
and orphans every registered passkey. A custom domain (subdomain + CNAME) is supported if one is wanted.
For push to phones use SSE, not WebSockets (Runtime documents HTTP only).

### Deploying (one command)

```bash
node infra/aiven-deploy.mjs                     # deploy origin/main, wait, smoke-test; prints PASS or FAIL
node infra/aiven-deploy.mjs origin/claude/x     # any branch, tag or commit
node infra/aiven-deploy.mjs --smoke-only        # only the smoke test against what is live
node infra/aiven-deploy.mjs --config-only       # only push the settings below (the app restarts)
node infra/aiven-deploy.mjs --dry-run           # show what would change
```

Runtime clones the private repo over SSH with a read-only deploy key and builds the **head of one
branch**; pinning a commit (`commit_sha`) needs the Aiven GitHub App, which we do not have. So the script
makes a deploy commit on top of the ref that adds only `web/.build-info.json` (source commit, ref, time),
force-pushes it to the branch **`deploy/aiven`** (never merge that branch), points dock-app at it, sets the
environment, redeploys, polls `/api/health` until the new commit answers (about 4 to 5 minutes: clone,
build, image scan, start) and runs `pnpm smoke` against the public URL. Deploys are not automatic on push.

`pnpm smoke --url <url> [--commit <sha>]` (in `web/`) is the smoke test: health and expected commit, the
wall `/` first (it used to break every later API error), the console `/k/kaari` and its `/ui-api` back
end, `/join` and the passkey options (RP ID must equal the host), the five discovery documents, a search,
one intake through to a signed quote, two refusals with rule and status (tampered mandate: 401
`mandate_signature`; order below the quoted price: 422 `order_matches_quote`), and `/api/v1/dev/*` closed.
It makes a few live partner lookups and no model calls.

The phone path, without a phone: `E2E_BASE_URL=https://<host> pnpm exec playwright test` runs
`e2e/approval.spec.ts` (Chromium as a Pixel 7 with a virtual platform authenticator) against the deployed
server: join by passkey, the agent's order over the €500 limit, sign-off with the passkey, committed and
on the wall; a removed passkey approves nothing; one-tap decline.

### Settings on the app

`infra/aiven-deploy.mjs` is the one place the environment list is defined (a PUT replaces the whole list,
and the API returns values only with `?include_secrets=true`, so the script re-sends the full application
object, deploy key included). Values come from `web/.env.local`; names only are ever printed.

| Kind | Names |
|---|---|
| variable | `NODE_ENV`, `DOCK_PUBLIC_URL`, `DOCK_WEBAUTHN_RP_ID`, `DOCK_WEBAUTHN_ORIGINS`, `DOCK_WEBAUTHN_RP_NAME`, `DOCK_CATALOG=valio`, `VALIO_API_BASE`, `DOCK_LLM`, `DOCK_LLM_DAILY_USD`, `DOCK_LLM_DAILY_CALLS`, `DOCK_LIVE_DAILY_CALLS`, `DOCK_TRUSTED_PROXY_HOPS` (+ `DOCK_INTERPRET_MODEL`, `DOCK_AGENT_MODEL`, `VALIO_CUSTOMER` when set locally) |
| secret | `DOCK_WHOLESALER_JWK`, `DOCK_DEMO_ORG_JWK`, `DOCK_DEMO_KITCHEN_JWK` (fixed Ed25519 keys generated 13 Nov, also in the shared `web/.env.local`, nowhere else), `VALIO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| from the integrations | `DATABASE_URL`, `OPENSEARCH_URI`, `VALKEY_URL`, `KAFKA_*`. Despite their status reading `starting`, the `application_service_credential` integrations do deliver these (the API refuses a variable that duplicates one: "Duplicate environment variable key 'DATABASE_URL' found in integrated service credentials"), and `/api/health` shows all four services reachable. OpenSearch arrives as `OPENSEARCH_URI`, not `OPENSEARCH_URL`. |

Defaults of the demo caps: model spend $5 and 500 calls per UTC day, 3,000 partner API requests per day.
To stop all model spend at once: `DOCK_DEPLOY_LLM=off node infra/aiven-deploy.mjs --config-only`.
`DOCK_DEMO_TAP_APPROVAL` is deliberately not set: the demo kitchens' fictional approvers have no passkey,
so their console QR is view-only in production; the visitor path (join by QR, own passkey) is the live one.

### The real catalogue on the server

The product index is built from partner files that are in neither the repo nor the image. `pnpm
index:publish` (in `web/`) stores the prebuilt gzipped index in dock-pg as one row of
`partner_data.catalog_index` (sha256, build time, product count, bytes; its own schema, so the Grafana
role, which reads `public` and `telemetry`, cannot read it). At start (`src/instrumentation.ts`) the
server uses a local index file if there is one, else downloads the row and caches it under
`.data/valio/cache/` by hash, else a copy cached at an earlier start, else the 12-product seed. An
unreachable database never fails startup; the log line `catalogue index: ... running on the 12-product
seed catalogue` says so, and `/api/health` shows `catalog.source` and `catalog.index.from`. After
`pnpm index:build`, run `pnpm index:publish` and redeploy.

`/api/health` reports: commit, catalogue source and size, which of PostgreSQL, Valkey, OpenSearch and
Kafka answer (probes cached 30 s), today's use of the demo caps, and which keys are fixed. No secrets.

### What a stranger with the URL can do (exposure review, 13 Nov)

Without a mandate or approver session, reachable by anyone:

| Route | Spends | Bound |
|---|---|---|
| `/ui-api/kitchens/{kaari,laakso,sbx_…}/call` (console back end; holds the kitchen's mandate server-side) | model calls (interpret), live partner lookups, in-memory orders and ledger | 60/min per address, 40/min per kitchen; daily model and partner caps (429 `demo_limit_reached`) |
| `POST /api/v1/sandboxes/{id}/demo-order` (wall button), `POST /api/v1/approver/demo-order` | live lookups, orders | 12/min per address, 6/min per kitchen; partner cap |
| `POST /api/v1/join`, `/join/verify` | a visitor kitchen (max 200 alive, 90 min each) | 30/min per address |
| `GET /api/v1/events` (SSE) | an open connection | 60 new streams/min per address |
| `GET /ui-api/wall`, `/ui-api/kitchens/{k}`, `/api/v1/sandboxes`, `/api/v1/approvals`, `/api/v1/ledger`, `/api/health`, discovery documents, pages | nothing (reads) | 900/min per address overall, 300/min for pages |

Everywhere: request bodies over 64 KB are refused (413, and the proxy buffers at most 128 KB),
`/api/v1/dev/*` is 404 in production. With a mandate (`/api/v1/*`, `/api/mcp`) the gate's own rules apply
plus 120 writes/min per address. Per-address limits are generous because venue Wi-Fi puts many phones
behind one address; the money is bounded by the daily caps, not by the per-address limits.

A stranger **can**: open the wall and any console, make a demo or visitor kitchen's agent ask for things
(including model calls) until the limits bite, start a visitor kitchen, read the public ledger and
pending sign-off summaries, list visitor kitchens (by design: the wall and console switch between them).
A stranger **cannot**: approve anything (sign-off needs the named approver's passkey; the demo kitchens'
one-time links are not exposed in production), mint a mandate (the demo org keys are now private), read
partner data in bulk (search results only, live lookups capped at 10 ids per call and per day), or spend
more than the daily model budget. In-memory state (orders, ledger, events) still grows with use until a
restart; at these limits that is megabytes, not gigabytes.

Fixed in this round (found by the first smoke test): **every API error became a 500 once `/` had been
rendered**. The page built the shared runtime from its own module graph, so a route's `err instanceof
DockError` was false. DockError and PasskeyError now carry a `Symbol.for` brand that `instanceof` checks
(`src/core/errors.ts`), and `src/server/http.test.ts` loads a second copy of the class to prove it.

## Observability

Where to look: **Grafana → dashboard "Dock overview"** at
`https://dock-grafana-<project>.e.aivencloud.com/d/dock-overview` (user `avnadmin`, password on the
dock-grafana page in the Aiven Console). `node infra/grafana/provision.mjs` recreates the data sources
and the dashboard and prints the URL. Three rows:

1. **Dock** (PostgreSQL `telemetry.events`): orders committed, committed value, human sign-offs
   (asked / granted / denied), gate refusals, live-API calls saved by the cache and the hit rate,
   refusals by rule, events per minute by kind, crash-test scores. Empty until the app writes rows.
2. **Aiven services** (Aiven API): state and plan of every service; CPU, memory and disk for all six;
   latest `pnpm infra:check --record` result per service.
3. **Runtime app logs**: dock-app's run and build logs (Runtime keeps 24 h).

Why it is built this way: **free-plan services allow no service integrations.** The free-tier pages
say so for all four, and the API answers `403 service_integration_not_allowed` to the Grafana
`datasource` integration for dock-pg and dock-search. The `metrics` integration is the only way into
Aiven for Metrics, so it falls under the same rule, and the `application` service type is not a
metrics source at all. So instead:

- Grafana reads PostgreSQL directly as `grafana_reader` (SELECT only, max 3 connections, 10 s timeout).
- Grafana's Infinity plugin calls `api.aiven.io` with the token of the application user
  `dock-grafana-reader`, which has the project **read-only** role and cannot read secrets (checked:
  403 on `include_secrets`). That gives the CPU/memory/disk series the Console shows (where Aiven
  reports them) for every service, free or paid, plus the Runtime logs.

**How the app should emit its own metrics:** insert a row into `telemetry.events` (schema and the list
of `kind` values in `infra/telemetry.sql`) in the same transaction as the thing it counts, for example
`insert into telemetry.events (source, kind, rule, agent_id, order_id, value) values ('dock-app',
'gate.refused', 'weekly_budget', $1, $2, null)`. Publish the same event to Kafka after commit for the
stream consumers. Log to stdout (one JSON object per line); Runtime captures it and Grafana shows it.
Keep the app's PostgreSQL pool at 5 or fewer: the free plan has 20 connections in total, shared with
Grafana, Aiven MCP and laptops.

Not done because of the budget rules: **Aiven for Metrics (Thanos) startup-4, do-fra, $0.082/h**
(about $3.60 to Sunday): with every data service on a free plan nothing could send metrics to it.
Making it useful means upgrading the data services, which these rules forbid; costs to Sunday in
do-fra: PostgreSQL startup-4 $0.103/h ($4.50), OpenSearch startup-4 $0.123/h ($5.35), Kafka startup-2
$0.274/h ($11.90), Valkey startup-1 $0.026/h ($1.15). With Thanos that is $0.69/h in total, about
$30 to Sunday, inside the $50 credit but over the $0.20/h limit; it would also unlock log integration
into OpenSearch, connection pooling on PostgreSQL and more Kafka topics.

## PostgreSQL

Enabled on dock-pg (`infra/postgres-extensions.sql`): `vector` 0.8.7, `pg_trgm` 1.6, `unaccent` 1.1,
`pgcrypto` 1.4, `pg_stat_statements` 1.12. 75 extensions are available on the free plan, including
`citext`, `btree_gist`, `pg_cron`, `timescaledb`, `postgis`, `pgaudit`. Text-search configurations
`finnish`, `swedish`, `english` exist. `avnadmin` is not a superuser (cannot grant `pg_read_all_data`).

## Free plan limits that matter

| Service | Limits |
|---|---|
| All four | No service integrations (except credentials into a Runtime app), no VPC, no static IPs, one free service per type per organisation, region fixed, no SLA. **Powered off when idle** ("no continuative activity"), and a new service with no initial use can be powered off within hours; power it on again in the Console. |
| PostgreSQL | 1 CPU, 1 GB RAM, **1 GB disk**, **max_connections 20**, no connection pooling. |
| Valkey | 1 GB RAM, maxmemory 50 %, policy `noeviction` (writes fail when full, so give every key a TTL); `CONFIG` is not available. In **do-ams**, while everything else is in Frankfurt (a few ms extra per call). |
| OpenSearch | 4 GB RAM, 20 GB disk, 2 shards per index default, 20 shards per node, 50 concurrent connections, no security plugin (only `avnadmin`), no custom domain. |
| Kafka | 250 KiB/s in and out, **5 topics × 2 partitions**, fixed retention, no Kafka Connect, MirrorMaker or tiered storage, client-certificate auth only (SASL off). Plan the topics, e.g. `dock.actions` and `dock.gate`, keyed by order id. |

IP allowlists: every service is open to `0.0.0.0/0` (the default), protected by TLS and credentials.
The Runtime app has no static egress IP on these plans, so an allowlist could not name it; leave as is.

## How to check everything

From `web/`:

```bash
node ../infra/aiven-env.mjs        # write OpenSearch, Valkey, Kafka keys into .env.local from the API
                                   # (--include-database-url also rewrites DATABASE_URL)
pnpm infra:check                   # one line per service: PASS / FAIL / not configured
pnpm infra:check --record          # also writes the results to telemetry.events (Grafana table)
node ../infra/grafana/provision.mjs  # (re)create Grafana data sources and the dashboard
```

The Aiven API returns `"<redacted>"` for every password and key unless the request asks for
`?include_secrets=true`. A URI copied from a plain API response looks right and fails to authenticate.

Runtime logs: `curl -X POST -H "Authorization: aivenv1 $AIVEN_API_TOKEN" -H 'Content-Type: application/json'
-d '{"log_type":"application-run"}' https://api.aiven.io/v1/project/$AIVEN_PROJECT/service/dock-app/logs`
(`application-build` for the build), or the Grafana dashboard's last row.

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

- **Dock's MCP endpoint runs on Runtime** inside dock-app (Streamable HTTP at `/mcp`, same process as
  the REST API, mandate as the bearer credential). Runtime ports are HTTP/1.1 behind Aiven's TLS edge,
  which is what Streamable HTTP and SSE need.
- **The outside buyer is an Aiven Managed Agent** ("Laakso Catering purchasing agent") connected to
  Dock's MCP endpoint as a custom integration. The demo's "agent gets the milk request" is then a chat
  message to an agent that Dock does not control, running on Aiven, buying through the open protocol;
  the gate still refuses it when it misbehaves. This is the strongest answer to "how does the MCP
  runtime come into play". Steps once `/mcp` exists:
  1. `POST …/managed-agents/environment/default/integration` with `{"catalog_type": "custom",
     "name": "dock", "custom_url": "https://<app-host>/mcp", "credentials": {"token": "<mandate JWS>"},
     "read_only": false}` (check the exact `catalog_type` for custom servers in the Console first: the
     catalog lists only named ones); the response lists the tools Dock exposes.
  2. `POST …/managed-agents/agent` with `name`, `model`, `system_instructions`, `tool_ids` from step 1.
  3. `POST …/agent/{id}/session`, then `POST …/session/{sid}/message` with the request text.
  Not done tonight: there is no `/mcp` endpoint in the app yet, and the cost of agent runs is unpublished.
- **An ops agent with Aiven MCP (Read-only role)** on a schedule: "summarise the last hour of gate
  refusals from `dock-events` and any service not RUNNING". Cheap to add from the Console once the
  topics carry data.
- **The team's coding agents use Aiven MCP** (`claude mcp add --transport http aiven
  https://mcp.aiven.live/mcp`) to inspect topics, slow queries and logs while building.

## Hosting on Aiven Runtime

**Proven tonight.** dock-app builds `web/Dockerfile` from branch `claude/aiven-infra` and serves the
current app at `https://<random-name>.eur-1.aiven.app` (Let's Encrypt certificate, HTTP/2 at the edge,
TLS terminated by Aiven, plain HTTP to the container on 8080). About 3 minutes from create to serving
(clone, build, image scan, start); Next.js starts in 1.8 s.
Smoke test from a laptop: `GET /` and `GET /api/v1` return 200, and `pnpm demo --url <app-url>` runs
the milk order over HTTPS up to the approval step (request → lookup → quote → gate decision
`needs_human_approval`); in the misbehaviour run, attempts 1 to 6 are refused by their named rules
and 7 to 13 come back as HTTP 500 because of the first bug below.

Public HTTPS for phones and passkeys: **yes**. The origin is HTTPS with a valid public certificate, so
WebAuthn works with the app host name as the RP ID. Keep that host stable: recreating dock-app gives a
new random name and orphans registered passkeys. A custom domain (subdomain + CNAME) is supported and
removes that risk. For push to phones use SSE, not WebSockets (Runtime documents HTTP only; WebSocket
upgrades are not mentioned).

How it is wired (all through the API, no Console clicks):

- **Source**: the repo is private, so Runtime clones it over SSH with a read-only deploy key
  (`application.source.repository_url = git@github.com:Nafay-0/junction-2026.git`,
  `deployment_key`). The Console alternative is the Aiven GitHub App (org admin, browser), which also
  allows pinning a commit. `repository_url` may also be a public `docker.io/...` image.
- **Build**: `build_path = web`, `containerfile_path = web/Dockerfile`.
- **Credentials**: `application_service_credential` integrations inject `DATABASE_URL`,
  `OPENSEARCH_URL`, `VALKEY_URL` and `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_SECURITY_PROTOCOL`,
  `KAFKA_ACCESS_KEY`, `KAFKA_ACCESS_CERT`, `KAFKA_CA_CERT` (real newlines). This works even from the
  free services, unlike every other integration type. node-postgres needs `uselibpqcompat=true` added
  to `DATABASE_URL` (Aiven's Runtime docs do the same).
- **Deploys are not automatic on push.** Redeploy the branch head with
  `curl -X POST -H "Authorization: aivenv1 $AIVEN_API_TOKEN" https://api.aiven.io/v1/project/$AIVEN_PROJECT/service/dock-app/application/redeploy`.
  Switch to `main` after merging with `PUT …/service/dock-app` and
  `{"user_config":{"application":{"source":{"branch":"main"}}}}` (changing the branch redeploys).
- **Before the public demo** set `DOCK_WHOLESALER_JWK` and `DOCK_DEMO_ORG_JWK` as `secret` env vars
  (`user_config.application.environment_variables`; a PUT replaces the whole list). Without them the
  app runs keyless, which `web/.env.example` says is not for a public deployment.
- One instance, restart policy on-failure. Idle memory is about 300 MB (60 % of the first 512 MB plan),
  hence the move to 1 GB. The in-memory store is lost on every redeploy until the PostgreSQL adapters land.

Two app bugs found by the smoke test (not fixed here; the files are outside this branch's area):

- **Every API error becomes a 500 once `/` has been rendered first.** The status page creates the
  `globalThis` runtime from the page's module graph; route handlers then throw a `DockError` from a
  different copy of the class, `err instanceof DockError` in `src/server/http.ts` is false, and the
  401/422 turns into `internal_error`. Reproduced locally with `next start`: request `/`, then any bad
  request. On Aiven it hits every time, since `/` is the first page anyone opens. Fix: match on a brand
  (`err.name === "DockError"` plus fields, or a `Symbol.for` brand on the class) instead of `instanceof`.
- `pnpm demo --url` crashes at the approval step against a production build: `/api/v1/dev/outbox`
  returns 404 by design and `scripts/demo.ts:99` reads `.body.messages` without checking.

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

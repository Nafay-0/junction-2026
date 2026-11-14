# Dependency failures (`tests-live/deps`)

Makes one dependency fail at a time against local Dock production servers that the runner starts itself from the
existing `.next` build, and records for each failure mode:

- what the **buyer** sees: the kitchen console's back end (`/ui-api/kitchens/<k>/call`, the same calls the page makes),
  the REST agent API, and for the partner also an MCP agent (stock `@modelcontextprotocol/client`);
- what the **approver** sees: the list behind `/approver`, the page `/approve/<id>`, its data, and a passkey sign-off
  (software authenticator, the same assertion a phone makes);
- whether **refusals still refuse**: an edited quote price, order lines that differ from the quote, a reused quote, an
  over-limit order committing without a person, an agent approving its own order;
- whether anything is **lost or duplicated** once the dependency is back (ledger per order, each order fetched by id,
  ledger verification, for PostgreSQL also a restart on the same schema, for Kafka the test topic read back);
- **recovery**: seconds from the dependency returning to the first good answer that needs it.

```bash
cd web
pnpm exec tsx tests-live/deps/run.ts --only model,partner                                   # no secrets, no network: CI-safe
pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts --only pg,valkey,kafka,opensearch  # Aiven (needs web/.env.local)
pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts                                  # everything, about 25 min
```

It prints a table and writes `tests-live/results/deps-<time>.json` (rows with evidence); server logs go to
`tests-live/results/logs/`. Exit code 1 when a refusal did not hold or an order was lost or duplicated. Both
`tests-live/results/` and its logs should be git-ignored.

Ports: app servers 4630-4633 (at most two at once), fakes 4690-4694. The runner refuses to start a server on a port
that is in use, and kills only the process groups it started (also on Ctrl-C).

A second engineer on the same machine moves the Aiven scenarios out of the way: `DEPS_APP_PORT` (app server),
`DEPS_PROXY_PORT` (the fault proxy listens there, and the preload sends the app's connections to the service's
host:port to it, instead of listening on the service's own port) and `DEPS_PG_SCHEMA` (`dock_testinfra` or
`dock_limits`, nothing else; created by the app, dropped at the end only if this run created it):

```bash
DEPS_APP_PORT=4730 DEPS_PROXY_PORT=4731 DEPS_PG_SCHEMA=dock_limits pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts --only pg
```

## Files

| File | What |
|---|---|
| `run.ts` | the runner, `--only model,partner,pg,valkey,kafka,opensearch` |
| `fake-model.ts` | OpenAI-compatible `/v1/chat/completions` (non-streaming and SSE), structured output that fits the request's JSON schema; modes ok, slow, hang, e500, r429 (Retry-After), garbage, badjson, reset |
| `fake-partner.ts` | the partner's `/api/price`, `/api/availability`, `/api/ping`, adapted from the QA branch's `qa/bin/fake-partner.ts`, control on its own port; modes ok, slow, hang, r429, e503, refused (stops listening), reset, garbage, flap (down/up every N s) |
| `fault-proxy.ts` | TCP proxy in front of one Aiven service; modes forward, refuse, reset, blackhole (a partition: held, not dropped) |
| `dns-preload.cjs` | `NODE_OPTIONS=--require` for the app: maps the one service's host name to 127.0.0.1 (TLS keeps the real name and certificate check) and drops inserts into `telemetry.events` |
| `lib/server.ts` | starts `pnpm exec next start` with a closed environment (see Safety) |
| `lib/http.ts`, `lib/flow.ts`, `lib/cycle.ts`, `lib/mcp.ts` | buyer, approver and agent flows over HTTP; refusal checks; order audit |
| `scenarios/model.ts`, `scenarios/partner.ts`, `scenarios/aiven.ts` | the scenarios |

## What each scenario does

**model**: every model setting (`DOCK_INTERPRET_MODEL`, `DOCK_ASSISTANT_MODEL`, `DOCK_MEMORY_MODEL`, `DOCK_SCAN_MODEL`,
`DOCK_MENU_MODEL`, `DOCK_MENU_PICK_MODEL`, `DOCK_AGENT_MODEL`) is `compat:fake` with `OPENAI_COMPATIBLE_BASE_URL` on the fake.
Per mode: free text over REST (`POST /api/v1/agent/interpret`) and through the console, the kitchen assistant, the
memory writer, the menu planner (ok and 500 only), then the whole order through the form while the model is still
failing, then recovery. Then Dock's own caps: `DOCK_LLM_DAILY_CALLS=3` reached by failed provider calls,
`DOCK_LLM_DAILY_USD=0.02`, and the per-session free-text allowance (30 an hour) used up by failed calls. Seed catalogue.

**partner**: the real catalogue index (`web/.data/valio/catalog-index.json.gz`) with `VALIO_API_BASE` on the fake (never the
real partner). Per mode: console, REST and MCP buyers at once, recovery, then a full order with sign-off. Then: options
shown, partner down, the buyer takes an option (quote) and orders a quote fixed before the outage, the approver signs
while the partner is down; and five buyers ordering while the partner flaps every 3 s, retrying like a person, audited.
Each probe group uses a new delivery date, because live answers are cached per product and date.

**pg**: `DOCK_STORE=postgres DOCK_PG_SCHEMA=dock_testinfra DOCK_PG_POOL_MAX=2`, seed catalogue. Outages refuse, blackhole and
reset while a visitor joins, orders, and signs an order that was waiting from before; then a restart on the same schema
compares the ledger and orders before and after.
**valkey**: `DOCK_CACHE=valkey DOCK_BUS=memory`, seed catalogue. **kafka**: `DOCK_ACTIONS=kafka DOCK_KAFKA_SINK=0
DOCK_ACTIONS_TOPIC=dock.actions.testinfra`; the producer is watched through `/api/health` and the topic is read back with
a consumer group of our own. **opensearch**: `DOCK_SEARCH=opensearch` on the real catalogue with the fake partner.

## Safety

- **No secrets reach a model/partner run.** `lib/server.ts` sets `__NEXT_PROCESSED_ENV=true`, so Next does not read
  `web/.env.local` at all, and sets every variable name Dock knows (from `.env.example` and the source) to "" unless
  the scenario sets it. Model and partner scenarios pass no secret; `/api/health` of those servers shows every
  service "not configured". Radar polling and voice are off. Model spend is zero; the partner is never called.
- **Aiven runs** pass only the variables of the service under test (Kafka also gets `DATABASE_URL`, which the
  Kafka adapter requires), read from the runner's environment. Nothing prints host names, ports or credentials; the
  server log is scrubbed of every passed value.
- **PostgreSQL**: schema `dock_testinfra` only; the app creates it on start (`migrate()` in
  `src/server/aiven/pg/pool.ts`), the runner drops it at the end only if it did not exist before the run. Pool of 2,
  one server on PostgreSQL at a time. `dock_prod` and `dock` are never named. Never run `pnpm aiven:migrate --reset`
  against anything but `dock_testinfra`.
- **telemetry.events**: any process with a pool writes `metric.*` and `infra.check` rows there every 60 s
  (`src/server/aiven/index.ts` flushMetrics). From a test process those rows would put our injected outages on the
  production Grafana dashboard, so the preload drops them (`DEPS_DROP_TELEMETRY=1`; each drop is logged to
  `results/logs/preload-<service>.log`).
- **Kafka**: own topic `dock.actions.testinfra`, sink off, own consumer group `dock-deps-test-<time>`. The app creates the
  topic if missing (free plan: 5 topics); the runner deletes it at the end only if this run created it.
- **Valkey**: never `DOCK_BUS=valkey` (the channel `dock:v1:events` is shared with the live site's wall). Cache only,
  on the seed catalogue: keys are `dock:v1:offer:<date>:<seed id>`, which production (real catalogue, keys
  `dock:v1:live:...`) never reads. The live-lookup allowance keys are namespaced by the schema
  (`dock:v1:allowance:dock_testinfra:...`). Valkey is NOT tested with the real catalogue, because the fake partner's
  prices would land in `dock:v1:live:<date>:<real id>`, which production reads.
- **OpenSearch**: read-only searches of the existing index.

## Limits

- The browser is not driven; "buyer sees" for the console is the reply of the console's own back end and the mapping in
  `src/app/_client/interpret.ts` / `k/[kitchen]/console.tsx` (replicated in `lib/http.ts` `consoleInterpretView`).
- Voice (Gemini Live) and photo scanning are not exercised.
- The fault proxy covers the first bootstrap address only; a Kafka cluster that advertises other broker names would be
  reached directly (the runner notes the count).

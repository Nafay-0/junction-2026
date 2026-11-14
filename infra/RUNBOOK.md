# AimoPilot weekend runbook

Live site: **https://jolly-wondrous-bunny.eur-1.aiven.app** (Aiven Runtime app `dock-app`). Everything below
runs from the repository root on a laptop with the shared `web/.env.local`. Background: `infra/aiven.md`.

## Is it up?

```bash
curl -s https://jolly-wondrous-bunny.eur-1.aiven.app/api/health | python3 -m json.tool
node infra/aiven-deploy.mjs --smoke-only        # about 30 s, prints PASS or FAIL
```

`/api/health` shows the live commit, the catalogue (expect `valio`, 17,546 products), each backing service,
the data plane (`dataPlane.switches`, each service `reachable`, `ledger.diverged` must be null), and today's
use of the demo caps (`demoLimits`).

## Deploy

```bash
node infra/aiven-deploy.mjs                     # origin/main
node infra/aiven-deploy.mjs origin/claude/deploy  # or any branch, tag or commit
```

Takes about 5 minutes (build about 4, then start) and ends with the smoke test. The site keeps serving the
old version until the new one is up. Passkeys and data survive (they are in PostgreSQL schema `dock_prod`).

## Roll back to the previous commit

```bash
node infra/aiven-deploy.mjs --rollback          # the commit that was live before the current one
node infra/aiven-deploy.mjs <sha>               # or any commit you name
```

Each deploy commit on branch `deploy/aiven` records the commit that was live before it.

## Restart without changing anything

```bash
node infra/aiven-deploy.mjs --restart           # same commit, new container, about 5 minutes, then smoke
```

Runtime has no plain restart; this rebuilds the same commit. Forgotten by a restart: operations-desk sign-ins
(enter `/ops` again), connector revocations and per-connector limits (a revoked demo kitchen address works
again; a reissued one goes back to the configured address), rate-limit counters and today's cap counters.

## Reset demo data between rehearsals (keeps visitors' passkeys)

```bash
cd web
DOCK_PG_SCHEMA=dock_prod pnpm aiven:reset-demo           # dry run: what would be cleared
DOCK_PG_SCHEMA=dock_prod pnpm aiven:reset-demo --yes     # clear
cd .. && node infra/aiven-deploy.mjs --restart           # required right after
```

Clears orders, requests, intakes, kitchen memory (Kaari's history is re-seeded at start), used quotes and the
ledger. Keeps approvers, passkeys, sessions and visitor kitchens, so a visitor who joined earlier can still sign.
Why it matters: an order, even one still waiting for sign-off, counts against a kitchen's weekly budget for
seven days. The built-in demo kitchens (Laakso, Kaari and their menu agents) share one weekly budget per kitchen of
EUR 150,000 (`DEMO_WEEKLY_BUDGET_CENTS` in `web/src/server/dev-fixtures.ts`): about 40 runs of the 1,000-litre
example and 40 menu orders, a full day of demonstrations, so a reset is needed between demo days, not between runs.
Their per-order limits stay low (Laakso EUR 1,000, Kaari EUR 100), so the 1,000-litre order still goes to a person
for sign-off. Visitor kitchens are new organisations with their own EUR 10,000 week. A local `pnpm start` keeps
everything in memory: restarting it is the reset. Between the reset and the restart the site
refuses ledger writes (health shows the ledger as diverged): do it only when nobody is on stage.
Wipe everything instead (passkeys too): `DOCK_PG_SCHEMA=dock_prod pnpm aiven:migrate --reset --yes`, then restart.

## Switch one adapter off

```bash
DOCK_DEPLOY_SEARCH=in-process node infra/aiven-deploy.mjs --config-only   # OpenSearch -> in-process search
DOCK_DEPLOY_ACTIONS=postgres  node infra/aiven-deploy.mjs --config-only   # Kafka -> write telemetry straight to PG
DOCK_DEPLOY_ACTIONS=off       ...                                        # no action stream at all
DOCK_DEPLOY_CACHE=memory      ...                                        # Valkey live cache -> in process
DOCK_DEPLOY_BUS=memory        ...                                        # Valkey pub/sub -> in process (one process is fine)
DOCK_DEPLOY_LLM=off           ...                                        # no model calls at all
```

`--config-only` restarts the app with the new settings (about 5 minutes). The setting lasts until the next
deploy run without the variable, so keep the variable on every later deploy command until the service is fine.
Do not switch the store (`DOCK_DEPLOY_STORE=memory`) except as a last resort: every order and passkey is then
lost on the next restart.

## Operations desk

`/ops` needs `DOCK_OPS_PASSCODE` (in `web/.env.local`; read it there, do not paste it in chats). The same
passcode protects the one-time approver enrolment for the built-in demo kitchens once that lands from the fix
branch. Connector management (reissue, revoke at `/ui-api/connect/<kitchen>`) takes `DOCK_CONNECTOR_SECRET`
as a bearer token.

## The site is slow

1. `/api/health`: a service with `reachable: false` or `ms` in the thousands. Free-plan services are powered
   off when idle; power one on in the Aiven Console (it takes minutes), or switch its adapter off (above).
2. `demoLimits`: at the cap, model and partner calls are refused with 429 "Demo limit reached" (resets at
   midnight UTC). Raise with `DOCK_DEPLOY_LLM_DAILY_USD=10 node infra/aiven-deploy.mjs --config-only`.
3. Runtime logs: `curl -s -X POST -H "Authorization: aivenv1 $AIVEN_API_TOKEN" -H 'Content-Type: application/json'
   -d '{"log_type":"application-run"}' https://api.aiven.io/v1/project/$AIVEN_PROJECT/service/dock-app/logs`
   (lines are JSON; look for `level":"error"` and `catalog-index`). Grafana's "AimoPilot overview" has the same.
4. The partner API (`junction26.valioaimo.fi`) slow or down: live lookups time out with a named refusal; the
   search still works.
5. PostgreSQL has 20 connections in total: the app holds up to 4, Grafana 3. Close stray `psql` sessions.

## Never during a live demo

- Deploy, restart, `--config-only`, reset or migrate (each restarts the app for about 5 minutes or breaks the
  ledger until a restart).
- Delete or recreate `dock-app` (a new host name orphans every passkey and every QR code printed).
- Run `pnpm aiven:migrate --reset`, or point a laptop at schema `dock_prod` (`DOCK_PG_SCHEMA=dock_prod pnpm dev`):
  a second process writing the same ledger makes the live one stop persisting it.
- Revoke or reissue the demo kitchen's connector address while the assistant demo is on.
- Change `DOCK_WHOLESALER_JWK`, `DOCK_DEMO_ORG_JWK`, `DOCK_CONNECTOR_SECRET`, `DOCK_OPS_PASSCODE` or
  `DOCK_ACCOUNT_KEY_SECRET` (it seals every kitchen's key in the database; a new value locks them all).
- Merge or push to branch `deploy/aiven` by hand.

## Release checklist (before each presentation)

Full details and the test map: `web/e2e/README.md`; open defects: the `test.fail` tests in `web/e2e/` and the test-infra report. All local runs use their
own hermetic servers (seed catalogue, no model, no secrets) and never touch the deployment.

**On the commit you are about to deploy** (from `web/`, about 10 minutes):

```bash
git fetch origin && git checkout origin/main
pnpm install --frozen-lockfile
pnpm test:predeploy        # typecheck, unit, build, pnpm demo, QA harness, sign-off + order lane on Chromium and WebKit phones
```

Every line must say PASS. If one fails, read `web/test-results/run-<step>.log` and do not deploy that commit. The
night before (or when a large change lands), run `pnpm test:full` instead (about 45 minutes; every browser and
size, accessibility, visual comparison, failure scenarios), or check the latest **Demo suite** run on CRACI
(`.github/workflows/demo-suite.yml`, on every push to main and every three hours).

**Deploy, then check the live site read-only** (no join, no order; one live price lookup):

```bash
node infra/aiven-deploy.mjs                     # ends with its own smoke test
cd web && E2E_LIVE_URL=https://jolly-wondrous-bunny.eur-1.aiven.app pnpm exec playwright test --project=live
```

Expect 5 passed (1 skipped): health ok on the `valio` catalogue with the ledger not diverged, the wall with its QR
code and no script errors, `/join` served, the shop's sign-in door with the stage kitchens private, the operations
desk asking for the passcode. Add `E2E_LIVE_SIGNIN=1` to also sign in to the first public test account and open one
product page with a live price (a session row and one partner lookup, nothing else).

**Then, with two real phones on the venue Wi-Fi (5 minutes)**: the checklist in `web/e2e/README.md`, "Five-minute
manual check": scan, passkey, the request opens by itself, lock and unlock, approve, signed order on the wall,
decline on the second phone, the store's lane on a phone, layout and language buttons, the call screen if voice is
shown. If the request does not open by itself on a phone within 10 seconds, the venue network is blocking the
live stream: tell the presenter to have visitors reload and tap the request under "Waiting for you".

**Limits to keep in mind on stage** (measured on a local build with the public limits on,
`web/e2e/room/crowd.spec.ts`, `E2E_CROWD_MAX=20,40,60`; results in `web/test-results/crowd-<N>.json`):

- A room, not a table: the per-address limits (`web/src/proxy.ts`) hold 60 visitors who scan within the same minute
  behind one venue address, and behind two. Measured 14 Nov (Chromium, 60 phone contexts on one laptop):

  | Visitors at once | Before: completed (refused) | After: completed, 429s | After: join / sign-off, median |
  |---|---|---|---|
  | 20, one address | 12 (5 `join`, 3 `demo-order`) | 20, none | 3.5 s / 7.1 s |
  | 40, one address | 12 (25 `join`, 3 `demo-order`) | 40, none | 1.2 s / 5.3 s |
  | 60, one address | 12 (48 `join`) | 60, none | 16 s / 19 s (laptop at load 30+: the browsers, not the server) |
  | 60, two addresses | - | 60, none | 2.7 s / 6.1 s |

  The same 60 over HTTP with no browser (`pnpm exec tsx tests-live/crowd-http.ts --url <limits-on server>`): join
  7 ms, all 60 tapping "ask my agent" in the same second 2.2 s each (4.5 s at most), sign-off path 5.7 s median.
  A visitor sends at most: join 1, join-verify 1, demo-order 1, events 2, page 7, any 32 in two minutes.
- What still bounds a crowd or an abuser regardless of address: 6 "ask my agent" a minute per phone and per visitor
  kitchen, 30 thread turns a minute per kitchen, 600 console calls a minute per kitchen, at most 200 visitor
  kitchens at once (`DOCK_SANDBOX_MAX`), and the daily caps (`demoLimits` in `/api/health`; voice calls per hour
  and day). A bigger room: raise one rule with `DOCK_LIMIT_<RULE>` (below) on the deploy, never during a demo.
- Every per-minute rule is an environment variable, empty = the default:

  | Variable | Default | Counts |
  |---|---|---|
  | `DOCK_LIMIT_ANY` | 6000 | every request, per address |
  | `DOCK_LIMIT_PAGE` | 1500 | page loads, per address |
  | `DOCK_LIMIT_JOIN` | 240 | the join passkey prompt (`POST /api/v1/join`), per address |
  | `DOCK_LIMIT_JOIN_VERIFY` | 150 | a kitchen created (`POST /api/v1/join/verify`), per address |
  | `DOCK_LIMIT_DEMO_ORDER` | 150 | "ask my agent", per address |
  | `DOCK_LIMIT_DEMO_ORDER_KITCHEN` / `_SESSION` | 6 / 6 | "ask my agent", per visitor kitchen / per approver phone |
  | `DOCK_LIMIT_EVENTS` | 480 | live streams opened (events, kitchen thread), per address |
  | `DOCK_LIMIT_CONSOLE_CALL` / `_KITCHEN` | 3000 / 600 | the store's console calls, per address / per kitchen |
  | `DOCK_LIMIT_THREAD` / `_KITCHEN` | 300 / 30 | thread turns and resets (the composer), per address / per kitchen |
  | `DOCK_LIMIT_AGENT_WRITE` | 600 | outside agents' and MCP writes, per address |
  | `DOCK_LIMIT_ACCOUNT` | 300 | account sign-in, sign-up, mandate, devices, per address |
  | `DOCK_LIMIT_ASSISTANT` / `_KITCHEN` | 150 / 60 | store assistant questions |
  | `DOCK_LIMIT_CATALOG_LIVE` | 240 | live price checks from product pages, per address |
  | `DOCK_LIMIT_KITCHEN_WRITE` / `_KITCHEN` | 360 / 120 | basket, memory, plan quote/order, answer page |
  | `DOCK_LIMIT_VOICE_CALL` / `DOCK_LIMIT_VOICE_TOOL` | 30 / 300 | voice calls started / their tool calls, per address |
  | `DOCK_LIMIT_INTERPRET`, `DOCK_LIMIT_OPS_ENTER`, `DOCK_LIMIT_MENU_PLAN` / `_KITCHEN` | 20, 10, 40 / 60 | unchanged |
  | `DOCK_LIMIT_SIGNIN_FAIL_ACCOUNT` / `_ADDRESS` | 8 / 200 per 15 min | failed sign-ins (hold with `DOCK_RATE_LIMITS=off` too) |
  | `DOCK_LIMIT_SIGNUP_ADDRESS` | 120 per hour | account sign-ups, per address |
- The database away (PostgreSQL refused, reset or partitioned): every screen says "AimoPilot can't save / read
  its records right now" and tries again by itself; API calls answer 503 `store_unavailable` within 6 s
  (`DOCK_PG_CONNECT_TIMEOUT_MS` 5000, `DOCK_PG_QUERY_TIMEOUT_MS` 6000) and work again within a second of it coming
  back, with nothing lost or doubled (`pnpm exec tsx --env-file=.env.local tests-live/deps/run.ts --only pg`).
- Order pages: five `/k/<kitchen>/order` pages watching waiting orders from one address got no 429 in 75 s
  (QA's finding of 429s at two pages no longer reproduces on this build).
- `demoLimits` in `/api/health`: at the model cap, free text and the assistant stop until midnight UTC with no
  offline fallback; raise the cap before the session rather than during it.

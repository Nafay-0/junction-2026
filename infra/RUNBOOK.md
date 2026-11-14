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

Usually takes about 5 minutes (build about 4, then start) and ends with the smoke test; on Sat 14 Nov one build
took over 15 minutes, so the script now waits up to 30. The old version serves until the new one starts, and
then the site does not answer for about a minute while it switches: never deploy while someone is being shown it. Passkeys and data survive (they are in PostgreSQL schema `dock_prod`).

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

# Aiven

**The judges' brief already exists: [`infra/AIVEN-JUDGES.md`](../../../infra/AIVEN-JUDGES.md).** Give Aiven's judges
that page. Background and costs: [`infra/aiven.md`](../../../infra/aiven.md); operations: [`infra/RUNBOOK.md`](../../../infra/RUNBOOK.md).

## What Aiven does in the product, in plain words

Eight services, one job each, as `/ops/platform` shows them:

| Service | Job |
|---|---|
| Runtime | Hosts AimoPilot: the gate, its MCP door and REST API, the portals. The public address `aimopilot.zeroanomaly.tech` is a custom domain in front of the app's own host |
| PostgreSQL | Orders, approvals, the hash-chained ledger, kitchen memory (pgvector), telemetry; the agent scorecard is SQL over it; the Time machine's history (schema `dock_prod_history`) |
| Kafka | Every agent action, gate decision, search and conversation turn, in order (`dock.actions`) |
| Valkey | Live-price cache, each agent's lookup budget, the event bus |
| OpenSearch | Product search over 17,546 products in three languages; the agent's recall (keyword lists and vectors), asked first on the hosted site; the audit trail in words |
| Grafana | The dashboard and its alert rules |
| Managed Agents | An outside buyer that AimoPilot does not run, ordering through the MCP door |
| Aiven MCP server | The operations copilot's read-only view of service state, logs and metrics |

## Where to see it

`https://aimopilot.zeroanomaly.tech/ops/platform`, no passcode needed to look. Tabs: **The platform**, **Send in an
Aiven agent**, **Ask the platform**, **Observe**, **The stream**. Visitors may send in the Aiven agent, ask the
platform and time the search backends, each capped per address and per day (`web/src/server/ops/try-caps.ts`).
Also `/ops/agents` (scorecard, audit search on OpenSearch) and `/ops/time-machine` (history on PostgreSQL). Health:
`/api/health`.

## Checked for this page (Sunday 15 Nov, about 01:00)

| Claim | Check | Result |
|---|---|---|
| The app and its four data services are up and in use | `GET /api/health` on the live site | True: PostgreSQL, Valkey, OpenSearch (17,546 products in `dock-products`) and Kafka (2 brokers) reachable; store `postgres`, actions `kafka`, cache and bus `valkey`, search `opensearch`; public URL and passkey RP ID `aimopilot.zeroanomaly.tech` |
| Recall asks OpenSearch first on the hosted site | `/api/health` `dataPlane.recall.order` | True: `opensearch`, then `memory` |
| The Time machine's history is on PostgreSQL | `GET /ops-api/time-machine` (viewer) | True: "History kept in Aiven PostgreSQL", `dock-pg, schema dock_prod_history` |
| The eight services and their jobs | `web/src/server/aiven/showcase/platform.ts` (`JOBS`) | Matches the table above |
| A Managed Agent buyer ends at sign-off, committed, or refused `order_matches_quote` | `infra/aiven.md` ("all three presets ended as expected") | Documented by the team; not re-run for this page. When Aiven refuses a run, the page plays a labelled recording |
| Copilot answers are computed from rows, never written by a model | `web/src/server/aiven/showcase/copilot.test.ts` | True in the code: no model call in `showcase/` |
| Read-only database user, 3 s statement timeout, 2 connections | `infra/copilot.sql`, `infra/aiven.md` | Documented; set up by `infra/copilot-user.mjs` |
| Run rate $0.086/hour, about $3.80 by Sunday evening of the $50 credit | `infra/aiven.md` | Consistent; not re-read from the API for this page |
| Grafana alert rules | `infra/grafana/provision.mjs` | Provisioned into Grafana only when its API allows; the app checks the same thresholds itself every 30 s. Whether Grafana holds them now: not verified |

## What to correct or say carefully

- **"Every part of AimoPilot runs on Aiven."** Say instead: "Everything that keeps state or serves requests runs on
  Aiven." The language models (Anthropic, OpenAI, Google, Featherless) and Valio Aimo's price API run elsewhere.
- **A euro total for the Managed Agent's order.** Prices are live; say "over the €1,000 it may spend alone".
- **Crash-test scores on the Observe tab** appear only after an export to the production database. Check the panel
  before pointing at it.
- **No latency or speed figures** in anything public.
- **Free-plan limits shaped the design**, and that is worth saying: no service integrations on free plans, so
  Grafana reads PostgreSQL directly and the Aiven API with a read-only token; no Kafka REST, so the server reads the
  topic itself (`infra/aiven.md`, "Observability").

## Honest strength of the use

Strong. Aiven is not a logo here: it is where the system of record, the event stream, the cache, the search and the
history live, with fallbacks per service (`infra/RUNBOOK.md`, "Switch one adapter off"). The Managed Agent and the
MCP copilot show the door is open; the core use is the data plane.

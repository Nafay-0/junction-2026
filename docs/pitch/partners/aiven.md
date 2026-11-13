# Aiven

> **Name: the team must choose.** Replace `{{NAME}}` ("Dock" in the code, "AimoPilot" in the draft submission).

**The judges' brief already exists: [`infra/AIVEN-JUDGES.md`](../../../infra/AIVEN-JUDGES.md).** Give Aiven's judges
that page. Background and costs: [`infra/aiven.md`](../../../infra/aiven.md); operations: [`infra/RUNBOOK.md`](../../../infra/RUNBOOK.md).

## What Aiven does in the product, in plain words

{{NAME}} runs on Aiven Runtime. Orders, sign-offs, passkeys, kitchen memory and the tamper-evident ledger are in Aiven
for PostgreSQL. Every agent action goes through Aiven for Apache Kafka. Live prices are cached in Aiven for Valkey.
Product search over 17,546 products runs on Aiven for OpenSearch. Grafana shows the numbers. An Aiven Managed Agent
plays an outside buyer that we do not run, and the operations copilot reads service state through Aiven's MCP
server with a read-only token.

## Where to see it

`https://jolly-wondrous-bunny.eur-1.aiven.app/ops/platform` (operations passcode needed), then the tabs **The
platform**, **Send in an Aiven agent**, **Ask the platform**, **Observe**, **The stream**. Health without a passcode:
`/api/health`.

## Checked for this page (Saturday 14 Nov, about 01:30)

| Claim in `AIVEN-JUDGES.md` | Check | Result |
|---|---|---|
| The app and its four data services are up and in use | `GET /api/health` on the live site | True: PostgreSQL, Valkey, OpenSearch (17,546 products in `dock-products`) and Kafka (2 brokers) reachable; store `postgres`, actions `kafka`, cache and bus `valkey`, search `opensearch` |
| A Managed Agent buyer ends at sign-off, committed, or refused `order_matches_quote` | `infra/aiven.md` ("Measured 13 Nov: … all three presets ended as expected") | Documented by the team; not re-run for this page. When Aiven refuses a run, the page plays a labelled recording |
| Copilot answers are computed from rows, never written by a model | `web/src/server/aiven/showcase/copilot.test.ts` ("computes the answer from the rows, and says 'does not say' when a query fails") | True in the code: no model call in `showcase/` |
| Read-only database user, 3 s statement timeout, 2 connections | `infra/copilot.sql`, `infra/aiven.md` | Documented; set up by `infra/copilot-user.mjs` |
| Run rate $0.086/hour, about $3.80 by Sunday evening of the $50 credit | `infra/aiven.md` ("Run rate: $0.0864/hour", "about $3.75") | Consistent |
| Restarts keep orders and passkeys | `infra/aiven.md` "Restart proof (14 Nov, on the live site)" | Documented with the scripts that ran it |

## What to correct or say carefully

- **"Every part of Dock runs on Aiven."** Say instead: "Everything that keeps state or serves requests runs on
  Aiven." The language models (Anthropic, OpenAI, Google) and Valio Aimo's price API run elsewhere.
- **"€1,400"** for the Managed Agent's order is from one recorded run (1,000 cartons at €1.40). Prices are live; say
  "over the €1,000 it may spend alone".
- **"crash-test scores" on the Observe tab** appear only after `pnpm crash:export` has written rows to the
  production database. The crash test is on `main` but was not deployed on Saturday 01:30. Check the panel before
  pointing at it.
- **Free-plan limits shaped the design**, and that is worth saying: no service integrations on free plans, so
  Grafana reads PostgreSQL directly and the Aiven API with a read-only token; no Kafka REST, so the server reads the
  topic itself (`infra/aiven.md`, "Observability").

## Honest strength of the use

Strong. Aiven is not a logo here: it is where the system of record, the event stream, the cache and the search live,
with fallbacks per service (`infra/RUNBOOK.md`, "Switch one adapter off"). The Managed Agent and the MCP copilot are
extras that show the door is open; the core use is the data plane.

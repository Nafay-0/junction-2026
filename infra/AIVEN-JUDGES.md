# AimoPilot on Aiven: a one-page brief for Aiven's judges

**AimoPilot** is an open loading dock for AI purchasing agents. Any company's buying agent can order food from a
wholesaler (Valio Aimo's challenge) through open standards, MCP among them. It carries a signed mandate that
says what it may buy. Plain code checks every order against that mandate, and a named person signs off anything
beyond it on their phone. Every part of AimoPilot runs on Aiven.

Open **https://jolly-wondrous-bunny.eur-1.aiven.app/ops/platform** (operations portal, then **Platform**).

## Three things to click

1. **Send in an Aiven agent.** Pick "Valio's own example" and press *Send it in*. A purchasing agent that runs
   on **Aiven Managed Agents** (its own model, in Aiven's environment, not ours) connects to AimoPilot's MCP endpoint
   on **Aiven Runtime**. Its tool calls come back on the page, and the gate's decisions appear live from **Kafka**
   while it works. About 30 to 60 seconds later it stops: 1,000 litres comes to €1,400, over the €1,000 it may
   spend alone, so the order waits for a named person's sign-off. The other two tasks show an order committed
   inside the mandate, and an agent told to pay less than the signed quote, which the gate refuses and names the
   rule (`order_matches_quote`). The agent's mandate is minted on our server for each run, is valid for 20 minutes,
   goes straight into Aiven's credential store, and is never shown.
2. **Ask the platform.** Press *Is anything unhealthy?* The answer comes from **Aiven's MCP server**
   (`aiven_service_list`, called with a read-only token) plus the app's own health probes in **PostgreSQL**. The call
   and the rows sit under the answer. Then try *How many orders were refused in the last hour and by which rule?*,
   or type `delete from telemetry.events` to see the write refused. Answers are computed from rows, never written
   by a model. A question the data cannot answer gets "The data does not say."
3. **The stream.** A live tail of the Kafka topic `dock.actions`, read by the server, with the consumer group's
   committed offsets and lag per partition. You can watch the gate produce events and the sink write them into
   PostgreSQL. In **Trace**, *Read from the stream* replays one request from Kafka in order, and each message's
   partition and offset sits beside its step.

## Which service does which job, and why

| Service | Job | Why this one |
|---|---|---|
| Aiven Runtime | Hosts AimoPilot: the gate, its MCP door, REST, the portals | The app sits next to its data, gets credentials injected, public HTTPS that Managed Agents can reach |
| PostgreSQL (free) | Orders, approvals, hash-chained ledger, kitchen memory (pgvector), telemetry | "Commit at a fixed price" is a transaction. Constraints and pgcrypto check the ledger's hash chain. Embeddings live next to their rows |
| Kafka (free) | Every agent action and gate decision, keyed by order | Ordered and replayable. The dashboard's table is just a consumer group |
| Valkey (free) | Live-price cache, per-agent lookup budget, event bus | `SET … EX` matches "this price is valid for N minutes". `INCR` is a budget |
| OpenSearch (free) | Search over 17,546 products in Finnish, Swedish and English | Narrows the choice in master data first, so the partner's price API is asked about a short list only |
| Grafana | The full dashboard (behind its login) | Free plans allow no metrics integration, so Grafana reads PostgreSQL as a read-only user and the Aiven API with a read-only token |
| Managed Agents (free tier) | An outside buyer that AimoPilot does not run | Shows the door is open, and the gate holds an agent that AimoPilot does not control |
| Aiven MCP server | The operations copilot's view of service state, logs and metrics | Read-only token and read-only tools. Nobody holds admin credentials to ask "is anything down?" |

The **Observe** tab shows the dashboard's numbers inside the portal. They come from the same table: orders,
sign-offs and how long they waited, refusals by rule, live-price calls the cache saved, products priced per request
(out of 17,546), model spend, service health, pipeline in and out, and crash-test scores. Each panel shows its SQL.

## Safety, briefly

- The copilot reads PostgreSQL as `dock_copilot`, a user that can `SELECT` one view and nothing else. Its sessions
  are read-only, statements stop after 3 s, and it holds at most 2 connections. The view withholds the steps that
  could quote a kitchen's private memory. The app also refuses writes, catalogues, comments and unlisted tables
  before a query is sent, caps answers at 200 rows, and scrubs secrets from everything it returns.
- Aiven's MCP server is allowed for the organisation. Its SQL tool needs a PG Editor permission that the read-only
  token does not have, and we chose not to grant it. So SQL takes the direct read-only path, and every card says
  which path answered.
- All Aiven tokens on the server are read-only project roles. The launcher's token can start sessions and rotate
  the agent's credential, but it cannot change services or plans.

## Money

$50 trial credit. Run rate **$0.086/hour** (Grafana startup-1 and the Runtime app; the four data services, Managed
Agents and the MCP server are free). That comes to about **$3.80** by Sunday evening. The Platform page reads the run
rate and the balance from the API.

**Considered and not used:** Aiven for Metrics (free plans cannot send it metrics), Kafka Connect (not on free
Kafka), Kafka REST (off on free Kafka, so the server reads the topic itself), ClickHouse (PostgreSQL is enough at
this volume), and embedded Grafana panels (they would weaken the dashboard's login).

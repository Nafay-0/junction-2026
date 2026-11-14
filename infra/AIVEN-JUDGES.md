# AimoPilot on Aiven: a one-page brief for Aiven's judges

**AimoPilot** is an open loading dock for AI purchasing agents. Any company's buying agent can order food from a
wholesaler (Valio Aimo's challenge) through open standards, MCP among them. It carries a signed mandate that
says what it may buy. Plain code checks every order against that mandate, and a named person signs off anything
beyond it on their phone. Every part of AimoPilot runs on Aiven.

Open **https://jolly-wondrous-bunny.eur-1.aiven.app/ops/platform** (operations portal, then **Platform**). No
passcode is needed to look: without one you are a viewer and every page reads, with the same data the staff see
(a kitchen's private memory named, never shown; mail addresses masked; the words of other people's own kitchens
replaced by "the buyer's words are shown to staff only"). Anything that acts, costs money or calls outside on
demand asks for the staff passcode, which the team at the table has: below, **1** and **2** need it; **3**, **4**
and **5** are open to look at (suspending an agent from 4 needs it).

## Five things to click

1. **Send in an Aiven agent** (staff: it launches an agent run on Aiven and spends model calls). Pick "Valio's own example" and press *Send it in*. A purchasing agent that runs
   on **Aiven Managed Agents** (its own model, in Aiven's environment, not ours) connects to AimoPilot's MCP endpoint
   on **Aiven Runtime**. Its tool calls come back on the page, and the gate's decisions appear live from **Kafka**
   while it works. About 30 to 60 seconds later it stops: 1,000 litres comes to €1,400, over the €1,000 it may
   spend alone, so the order waits for a named person's sign-off. The other two tasks show an order committed
   inside the mandate, and an agent told to pay less than the signed quote, which the gate refuses and names the
   rule (`order_matches_quote`). The agent's mandate is minted on our server for each run, is valid for 20 minutes,
   goes straight into Aiven's credential store, and is never shown.
2. **Ask the platform** (staff: each question runs SQL and calls Aiven's MCP server; open to all, a room would
   multiply both, so viewers see the questions and the page but not the button). Press *Is anything unhealthy?* The answer comes from **Aiven's MCP server**
   (`aiven_service_list`, called with a read-only token) plus the app's own health probes in **PostgreSQL**. The call
   and the rows sit under the answer. Then try *How many orders were refused in the last hour and by which rule?*,
   or type `delete from telemetry.events` to see the write refused. Answers are computed from rows, never written
   by a model. A question the data cannot answer gets "The data does not say."
3. **The stream.** A live tail of the Kafka topic `dock.actions`, read by the server, with the consumer group's
   committed offsets and lag per partition. You can watch the gate produce events and the sink write them into
   PostgreSQL. In **Trace**, *Read from the stream* replays one request from Kafka in order, and each message's
   partition and offset sits beside its step.
4. **Watch the agents.** In **Agents**, the scorecard gives every agent at the door one status with its reason in
   words: *performing*, *escalating* (and whether its mandate is simply too tight for what the kitchen asks, a
   suggestion rather than a fault), *failing* (with the rule it keeps hitting), or *quiet*. Its figures are SQL over
   the telemetry table in **PostgreSQL**, read as the read-only user, with the query beside them; the status is plain
   code over those figures and a thresholds table on the page. A failing agent gets a proposal (suspend it, open its
   last refused request in Trace) that a person carries out through the existing controls and that names who did
   it. Below it: every order waiting for a person, oldest first, why it needed one, and how long sign-offs take. Then
   search the audit trail in words ("refusals for allergens by outside agents today"): **OpenSearch** answers from
   the `dock-events` index (codes, counts and times only, no buyer text), with the same filters in SQL as the
   fallback. The copilot answers *Which agents are failing?*, *Which need a person most often?* and *What is waiting
   for sign-off?* from the same rows.

5. **The Time machine.** In **Time machine**, pick an order and slide the time: the rules in force then and now,
   who changed what in between, and the real gate run again on the order as of each moment, with the one rule that
   would now decide differently named. Each answer is one statement on **PostgreSQL** (`WHERE during @> t` over
   versions kept as time ranges), shown with its time under the page. An order's timeline links straight to it.

## Which service does which job, and why

| Service | Job | Why this one |
|---|---|---|
| Aiven Runtime | Hosts AimoPilot: the gate, its MCP door, REST, the portals | The app sits next to its data, gets credentials injected, public HTTPS that Managed Agents can reach |
| PostgreSQL (free) | Orders, approvals, hash-chained ledger, kitchen memory (pgvector), telemetry; the agent scorecard is SQL over it; the Time machine's history as ranges | "Commit at a fixed price" is a transaction. Constraints and pgcrypto check the ledger's hash chain. Embeddings live next to their rows. Every scorecard figure is a query staff can read. Every version of a rule the gate reads (mandate, kitchen rules, recall holds, suspensions, the week's spend) carries the `tstzrange` it was in force, an exclusion constraint forbids overlap, and "the rules as they stood" is `during @> t`: the Time machine replays any order against them, built from the ledger on first start |
| Kafka (free) | Every agent action, gate decision, product search and conversation turn, keyed by order | Ordered and replayable. The dashboard's table is just a consumer group, and its lag is one of the app's alerts |
| Valkey (free) | Live-price cache, per-agent lookup budget, event bus | `SET … EX` matches "this price is valid for N minutes". `INCR` is a budget |
| OpenSearch (free) | Search over 17,546 products in Finnish, Swedish and English: the store's keyword search, and a recall index for the agent's smart search (names in three languages plus one 768-dimension vector per product, HNSW); the audit trail (`dock-events`) | Narrows the choice in master data first, so the partner's price API is asked about a short list only. Keyword lists and nearest vectors come back in one `_msearch`; smart search uses them when this server's in-memory copy is not loaded yet (the first searches after a deploy) or fails, and one setting makes OpenSearch answer first. On 189 test requests both give the same answers (97 % right first) |
| Grafana | The full dashboard (behind its login), with an agents row (status, escalation rate, refusals by agent and rule, time to a decision, spend per order) and search and conversation panels | Free plans allow no metrics integration, so Grafana reads PostgreSQL as a read-only user and the Aiven API with a read-only token |
| Managed Agents (free tier) | An outside buyer that AimoPilot does not run | Shows the door is open, and the gate holds an agent that AimoPilot does not control |
| Aiven MCP server | The operations copilot's view of service state, logs and metrics | Read-only token and read-only tools. Nobody holds admin credentials to ask "is anything down?" |

Alerts are data: six thresholds (conversation turns over 20 s at the 90th percentile, any turn that failed, search
answered by its fallback more than 1 in 20 times, model spend over 80 % of the day's cap, a sign-off waiting over 30
minutes, Kafka lag) are checked by the app every 30 seconds; the Platform page says "all quiet" or what is breaching
and since when. No paid alerting service: `infra/grafana/provision.mjs` also provisions the same rules into Grafana
when its API allows it.

The **Observe** tab shows the dashboard's numbers inside the portal. They come from the same table: orders,
sign-offs and how long they waited, refusals by rule, live-price calls the cache saved, products priced per request
(out of 17,546), model spend, service health, pipeline in and out, crash-test scores, search by stage (embedding,
recall, judge; which backend answered; fallbacks; cost per 1,000 searches; "not sold") and the conversation (turn
time, failed turns, what each turn ended in, model calls per turn). Each panel shows its SQL.

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

**Tried and not relied on:** OpenSearch anomaly detection (in the 3.6 service at no extra cost): a detector on refusals
per agent validates, but our events are too sparse to train it ("too sparse for model training"), so the thresholds
above decide instead.

**Considered and not used:** Aiven for Metrics (free plans cannot send it metrics), Kafka Connect (not on free
Kafka), Kafka REST (off on free Kafka, so the server reads the topic itself), ClickHouse (PostgreSQL is enough at
this volume), and embedded Grafana panels (they would weaken the dashboard's login).

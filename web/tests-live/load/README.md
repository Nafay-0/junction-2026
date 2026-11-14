# Load, locally

How many orders a minute one Dock server takes through the gate, where it slows, its memory over a ten-minute soak,
whether the ledger still verifies afterwards, and how many order pages can watch a waiting order behind one address
before the public rate limits answer 429. Seed catalogue, model off, no shared service touched, no model spend.

Run everything from `web/`, after a production build exists in `.next` (these scripts never build).

```bash
# 1. Stepped load: a fresh server per step on 4652 (the harness starts and stops it), 1..64 concurrent buyers, 60 s each
pnpm exec tsx tests-live/load/load.ts --fresh-port 4652 --steps 1,2,4,8,16,32,64 --step-seconds 60

# 2. Growth: two buyers until 6,000 orders, throughput per 500 orders (how the gate slows as the store fills)
pnpm exec tsx tests-live/load/load.ts --fresh-port 4654 --growth 6000 --window 500

# 3. Soak: ten minutes open loop at 70 % of the knee from step 1 (or --rate N purchases/min)
pnpm exec tsx tests-live/load/soak.ts --fresh-port 4653 --knee-share 0.7 --minutes 10

# 4. Watchers: order pages polling like console.tsx, public limits ON, on a fresh server on 4651
pnpm exec tsx tests-live/load/watchers.ts --fresh-port 4651 --same 1,2,3 --distinct 3,4

# Your own server instead of --fresh-port (prints its node PID; stop it with kill <pid>):
tests-live/load/start-server.sh 4650            # limits off
tests-live/load/start-server.sh 4651 limits     # public limits on
pnpm exec tsx tests-live/load/load.ts --url http://localhost:4650 --pid <pid>

# The PostgreSQL store (DATABASE_URL from .env.local) on a schema of your own, 2 connections, no other Aiven adapter
# (STORE=postgres also works with --fresh-port; dock and dock_prod are refused). Drop the schema afterwards.
STORE=postgres PG_SCHEMA=dock_perf PG_POOL_MAX=2 tests-live/load/start-server.sh 4655
# From a laptop every query is a ~40 ms round trip to Aiven, so 5,000 orders take hours to place; fill the store
# by copying its own committed orders in SQL (recent, same organisations), then measure a window on top:
pnpm exec tsx --env-file=.env.local tests-live/load/pg-fill.ts --schema dock_perf --to 4750
pnpm exec tsx tests-live/load/load.ts --url http://localhost:4655 --pid <pid> --growth 250 --window 250

# Heap snapshots of the server (kill -USR2 <pid> writes one to $LOG_DIR):
NODE_EXTRA="--heapsnapshot-signal=SIGUSR2" pnpm exec tsx tests-live/load/soak.ts --fresh-port 4653 --rate 90

# One purchase of each kind, with the gate's reasons, to check the mix still gets the answers below:
pnpm exec tsx tests-live/load/probe.ts --url http://localhost:4650
```

Results go to `tests-live/results/load-<date>.json`, one section per script (`steps`, `growth`, `soak`, `watchers`);
`--out` and `--section` change where. Server logs go to `$LOG_DIR` (default the system temp dir).

## What a buyer does

`lib.ts runFlow`: the open interface as an outside agent uses it, `Authorization: Mandate <jws>` and `Dock-Agent-Id`
on every call: `POST /api/v1/requests` -> `POST /api/v1/availability` (short list of 1-2) -> `POST /api/v1/quotes`
-> `POST /api/v1/orders`. Buyers alternate between the two demo organisations (Laakso, Kaari), one agent id each,
mandates minted with the demo keys the server also reads from `.env.local` (only those two names are read).

| share | flow | expected answer |
|---|---|---|
| 75 % | 40-60 L of VA-1001, a need-by day of its own, mandate with limits that never bind | 201 committed |
| 10 % | Valio's example: 1,000 L, 600 L VA-1010 + 400 L AR-2010 substitute (€1,322), the demo kitchens' own limits | 202 waits for sign-off (`per_order_limit`, Laakso also `substitution_rule`) |
| 7.5 % | PK-4001 oat drink | 422 `forbidden_allergens` (Laakso), `category_allowed` (Kaari) |
| 7.5 % | mandate with a €1 weekly budget | 422 `weekly_budget` |

Repeated identical orders would trip `order_splitting` and `weekly_budget` on the demo mandates, so the "auto"
mandates carry limits that never bind; the refusals in the results are the two designed shares above.
The gate also runs the mistake check on REST orders (`orders.ts mistakeCheckOf`, `core/order-check.ts`): the same
family for the same day ordered within 48 h is a likely repeat, an amount 3x off the kitchen's usual is unusual, and
either sends the order to a person (`human_confirmation`). So each "auto" purchase asks for its own need-by day
(`lib.ts uniqueDay`) and 40-60 L, within 3x of both kitchens' usual (Kaari's history is about 100 L); with the old
5-60 L and no date, 668 of 901 "auto" purchases went to sign-off.

`start-server.sh` blanks every shared service and paid key from `.env.local` (`DATABASE_URL`, Valkey, OpenSearch,
Kafka, the partner key, model keys) and raises the live-lookup allowance, which on the seed catalogue is an in-memory
read (the defaults, 3,000 lookups a day for all agents together, would end a run within minutes). `/api/health`
then shows every service "not configured".

## Reading the output

- `decisionsPerMin`: orders the gate decided per minute (committed + sent to sign-off + refused); `committedPerMin` etc.
  split it. `asDesigned` counts orders whose answer matched the table; `unexpectedOutcomes` lists the rest.
- `latencyMs.<call>`: p50/p95/p99/max per call type, and `flow` for the four calls together.
- `errors`: transport failures, timeouts (30 s) and 5xx, by `call:status:code`. `other4xx`: any 4xx that is not
  the order decision itself (should be empty).
- `refusalsByRule`: the deciding rule of each refused order.
- `knee`: the last step before throughput rises less than 10 % over the step before, or a call's p95 passes 1 s.
- `ordersInStoreAfter`: orders the server holds after the step. Latency depends on it as much as on concurrency (below).
- soak `samples[]`: every 10 s RSS, CPU, `/api/health` and `/ui-api/wall` time, orders decided, purchases in flight.
  `memory.slopeMbPerMin` is a least-squares slope over the samples. `ledger.<org>`: the ledger read by the
  organisation's agent: `verification`, and every order placed present exactly once as a decision and once as its
  commit or sign-off request. `ordersLost`/`ordersDuplicated` sum those. `events`: what one public event-stream
  client received against what the orders imply.
- watchers `maxWatchersOneAddressWithout429`: how many console pages share one address before a 429.

The load generator runs on the same machine as the server and other agents' browser tests; every step records the
load average. Treat the numbers as one laptop's, not a capacity plan.

## Results after the fixes, 14 Nov 2026 (branch `claude/test-infra-perf`, 12-core laptop, load average 20-30 from other agents)

Same machine and mix, before (870108a) and after; `--growth` with 2 buyers, soak 10 min at 90 purchases/min.

| | in memory, before | in memory, after | PostgreSQL, before | PostgreSQL, after |
|---|---|---|---|---|
| orders/min at 250 stored | 1,049 | 3,335 | 55 | 109 |
| at 500 | 418 | 2,991 | 15.6 | 108 |
| at 1,250 | 43 | 1,781 | (not reached) | 106 |
| at 5,000 | (not reached) | 936 (1,170-1,930 at 4,000-4,800) | (not reached) | 106 |
| p95 quote / order at 250, ms | 90 / 90 | 21 / 19 | 1,719 / 1,919 | 425 / 706 |
| at 1,250 | 3,118 / 3,039 | 47 / 45 | | 441 / 730 |
| at 5,000 | | 123 / 80 (40-60 at 4,000-4,800) | | 433 / 729 |
| soak: decided, errors | 863, 38 (timeouts) | 901, 0 | 121, 781 | 901, 0 |
| soak RSS start -> end (peak), MB | 326 -> 652 (1,449) | 300 -> 212 (239) | 351 -> 542 (704) | 152 -> 64 (204) |
| RSS slope after 2 min, MB/min | +93 | +0.1 | +21.6 | +0.9 |
| wall request, start -> end | 10 ms -> 30 s (timeouts) | 62 ms -> 23 ms, 4 ms after | 353 ms -> 17 s | p50 286 ms (up to 1 s in the bursts), 93 ms after; 170 ms idle at 5,000 |
| ledger verified, lost, duplicated | yes, 0, 0 | yes, 0, 0 | read timed out (30 s) | yes, 0, 0 |

PostgreSQL from this laptop is bound by round trips (~40 ms each, 2 connections), not by the store: the after
numbers are flat from 250 to 5,000 orders (a quote is about 6 queries, an order about 14). The 1,250 and 5,000
PostgreSQL points are a 250-order window on a store filled by `pg-fill.ts`. At 90/min the PostgreSQL soak runs at
about 85 % of that capacity: quote/order p95 stayed at 440-480 / 760-800 ms for 8 minutes, then two 20 s bursts
in the last 90 s queued 6-7 purchases (order p95 about 5 s, no errors); the wall's ~280 ms is 4 round trips queued
behind the orders.

What grew, and what was linear in stored orders per request (before):
- every quote and order deep-copied every stored order 3-4 times (`InMemoryDockRepository.listOrders` from
  `expireStale`, `budgetUse`, `recentOrders`; on PostgreSQL each was a fetch of every order document);
- every order kept its organisation's same-day orders in its `order_splitting` details (quadratic memory);
- the wall copied the whole ledger and every order and re-hashed the chain on every 1.5 s poll, and the kitchen
  portal, ops views and the ledger route copied the whole ledger per request (ops overview also searched every
  order per request);
- bundled, iovalkey's 3.4 MB command table was kept once per server chunk, about 70 MB at start.

Now the store answers the gate's queries from indexes (in memory) or in SQL on stored columns (PostgreSQL), the
splitting check reads a count and a sum and names the newest 10, ledger entries are frozen and indexed and verified
incrementally, the wall reads only new entries and caches an idle poll. Heap snapshots at 180 and 810 orders of the
soak: what is retained grows by about 24 KB per order (the order itself about 12 KB, its 6 ledger entries about 12 KB)
plus the claim store filling to its 5,000 cap; nothing else grows. RSS stays flat because the GC reuses its slack;
a weekend of 10,000 orders is about 240 MB of heap in memory, half that on PostgreSQL (orders are not in memory).

## Results, 14 Nov 2026 (`main` f501f6d build, 12-core laptop, load average 5-21 from other agents)

- Fresh server, 60 s steps: about 590 orders decided a minute at 2 buyers (the knee: p95 quote 216 ms, order 204 ms),
  flat to 64 buyers (520-595/min) because one Node process is at 100 % CPU; p95 passes 1 s at 16 buyers.
- That figure is for a server that starts empty. Every quote and order deep-copies every stored order
  (`InMemoryDockRepository.listOrders`, `core/orders.ts:214`, called 3 times per quote and per order), and every order
  stores the list of the organisation's earlier same-day orders (`order_splitting` details, `core/policy.ts:381`), so the
  cost per order grows with the square of the store: 1,906/min at 250 orders, 493 at 500, 202 at 750, 108 at 1,000, 76 at 1,250.
- Ten-minute soak at 90/min: 901 orders, 0 errors, ledger verified, 0 lost, 0 duplicated; RSS 249 -> 1,133 MB (peak 1,500,
  +108 MB/min); `/api/health` and `/ui-api/wall` 20 ms at the start, 320 ms at the end (peak 2.2 s).
- At 70 % of the knee (414/min) the server falls behind after about 65 s (about 450 orders): calls time out at 30 s from
  minute 2. The ledger still verified, nothing lost or duplicated (52 orders were decided whose answer the client never got).
- Public event stream: one client got every `order_committed` and `approval_requested` (p95 delay 6 ms) but no
  `order_rejected`: a refusal at order time publishes no event (`core/orders.ts`, placeOrder's reject branch).
- Order pages behind one address (limits on): 1 works, 2 get 429 `console-call` within the minute. With an address each,
  3 work and 4 hit the per-kitchen `console-call-kitchen` limit.

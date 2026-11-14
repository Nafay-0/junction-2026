# The audit time machine on MariaDB

When a kitchen disputes an order three weeks later, the ledger already says *what happened*. The hard question is
*what was true when it happened*: the mandate's limit that morning, the kitchen's allergen rules, whether the product
was on a recall hold, whether the agent was suspended, how much of the week's budget was gone. Those rules keep
changing. This keeps every version of them in MariaDB's system-versioned tables, so both sides can see the rules
exactly as they stood at any second, and puts a past order through the real gate again, as of then and as of now.

PostgreSQL, the system of record, has no built-in system versioning. MariaDB does (`WITH SYSTEM VERSIONING`,
`FOR SYSTEM_TIME`), and since 11.8 also a `VECTOR` type with a vector index. That is why it is used here, for this
one job, beside the system of record rather than instead of it.

## Run it (one command)

Docker and Node 24 with pnpm. From `web/`:

```bash
pnpm install
pnpm mariadb:reproduce
```

It starts `mariadb:12.3.3` (the current long-term-support release) from `compose.yaml` on `127.0.0.1:3407`, resets
its database, seeds the scenario through the real order flow, prints the answers and the measurements below. With
`OPENAI_API_KEY` in the environment (or in `web/.env.local`) it also embeds the decisions and runs the vector
measurements; without it, that part is skipped and says so. Options: `--no-docker`, `--no-vectors`, `--scale=N`,
`--runs=N` (see the top of `web/scripts/mariadb-reproduce.ts`).

To explore it in the app, start the app with `DOCK_MARIADB_URL=mariadb://dock:dock@127.0.0.1:3407/dock_audit` and open
`/ops/time-machine`. The live tests run with the same variable (`pnpm test`), in a throwaway `dock_test_*` database
that `init/01-test-databases.sql` lets the `dock` user create.

## What is mirrored, and how

| Table (all `WITH SYSTEM VERSIONING`) | One row per | Taken from |
|---|---|---|
| `gate_mandate` | agent: the terms of the mandate it presents (limits, budget, groups, claims, allergens, certificates, lead time, swaps, approvers) | every mandate the gate verifies (`authenticate`), and each order's own copy |
| `gate_kitchen_rule` | rule a person stated, or habit learned, in a kitchen's memory | the kitchen store |
| `gate_product_hold` | recall hold (held or lifted, by whom) | the recall radar's holds |
| `gate_suspension` | operator suspension (active or resumed, by whom) | the ledger's `control` entries |
| `gate_budget` | kitchen: committed and held spend of the last 7 days | the orders, as the gate counts them |
| `gate_order` | order: status, outcome, who authorised it | the order store |

`gate_order_body` keeps each order as it was put to the gate (quote, lines, request, and the door it came through:
the store, the assistant, voice, a photo, the menu planner, MCP, a connector address or REST); `gate_decision` keeps
the ledger's plain-language decisions with their embeddings and door. Neither changes, so neither is versioned.

Recall holds are judged by the gate's own rule `recall_hold`: the replay hands the holds in force at the chosen moment
to `evaluatePolicy` exactly as `createDock`'s `ProductHolds` does. Suspensions are checked at the door, in front of the
gate, as the app does; they are read from the ledger's `control` entries until the core persists them (the switch point
is marked in `web/src/server/mariadb/attach.ts`).

The application writes nothing but `INSERT`, `UPDATE` and `DELETE` on current rows (`web/src/server/mariadb/mirror.ts`);
MariaDB keeps every earlier version with its `ROW_START` and `ROW_END`. The mirror is told "something may have
changed" by taps on the ledger, the kitchen store, the mandate check and the event bus; it waits 120 ms, reads the
app's state, and writes what differs in one transaction. A tap never waits for MariaDB and never fails the call it
sits on: if MariaDB is down, ordering is unaffected and the page says the mirror is behind.

Two MariaDB details do real work:

- **`WITHOUT SYSTEM VERSIONING` columns.** The demo kitchens re-sign the same mandate terms every day under a new id
  and validity window. Those columns are excluded from versioning, so re-signing is a quiet update and only a change
  of terms makes history.
- **`FOR SYSTEM_TIME` on a view.** `gate_rules` is a `UNION ALL` view over the five rule tables. Applied to the view,
  `FOR SYSTEM_TIME AS OF` reaches every table under it, so "the rules as they stood" is one statement:

```sql
SELECT area, org_id, item, in_force, value, changed_by, since, until
  FROM gate_rules FOR SYSTEM_TIME AS OF TIMESTAMP ?
 WHERE org_id IN (?, '*') AND in_force = 1
```

The seeded scenario, and only the scenario, sets the session's `@@timestamp` before each write: the documented way to
give rows a `ROW_START` in the past, so three and a half weeks of rule changes can be seeded in a second. The app's
live mirror never sets it; its history is stamped by the server's own clock.

## The scenario

Koulukeittiö Aurinko, a synthetic school kitchen (all names invented), 25 days back from the moment you run it:
mandate v1 (€400 per order alone, €3,000 a week, lactose-free only); order A, 40 L of oat drink, placed alone; order
B, 500 L of milk for €645, signed off by the kitchen manager; a week later the kitchen manager adds "Never gluten" and
the mandate is reissued to forbid gluten; a recall drill holds the 10 L milk box for two days; order D buys that box
after the hold is lifted; operations suspend the agent for a night; the limit is raised to €1,000; in the last week
the budget fills. Two other kitchens order in the background. Each kitchen's agent comes through one door (Aurinko over MCP, the hotel over REST, the café through a connector address), recorded with every request. 78 orders in all, every one through the real gate.

## The answers it prints

The real gate (`evaluatePolicy` in `web/src/core/policy.ts`, the same pure function) run again on past orders. The
order's own facts are held as they were (quote, prices, lines, the moment, the mandate's id and window); only the
rules come from MariaDB.

| Order | When it arrived (replayed; matches what the gate recorded) | With today's rules | The rule that differs |
|---|---|---|---|
| A, oat drink €75.60 | placed by the agent alone | refused | `forbidden_allergens`: gluten is forbidden now |
| B, milk €645 | sent to the kitchen manager | refused | `per_order_limit` now passes (€1,000), but `weekly_budget` fails (€2,537 of €3,000 spent this week) |
| D, milk box €387 | placed alone | placed alone | none; slid to the drill it is refused by `recall_hold`, slid to the night of the suspension it is refused at the door |

For each of them the replay against the rules the instant before the order reproduces the gate's recorded decision
rule for rule, and the mirrored mandate terms match the mandate the order itself carried.

## Measurements

Saturday 14 Nov 2026, an Apple M3 Pro laptop (18 GB), MariaDB 12.3.3 in Docker Desktop (64 MB buffer pool, 512 MB
container cap), Node 25, the official `mariadb` connector 3.5.4. Times are measured in Node around `pool.query`, so
they include the round trip to the container; 200 runs after 5 warm-up runs; median and 95th percentile. The full
output is in [`results-2026-11-14.txt`](results-2026-11-14.txt). Other agents were building on the same machine, so
expect noise: across four runs the 100,000-version single lookup measured 0.45 to 2.4 ms. This is the run after
merging the integration branch (holds as a gate rule, doors recorded); the replay answers are the same as before it.

**Rows** after the scenario: 89 current rows and 92 history versions in the six versioned tables (181 in all); every
table is one or two 16 KiB InnoDB pages.

| Query | Median | p95 |
|---|---|---|
| The rules `AS OF` a past moment (view over five versioned tables) | 0.96 ms | 2.21 ms |
| The rules `AS OF` now | 0.63 ms | 1.40 ms |
| Every version `FROM` then `TO` now (the changes) | 1.34 ms | 3.13 ms |
| The whole page answer for one order (8 statements and 3 gate runs, 50 runs) | 5.99 ms | 10.65 ms |
| Combined: vector nearest neighbours joined to `FOR SYSTEM_TIME ALL` (78 decisions) | 4.00 ms | 8.87 ms |
| One agent's terms `AS OF` 200 days back, table with 100,000 history versions | 1.78 ms | 3.64 ms |
| All 100 agents `AS OF` that moment, same table (scan) | 15.57 ms | 23.17 ms |

The 100,000-version table (100 agents, 1,000 versions each, loaded in 15.1 s, 7.5 MiB) is dropped afterwards.

## Vector search: did it earn its place?

The combined statement, nearest decisions by meaning with the mandate in force when each was made:

```sql
SELECT n.order_id, n.at, n.outcome, n.rules_hit, n.explanation, n.distance,
       m.per_order_limit_cents, m.weekly_budget_cents, m.forbidden_allergens, m.ROW_START AS terms_since
  FROM (SELECT entry_hash, order_id, at, org_id, agent_id, outcome, rules_hit, explanation,
               VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
          FROM gate_decision ORDER BY distance LIMIT ?) AS n
  LEFT JOIN gate_mandate FOR SYSTEM_TIME ALL AS m
         ON m.agent_id = n.agent_id AND m.ROW_START <= n.at AND n.at < m.ROW_END
 ORDER BY n.distance
```

`EXPLAIN` shows the inner query on the vector index (`gate_decision: embedding`) and the join on the history by key.

Method: ten questions a member of staff might type ("milk that was not lactose free", "it would have come too
late"), each judged by the rule that actually decided each returned decision (from the ledger, not by eye).
Result: vector search found the right decisions in 44% of top-five slots on 10 questions over 78 templated decisions (precision at 5: 0.44), against 20% for MariaDB's own `FULLTEXT` on the same text (it returned
nothing for four of the ten questions); best possible on this corpus 72% (some rules occur fewer than five times; one
question has no relevant decision at all). Before the integration branch reworded the gate's reasons (substitutes now
named in full, so many decisions say "lactose-free milk") the same run measured 62%; a second run after it, 46%. Embeddings: OpenAI `text-embedding-3-small`, about 4,000
tokens per run, under $0.0001.

Limits of that result: 78 decisions written by templates, ten questions written by us, one run. It shows the vector
search finds decisions by what they mean where keywords miss; it does not show quality at scale.

## Attaching it to the public deployment

The public site has no MariaDB today, and `/ops/time-machine` says so rather than pretend. To attach one: any
MariaDB 11.8 or later reachable over TLS (a managed service such as MariaDB Cloud or SkySQL, or a small MariaDB
container next to the app), a database and a user that may create tables in it, and the one variable
`DOCK_MARIADB_URL=mariadb://user:password@host:3306/dock_audit?ssl=true` on the app. The schema is created on first
connect. Nothing else changes: the mirror only reads the app's state, so PostgreSQL stays the system of record.

## Not done

- The live mirror stamps history a moment after the app sees a change (120 ms debounce plus the write). A mandate
  first presented with an order may reach MariaDB just after it; the page then uses the mandate the order carried
  and says so.
- With the app's in-memory store, a restart forgets orders; the mirror keeps them as the record and marks them
  `forgotten`, so a replay does not count them among the orders the gate could see.
- History is kept forever. A real deployment would partition it (`PARTITION BY SYSTEM_TIME INTERVAL 1 MONTH`) and
  drop old partitions under a retention rule both sides agree to.

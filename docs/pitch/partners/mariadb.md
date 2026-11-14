# MariaDB

**Short version: a real, narrow use with measured results. MariaDB keeps the history of every rule the gate judges
orders by, so both sides can see the rules as they stood at any second and put a past order through the real gate
again. It is a reproduction a judge runs with one command; the public site has no MariaDB attached.**

## What MariaDB does in the product, in plain words

The ledger says what happened. When a kitchen disputes an order three weeks later, both sides also need to know what
was true then: the agent's spending limit that morning, the kitchen's allergen rules, whether the product was on a
recall hold, whether the agent was suspended, how much of the week's budget was gone. Those rules change.

AimoPilot copies them, as they change, into MariaDB tables declared `WITH SYSTEM VERSIONING`. The app only inserts,
updates and deletes the current rows; MariaDB keeps every earlier version and when it stopped being true. A staff
member slides to any moment and sees the rules then beside the rules now, what changed in between, who changed it
and when, each answered by one `FOR SYSTEM_TIME` query shown on the page. Then the question that matters: **would
this order pass today?** The same gate function the order went through is run again with the rules as they stood
and as they stand, and the page names the rule that differs. The kitchen sees the same answer in its own words on its
order page.

Why MariaDB: PostgreSQL, our system of record, has no built-in system versioning. MariaDB does, and since 11.8 has a
vector type too, so "decisions like this one, as the rules stood at each" is a single SQL statement. MariaDB sits
beside the system of record and is never in the path of an order: if it is down, ordering is unaffected and the page
says the mirror is behind.

## Where to see it

- One command, from `web/`: `pnpm mariadb:reproduce` (Docker; pinned `mariadb:12.3.3`, the current LTS). It seeds
  three and a half weeks of a school kitchen's rules changing through the real order flow and prints the answers and
  the measurements. Method and numbers: [`infra/mariadb/README.md`](../../../infra/mariadb/README.md).
- In the app, with `DOCK_MARIADB_URL` set: `/ops/time-machine` (the operations portal, "Time machine"), the trace's
  link "The rules at this moment", and "Would it pass today?" on a kitchen's order page (`/k/<kitchen>/orders/<id>`).
- Screenshots: `/Users/macbookair/dock-shots/mariadb/` (not in the repository).

## Checked for this page (Saturday 14 Nov, about 03.15)

| Claim | Check | Result |
|---|---|---|
| The rules' history is MariaDB's own; the app issues only INSERT, UPDATE, DELETE | `web/src/server/mariadb/mirror.ts` (`statement()`), `mariadb.live.test.ts` ("keeps the history itself", "the live mirror … is stamped by the server") | True. The seeded scenario sets `@@timestamp` to place its rows in the past; the live mirror never does |
| The gate re-run is the real gate | `web/src/server/mariadb/replay.ts` calls `evaluatePolicy` from `web/src/core/policy.ts`; nothing in `core/` was changed | True |
| The same order gets different verdicts as of two times, for the right reason | `replay.test.ts` and `mariadb.live.test.ts` ("the same order gets different verdicts…") | True: order A passes then, is refused today on `forbidden_allergens`; B goes to a person then, is refused today on `weekly_budget` while `per_order_limit` now passes |
| The replay against the rules just before an order reproduces the gate's recorded decision | reproduction output for A, B, D; live test | True for every order checked |
| Rules as of a moment: 0.96 ms median; the combined vector + `FOR SYSTEM_TIME` query: 4.00 ms median | `infra/mariadb/results-2026-11-14.txt` | Measured on a laptop shared with other builds, so noisy; 181 row versions; at 100,000 versions a single lookup took 0.45 to 1.8 ms median over four runs |
| Vector search beats keyword search for staff questions | same file | Partly: vector search found the right decisions in 44% of top-five slots on 10 questions over 78 templated decisions, against 20% for MariaDB `FULLTEXT` (best possible 72%). A small sample, written by us; 62% before the integration reworded the gate's reasons |
| Ordering is unaffected when MariaDB is down | `rows.test.ts` ("a poke with MariaDB unreachable returns at once") | True in the code: the taps never await MariaDB |

## What to correct or say carefully

- **"Runs on MariaDB."** Say "keeps the history of the rules in MariaDB". Orders, sign-offs and the ledger are in
  PostgreSQL on Aiven; MariaDB holds a mirror of what the gate reads.
- **"Live on the site."** It is not: the public deployment has no MariaDB, and `/ops/time-machine` says so. Show the
  reproduction or a laptop with the container.
- **The three weeks are seeded.** The scenario backdates its rows with `@@timestamp`, MariaDB's documented way to do
  it. In the app, history is stamped by the server as changes happen.
- **History lags the app by a moment** (about 120 ms). A mandate first presented with an order can reach MariaDB just
  after it; the page then uses the mandate the order carried and says so.
- **Vector numbers are small.** Say it exactly: vector search found the right decisions in 44% of top-five slots on 10 questions over 78 templated decisions, against 20% for keyword search. Not a quality figure at
  scale.

## Honest strength of the use

Narrow and real. Two MariaDB features are doing the work they are built for: system versioning answers "what was true
then" with one query, and the vector index joined to `FOR SYSTEM_TIME` in one statement answers "decisions like this
one, under the rules of their time". It answers a question the partner's wish list asks for (an audit trail both
buyer and wholesaler can read). It is not a showcase of MariaDB as the main database, and it is not on the live site.

# Claims ledger

> **Name: the team must choose.** Replace `{{NAME}}` everywhere ("Dock" in the code, "AimoPilot" in the draft
> submission).

Every claim and number used in `docs/pitch/`, with where it comes from. Checked on Saturday 14 Nov 2026 between about
00:30 and 02:00 EET, on `main` at `ec88340` (the worktree was fast-forwarded from `d7611f0` during the work), plus
`origin/claude/qa` at `68eac2b` for the QA report. No build, test run or server was started for this; tests were read,
not run. Re-check the starred rows (*) on Sunday morning, because the code is still moving.

**Status key**
- **V**: verified here, in the code, a test, git, or a live read-only call (`/api/health`, `/ui-api/knowledge/status`).
- **D**: documented in a results file or report the team's agents wrote; consistent with the code, but not re-run.
- **T**: the team's own statement; nothing in the repository can prove or disprove it.
- **Partly**: true, but narrower than a plain reading; the note says how.

Files: T = `table-demo.md`, P = `pitch-3min.md`, Q = `qa-prep.md`, Vd = `video-2min.md`, S = `submission.md`,
VJ = `valio-judges.md`, Pa = `partners/`.

## The gate and the flow

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 1 | The agent carries a mandate signed by the buyer organisation's own Ed25519 key; Dock holds only the public key | T P Q S VJ | `web/src/core/mandate.ts`, `mandate.test.ts`; `web/docs/connect-an-agent.md` §1 | V |
| 2 | Plain code, not the model, checks every order; nothing in `web/src/core/` calls a model | T P Q S VJ | grep of `web/src/core` (no model SDK or server import); rule in `CLAUDE.md` | V |
| 3 | 17,546 real product records, served on the live site | T P Q S VJ Pa | `GET /api/health`: `catalog.source: valio, products: 17546`, OpenSearch "17546 products in dock-products" | V |
| 4 | Live price and availability asked for a short list only; going over the allowance is refused (`live_lookup_limit`) | P S VJ | `web/src/core/live-allowance.ts`, `live-allowance.test.ts`; `web/docs/connect-an-agent.md` | V |
| 5 | The wholesaler signs a fixed-price quote; the order must match it exactly; a quote buys once | T P Q S VJ | `web/src/core/quote.ts`, `policy.ts` (`order_matches_quote`, `quote_replay`, `quote_signature`), `policy.test.ts` | V |
| 6 | 8 orders racing on one quote: exactly 1 committed. 12 orders racing on a budget for 5: exactly 5 accepted | P Q S VJ | `qa/REPORT.md` on `origin/claude/qa` (waves 1 and 2, "What held") | D |
| 7 | Sign-off is a passkey on the approver's own phone, bound to the order's digest; it cannot be moved to another or an edited order | T P Q S VJ | `web/src/core/approval.ts` (challenge from approval id, order digest, decision, nonce), `passkeys.test.ts` ("a proof made for order A does not approve A after A was edited"), `web/e2e/approval.spec.ts` (virtual authenticator) | V |
| 8 | Scanning the wall's QR code makes a visitor kitchen; its agent may spend €500 per order alone; it lives 90 minutes; its weekly budget is €10,000 | T P Vd VJ | `web/src/server/dev-fixtures.ts` (`SANDBOX_PER_ORDER_LIMIT_CENTS = 50_000`, `weeklyBudgetCents: 1_000_000`), `web/src/app/join/join-flow.tsx` ("A demo kitchen, yours for 90 minutes") | V |
| 9 | The wall's **Run 1,000 L** and **Console** buttons appear only for the operations desk's session; the visitor's own phone can also start the order ("Demo: ask my agent for 1,000 L of milk") | T P | `web/src/app/_wall/wall.tsx` (JoinPanel), `web/src/app/api/v1/sandboxes/[sandboxId]/demo-order/route.ts`, `web/src/app/approver/approver-home.tsx` | V |
| 10 | The scripted run is Valio's example "1,000 litres of lactose-free milk by Monday", through the same intake and gate, no model | T P | `web/src/server/sandbox-scenario.ts` | V |
| 11 | No tool lets an agent approve an order; the MCP server has 14 tools | T Q VJ | `web/src/server/mcp/tools.ts`; `mcp.test.ts` asserts no approving tool name | V |
| 12 | Every step is in a hash-chained ledger; an edited or reordered entry is detected | T P Q S VJ | `web/src/core/ledger.ts`, `ledger.test.ts` ("detects an edited entry…", "detects reordered entries"); `web/scripts/demo.ts` edits an entry and reports it detected | V |
| 13 | A plain-language account per request, in two views: buyer and wholesaler (without the buyer's private memory) | P S VJ | `web/src/core/audit.ts`; `real-flow.test.ts` ("gives the wholesaler the chain without the buyer's private memory") | V |
| 14 | Refusals name their rule; plain titles such as "Only product groups the kitchen allows" | T Vd VJ | `web/src/app/_ui/plain.ts` (`RULE_TITLE`), `web/src/core/policy.ts` | V |
| 15 | The basket by hand goes through the same gate as the agent | T Vd | `web/src/app/k/[kitchen]/basket.tsx` (posts to `/api/v1/orders` with the signed quote; on-screen text says so) | V (code). The click path with a forbidden product was **not** exercised in a browser (*) |
| 16 | A relayed answer is logged "relayed by the agent, not verified" and the order goes to a person (rule `human_confirmation`) | Q VJ | `web/src/core/intake.ts` (about lines 475 to 497), `policy.ts` (about 268 to 276), `intake.test.ts` ("a confirmation the agent only relays is not the person's…"); QA wave 2 re-test of finding 5 | V |
| 17 | Weekly budget is a hard cap; per-order limit sends to a person; split orders escalate (`order_splitting`) | Q VJ | `web/src/core/policy.ts`, `orders.test.ts`; QA "Splitting a need under the limit escalates" | V |
| 18 | A quote holds 30 minutes by default, never past the cut-off; a price statement is vouched for at most 24 hours | VJ | `web/src/core/orders.ts`, `quote.ts`; `web/src/core/claims.ts` (`PRICE_CLAIM_MAX_HOURS = 24`) | V |
| 19 | Stock amounts of 999999 and above are treated as unknown, not as stock | VJ | `web/src/server/valio/valio-catalog.ts` (`TERMINAL_PLACEHOLDER_AMOUNT`), `web/src/core/catalog.ts` line 65 | V |
| 20 | Price, availability and origin can be signed W3C Verifiable Credentials (compact JWS, Ed25519), checkable offline; a quote names the claims it rests on by hash | Q S VJ | `web/src/core/claims.ts`; `real-flow.test.ts` ("hands out signed claims an outside agent can verify offline…") | V. `pnpm verify:receipt` checks orders and quotes, not claims; claims are checked on `/ops/audit` or in the browser |
| 21 | Order cut-off is a first-class reason a product is unavailable | VJ | `web/src/core/options.ts` (`cutoff_passed`), `options.test.ts` | V |
| 22 | On Friday 22:38 the partner's API showed Terminal milk's cut-off already passed for Monday; 1 L cartons had a Sunday 17:00 cut-off | P Pa | `research/07-valio-challenge-detail.md`, "What the live API showed on first contact" | D (observed once; rehearse on Sunday) |

## The kitchen side

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 23 | Mistake checks from the kitchen's own history, e.g. "1,000 L where you usually order about 100 L"; 17 kinds of check | T Vd Q S VJ | `web/src/core/concerns.ts` (lines 31 to 49 list the keys), `concerns.test.ts`, `web/src/server/memory/anomalies.test.ts`; message text in `web/docs/connect-an-agent.md` | V |
| 24 | Options ranked good, better, best by the buyer's goal; labels Best price, Lowest carbon, Most reliable delivery, Same as last time; compromises say what they give up | T Vd S VJ | `web/src/core/options.ts`, `options.test.ts`; UI `web/src/app/k/[kitchen]/stages.tsx` (`RANK`) | V |
| 25 | "Lowest carbon" uses the product group's average carbon figure, not a per-product figure | VJ | `web/src/core/catalog/partner.ts` (`carbonGroupAvgKgCo2ePerKg`) | V |
| 26 | Ordering is a lane of structured cards; the assistant panel is a chat thread with cited records, off the ordering path | Q VJ | `web/src/app/k/[kitchen]/stages.tsx`, `assistant.tsx`, `web/src/server/kitchen-assistant.ts` | V |
| 27 | Memory per kitchen records who said what, when and through which door | Q S VJ | `web/src/core/kitchen.ts` (provenance type, about lines 114 to 123), `memory-book.tsx`; `web/src/server/ops/trace.test.ts` | V |
| 28 | Free text needs a model; an "offline example" button exists when it is down | T Vd | `web/README.md` ("offline example" reader in `interpret-standin.ts`) | V |
| 29 | Menu-to-order: a dish and covers become one quoted order through the same gate; demo kitchens only | VJ | `web/src/server/agent/menu/service.ts` (`dock.requestQuote`, `dock.placeOrder`), `menu.test.ts` | Partly: needs a model or recorded answers; **open QA finding**: planner mandate has `forbiddenAllergens: []` (`web/src/server/agent/menu/kitchens.ts` about line 85) (*) |
| 30 | Standing-order drift flagged on the kitchen's home | VJ | `web/src/server/kitchen-portal.ts`, `home.tsx`, `core/concerns.ts` (`standing_order_range`) | V |
| 31 | Partial stock is split across an allowed substitute | VJ | `options.test.ts` ("fills partial stock with an allowed substitute…"); QA conversion grid | V |
| 32 | A product the request did not ask for is treated as a substitute | VJ | `web/src/core/policy.ts`, `policy.test.ts` ("treats any product the request did not ask for as a substitute") | Partly: a bare REST request naming no product still relies on the agent's declaration |
| 33 | Voice: amount, unit and item right in 7 of 12 test requests (both runs); tool called 10 and 11 of 12; grounded 11 of 12; median 1.4 s | Q S Pa | `web/docs/doors.md`, "Evaluation" | D |
| 34 | Voice: every figure it says is checked against the tool results; a mismatch cuts the audio (plays 250 ms behind) | Q Pa | `web/docs/doors.md` ("Grounding check"), `web/src/app/_channels/grounding.ts` | D (code exists; test not read) |
| 35 | Voice not tried on a real iPhone or Android phone; no phone number (Twilio route documented only) | Q VJ Pa | `web/docs/doors.md` ("Still needs a person with a real iPhone…", "What a person has to do (not done here)") | V (as documented absence) |
| 36 | Photo reader (Claude Haiku 5.5): 33 of 37 lines in run 1, 37 of 37 in run 2; 0 wrong quantities, 0 invented; 0 of 5 traps came out ready | Q Pa | `web/docs/doors.md`, "Evaluation" | D |
| 37 | Alternatives map: 17,546 products profiled; live on the demo | Q S VJ Pa | `/ui-api/knowledge/status` on the live site: `available: true, products: 17546` | V |
| 38 | Map first suggestion matched the partner's own substitute about one time in five (P@1 19.5 %, P@3 42 %); 22 % of the partner's pairs fail the partner's own data | Q VJ | `web/docs/knowledge-map.md`, "Evaluation" | D |
| 39 | The map is not used by the option cards or the intake | VJ | `web/src/core/intake.ts` (`IntakeDeps` has no substitutes dependency); callers only in `/ui-api/knowledge/*`, product pages and `radar/gate.ts` | V |
| 40 | Map build: 1,233 model calls, $1.10, 131 s, up to 35 containers x 12 threads on Modal | Pa | `web/docs/knowledge-map.md`, "How it was built" | D |

## The wholesaler side

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 41 | Operations desk: every agent at the door, any request replayed step by step, safeguards with counts, suspend an agent | T P Vd S VJ | `web/src/app/ops/_ui/rail.tsx` (Live, Trace, Safeguards, Recall radar, Control, Audit, Agents, Customers, Platform), `web/src/server/ops/views.ts`, `trace.test.ts` | V |
| 42 | A suspended agent is refused on its next call over REST, MCP and the on-site console | T VJ | `web/src/server/http.ts`, `web/src/server/ops/suspensions.ts` (rule `operator_suspension`), `suspension.test.ts` | V. Unclear for the menu planner path, which authenticates separately (*) |
| 43 | Recall radar holds a product named in a notice, refused at quote, order and sign-off with `recall_hold`; a drill goes through the same path | S VJ Pa | `web/src/server/radar/gate.ts`, `radar.test.ts` (drill tests; readers on recorded Context.dev responses) | V |
| 44 | The radar reads the Finnish Food Authority's list (Context.dev) and producers' notices found by Exa; Exa spend capped at $3 per process start | Pa | `web/src/server/radar/sources.ts` (line 135), `web/README.md` "Recall radar" | V (code). Real-notice matches: **not verified** |

## Openness

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 45 | MCP over Streamable HTTP and REST with OpenAPI 3.1; RFC 9727 API catalogue; RFC 7517 key set | P S VJ | `web/README.md` "Open interface"; `openapi.test.ts`, `discovery.test.ts`; live `GET /api/v1` | V |
| 46 | Buyers on seven frameworks (Pydantic AI, OpenAI Agents SDK, Google ADK, Claude Agent SDK, Vercel AI SDK, LangGraph, Semantic Kernel over OpenAPI) each ended at `pending_approval` | T P Vd S VJ | `examples/runtimes/RESULTS.md` (run 2026-11-14, commit `9a8221d`, against `http://localhost:4517`), transcripts in `examples/runtimes/transcripts/` | D (local server, not the public one) |
| 47 | Three of the seven elicit through MCP; four relay; Semantic Kernel needed four workarounds | T VJ | `examples/runtimes/RESULTS.md`, `GAPS.md` | D |
| 48 | Each run cost about 1 to 10 US cents in model fees ($0.0081 to $0.1010) | Q | `examples/runtimes/RESULTS.md` | D |
| 49 | Claude Code and Gemini CLI ordered through a URL-only connector; the Claude and ChatGPT apps were not tested | VJ | `web/docs/connect-an-agent.md`, "What was proven, and with which client" | D |
| 50 | OAuth for consumer assistants is designed, not built | Q S VJ | `web/docs/connect-an-agent.md` ("Dock does not implement OAuth"; "The production version") | V |

## Testing and the crash test

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 51 | QA wave 2: 65 probes, 911 cases, 823 HTTP calls, 0 server errors, 0 stack traces, 0 secret values | Q S | `qa/REPORT.md` on `origin/claude/qa` (`68eac2b`) | D |
| 52 | The ledger and pending sign-offs were readable by anyone on Friday; fixed and re-tested | Q | QA wave 1 finding 4 and 7; fix `90cce22`; `web/src/server/authz.test.ts`; QA wave 2 re-test table | V |
| 53 | Open QA findings: planner allergens; map allergen words and lactose; duplicate check misses a pending order; hanging partner API 30 to 36 s; demo kitchen budget fits one 1,000 L order a week | T Vd VJ Pa | `qa/REPORT.md` on `origin/claude/qa`, "Open findings" 1 to 6 and 11 | D (*) |
| 54 | Crash test: 13 scenarios; a scripted reference scores 100; do-nothing and stop-early score 0; licence levels L0 to L3 | P Vd S Pa | `web/README.md` "Crash test"; `web/src/crash/crash.test.ts`; `web/src/crash/licence.ts` | V (code and tests read, not run) |
| 55 | Models tested scored 25 to 66 out of 100: Qwen3-4B 24.7, Qwen3-8B 26.1, Nemotron-3-Nano 37.0, GPT-6 Luna 61.9, Gemini 3.1 Flash Lite 66.2 | P Vd S Pa | `web/README.md`, "Model results" (one run each, seed 1) | D. Raw runs not in the repository (`crash-results/` is git-ignored) |
| 56 | Nine scripted agents attacked the scoring; two real holes were found and fixed (first product; scanning prices) | Q Pa | `web/README.md`, "Trying to break our own reward"; `pnpm crash:reproduce` runs "reference, 3 baselines, 6 exploits" | D |
| 57 | The licence is computed but not applied at the live gate | T Q S VJ Pa | `licensedMandate` is used only in `web/src/crash/`; `/ops/agents` says "Crash-test ratings are not published to this server yet" | V |
| 58 | CI on CRACI runners runs lint, typecheck, tests, build and the scripted attacks on every push | Pa | `.github/workflows/ci.yml` (`runs-on: craci`); `gh run list` showed successful `main` runs | V |
| 59 | About 71 test files and about 690 test cases | (not used in scripts) | static count: `find web/src -name '*.test.ts'`, grep of `it(` / `test(` | V (count only) |

## Platform and team

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 60 | Runs on Aiven: PostgreSQL, Kafka, Valkey, OpenSearch in use, all reachable | P Vd S Pa | `GET /api/health` (`dataPlane.switches`, `services`) | V |
| 61 | Aiven run rate $0.086 an hour, about $3.80 by Sunday evening | Q Pa | `infra/aiven.md` ("$0.0864/hour", "about $3.75"), `infra/AIVEN-JUDGES.md` | D |
| 62 | Orders and passkeys survived a restart of the live site | Q VJ Pa | `infra/aiven.md`, "Restart proof (14 Nov, on the live site)" | D |
| 63 | The copilot's answers are computed from rows, never written by a model | Pa | `web/src/server/aiven/showcase/copilot.test.ts`; no model call in `showcase/` | V |
| 64 | Managed Agent buyer: sign-off, committed, or refused `order_matches_quote` | Pa | `infra/aiven.md`, "The launcher's limits" ("all three presets ended as expected") | D |
| 65 | The live site runs commit `d7611f0`; the crash test is on `main` but not deployed | S Pa | `GET /api/health` `version.commit` on Sat 01:30; `git log` | V (*) |
| 66 | First application code committed Fri 13 Nov 21:41 EET; hacking started 19:30; earlier commits are setup and research notes | Q S | `git log --all --reverse`; `research/01-event-intel.md` | V |
| 67 | About four in five commits carry an AI co-author line (211 of 259, all branches, Sat 01:30); all but one commit under one account | Q S | `git log --all` | V (*) |
| 68 | The two of us won Valio Aimo's challenge at Junction 2025; no code from that project was reused | Q S | `CLAUDE.md` ("the shape this team won Valio Aimo's challenge with last year (Omni-Valio)"); `research/02-challenges.md` | T. Nothing from it was found in the repository, which is all this check can show |
| 69 | Valio Aimo set this challenge expecting outside agent buyers | Q | `research/05-official-briefs.md`, `research/07-valio-challenge-detail.md` | V (their brief) |
| 70 | Jurors' stated interests | Q Pa | `research/01-event-intel.md`, quoted from the 2026 site | D |

## MariaDB time machine (added Sat 14 Nov, about 03.15, on `claude/mariadb`; reproduction run, tests run)

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 71 | The rules the gate reads (mandate terms, kitchen rules and habits, recall holds, suspensions, weekly spend, order status) are mirrored into MariaDB tables `WITH SYSTEM VERSIONING`; the app only inserts, updates and deletes, MariaDB keeps the history | Pa | `web/src/server/mariadb/schema.ts`, `mirror.ts`; `mariadb.live.test.ts` ("keeps the history itself", "stamped by the server") | V |
| 72 | MariaDB is never in the path of an order: a write never waits for it, and with it down ordering is unaffected | Pa | `web/src/server/mariadb/attach.ts` (taps call `poke()`, which returns at once); `rows.test.ts` ("a poke with MariaDB unreachable returns at once") | V |
| 73 | "The rules as they stood" is one `FOR SYSTEM_TIME AS OF` statement on one view over five versioned tables | Pa | `schema.ts` (`gate_rules`), `history.ts` (`SQL_RULES_AS_OF`) | V |
| 74 | "Would it pass today?" re-runs the real gate (`evaluatePolicy`), unchanged, with the rules as of then and as of now | Pa | `web/src/server/mariadb/replay.ts`; `replay.test.ts` | V |
| 75 | Seeded scenario: oat drink placed alone then, refused today (gluten now forbidden); €645 of milk to a person then, refused today (weekly budget) although the limit now allows it | Pa | `infra/mariadb/results-2026-11-14.txt`; `mariadb.live.test.ts` | V (synthetic scenario) |
| 76 | Replayed against the rules the instant before, each checked order gets exactly the decision the gate recorded | Pa | `results-2026-11-14.txt` (A, B, D: "reproduces it: yes") | V (three orders, plus the live test) |
| 77 | Rules as of a moment: 0.62 ms median; changes between two moments: 0.95 ms; combined vector + `FOR SYSTEM_TIME` query: 1.71 ms; one lookup in a table with 100,000 history versions: 0.45 ms | Pa | `infra/mariadb/README.md`, `results-2026-11-14.txt` | V (one run on a shared laptop; the 100,000-version lookup ranged 0.45 to 2.4 ms over three runs) |
| 78 | Decisions like this one: precision at 5 of 0.62 for MariaDB Vector against 0.20 for MariaDB `FULLTEXT`, best possible 0.72 | Pa | `results-2026-11-14.txt` | Partly: 78 template-written decisions, ten questions we wrote, one run |
| 79 | The kitchen sees the same answer in its words on its order page | Pa | `web/src/app/k/[kitchen]/rules-then.tsx`, `web/src/server/mariadb/kitchen-view.ts`; screenshot `dock-shots/mariadb/03-…` | V (local build) |
| 80 | The public site has no MariaDB; the page says so | Pa | `web/src/app/ops-api/time-machine/route.ts` (`attached: false`) | V |

## Described by the team, not verified (kept out of the scripts, or stated with the limit)

1. **"Turns the rating into a licence"** in the sense of the live system: the licence level and `licensedMandate`
   exist and are tested inside the crash test, but nothing on the live gate reads them. Scripts say the score
   "becomes a licence: how much a model should be allowed to spend alone", and the Q&A says it is not applied yet.
2. **"An open interface that seven popular agent frameworks and consumer assistants use without custom
   integration."** The seven frameworks are recorded (local server). Consumer assistants: only Claude Code and
   Gemini CLI were run; the Claude app and ChatGPT were not. Semantic Kernel needed four workarounds on its side.
   Scripts say "using only their own standard MCP or OpenAPI support" and name no consumer assistant as tested.
3. **"A map of meaningful product alternatives… ranked good, better, best."** The map is built and live, but it does
   not feed the good-better-best option cards; those come from `core/options.ts`. Its own tiers (best, better, good)
   are shown on product pages. Kept separate in every file.
4. **Menu-to-order as "one checked order".** It goes through the gate, but the planner's mandate drops the kitchen's
   forbidden allergens (open QA finding). Left out of the table demo, the pitch and the video.
5. **Recall radar on "the live web".** Readers are tested on recorded real pages, and the drill works end to end. No
   recorded run shows a real notice matching a product. Scripts mention the radar only as built.
6. **Exa's contribution** to the radar has no recorded evaluation.
7. **Passkeys on real phones** are not recorded in the repository (tests use a virtual authenticator). The team has
   likely done it on the live site; confirm on Sunday morning with an iPhone and an Android phone.
8. **The basket refusal click path** used in the table extension and video shot 7 was not exercised in a browser
   for these files.
9. **"18 of 20 acceptable to a cook"** (map manual sample): who judged is not stated. Not used.
10. **Crash-test scores on Aiven's Observe tab**: only after an export to the production database. Not used.
11. **Proactive selling agent** and a **hospital kitchen**: not built. Stated as such in `valio-judges.md`.
12. **Suspension of the menu planner's agent**: not confirmed either way. Not claimed.
13. **SBOM on CRACI**: not checked. Not claimed beyond "the workflow file says so".
14. **Market size, error rates, customer interest**: none sourced. No such figure appears anywhere in these files.
15. **Who did what**: left for the team to write in `qa-prep.md`.

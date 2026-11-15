# Claims ledger

Every claim and number used in the judge-facing documents, with where it comes from. First checked on Saturday 14
Nov 2026 between about 00:30 and 03:30 EET; **re-checked on Sunday 15 Nov between about 00:30 and 02:00 EET** on
branch `claude/docs-final` (from `main` at `fbb0f50`), against the code, the tests and read-only calls to the live
site. The live site then ran commit `7661caa` (deployed 14 Nov 22:37 UTC); `main` was seven commits ahead, none of
them in `web/`. On this branch `pnpm typecheck` was clean and `pnpm test` passed: 188 test files, 1,710 tests (45
skipped).

**Status key**
- **V**: verified here, in the code, a test, git, or a live read-only call (`/api/health`, an `/ops` page as viewer).
- **D**: documented in a results file or report the team's agents wrote; consistent with the code, but not re-run.
- **T**: the team's own statement; nothing in the repository can prove or disprove it.
- **Partly**: true, but narrower than a plain reading; the note says how.
- **Not verified**: kept only so the gap is visible. Not used in any script.
- **Corrected** / **Removed**: the earlier wording was no longer true; the note says what changed.

Files: R = `README.md`, T = `table-demo.md`, P = `pitch-3min.md`, Q = `qa-prep.md`, Vd = `video-2min.md`, S =
`submission.md`, VJ = `valio-judges.md`, Pa = `partners/`, AJ = `infra/AIVEN-JUDGES.md`.

## The gate and the flow

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 1 | The agent carries a mandate signed by the buyer organisation's own Ed25519 key; AimoPilot holds only the public key | P Q S VJ | `web/src/core/mandate.ts`, `mandate.test.ts`; `web/docs/connect-an-agent.md` §1 | V. Demo assumption: for accounts opened on the site, the service holds the kitchen's signing key (the onboarding says so) |
| 2 | Plain code, not the model, checks every order; nothing in `web/src/core/` calls a model | R T P Q S VJ | grep of `web/src/core` (no model SDK or server import); rule in `CLAUDE.md` | V |
| 3 | 17,546 product records, served on the live site | R T P Q S VJ Pa AJ | `GET /api/health` on 15 Nov: `catalog.source: valio, products: 17546`; OpenSearch "17546 products in dock-products" | V |
| 4 | Live price and availability asked for a short list only; going over the allowance is refused (`live_lookup_limit`) | R S VJ | `web/src/core/live-allowance.ts`, `live-allowance.test.ts` | V |
| 5 | The wholesaler signs a fixed-price quote; the order must match it exactly; a quote buys once | R S VJ | `web/src/core/quote.ts`, `policy.ts` (`order_matches_quote`, `quote_replay`), `policy.test.ts` | V |
| 6 | 8 orders racing on one quote: exactly 1 committed. 12 orders racing on a budget for 5: exactly 5 accepted | P Q S | `qa/REPORT.md`, "What held" | D |
| 7 | Sign-off is a passkey on the approver's own phone, bound to the order's digest; it cannot be moved to another or an edited order | T P S VJ | `web/src/core/approval.ts`, `passkeys.test.ts` ("a proof made for order A does not approve A after A was edited"), `web/e2e/approval.spec.ts` | V |
| 8 | Scanning the wall's QR code makes a visitor kitchen for 90 minutes with a €500 per-order limit | (no longer used) | `web/src/server/dev-fixtures.ts`; `k/door.text.ts` ("closes 90 minutes after you joined") | V (code). The scripts now use the test kitchens instead |
| 9 | The wall's **Run 1,000 L** and **Console** buttons | (no longer used) | `web/src/app/_wall/wall.tsx` | **Removed** from the scripts: the table demo is now the kitchen's conversation. Not re-checked |
| 10 | The scripted run (`pnpm demo`) is Valio's example through the same intake and gate, no model | T | `web/scripts/demo.ts`, `web/src/server/sandbox-scenario.ts` | V (code; not run today) |
| 11 | No tool lets an agent approve an order | VJ | `web/src/server/mcp/tools.ts`; `mcp.test.ts` asserts no approving tool name | V. **Corrected**: the MCP server now has **19** tools, not 14 |
| 12 | Every step is in a hash-chained ledger; an edited or reordered entry is detected | R P S VJ | `web/src/core/ledger.ts`, `ledger.test.ts` | V |
| 13 | A plain-language account per request, in two views: buyer and wholesaler (without the buyer's private memory) | S VJ | `web/src/core/audit.ts`; `real-flow.test.ts` | V |
| 14 | Refusals name their rule | R T VJ | `web/src/app/_ui/plain.ts` (`RULE_TITLE`), `web/src/core/policy.ts` | V |
| 15 | The basket by hand goes through the same gate as the agent | S | `web/src/app/k/[kitchen]/basket.tsx`; landing page "An order from the basket and an order from the agent pass the same checks" | V (code). Click path not exercised in a browser for these files |
| 16 | A relayed answer is logged as relayed, not verified, and never satisfies a confirmation that matters: the order goes to a person (`human_confirmation`) | T Q VJ | `web/src/core/intake.ts` (`isVerified`), `policy.ts`; `open-findings.test.ts`, `intake-tools.test.ts`. On stage: "a yes passed on to me doesn't count as the kitchen manager's OK" (`demo-script-sunday.md`) | V (code), D (the live wording) |
| 17 | Weekly budget is a hard cap; per-order limit sends to a person; split orders escalate together (`order_splitting`) | VJ | `web/src/core/policy.ts`; `gate-attacks.test.ts` | V |
| 18 | A quote holds 30 minutes by default, never past the cut-off; a price statement is vouched for at most 24 hours | VJ | `web/src/core/orders.ts`, `quote.ts`, `claims.ts` (`PRICE_CLAIM_MAX_HOURS = 24`) | V |
| 19 | Stock amounts of 999999 and above are treated as unknown, not as stock | VJ | `web/src/server/valio/valio-catalog.ts` (`TERMINAL_PLACEHOLDER_AMOUNT`) | V |
| 20 | Price, availability and origin can be signed W3C Verifiable Credentials (compact JWS, Ed25519), checkable offline; a quote names the claims it rests on by hash | S VJ | `web/src/core/claims.ts`; `real-flow.test.ts` | V |
| 21 | Order cut-off is a first-class reason a product is unavailable | R VJ | `web/src/core/options.ts` (`cutoff_passed`), `options.test.ts` | V |
| 22 | On Sunday the usual 10 l milk boxes have missed their cut-off for Monday, and 1 l cartons can be ordered for Monday until 17:00 | T P | `docs/pitch/demo-script-sunday.md` (checked with the server's clock at 10:30 and with the real clock at 00:30) | D |
| 98 | The gate is a pure function of 20 rules | S T P VJ Vd | `web/src/core/policy.ts` (`RULES`, 20 entries); the landing page counts `RULES.length` | V |

## The kitchen side

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 23 | Mistake checks from the kitchen's own history, e.g. "That's 1 000 L. You usually order about 100 L of this (your last 8 orders)" | T Q VJ | `web/src/core/concerns.ts`, `concerns.test.ts`; wording in `demo-script-sunday.md` (Kaari) | V (code), D (wording). "17 kinds of check" **not re-checked**, dropped from the scripts |
| 24 | Options ranked good, better, best by the buyer's goal; compromises say what they give up | S VJ | `web/src/core/options.ts`, `options.test.ts` | V |
| 25 | "Lowest carbon" uses the product group's average carbon figure, not a per-product figure | VJ | `web/src/core/catalog/partner.ts` (`carbonGroupAvgKgCo2ePerKg`) | V |
| 26 | One conversation per kitchen; the model writes at most one short line per turn; prices, stock, amounts and dates appear only in cards made from tool results and gate records | R Q S VJ | `web/docs/agent-thread.md` ("What an agent turn is"), `web/src/server/thread/types.ts`; grounding check `core/grounding.ts` | V (doc and types). **Corrected**: the earlier "a numbered lane of structured cards, with a separate assistant chat" no longer describes the store |
| 27 | Memory per kitchen records who said what, when and through which door | VJ | `web/src/core/kitchen.ts` (provenance), `memory-book.tsx`; `trace.test.ts` | V (not re-checked today) |
| 28 | An "offline example" button when the model is down | (no longer used) | `web/README.md` | **Not verified** today; dropped from the scripts |
| 29 | Dish flow: one skippable question, three ideas, then "You have / I'll order / Can't get", each with a reason; what the kitchen has is estimated from its order history; a line the allergen rule stops is shown, not ordered | R S VJ | `web/src/server/thread/dish.ts`, `menu.ts` (lines 683 to 722); `web/src/server/agent/menu/coverage.ts`, `plan.ts` ("an estimate from its order history") | V (code). Needs a model. **Open**: the stand-alone planner's own mandate for Kaari still has `forbiddenAllergens: []` (`web/src/server/agent/menu/kitchens.ts` line 92) while Kaari forbids nuts (`demo-kitchen.ts`): QA finding 1 is not closed on that path |
| 30 | Standing-order drift flagged | VJ | `web/src/server/kitchen-portal.ts`, `core/concerns.ts` (`standing_order_range`) | V |
| 31 | Partial stock is split across an allowed substitute | VJ S | `options.test.ts` ("fills partial stock with an allowed substitute…") | V |
| 32 | A product the request did not ask for is treated as a substitute | VJ | `policy.ts`, `policy.test.ts` | Partly: a bare REST request naming no product still relies on the agent's declaration |
| 33 | Voice: heard right in 33 of 36 held-out clips (accents, hall noise, three languages; Gemini 3.8 Live) | T Q S VJ | `web/docs/doors.md` ("Evaluation"), `web/eval/voice/results/held-gemini-3.8-live.json` (`right: 33, clips: 36`); landing page "Heard right in 33 of 36 held-out voice clips" | V (results file). **Corrected**: the old "7 of 12" was the push-to-talk door before 14 Nov evening; on that original set it is now 11 of 12 |
| 34 | Voice: the voice model only relays; it has one tool (`relay`) and cannot place, approve or change anything | Q | `web/docs/doors.md`; `server/thread/voice-brief.ts`, `voice-brief.test.ts` | V (doc and test name) |
| 35 | Voice not recorded on a real iPhone or Android phone; no phone number (Twilio route documented only) | Q VJ | `web/docs/doors.md` ("Five minutes with a real phone" is a checklist, no result; "What a person has to do (not done here)") | V (as documented absence) |
| 36 | Photo reader (Claude Haiku 5.5): 33 of 37 lines in run 1, 37 of 37 in run 2; 0 wrong quantities, 0 invented; 0 of 5 traps came out ready | (not in the scripts now) | `web/docs/doors.md`, "Photo" | D |
| 37 | Alternatives map: 17,546 products profiled | (not in the scripts now) | `/ui-api/knowledge/status` (14 Nov) | V on 14 Nov; not re-checked |
| 38 | Map first suggestion matched the partner's own substitute about one time in five; 22 % of the partner's pairs fail the partner's own data | Q VJ | `web/docs/knowledge-map.md`, "Evaluation" | D |
| 39 | The map is not used by the option cards or the intake | VJ | `web/src/core/intake.ts` | V on 14 Nov; not re-checked |
| 40 | Map build: 1,233 model calls, $1.10, on Modal | Pa | `web/docs/knowledge-map.md` | D |

## The wholesaler side

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 41 | Operations portal: every agent at the door with a scorecard, any request replayed step by step, safeguards with counts, suspend an agent | R T P S VJ AJ | `web/src/app/ops/(desk)/` (agents, trace, safeguards, control, …); `/ops/agents` read as viewer on 15 Nov | V |
| 42 | A suspended agent is refused on its next call through every door | VJ | `web/src/core/orders.ts` (`DockDeps.admit`), `ops/suspensions.ts`; `suspension.test.ts`, `suspension-doors.test.ts` | V |
| 43 | Recall radar holds a product named in a notice, refused at quote, order and sign-off (`recall_hold`) | VJ | `web/src/server/radar/gate.ts`, `radar.test.ts` | V |
| 44 | The radar reads the Finnish Food Authority's list (Context.dev) and producers' notices found by Exa | Pa | `web/src/server/radar/sources.ts` | V (code). Real-notice matches: **not verified** |

## Openness

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 45 | MCP over Streamable HTTP and REST with OpenAPI 3.1; RFC 9727 API catalogue; RFC 7517 key set | R P S VJ | `openapi.test.ts`, `discovery.test.ts`; live `GET /api/v1` | V |
| 46 | Buyers on seven frameworks each ended at `pending_approval` with only the address and a signed mandate | T P S VJ | `examples/runtimes/RESULTS.md` (run 14 Nov, commit `3cd29e2`, against `http://localhost:4733`) | D (local server, not the public one) |
| 47 | Three of the seven elicit through MCP; four relay; Semantic Kernel needed workarounds | T VJ | `examples/runtimes/RESULTS.md`, `GAPS.md` | D |
| 48 | Each run cost about 1 to 5 US cents in model fees ($0.0087 to $0.0471) | Q | `examples/runtimes/RESULTS.md` | D. **Corrected** from "1 to 10 cents" (an earlier run) |
| 49 | Claude Code and Gemini CLI ordered through a URL-only connector; the Claude and ChatGPT apps were not tested | VJ | `web/docs/connect-an-agent.md` | D |
| 50 | OAuth for consumer assistants is designed, not built | Q S VJ | `web/docs/connect-an-agent.md` | V |
| 106 | The repository is public (MIT), so `/try`'s one command works from a clone | S | `gh repo view` on 15 Nov, 06:25: `PUBLIC`; `web/src/app/try/try.text.ts` | V |

## Testing and the crash test

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 51 | QA final run: 66 probes, 907 cases, 1,027 HTTP calls, 0 server errors, 0 stack traces, 0 secret values | Q | `qa/REPORT.md`, "What held" (final run on `ec88340`) | D. **Corrected** from "65 probes, 911 cases" (wave 2) |
| 52 | The ledger and pending sign-offs were readable by anyone on Friday; fixed and re-tested | Q | QA wave 1; `web/src/server/authz.test.ts` | V |
| 53 | Open QA findings: stand-alone planner allergens; map allergen words; duplicate check misses a pending order | VJ T | `qa/REPORT.md`, "Open findings" (as of Saturday about 02:00) | D, **not re-checked** except finding 1 (still open on the stand-alone planner path, row 29). "A demo kitchen's budget fits one 1,000 L order a week" removed: the demo now uses the test kitchens, reset every 60 minutes |
| 54 | Crash test: 13 scenarios, three runs each through the same harness and the same gate, scored from the gate's own records; the worst run sets the licence (L0 Learner to L3 Autonomous); scripted reference 100, do-nothing and stop-early 0 | P S Q | `web/src/crash/results/summary.json` (`crash-suite/2`, 14 Nov 00:58 UTC; every agent `repeats: 3`, 13 scenarios); landing page "three runs each" | V (file read; suite not re-run) |
| 55 | Model results (mean, worst run, licence): Claude Fable 5.2 96.9 / 96.5 L3; Claude Opus 5.5, the kitchen agent's model, 95.7 / 95.2 L3; Claude Sonnet 5.5 90.8 / 85.7 L1; GPT-6 Astra 80.4 / 79.9 L1; Claude Haiku 5.5 78.3 / 68.9 L1; GPT-6 Luna 64.8 / 59.7 L0; open Qwen3 and Nemotron models 7.9 to 14.9 mean, L0 | (only the shape is in the scripts) | `web/src/crash/results/summary.json` | V (file). **Corrected**: "models we tested scored 25 to 66 out of 100, one run each" is stale and removed from every script. Note: `/ops/agents` on the live site rounds some figures differently (e.g. Sonnet 93); not reconciled, so no per-model figure is in the scripts |
| 56 | Scripted agents attacked the scoring; two real holes were found and fixed (first product; scanning prices) | Q | `web/README.md`, "Trying to break our own reward" | D |
| 57 | The licence is not applied on the hosted site; the gate can enforce it behind `DOCK_LICENCE_ENFORCE=on` | T Q S VJ | `web/src/server/ops/licence-gate.ts` (rule `crash_licence`, off by default), `licence-gate.test.ts`; `/ops/agents` on the live site: "No crash-test results on this server" | V. **Corrected** from "computed but not applied at the live gate": enforcement now exists, switched off |
| 58 | CI on CRACI runners runs lint, typecheck, tests, build and the scripted attacks on every push | Pa | `.github/workflows/ci.yml` (`runs-on: craci`) | V on 14 Nov; not re-checked |
| 59 | 188 test files and 1,710 tests pass (45 skipped) | (not in the scripts) | `pnpm test` on this branch, 15 Nov | V |

## The second reader (NVIDIA Nemotron)

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 71a | Every typed or spoken request can be read twice: by the agent's model and, at the same moment, by NVIDIA Nemotron 3 Nano (via Featherless) | Pa S | `web/src/server/agent/interpret.ts`, `second-reader.ts`; needs `DOCK_SECOND_READER_MODEL` | V (code). On the live site: **not verified** (the setting is not visible in `/api/health`) |
| 72a | Plain code compares the two readings; the second can only add a question | Pa | `web/src/core/second-reading.ts`, `second-reading.test.ts` | V |
| 73a | No needless question in 252 compared requests | Pa | `web/docs/second-reader.md`, `web/eval/second-reader/results*.json` | Partly (the rules were tuned on most of them; the fresh 20 are the untouched number) |
| 74a | Catches about 9 in 10 injected misreadings | Pa | same | V (injected errors only) |
| 76a | Nemotron alone is right on every compared field only about 60 % of the time | Pa | `web/docs/second-reader.md` | V |
| 77a | Nemotron 3 Super 120B could not be evaluated (429 "at capacity" on all calls) | Pa | `web/eval/second-reader/readings*.json` | V |

Rows 75 (timing) and 78 of the Saturday ledger are left out: 75 is a speed figure, and 78 was not re-checked.

## Platform and team

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 60 | Runs on Aiven: PostgreSQL, Kafka, Valkey, OpenSearch in use, all reachable | S Pa AJ | `GET /api/health` on 15 Nov (`dataPlane.switches`, `services`) | V |
| 61 | Aiven run rate $0.086 an hour, about $3.80 by Sunday evening | Q Pa AJ | `infra/aiven.md` ("$0.0864/hour", "about $3.75") | D |
| 62 | Orders and passkeys survived a restart of the live site | Q | `infra/aiven.md`, "Restart proof (14 Nov)" | D |
| 63 | The copilot's answers are computed from rows, never written by a model | S Pa AJ | `web/src/server/aiven/showcase/copilot.test.ts`; no model call in `showcase/` | V |
| 64 | Managed Agent buyer: sign-off, committed, or refused `order_matches_quote` | Pa AJ | `infra/aiven.md`, "The launcher's limits" | D |
| 65 | The live site runs `7661caa`, deployed 14 Nov 22:37 UTC; `main` was 7 commits ahead, none in `web/` | (this file) | `GET /api/health` `version`; `git rev-list 7661caad..origin/main` | V. **Corrected** from `d7611f0` |
| 66 | First application code committed Fri 13 Nov 21:41 EET; hacking started 19:30 | Q S | `git log --all --reverse`; `research/01-event-intel.md` | V (14 Nov) |
| 67 | Share of commits with an AI co-author line | Q S | `git log` | **Stale**: the Saturday 01:30 counts (211 of 259; 179 of 220 on `main`) are removed from the scripts; recount before quoting |
| 68 | The two of us won Valio Aimo's challenge at Junction 2025; no code from that project was reused | Q S | `CLAUDE.md`; `research/02-challenges.md` | T |
| 69 | Valio Aimo set this challenge expecting outside agent buyers | Q | `research/05-official-briefs.md`, `research/07-valio-challenge-detail.md` | V (their brief) |
| 70 | Jurors' stated interests | Q | `research/01-event-intel.md` | D |
| 71b | "Add to signed mandate" re-signs the kitchen's mandate with the rule; earlier mandates stop working | VJ | `web/src/core/mandate.ts` (`supersededBy`), `mandate-reissue.ts`, `mandate-reissue.test.ts` | V (14 Nov) |
| 72b | On a public site, a mandate signed with the demo organisations' public development key is refused | VJ | `web/src/server/dev-fixtures.ts`, `dev-key.test.ts`; `/api/health` `settings.demoOrgKey: fixed` | V |

## The Time machine (MariaDB reproduction and the hosted PostgreSQL history)

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 71c | The rules the gate reads can be mirrored into MariaDB tables `WITH SYSTEM VERSIONING` | R Pa | `web/src/server/mariadb/schema.ts`, `mirror.ts`; `mariadb.live.test.ts` | V (14 Nov) |
| 72c | The history is never in the path of an order | Pa | `web/src/server/mariadb/attach.ts`; `rows.test.ts` | V (14 Nov) |
| 74c | "Would it pass today?" re-runs the real gate (`evaluatePolicy`) with the rules as of then and as of now | R S AJ | `web/src/server/mariadb/replay.ts`; `replay.test.ts` | V |
| 75c | Seeded scenario: oat drink placed alone then, refused today; €645 of milk to a person then, refused today | Pa | `infra/mariadb/results-2026-11-14.txt` | V (synthetic scenario) |
| 80 | On the hosted site the Time machine keeps its history in Aiven for PostgreSQL, schema `dock_prod_history`, each version with the `tstzrange` it was in force | R S Pa AJ | `web/src/server/history/pg-store.ts`, `store.ts`; live `GET /ops-api/time-machine` on 15 Nov: `backend: postgres`, "dock-pg, schema dock_prod_history" | V. **Corrected** from "the public site has no MariaDB; the page says so" |

Row 77 (MariaDB timings) and 78 (vector search on decisions) of the Saturday ledger are left out of every script:
77 is a speed figure, 78 a small sample.

## Added on Sunday 15 Nov

| # | Claim | Used in | Source | Status |
|---|---|---|---|---|
| 81 | The public address is `https://aimopilot.zeroanomaly.tech`, a custom domain in front of the Aiven Runtime app; links, QR codes, mail and passkeys (RP ID) belong to it | R T P S VJ Pa AJ | `/api/health` on 15 Nov: `settings.publicUrl` and `settings.passkeyRpId` both the custom domain; `infra/aiven-deploy.mjs` (`DOCK_DEPLOY_CUSTOM_DOMAIN`, default `aimopilot.zeroanomaly.tech`) | V |
| 82 | The app's own host `jolly-wondrous-bunny.eur-1.aiven.app` still answers, with the same deployment | R T AJ | `/api/health` on both hosts: the same commit and deploy time | V |
| 83 | The landing page is at `/` (with "How it looks on your webshop" and a film slot), the wall at `/wall`, the first landing page at `/landing/classic` | R | `web/src/app/page.tsx` (`Landing2`), `_landing2/landing2.text.ts` (`WEBSHOP`, `film`), `app/wall/`, `app/landing/classic/` | V |
| 84 | Three ways in on `/k`: "Start a fresh kitchen", "Try a kitchen with rules" (Hotel Lumo kitchen, Metsola school kitchen, Kahvila Sointu; shared, reset every 60 minutes), "Open your restaurant's account" | R T S VJ | `web/src/app/k/page.tsx`, `door.text.ts`; `server/accounts/test-accounts.ts`; `server/accounts/schedule.ts` (`DOCK_TEST_ACCOUNTS_RESET_MINUTES`, default 60) | V |
| 85 | A fresh kitchen: one click, no rules, empty memory, private to its browser, deleted after 24 hours without use unless kept | R VJ T | `web/src/server/demo/fresh.ts` (`FREE_TERMS`, `sweepFreeKitchens`), `door.text.ts` (`freshLine`, `freshNote`) | V. "No rules" means free-play terms: every group, no diet or allergen rule, limits too high to bind; availability, cut-offs, the mistake check and the ledger still stand |
| 86 | The onboarding asks for a business email and sends nothing until it is confirmed from the first email | R VJ | `door.text.ts` (`email`, `noEmail`); `server/accounts/email.ts`, `email.test.ts` | V (text and code names) |
| 87 | `/ops` is viewable without a passcode (viewer); acting needs the staff passcode | R T S VJ AJ Pa | `web/src/server/ops/handler.ts` (`opsRead`, `STAFF_ONLY`), `viewer.ts`; `/ops/agents` fetched without a session on 15 Nov | V |
| 88 | On `/ops/platform` visitors may send in the Aiven agent (3 an hour per address), ask the platform (20 an hour, 400 a day) and time the search backends (1 per 10 minutes, 60 a day) | T AJ Pa | `web/src/server/ops/try-caps.ts` | V (code) |
| 89 | Six agents, one gate: the kitchen's buying agent (typed or hands-free voice), the wholesaler's selling agent, the watch, the menu planner, any outside agent (MCP, REST/OpenAPI), the operations copilot | R P S Q Vd | `web/src/app/_landing2/landing2.text.ts` (`agents`, "Six agents, one gate") | V |
| 90 | The selling agent makes at most two offers a kitchen a week; an offer is never an order | S VJ | `web/src/core/offers.ts` (`OFFER_WEEKLY_CAP = 2`, "An offer is never an order"); `web/docs/offers.md` | V |
| 91 | Hands-free voice is one mode; spoken words go through the same engine as typed ones | R T S Q | `web/docs/doors.md` ("parity by construction"); `server/thread/voice-bridge.ts`; `voice-parity.test.ts` | V (doc and test exist; test passes in the suite) |
| 92 | Hands-free with real audio and the live models: 27 conversations, 45 utterances, every one relayed to the engine; 25 of 27 ended exactly as the typed run | Q | `web/docs/doors.md` ("Real audio, hands-free, live models"), `web/eval/voice/results/caps-gemini-3.8-live.json` (`relayed` 45 of 45, `outcomeSame` 25 of 27) | V (results file). Heard right: 36 of 45, by the rule now stated beside the doc's table (at most one word in five wrong, compared as written, so "200" against "two hundred" counts as wrong); 6 of the other 9 differ only in how a number is written, 3 are real mishearings. The doc's earlier "42 of 45" counted digits and number words as equal and was corrected on 15 Nov. The scripts use only 45 of 45 relayed and 25 of 27 |
| 93 | The agent's steps are shown open, in plain words; lists are open by default | R T | `web/src/app/_landing2/reel-thread.json` (`stepsViewAsShown`); `demo-script-sunday.md` ("steps open") | D |
| 94 | A backup is offered for a product with a poor delivery record, at most one sentence per order | R S VJ | `web/src/server/thread/backup.ts`, `web/src/server/reliability/` | V (code) |
| 95 | Receipts and alerts by email are built; with the default sender, Resend delivers only to the Resend account's own address, so real delivery needs a verified sending domain | R T S VJ Q | `web/docs/mail.md` ("The sender, and what the user must do in Resend"); `server/notify/` | V (doc and code). The domain is **not set up** |
| 96 | Search, right product first on 189 requests over 17,546 products: BM25 31 %, keyword 40 %, standard hybrid 58 %, semantic k-NN 72 %, AimoPilot 97 % | T P S Q VJ Vd | `web/docs/smart-search.md` ("Evaluation", "Common practice"), `web/src/app/_landing/search-eval.json` (measured 14 Nov) | D (not re-run). These are set-ups the team built and ran, not other companies' products |
| 97 | On the hosted site recall asks Aiven for OpenSearch first (keyword lists and vectors), memory as the fallback | R S AJ Pa | `/api/health` on 15 Nov: `dataPlane.recall.order: [opensearch, memory]`, `answered.opensearch: 3`; `infra/aiven-deploy.mjs` (`DOCK_SEARCH_RECALL_BACKEND=opensearch`) | V. `web/docs/smart-search.md` said memory stays first; corrected there with a note |
| 99 | Eight Aiven services, one job each: Runtime, PostgreSQL, Kafka, Valkey, OpenSearch, Grafana, Managed Agents, Aiven MCP server | R S P Q Pa AJ Vd | `web/src/server/aiven/showcase/platform.ts` (`JOBS`); landing page "On Aiven, one job per service" | V |
| 99a | Grafana holds the dashboard and alert rules | S AJ Pa | `infra/grafana/provision.mjs` (rules provisioned "when this Grafana allows"; otherwise the app's own alert table) | Partly: whether the rules are in Grafana now is **not verified** |
| 101 | The operations pages show a marked sample week, played through the real gate with scripted inputs in the sample's own kitchens; "Hide the sample" | R T S | `web/src/server/alive/story.ts`, `marks.ts`; `web/src/app/ops/_ui/sample.text.ts` | V (code) |
| 103 | The partner's full two-sentence example ("I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.") runs the whole path, as does its first sentence alone | T VJ S | `docs/pitch/table-demo.md`; run on the hosted site on 15 Nov (two reviewers, two phones, both sign-offs) | V (hosted run, 15 Nov about 04:35) |
| 104 | The Hotel Lumo path's wording (the exception first, three carton options, the slab, "Send to my phone", the refused "Ignore the limit…") | T P | `docs/pitch/demo-script-sunday.md` | D |
| 105 | The film: nine scenes; its figures (about 17,000 products, three priced, twenty rules, 72 % and 97 %) match this ledger | Vd | `video/src/script.json` on `origin/claude/video-3` (`cea872b`) | V (script read). The memory scene's 4,000 against 400 litres is an illustration, **not a recorded run** |
| 107 | The kitchen's agent runs on Claude Opus 5.5 | S | `web/src/server/thread/agent.ts` (`AGENT_MODEL_DEFAULT`); deployed `DOCK_AGENT_MODEL` not visible | V (default). Deployed value **not verified** |
| 108 | A placed order waits for a person on the wholesaler's team, who confirms it for delivery or says it cannot be delivered; the kitchen is told in its conversation (and by email when it gave an address); the price and the signed receipt do not change | R S T Vd | `web/src/server/fulfilment/service.ts`, `web/src/server/thread/fulfilment.ts`, `web/e2e/demo/wholesaler-confirm.spec.ts`; `web/docs/assumptions.md` (Orders) | V (code and browser test, 15 Nov) |
| 109 | After an order is placed (alone or after the phone's OK) the conversation says it is recorded at the fixed price and is with the wholesaler's team to confirm for delivery | T Vd | `web/src/server/notify/say.text.ts` (`withTeamHere`), `web/src/server/thread/engine.ts` (`afterSignOff`), `after-signoff.test.ts` | V (code) |
| 110 | Each product in a list and each option shows its delivery record (the share of past deliveries that arrived as ordered) and an estimated footprint; the footprint is the product group's average per kilo, always shown with "≈", never a measurement of the product | R S Vd | `web/src/core/line-marks.ts`, `web/src/server/thread/marks.ts`, `web/src/app/k/[kitchen]/thread-marks.tsx` | V (code) |

## Described by the team, not verified (kept out of the scripts, or stated with the limit)

1. **The crash-test licence on the live gate.** Enforcement exists behind a switch and is tested; on the hosted site
   no licences are published, so nothing is enforced. Scripts say it "can" cap an agent and is not switched on.
2. **"Open interface that consumer assistants use without custom integration."** Only Claude Code and Gemini CLI were
   run; the Claude app and ChatGPT were not. The seven frameworks ran against a local server.
3. **The alternatives map and good-better-best.** The map does not feed the option cards. Kept separate in every file.
4. **The stand-alone menu planner with allergens.** Open on `/plan/kaari` (row 29). Left out of the table demo.
5. **Recall radar on "the live web".** Readers are tested on recorded pages; no recorded run shows a real notice
   matching a product.
6. **Passkeys and voice on real phones** are not recorded in the repository (tests use a virtual authenticator and
   synthetic or recorded audio). The team has used the live site from phones; nothing records it.
7. **Email to real inboxes**: not possible until a sending domain is verified.
8. **A hospital kitchen**: not built. (The proactive selling agent is now built: row 90.)
9. **Market size, error rates, customer interest**: none sourced. No such figure appears anywhere in these files.
10. **Speed and latency figures**: deliberately left out of every public document, though some are measured in
    `web/docs/`.

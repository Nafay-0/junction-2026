# Dock QA report

Build under test: `main` at `d7611f0` (Sat 14 Nov 2026, includes the fix branch `b155a58`), production build
(`pnpm build && pnpm start`) on servers QA ran itself: the real catalogue with the partner's live API (4310, 4316),
the seed catalogue with rate limits off (4311, 4312, 4317), with the public limits on (4314), and the real catalogue
pointed at a fake partner (4315 + `qa/bin/fake-partner.ts` on 4399). Machine-readable twin:
[`findings.json`](findings.json). Harness: `cd web && pnpm qa` (see [How to re-run](#how-to-re-run)).

Severity: **lose demo** = a judge on the demo path or trying the obvious thing hits it; **lose points** = a judge
probing controls, data or exceptions finds it; **cosmetic** = visible, harmless.
Criteria: Demo (30 %), Need (20 %), Controls (20 %), Robustness (15 %), Openness (15 %).

## Re-test of wave 1 (13 findings) on `d7611f0`

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Pending sign-off holds the budget; next judge gets no options | **closed** | a waiting order no longer blocks a new one (the clash is settled at sign-off); withdraw works; three attempts in a row each reach sign-off |
| 2 | Demo kitchens' sign-offs impossible in production | **closed, not verified end to end** | console now answers `mode: "enrol"` (presenter enrolment behind the ops passcode); QA did not use the passcode |
| 3 | Shared live-lookup allowance: request 31 gets 429 | **closed** | 31 visitors in an hour all answered; 30 anonymous catalogue checks no longer starve a visitor |
| 4 | Ledger open to anyone | **closed** | anonymous read: head and verification, 0 entries |
| 5 | Agent confirms a mistake as the head chef | **closed** | logged "Relayed by the agent, not verified"; new rule `human_confirmation` sends the order to a person, also under the limit (9, 10, 1,100 L) and over MCP |
| 6 | Substitution rules only bind declared substitutes | **closed** (when the request names a product) | undeclared AR-2010 for VA-1010 fails `substitution_rule` and `substitute_price` |
| 7 | Approvals and events open | **closed** | 401 `not_signed_in`; stranger's stream carries one org at most |
| 8 | Stranger triggers a visitor's demo order | **closed** | refused |
| 9 | Stranger acts as a visitor's agent via the console | **closed for visitor kitchens** | 401; the two demo kitchens stay open by design |
| 10 | Interpreter unmetered | **mostly closed** | 30/hour per session or agent; daily cap now also counts the assistant. Left: the daily cap is one counter per server, so one spender switches free text off for everyone until midnight UTC |
| 11 | "No options" hides the budget | **closed** | "Nothing fits. The blocker is the weekly budget: … €678.00 left …" |
| 12 | Quote usable on another request | **closed** | refused |
| 13 | Gate counts days in UTC | **closed** | 0 of 144 sampled hours wrong |

Also closed on `b155a58`: `/ui-api/kitchens/<visitor>/connect` handed a stranger the visitor kitchen's mandate token
(found on `a4177b9`, probe `portal.connect_hands_out_mandate`).

On the fix agent's note about finding 1: agreed. Counting a pending order only until its quote expires would still
fail `demo.headline_twice_laakso`, which retries at once, inside the 30-minute quote life; settling the clash at
sign-off is the better fix and passes.

## Open findings, most damaging first

### 1. The menu planner ignores the kitchen's forbidden allergens: hazelnuts quoted and auto-approved for Kaari
- **Severity** lose demo. **Criteria** Controls, Need. **Probes** `safety.plan_*`.
- **Reproduce** `POST /ui-api/plan/kaari {"text":"Beetroot salad topped with toasted hazelnuts, 15 g hazelnuts per cover, for 40 covers next Wednesday"}`, then `/quote` (real catalogue). `GET /ui-api/plan/kaari` shows `forbiddenAllergens: []`; Kaari's console mandate forbids `nuts`.
- **Expected** the nut line blocked or refused by the gate.
- **Actual** 476774 "Salliselta Hazelnut 800g" (contains nuts by its data), quote €34.62, preview `auto_approve`. Laakso (forbids gluten): PK-4001 oat drink, which contains gluten, chosen, status ready. Seen three times.
- **Cause** `web/src/server/agent/menu/kitchens.ts:85,94` and `:127,137`: the planner signs its own mandate for the same organisation, with every food category and without the kitchen's allergen rules; `findCandidates` (`service.ts:311,547`) never gets the request's own allergens.
- **Fix** derive the planner mandate from the kitchen's mandate (forbidden allergens, required attributes) and pass the request's allergens into matching.

### 2. After one signed 1,000 L order a demo kitchen cannot take Valio's example again for a week
- **Severity** lose demo. **Criteria** Demo, Robustness.
- **Reproduce** fresh server; commit one 1,000 L Laakso order (€1,322); `/k/laakso` asks the same.
- **Actual** `no_options`: "The blocker is the weekly budget: … €678.00 left of €2,000.00 this week (€1,322.00 already committed)". One rehearsal on the deployment uses up the headline for the week.
- **Cause** `web/src/server/dev-fixtures.ts` `weeklyBudgetCents: 200_000` against a €1,322 headline order.
- **Fix** give the demo kitchens a budget that fits a day of judging (e.g. €50,000) or reset demo spend daily.

### 3. The knowledge map accepts allergen words it does not know and calls nut products "verified"
- **Severity** lose points (allergen-safe substitution is one of Valio's scenarios). **Criteria** Controls, Need. **Probe** `safety.knowledge_unknown_allergen_word`.
- **Reproduce** `GET /ui-api/knowledge/role?q=pesto%20for%20pasta&allergens=tree_nuts`: 9 pestos containing nuts, each "allergens verified"; `q=granola for breakfast&allergens=peanut` returns 471758, which contains peanuts.
- **Cause** `web/src/server/knowledge/service.ts:81-89` checks only the word's format.
- **Fix** map synonyms (tree_nuts → nuts, peanut → peanuts) and answer 400 to unknown allergen words.

### 4. Forbidding "lactose" on the knowledge map still serves ordinary milk as verified
- **Severity** lose points. **Probe** `safety.knowledge_lactose_as_allergen`.
- **Reproduce** `GET /ui-api/knowledge/role?q=milk%20for%20coffee&allergens=lactose`: 460396, 463149, 463938, 465058, 475665 (milk, no lactose-free claim).
- **Cause** `facts.ts:79`, `map.ts:570` compare raw allergen tags; milk does not imply lactose for candidates.
- **Fix** treat "contains milk, no `lactose_free`" as containing lactose.

### 5. "Buy 50 kg of beef" shows a developer error and leaves no refusal anywhere
- **Severity** lose points. **Criteria** Need, Controls.
- **Reproduce** console intake `{item:{text:"beef"},quantity:{amount:50,unit:"kg"}}` → 422 `family_unknown`: "No product family matches "beef". Send item.category (for example "milk")." Nothing on the wall, in the ledger or in ops. Seen three times (browser and API).
- **Cause** `web/src/core/intake.ts:169` throws before a request is opened.
- **Fix** open the request and refuse it with `category_allowed`, in words a chef understands.

### 6. The duplicate check misses an identical order still waiting for sign-off
- **Severity** lose points. **Criteria** Need, Controls.
- **Reproduce** Kaari: 100 L milk for Thursday waits for sign-off; submit the same need again → `options_ready`, no concern; two identical orders wait for the same person (`order_splitting` counts only orders the agent placed alone).
- **Cause** `web/src/core/concerns.ts:379` reads committed history only. **Fix** include the org's pending orders.

### 7. Two open order pages behind one venue address exceed the console's address limit
- **Severity** lose points. **Criteria** Demo, Robustness. **Probe** `limits.two_waiting_pages_block_kitchen`.
- **Reproduce** `LIMITS=on qa/bin/fresh-server.sh 4314; pnpm qa --limits-url http://localhost:4314 --only limits.two`: two pages polling as `console.tsx:239-258` does (order every 3 s, ledger every 4 s, with the event stream up) for 75 s from one address: 92 calls, 10 refused 429 "Too many requests from your address".
- **What a demo table sees**: one page watching a waiting order costs about 35 console calls a minute against `console-call` 60/min per address (`src/proxy.ts:18`), so behind one venue address only one such page works; a second phone's page starts failing within the minute and so do new requests from that address. `agent-write` 120/min per address is not reached by people. The per-kitchen console limit (now 120/min) was not hit.
- **Fix** do not poll while the event stream is up (refetch on events), or key the console limits by console session. The harness should keep running with `DOCK_RATE_LIMITS=off` (it is hundreds of agents behind one address); the limit probes run against a second server with limits on.

### 8. A stranger can make a demo kitchen forget its stated rules
- **Severity** lose points. **Probe** `portal.memory_rule_forgotten_by_stranger`.
- **Reproduce** anonymous `POST /ui-api/kitchens/kaari/memory {"action":"forget","preferenceId":"pref_kaari_lactose"}` → 200; "Always lactose-free" is gone for every visitor (partly masked by a learned habit).
- **Fix** make memory writes on demo kitchens per console session, or reset them.

### 9. The assistant finds no substitute within Kaari's rules; the knowledge map has five
- **Severity** lose points. **Probe** `safety.assistant_substitute_respects_rules`.
- **Reproduce** `POST /ui-api/kitchens/kaari/assistant {"question":"Suggest a substitute for this cream for whipping desserts.","productId":"469050"}` → "cannot suggest a substitute".
- **Cause** `web/src/server/kitchen-assistant.ts:106`. **Fix** use `alternativesFor` with the mandate and stated rules.

### 10. "Can it arrive tomorrow?" gets no live lookup and "no delivery data"
- **Severity** lose points. **Probe** `safety.assistant_arrival_question_looked_up`.
- **Cause** `kitchen-assistant.ts:29` `LIVE_WORDS` lacks arrive/tomorrow/when. **Fix** always look up the product on screen for date and stock questions.

### 11. A rate-limiting or hanging partner API makes the buyer wait 30-36 s
- **Severity** lose points. **Criteria** Robustness. **Probe** `dependency.partner_failures`.
- **Actual** partner 429 with `Retry-After: 30` → 30 s, then `live_unavailable`; answers after 20 s → 36 s. Partner down, non-JSON, and hostile values (negative and huge prices, past validity, negative and sentinel stock, missing and extra products, non-dates) all answer fast and correctly: no bogus price reaches a card, quote or order.
- **Fix** cap the total wait per buyer request (about 8 s) and report "busy, retry in N s" instead of sleeping on it.

## Seen in the browser (wave 2, on `a4177b9`), worth a look

From a Playwright pass over every page at 360/768/2560 px, keyboard only, slow network and hostile text
(screenshots in the QA scratchpad). Reproduced twice unless marked once.
- Reloading the order page discards a live fixed price ("Not ordered.", no way back), and the wall keeps a "Price fixed" row for it (`console.tsx:49`). Lose points.
- Opening `/k/kaari` home adds a wall row stuck at "Checking live prices", described as "products the buyer opened in the catalogue" (`kitchen-portal.ts:371`). Lose points.
- The approval screen does not show the "Check the amount: first order, 1,000 L is a large one" note the order page promises the signer (`approval-view.ts:158`). Once. Lose points.
- Suspending an agent while its order page is open turned each 3 s poll into a ledger refusal: 14 identical "Suspended" cards on the wall in 34 s. Once. Lose points.
- A suspended agent looks normal on the kitchen home page. Lose points.
- Below 1280 px the order page has no text field; the floating "Ask the purchasing agent" button covers a card's "Get a fixed price for this". Cosmetic.
- Wording: "Best Best price", "Repeat: Repeat: …", "Sat 14.11..", "ordered 1 hour ago" for 3 minutes, money as "129,00 €" in ops and "€129.00" elsewhere, quote validity "Fri 13.11. 00.33" for Sat 00:33 (`_ui/plain.ts:187`), the voice agent says "valid until … UTC" (`say.ts:81`). Cosmetic.
- On the seed catalogue every delivery is "Saturday" whatever the kitchen's delivery days (`core/catalog.ts:279`). Seed only. Cosmetic.

## Improvements

- Pack and piece amounts follow memory's reference pack: "20 packs" of milk was 20 L on one server state and 200 L on another; the correction "Make it the usual 110.5 packs" means 110.5 litres. Ask which pack when a family sells 1 L and 10 L, never offer fractional packs (`concerns.ts:127-135, 296-297`).
- The daily model cap is one counter per server: a per-session share of it would stop one spender switching free text off for every judge.

## What held (evidence the team can show)

Across the full run on `d7611f0`: 65 probes, 911 cases, 823 HTTP calls, **0 server errors, 0 stack traces, 0 secret
values**, the ledger verified after every run.
- Altered quote payloads (price 1 cent, expiry +1 year, forged attributes): 422 `quote_signature_invalid`. Order lines that differ from the quote (quantity, price, extra, duplicate): 422 `order_matches_quote`. Same over MCP.
- **8 orders racing on one quote: exactly 1 committed. 12 orders racing on a budget for 5: exactly 5 accepted.**
- Mandates altered, forged with the real key id, expired, not yet valid, `alg: none`, HS256, garbage, wrong agent, missing: 401/403 with a rule, over REST and MCP.
- Cross-organisation quote, request, order and intake: refused or 404. Category, attribute, allergen and certificate rules each refuse with their own name. Splitting a need under the limit escalates.
- The agent cannot approve its own order five ways; passkey sign-off works end to end; approving twice → 409; another visitor's passkey or session cannot approve or decline.
- Conversion grid (19 amounts in L, kg, packs, pieces): totals = packs × price, quote = card, order = quote, no full match under-delivers or adds a whole pack; partial stock splits across two products.
- Hostile structured needs, 5 MB and chunked bodies (refused at once), 50,000-deep JSON, lone surrogates, RTL/NUL: 4xx, never 5xx. Hostile text renders as text on every screen (browser).
- Partner API down / 429 / garbage / hostile values: `live_unavailable` naming the wholesaler's service, no bogus price anywhere.
- Knowledge map with real kitchen constraints: 518 served substitutes and 4,843 relations checked, 0 violations when the allergen words are its own. Assistant refused prompt injection and forged context, called missing allergen data "unknown, not free", invented no price. Planner arithmetic exact for 10, 100, 1,000 covers.
- Keyboard-only flow works; no horizontal scroll at 360/768/2560 px; double clicks make one quote and one approval.

Candidates discarded: 12 (5 in wave 1, listed in `findings.json` history; 7 in the safety pass, e.g. a wrong
"delivered" date seen in 1 of 3 tries, documented knowledge-map exceptions, and probe artefacts).

## Coverage

Probe cases by area and kind, one full run (seed 20261113; the corpus and safety probes add the language column):

| area | plausible | hostile | boundary | sequence | authority | exhaustion | inconsistency | language |
|---|---|---|---|---|---|---|---|---|
| gate / quotes / mandate | 1 | 15 | 15 | 6 | 14 | | 1 | |
| intake / conversion / dates / memory | 5 | 9 | 25 + 144 | 4 | 4 | | | |
| interpreter | | | | | | 4 | | CORPUS_CASES |
| knowledge / planner / assistant / voice | SAFETY_CASES | | | | | | | |
| ledger / sandbox / rest / mcp | 2 | 14 | | | 10 | | | |
| dependency / screens | | 12 | | | | 63 | | |

Partner live lookups used in the whole session: about 20 (budget: well under 150). Model spend: under $3
(corpus generation with Sonnet about $1.0, corpus interpretation with Haiku, assistant/planner probes, browser pass).

**Not tested, and why**: signing as a presenter (needs the ops passcode, deliberately not used); a real voice call
(Gemini Live needs a microphone); passkeys on a real phone (software and virtual authenticators only); the public
deployment and the Aiven databases (out of scope); an authority pass over the new doors (connector tokens
`/api/mcp/c/<token>`, `/ui-api/memory/**`, scan, voice for another kitchen, ops-api without the passcode) was started
by a sub-agent that the model provider's safeguards stopped before it reported; it remains to be done by hand.

## How to re-run

```bash
cd web && pnpm build
qa/bin/fresh-server.sh 4312                                # seed catalogue, limits off
qa/bin/fresh-server.sh 4310 real                           # real catalogue (rationed live lookups)
LIMITS=on DOCK_LLM_DAILY_CALLS=3 qa/bin/fresh-server.sh 4314   # public limits on, tiny model cap
pnpm tsx qa/bin/fake-partner.ts 4399 &                     # fake partner API
VALIO_API_BASE=http://localhost:4399 qa/bin/fresh-server.sh 4315 real

pnpm qa --url http://localhost:4312                        # core run: free, CI-friendly, exits 1 on any failure
pnpm qa --url http://localhost:4312 --real-url http://localhost:4310 \
        --limits-url http://localhost:4314 --dep-url http://localhost:4315 --fake-url http://localhost:4399
pnpm qa --corpus          # re-interpret the 336-case corpus (paid, Haiku); cached in qa/corpus/interpretations.json
pnpm qa --regen-corpus    # regenerate the corpus with a model first
pnpm qa --list | --only gate,intake | --seed 7 ; QA_URL=https://host pnpm qa  (a server you run; it places orders)
```

Results: `web/qa/results/<date>-seed<seed>.json` (summary, coverage matrix, failures and notes per probe);
`web/qa/results/baseline.json` is the wave-1 run. Mandate probes mint mandates with the demo organisations' keys
from the environment; against a server with other keys they are skipped, not failed.

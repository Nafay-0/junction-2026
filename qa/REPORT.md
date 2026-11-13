# Dock QA report

Build under test: `main` at `b513f44` (Fri 13 Nov 2026), production build (`pnpm build && pnpm start`) on local
servers: the real catalogue with the partner's live API (port 4310), and the 12-product seed catalogue (4311, plus a
freshly restarted 4312 for the probes that need a clean server). Machine-readable twin: [`findings.json`](findings.json).
Harness: `cd web && pnpm qa` (see [How to re-run](#how-to-re-run)).

Status: **wave 1** (gate, intake, conversion, dates, authority). Browser, MCP, interpreter corpus and the buyer-agent
runner come in wave 2.

Severity: **lose demo** = a judge following the demo path or trying the obvious thing hits it; **lose points** = a judge
probing controls, data or exceptions finds it; **cosmetic** = visible but harmless.
Criteria: Demo (30 %), Need (20 %), Controls (20 %), Robustness (15 %), Openness (15 %).

## Findings, most damaging first

### 1. A sign-off nobody can give holds the kitchen's weekly budget; the next judge's milk order has no options
- **Severity** lose demo. **Criteria** Demo, Robustness. **Probe** `demo.headline_twice_laakso`.
- **Reproduce** `qa/bin/fresh-server.sh 4312 && pnpm qa --url http://localhost:4312 --only demo.headline`
  1. Fresh server, `/k/laakso`, Valio's example: 1,000 L lactose-free milk for the next weekday. Choose, place: waits for sign-off (€1,322 > €1,000 limit).
  2. Ask the same again.
- **Expected** options again; a pending order whose quote has expired stops holding budget.
- **Actual** `no_options`. Every product is excluded `over_budget` ("€678 left") because the first order, still pending (and on a production build unsignable, see 2), counts as spent for 7 days. There is no cancel.
- **Cause** `web/src/core/orders.ts:266-273` (`spentThisWeek` counts every `pending_approval` order, no quote-expiry check); nothing expires a pending approval.
- **Fix** count a pending order only until its quote expires (or expire the approval with its quote and log it); add a withdraw call.

### 2. On a production build the demo kitchens' sign-offs cannot be given
- **Severity** lose demo. **Criteria** Demo, Controls. **Probe** `demo.headline_twice_laakso`.
- **Reproduce** production build without `DOCK_DEMO_TAP_APPROVAL`; order over the limit on `/k/laakso` or `/k/kaari`; `GET /ui-api/kitchens/laakso/approval/<id>` returns `mode: "view_only"`.
- **Expected** a QR/link with which the (fictional) named approver can sign on stage.
- **Actual** view only. The one-time link lives only in the outbox, which is 404 in production. The order stays pending forever and feeds finding 1.
- **Cause** `web/src/app/ui-api/kitchens/[kitchen]/approval/[approvalId]/route.ts` (`allowed = NODE_ENV !== "production" || demoTapEnabled()`).
- **Fix** set `DOCK_DEMO_TAP_APPROVAL=1` on the demo deployment or give the demo kitchens' approver role a passkey path; say on the console who can sign. (Not checked: the public deployment's env. The QR-code visitor path is not affected.)

### 3. Every visitor of a demo kitchen is the same agent: request 31 in an hour gets 429 for everyone
- **Severity** lose demo. **Criteria** Demo, Robustness. **Probe** `demo.shared_live_allowance_kaari`.
- **Reproduce** fresh server, 31 requests on `/k/kaari` within an hour.
- **Expected** every visitor gets an answer.
- **Actual** request 31: `429 live_lookup_budget_exceeded` ("This agent already made 30 live price/availability lookups in the last 60 minutes"). An intake costs 1-2 lookups and a quote one more, so a busy stand loses the kitchen after ~10-15 visitors, for the rest of the hour.
- **Cause** `web/src/core/live-allowance.ts:17-21` (30 calls/60 min per org:agent) + `web/src/server/console-kitchens.ts` (one agent id per demo kitchen).
- **Fix** key the allowance per console session on the demo kitchens (or raise it there) and cache live answers per product and date for a few minutes; tell the visitor when to retry.

### 4. Anyone reads every kitchen's ledger with no credentials
- **Severity** lose points. **Criteria** Controls, Openness. **Probes** `exposure.ledger_public`, `exposure.console_ledger_cross_kitchen`.
- **Reproduce** `curl -s http://localhost:4311/api/v1/ledger`; or Kaari's console back end `POST /ui-api/kitchens/kaari/call {"method":"GET","path":"/api/v1/ledger"}` returns Laakso's entries.
- **Expected** a buyer sees its own organisation; strangers see the head and verification only.
- **Actual** all entries of all organisations: request texts, prices, decisions, approver names (480+ entries, 58 actors on one run).
- **Cause** `web/src/app/api/v1/ledger/route.ts` has no `authenticate`; the console allow-list forwards it (`.../call/route.ts:22`).
- **Fix** authenticate and filter by the mandate's org; keep `verify()` over the whole chain.

### 5. The agent can "confirm" a likely mistake itself, recorded as the head chef's confirmation
- **Severity** lose points. **Criteria** Controls, Need. **Probe** `intake.tenfold_confirmed_by_agent`.
- **Reproduce** as Kaari's agent: `POST /api/v1/intake` 1,000 L milk (`needs_confirmation`, `quantity_tenfold`), then `POST /api/v1/intake/<id>/concerns {"by":"Sanna Koskinen (head chef)","responses":[{"key":…,"choice":"confirm"}]}` with the same mandate.
- **Expected** only the human answers a human-input step (or the ledger says "relayed by the agent, unverified").
- **Actual** 200, `options_ready`; ledger actor `buyer:Sanna Koskinen (head chef)`: "Sanna Koskinen (head chef) confirmed as intended: 1,000 L …". The quote/order calls do refuse while the concern is open (that part holds).
- **Cause** `web/src/core/intake.ts:96-104` (`by` is free text), `respondToConcerns` (`intake.ts:425-462`) authorises with the mandate only.
- **Fix** log it as relayed and unverified, and send a confirmed tenfold/unusual quantity to sign-off unless the confirmation carries a human proof.

### 6. Substitution rules only bind substitutes the agent declares
- **Severity** lose points. **Criteria** Controls. **Probes** `gate.substitution_undeclared`, `gate.substitute_price_reference`.
- **Reproduce** mandate `substitution.rule = "none"`, request for 20 × VA-1010. Quoting AR-2010 `substituteFor: VA-1010` is refused; quoting AR-2010 without `substituteFor` commits. Under `within_preferences` +10 %, JP-3010 (+25.6 %/L over VA-1010) fails, but passes when declared a substitute for VA-1201.
- **Expected** the gate knows what was asked for and treats anything else as a substitute of it.
- **Cause** `web/src/core/policy.ts:169-211` judges only lines with `substituteFor`; `web/src/core/quote.ts:157-170` takes it from the agent; requests carry only free text.
- **Fix** store the requested product (or the intake's chosen card) on the request; the quote marks every other line as its substitute and prices against it.

### 7. Pending sign-offs, the sign-off screen and the event stream are open to anyone
- **Severity** lose points. **Criteria** Controls. **Probes** `exposure.approvals_public`, `exposure.events_public`.
- **Reproduce** `curl -s localhost:4311/api/v1/approvals`; `curl -s localhost:4311/api/v1/approvals/<id>`; `curl -sN 'localhost:4311/api/v1/events?since=0'`.
- **Actual** every org's pending orders (lines, totals, reasons), the full sign-off view (kitchen, approver name, items) and every org's events.
- **Cause** `web/src/app/api/v1/approvals/route.ts` ("APPROVER-AUTH SEAM: open today"), `approvals/[approvalId]/route.ts` GET, `events/route.ts`.
- **Fix** require the approver session; give the wall its own feed.

### 8. A stranger can list visitors' kitchens and make their agents order
- **Severity** lose points. **Criteria** Controls, Demo. **Probe** `sandbox.stranger_triggers_demo_order`.
- **Reproduce** `GET /api/v1/sandboxes` lists every `sbx_` id; `POST /api/v1/sandboxes/<id>/demo-order` (no credentials) → 201, a new sign-off request on that visitor's phone; repeatable.
- **Cause** `web/src/app/api/v1/sandboxes/[sandboxId]/demo-order/route.ts` has no check.
- **Fix** require the visitor's session or a wall token; list names, not ids.

### 9. Anyone who knows a kitchen's slug acts as its agent through the console back end
- **Severity** lose points. **Criteria** Controls. **Probe** `sandbox.stranger_spends_visitor_budget`.
- **Reproduce** take an `sbx_` id from finding 8; drive intake → choice → order through `POST /ui-api/kitchens/<sbx_id>/call`: the order commits on the visitor's kitchen (within €500).
- **Cause** `web/src/app/ui-api/kitchens/[kitchen]/call/route.ts` attaches the mandate for any caller (the DEMO NOTE in `console-kitchens.ts`).
- **Fix** require the visitor's session for `sbx_` consoles.

### 10. The paid interpreter is reachable anonymously with no limit
- **Severity** lose points. **Criteria** Robustness, Openness. **Probe** `exposure.interpret_unmetered`.
- **Reproduce** `POST /ui-api/kitchens/kaari/call {"method":"POST","path":"/api/v1/agent/interpret","body":{"text":"10 L milk for Tuesday"}}` in a loop: every call is a model call, no 429.
- **Fix** per-client token bucket + daily cap; cache by (text, day).

### 11. "No options" leads with stock and dates when the budget is what blocked it
- **Severity** lose points. **Criteria** Need, Robustness. **Probe** `demo.headline_twice_laakso`.
- **Actual** "Nothing on the short list can be delivered in time…: earliest delivery Thu 19 Nov…; only 400 L in stock…"; the four `over_budget` exclusions are cut off.
- **Cause** `web/src/core/intake.ts:539-544` takes the first three distinct reasons in list order.
- **Fix** lead with the reason that removed most products, budget and cut-off first.

### 12. A quote for one request can be ordered on another request
- **Severity** lose points. **Criteria** Controls, Openness. **Probe** `gate.quote_other_request`.
- **Reproduce** quote on request A, `POST /api/v1/orders` with `requestId: B`: committed under B; the ledger has the quote under A and the order under B.
- **Cause** `web/src/core/policy.ts:106-111` (`quote_binding` omits `requestId`).
- **Fix** one line: add the quote's `requestId` to `quote_binding`.

### 13. 00:00-02:00 Helsinki, the gate's latest delivery day is one day short
- **Severity** lose points (night only). **Criteria** Robustness. **Probe** `dates.gate_latest_day_helsinki`.
- **Actual** 14 of 144 sampled hours refuse a delivery exactly `maxLeadDays` Helsinki days ahead ("after the latest acceptable date 2026-11-18" for Thu 19 Nov at Sat 00:00).
- **Cause** `web/src/core/policy.ts:160`, `web/src/core/options.ts:213` use a UTC date; the intake uses Helsinki.
- **Fix** `addDaysIso(localNow(now).date, maxLeadDays)` in both.

## Improvements (change what a judge or user experiences)

- **Pack and piece amounts follow memory's reference pack.** "20 packs" of milk became 20 L on one server state and 200 L on another, depending on which product memory took as the usual; the concern restates it in litres (good), but the correction reads "Make it the usual 110.5 packs" for 110.5 litres. When a family sells 1 L and 10 L packs, ask which pack; never offer fractional packs. (`web/src/core/concerns.ts:127-135, 296-297`)
- **A withdraw call** for pending orders (buyer and agent), logged; part of the fix for finding 1.

## What held (evidence the team can show)

All on the production build; 0 server errors, 0 stack traces and 0 secret values in 328 responses; the ledger verified after every run.
- Altered quote payloads (price to 1 cent, expiry +1 year, forged attributes) → 422 `quote_signature_invalid`, rule named.
- Order lines that differ from the quote (quantity, price, extra line, duplicate) → 422 `order_matches_quote`.
- A quote buys once, also with **8 orders racing on one quote: exactly 1 committed**.
- **12 orders racing against a weekly budget that fits 5: exactly 5 accepted**, the rest refused by `weekly_budget`.
- Mandates: altered limit, forged key with the real kid, expired, not yet valid, `alg: none`, HS256, garbage, wrong agent header, none at all → 401/403 with a rule.
- Cross-organisation: Kaari's quote under Laakso's mandate fails `quote_binding`; another org's request, order and intake are 404.
- Category, required attribute, forbidden allergen and certificate rules each refuse with their own rule name.
- Splitting 90 L into three €44.70 orders under a €50 limit: the parts that cross the limit go to a person (`order_splitting`).
- The agent cannot approve its own order (no proof, guessed token, demo tap and session proofs without the phone, junk passkey); the dev outbox is 404 in production.
- Passkey sign-off end to end with a software authenticator; approving twice → 409; another visitor's passkey or session cannot approve or decline.
- Conversion grid (19 amounts in L, kg, packs, pieces, including 9.5, 12.5, 99, 101, 333, 999 L): every card's total = packs × price, the quote buys exactly the card, the order exactly the quote, no full-match card under-delivers or adds a whole extra pack; 999 L splits 60 × VA-1010 + 40 × AR-2010 when stock is short.
- Intake sequence: choosing after quoting, answering after quoting, concerns out of state → 409 `intake_wrong_state`.
- Hostile needs (markup, 200 emoji, 201 chars, path-like category, SQL-like product id, `__proto__`, 11 claims, unknown unit, wanted-and-excluded) → 4xx with a code, never 5xx. Malformed JSON, 5 MB bodies, 50,000-deep nesting, text/plain, lone surrogates, NUL/RTL → 4xx or handled.
- Dates: yesterday → `delivery_in_past` (not confirmable); impossible dates → 400; 60 days ahead → nothing beyond the mandate's lead time.

## Candidates discarded (5)
1. "101 L → 101 × 1 L cartons, the dearest": the goal was reliability, and that card is the most reliable. Correct.
2. "12 pieces of milk → 120 L": depends on memory's reference pack; reclassified as the improvement above.
3. The live allowance's 30-distinct-products cap tripping on the real catalogue after three families: did not reproduce in 6 intakes.
4. "6 L cream / 5 kg yoghurt: no options" on Laakso: correct, its mandate allows only milk and plant drinks.
5. "Vegan oat drink: no options" on Laakso: correct, the seed oat drink contains gluten, which the mandate forbids.

## Coverage so far (wave 1)

Probe cases per area and kind (seed 20261113; full matrix with wave 2):

| area | plausible | hostile | boundary | sequence | authority | exhaustion | inconsistency |
|---|---|---|---|---|---|---|---|
| gate | 1 | 4 | 2 | 2 | 8 | | |
| quotes | | 3 | 13 | 2 | 1 | | 1 |
| mandate | | 8 | | | 3 | | |
| intake / conversion / dates / memory | 4 | 9 | 25 + 144 | 4 | 3 | | |
| sandbox / ledger / rest / interpreter | 1 | 7 | | | 7 | 1 | |
| dependency | | | | | | 31 | |

Live lookups on the partner's API so far: 8. Model spend so far: under $0.05.

## How to re-run

```bash
cd web
pnpm build
qa/bin/fresh-server.sh 4312            # production server on the seed catalogue (DOCK_CATALOG=seed)
pnpm qa --url http://localhost:4312    # all probes, fixed seed; exits 1 on any failed probe or invariant
pnpm qa --list                         # what runs
pnpm qa --only gate,intake             # areas or id prefixes
QA_URL=https://your-host pnpm qa       # another address (a server you run; it places orders)
```

Results go to `web/qa/results/<date>-seed<seed>.json` (summary, coverage matrix, every probe's failures and notes).
The mandate probes mint mandates with the demo organisations' keys from the environment
(`DOCK_DEMO_ORG_JWK`, `DOCK_DEMO_KITCHEN_JWK`, or the public dev seed when unset); against a server with other
keys they are skipped, not failed.

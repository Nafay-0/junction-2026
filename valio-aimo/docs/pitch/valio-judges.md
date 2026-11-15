# For Valio Aimo's judges: the brief, line by line

Demo: `https://aimopilot.zeroanomaly.tech` (a custom domain in front of the app on Aiven Runtime; `/api/health`
names the deployed commit). Source: `valio-aimo/web/` in the repository. All kitchens, people and histories are
synthetic; product records (17,546) and live prices come from your challenge materials and test API. No order reaches
a real order system.

How to read the "Verified" column:
- **Yes**: we found it in the code, with a test, and it is reachable from the screen named.
- **Partly**: it is built but narrower than the brief's wording, or a known issue is open. The note says which.
- **No**: not built.

**Ways in** (`/k`): **Start a fresh kitchen** (one click, no rules, empty memory, private to your browser, kept for
24 hours without use), **Try a kitchen with rules** (Hotel Lumo kitchen: always lactose-free, €500 alone; Metsola
school kitchen: no nuts, peanuts, sesame or fish, nutrition rules for pupils; Kahvila Sointu: a small café, €60
alone, €400 a week; shared and reset every 60 minutes), or **Open your restaurant's account** (the full onboarding,
with a business email and a confirmation). The presenter's stage kitchen Ravintola Kaari has its own password. Below,
`/k/<kitchen>` means any of them. `/ops` is the wholesaler's portal: looking needs no passcode, acting needs the
staff passcode.

The quickest look at the whole flow: in Hotel Lumo kitchen, type "I need 1,000 litres of lactose-free milk by
Monday." (`table-demo.md`).

## Core requirements

| Brief | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| Product lookup | Search over master data in Finnish, Swedish and English, inside the kitchen's hard rules, before any live call: keyword and vector recall on OpenSearch, a decision model as judge, code checking the judge. 97 % right product first on 189 test requests (standard hybrid 58 %, semantic 72 %) | `/k/<kitchen>/catalogue`; the agent's steps; MCP tool `search_products` | Yes | `web/docs/smart-search.md`; `web/src/server/search/`; `/api/health` (`dataPlane.recall`: OpenSearch first, memory as the fallback) |
| Price and availability lookup | Live calls to your API for a short list only (at most 10 products per call, with a per-agent hourly allowance), cached for the price's validity | The agent's options in the conversation; MCP `check_availability` | Yes | `web/src/core/live-allowance.ts`, `live-allowance.test.ts`; `infra/aiven.md` (Valkey cache) |
| "Query the APIs only when needed, never for all products" | Master data narrows the choice first; going over the allowance is refused with rule `live_lookup_limit`; the crash test penalises scanning prices | `/ops/safeguards` | Yes | `web/docs/connect-an-agent.md` ("Live price and availability is for short lists only"); crash scenario `live-economy` |
| Inquiry to order at a fixed price | The intake (need, mistake check, at most two questions, options, choice) ends in a quote signed by the wholesaler (JWS, Ed25519); the order must match the quote exactly and a quote buys once | The conversation on `/k/<kitchen>` | Yes | `web/src/core/intake.ts`, `quote.ts`, `policy.ts` (`order_matches_quote`, `quote_replay`); QA wave 2: 8 orders racing on one quote, exactly 1 committed |
| Permission management | A mandate signed by the buyer organisation's own key: product groups, required claims, forbidden allergens, certificates, lead time, per-order limit, weekly budget, substitution rule, approvers and their amounts | `/k/<kitchen>/agent` ("Agent and rules"); MCP `read_mandate` | Yes | `web/src/core/mandate.ts`, `mandate.test.ts`; QA: altered, forged, expired, `alg: none` mandates all refused |
| Human approval management | Above the mandate, a named approver signs on their own phone with a passkey bound to that order's digest; no tool lets an agent approve | **Send to my phone** on the sign-off, then `/approve/<id>` | Yes | `web/src/core/approval.ts`, `passkeys.test.ts` ("a proof made for order A does not approve A after A was edited"); `web/e2e/approval.spec.ts`; `mcp.test.ts` asserts no approving tool |
| Mock today's webshop, not a marketplace | One wholesaler's store for professional kitchens; the agent works inside it | `/k/<kitchen>`; on the landing page, "How it looks on your webshop" | Yes | `web/docs/DESIGN.md` |
| "Not a chatbot over the webshop" | One conversation per kitchen, but the model writes at most one short line per turn; prices, stock, amounts and dates appear only in cards built from tool results and gate records (options, order sheet, sign-off). The agent's steps are shown open, in plain words. It asks only when the answer changes the order | `/k/<kitchen>` | Partly | `web/docs/agent-thread.md` ("What an agent turn is"); the line passes a grounding check or is not shown (`core/grounding.ts`). It is a conversation, so judge for yourself whether that meets the brief |

## Optional directions

| Brief | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| Delivery comparison | Option cards labelled by what they are best at, including "Most reliable delivery" from your delivery-reliability file; order cut-off is a first-class reason a product is unavailable | The agent's options; its steps ("Left out 17 products. The order cut-off for that day has passed …") | Yes | `web/src/core/options.ts` (labels; `cutoff_passed`), `options.test.ts` ("treats a passed order cut-off as the reason…") |
| Sustainability comparison | "Lowest carbon" label from your carbon file | Option cards | Partly | The figure is the product group's average (`carbonGroupAvgKgCo2ePerKg`, `web/src/core/catalog/partner.ts`), not per product |
| Substitutions | Within the mandate's rule and price tolerance; a product the request did not ask for is treated as a substitute | Option cards; gate | Yes, one gap | `policy.ts` (`substitution_rule`, `substitute_price`), `policy.test.ts` ("treats any product the request did not ask for as a substitute"). Gap: a bare REST request naming no product still relies on the agent declaring the substitute |
| Traceability | Signed origin statements; every step in a hash-chained ledger; recall radar holds products named in food-safety notices | `/k/<kitchen>/orders/<id>`; `/ops/audit`; `/ops/radar` | Yes | `web/src/core/claims.ts`, `ledger.test.ts`; `web/src/server/radar/radar.test.ts` (drill: refused at quote, order and sign-off) |

## What you said you would love to see

| Wish | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| **Trust protocol**: an outside agent can verify stock, price and origin without a manual check | Each price, availability and origin statement can be a W3C Verifiable Credential (compact JWS, Ed25519) checked offline against `/.well-known/jwks.json`; a quote names the statements it rests on by hash; order confirmations are signed too | `/ops/audit` "Check a receipt or a signed claim"; `/k/<kitchen>/orders/<id>` | Yes | `web/src/core/claims.ts`; `real-flow.test.ts` ("hands out signed claims an outside agent can verify offline…"); `pnpm verify:receipt` (orders and quotes) |
| **Guardrails model**: which decisions need sign-off | Alone: inside the per-order limit, like-for-like within tolerance. A person: over the limit, substitutes outside preferences, a confirmed unusual amount, split orders. Refused outright: weekly budget, forbidden allergens, product groups, recalled products | `/ops/safeguards`; the sign-off in the conversation | Yes | `web/src/core/policy.ts` (rule list), `policy.test.ts`, `orders.test.ts` |
| **Response logic, good-better-best** for partial availability and substitutes | Full matches ranked best, better, good by the buyer's goal; when nothing fully matches, every card is a compromise that says what it gives up (later day, other product, pack size, split across two products) | Option cards | Yes | `web/src/core/options.ts`, `options.test.ts` ("ranks full matches best, better, good…", "fills partial stock with an allowed substitute…") |
| **Audit trail** readable by buyer and by Valio Aimo | One ledger, two views: the kitchen's (with its own memory) and the wholesaler's (without the buyer's private memory); plain-language account of each request | Buyer: `/k/<kitchen>/orders/<id>`. Wholesaler: "See this order as the wholesaler sees it", `/ops/audit/<orderId>`, `/ops/trace/<id>` | Yes | `web/src/core/audit.ts`; `real-flow.test.ts` ("gives the wholesaler the chain without the buyer's private memory") |

## Example scenarios

| Scenario | What we built | Where | Verified | Note |
|---|---|---|---|---|
| Need → recipe → order | In the conversation, a dish request gets one skippable question (preferences, what you have), three ideas, then the dish in three groups, "You have / I'll order / Can't get", each with its reason; what the kitchen has is estimated from its order history; a line the kitchen's allergen rule stops at the gate is shown, not ordered | `/k/<kitchen>` ("plan a lunch for ten") | Partly | `web/src/server/thread/dish.ts`, `menu.ts`; needs a model. **Open:** the stand-alone planner (`/plan/kaari`) still signs its own mandate for Kaari with no forbidden allergens (`web/src/server/agent/menu/kitchens.ts`, QA finding 1) |
| Last-minute event | When nothing can arrive in time, the options say so with the earliest date; compromise cards offer a later day | `/k/<kitchen>` | Partly | "Through recipe logic rather than a SKU swap" exists in the dish flow, where the planner swaps by the ingredient's job in the dish, each swap checked against the kitchen's rules |
| Supplier stock-out | Partial stock is split across an allowed substitute; the card states the trade-off. The watch notices a product that cannot come before the kitchen does and asks before it switches; a backup is offered for a product with a poor delivery record | The agent's options; the kitchen's opening line | Yes | `options.test.ts`. Note: your API reports placeholder stock (999999) for Terminal products; we treat it as unknown, not as stock (`web/src/server/valio/valio-catalog.ts`) |
| Proactive selling agent | The wholesaler's selling agent: at most two signed offers per kitchen in seven days; an offer never buys, the kitchen's agent and the gate decide | The kitchen's conversation; `/ops/offers` | Yes | `web/docs/offers.md`. The crash test also checks that a buyer treats a seller's message as data, not an instruction (`embedded-instruction`) |
| Allergen-safe substitution under pressure | At the gate: forbidden allergens refused, and missing allergen data counts as unsafe. In the alternatives map: substitutes may add no allergen | Gate; product page "If this is not there" | Partly | Gate: yes (`policy.ts`, tests). Map: **open QA findings** 3 and 4: it accepts allergen words it does not know ("tree_nuts") and does not treat ordinary milk as containing lactose. School kitchen exists (Metsola); no hospital kitchen |
| Standing order drift | The kitchen's home flags a standing order that drifted; the intake asks before repeating it | `/k/<kitchen>` | Yes | `web/src/server/kitchen-portal.ts`, `core/concerns.ts` (`standing_order_range`); crash scenario `standing-order-drift` |

## Your five judging criteria

| Criterion | Weight | What to look at | Honest note |
|---|---|---|---|
| Working end-to-end demo | 30 % | Hotel Lumo kitchen: your own 1,000 L example, a missed cut-off and a substitute, to the sign-off on your phone | Live on Aiven with your test API. Today type your first sentence only; the two-sentence form is being fixed (`table-demo.md`) |
| Solving the user's need, least manual correction | 20 % | The conversation: memory answers what it can, one check when the amount is unusual, the exception said first; search 97 % right first on 189 requests | The mistake checks are from the kitchen's history (`concerns.ts`). Not tested with real buyers |
| Autonomy and controls | 20 % | The sign-off, `/ops/safeguards`, `/ops/control` (suspend), the ledger, `/ops/time-machine` | The gate can cap an agent by its crash-test licence (`DOCK_LICENCE_ENFORCE`, tested); the hosted site has no licences published to it, so it does not |
| Robustness to exceptions | 15 % | Partial stock, passed cut-offs, deadlines, recalls; QA's partner-failure probes (down, 429, garbage values: no bogus price reaches a card) | QA's open findings are as of Saturday morning (`qa/REPORT.md`); not re-checked for this page |
| Openness and path to production | 15 % | `/try`, `/docs`, `/api/v1/openapi.json`, `/api/mcp`, `/.well-known/api-catalog`, `/.well-known/jwks.json`; `examples/runtimes/` (seven frameworks) | Below |

## Assumptions we made (visible on purpose)

1. **Synthetic world.** Kitchens, people, mandates and order histories are made up. Product records and live prices
   are yours.
2. **Stock placeholders are unknown.** Amounts of 999999 and above from the availability API are treated as "the
   wholesaler does not know", not as stock.
3. **The wholesaler holds the signing key.** In the demo, AimoPilot signs quotes, claims and confirmations with a
   "wholesaler" key. In production Valio Aimo would hold that key, and AimoPilot would sign on its behalf.
4. **The buyer organisation holds its own key.** It signs its agent's mandate; we keep only its public key.
5. **Prices hold for a short time.** A quote holds 30 minutes by default and never past the order cut-off; a price
   statement is vouched for at most 24 hours, even when the price list says it is valid until 9999.
6. **Helsinki time** for every delivery day and cut-off.
7. **Ask only when it changes the outcome.** Memory answers first; a check fires only for an unusual amount, date or
   rule; at most two typed questions.

## Main design decisions, and why

| Decision | Why |
|---|---|
| The gate is plain code in `web/src/core/`, which calls no model | Rules must give the same answer every time and be testable. The model is replaceable; the rules are not |
| The mandate is a signed document the agent carries, not an account | The buyer's authority travels with any agent from any vendor, and the wholesaler can check it without a login system |
| The order must match a quote the wholesaler signed, and a quote buys once | That is your "commit at a fixed price", and it stops an agent inventing a price or replaying an old one |
| Sign-off is a passkey on the approver's own phone, bound to the order's digest | No app, no password, resistant to phishing, and an approval cannot be moved to another or edited order |
| One hash-chained ledger, two views | Both sides read the same facts; the wholesaler's view leaves out the buyer's private memory |
| MCP and REST (OpenAPI 3.1) from the same schemas | You said either form is acceptable. Offering both covers most agent frameworks; we checked seven |
| When a client cannot show AimoPilot's question to the person, a relayed answer is logged as "relayed, not verified" and the order goes to a person | Found in our own QA: an agent could otherwise confirm a likely mistake in the chef's name |
| State on Aiven (PostgreSQL, Kafka, Valkey, OpenSearch), with in-process fallbacks | Survives restarts (tested on the live site), replayable events, and each service can be switched off without stopping the demo |

## Known limits

- **Open QA findings** (`qa/REPORT.md`, as of Saturday morning, not re-checked here): the stand-alone menu planner
  ignores the kitchen's forbidden allergens (still so in the code for Kaari); the alternatives map accepts unknown
  allergen words; the duplicate check misses an identical order still waiting for sign-off.
- **Today's fault**: your full two-sentence example fails in some kitchens, because the quote fails on the usual
  product whose cut-off has passed; the first sentence alone runs the whole path. A fix is under way.
- **The alternatives map is not wired into the option cards.** It is used on product pages, in the recall radar's
  alternatives and through its own routes. Its first suggestion matched your own substitution list about one time in
  five (P@1 19.5 %); 22 % of your list's pairs fail your own data's claims or allergens (`web/docs/knowledge-map.md`).
- **The crash-test licence is not applied on the hosted site.** The gate can enforce it behind a switch (tested in
  `licence-gate.test.ts`); no licences are published to the hosted server.
- **Clients without MCP elicitation** (four of the seven frameworks we ran) relay the buyer's answer; AimoPilot records it
  as unverified and sends the order to a person, but cannot prove who answered (`examples/runtimes/GAPS.md`).
- **Consumer assistants** (Claude, ChatGPT) connect through a secret per-kitchen address. OAuth with the mandate as
  the consent screen is designed (`web/docs/connect-an-agent.md`), not built. The Claude and ChatGPT apps were not
  tested; Claude Code and Gemini CLI were.
- **Voice** heard 33 of 36 held-out recorded clips right (`web/docs/doors.md`). No test on a real phone in a real
  kitchen is recorded.
- **Email** receipts and alerts are built and sent from a verified domain since 15 November; the free plan sends
  about 90 mails a day (`web/docs/mail.md`).
- Some limits (per connector, operations sign-in) are held in one process's memory.

## Next development steps

1. Close the open QA findings above, starting with allergens in the menu planner and the alternatives map.
2. Feed the alternatives map into the option cards, behind the same hard rules.
3. Switch on the crash-test licence at the gate, so a model's tested rating caps what it may spend alone.
4. OAuth 2.1 for consumer assistants, with the mandate as the consent screen and short-lived, client-bound tokens.
5. A one-time answer link for buyers whose agent's client cannot show AimoPilot's question, so every human answer is proven.
6. With your help: a test account on the real webshop, real stock figures, and one kitchen willing to try it.

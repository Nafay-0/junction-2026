# For Valio Aimo's judges: the brief, line by line

Demo: `https://jolly-wondrous-bunny.eur-1.aiven.app` (live commit `d7611f0` on Saturday 01:30; check
`/api/health`). Source: `web/` in the repository. All kitchens, people and histories are synthetic; product records
(17,546) and live prices come from your challenge materials and test API.

How to read the "Verified" column:
- **Yes**: we found it in the code, with a test, and it is reachable from the screen named.
- **Partly**: it is built but narrower than the brief's wording, or a known issue is open. The note says which.
- **No**: not built.

The demo kitchens are **Ravintola Kaari** (`/k/kaari`, a restaurant with an order history) and **Laakso Catering**
(`/k/laakso`, a school and day-care kitchen). Scanning the wall's QR code gives you your own hotel kitchen and makes
your phone its approver. `/ops` is the wholesaler's desk; ask us for the passcode at the table.

## Core requirements

| Brief | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| Product lookup | Search over master data in Finnish, Swedish and English, filtered by claims and allergens, before any live call | `/k/kaari/catalogue`; MCP tool `search_products` | Yes | `web/src/core/catalog.ts`, OpenSearch index of 17,546 (`/api/health`) |
| Price and availability lookup | Live calls to your API for a short list only (at most 10 products per call, with a per-agent hourly allowance), cached for the price's validity | Option cards on `/k/kaari/order`; MCP `check_availability` | Yes | `web/src/core/live-allowance.ts`, `live-allowance.test.ts`; `infra/aiven.md` (Valkey cache) |
| "Query the APIs only when needed, never for all products" | Master data narrows the choice first; going over the allowance is refused with rule `live_lookup_limit`; the crash test penalises scanning prices | `/ops/safeguards` | Yes | `web/docs/connect-an-agent.md` ("Live price and availability is for short lists only"); crash scenario `live-economy` |
| Inquiry to order at a fixed price | The intake (need, mistake check, at most two questions, options, choice) ends in a quote signed by the wholesaler (JWS, Ed25519); the order must match the quote exactly and a quote buys once | `/k/kaari/order`, stages 1 to 7 | Yes | `web/src/core/intake.ts`, `quote.ts`, `policy.ts` (`order_matches_quote`, `quote_replay`); QA wave 2: 8 orders racing on one quote, exactly 1 committed |
| Permission management | A mandate signed by the buyer organisation's own key: product groups, required claims, forbidden allergens, certificates, lead time, per-order limit, weekly budget, substitution rule, approvers and their amounts | `/k/kaari/agent` ("Agent and rules"); MCP `read_mandate` | Yes | `web/src/core/mandate.ts`, `mandate.test.ts`; QA: altered, forged, expired, `alg: none` mandates all refused |
| Human approval management | Above the mandate, a named approver signs on their own phone with a passkey bound to that order's digest; no tool lets an agent approve | Wall QR, then `/approver`, `/approve/<id>` | Yes | `web/src/core/approval.ts`, `passkeys.test.ts` ("a proof made for order A does not approve A after A was edited"); `web/e2e/approval.spec.ts`; `mcp.test.ts` asserts no approving tool |
| Mock today's webshop, not a marketplace | One wholesaler's store for professional kitchens; the agent works inside it | `/k/kaari` | Yes | `web/docs/DESIGN.md` |
| "Not a chatbot over the webshop" | Ordering is a numbered lane of structured cards. A model only turns words into a structured request. The store also has an assistant panel for questions, which is a chat with cited records | `/k/kaari/order` (cards); assistant panel on the right | Partly | The order path is cards (`k/[kitchen]/stages.tsx`). The assistant panel is a chat thread, deliberately kept off the ordering path |

## Optional directions

| Brief | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| Delivery comparison | Option cards labelled by what they are best at, including "Most reliable delivery" from your delivery-reliability file; order cut-off is a first-class reason a product is unavailable | Option cards on `/k/kaari/order`; "excluded" list | Yes | `web/src/core/options.ts` (labels; `cutoff_passed`), `options.test.ts` ("treats a passed order cut-off as the reason…") |
| Sustainability comparison | "Lowest carbon" label from your carbon file | Option cards | Partly | The figure is the product group's average (`carbonGroupAvgKgCo2ePerKg`, `web/src/core/catalog/partner.ts`), not per product |
| Substitutions | Within the mandate's rule and price tolerance; a product the request did not ask for is treated as a substitute | Option cards; gate | Yes, one gap | `policy.ts` (`substitution_rule`, `substitute_price`), `policy.test.ts` ("treats any product the request did not ask for as a substitute"). Gap: a bare REST request naming no product still relies on the agent declaring the substitute |
| Traceability | Signed origin statements; every step in a hash-chained ledger; recall radar holds products named in food-safety notices | `/k/kaari/orders/<id>`; `/ops/audit`; `/ops/radar` | Yes | `web/src/core/claims.ts`, `ledger.test.ts`; `web/src/server/radar/radar.test.ts` (drill: refused at quote, order and sign-off) |

## What you said you would love to see

| Wish | What we built | Where to click | Verified | Evidence |
|---|---|---|---|---|
| **Trust protocol**: an outside agent can verify stock, price and origin without a manual check | Each price, availability and origin statement can be a W3C Verifiable Credential (compact JWS, Ed25519) checked offline against `/.well-known/jwks.json`; a quote names the statements it rests on by hash; order confirmations are signed too | `/ops/audit` "Check a receipt or a signed claim"; `/k/kaari/orders/<id>` | Yes | `web/src/core/claims.ts`; `real-flow.test.ts` ("hands out signed claims an outside agent can verify offline…"); `pnpm verify:receipt` (orders and quotes) |
| **Guardrails model**: which decisions need sign-off | Alone: inside the per-order limit, like-for-like within tolerance. A person: over the limit, substitutes outside preferences, a confirmed unusual amount, split orders. Refused outright: weekly budget, forbidden allergens, product groups, recalled products | `/ops/safeguards`; the gate stage on `/k/kaari/order` | Yes | `web/src/core/policy.ts` (rule list), `policy.test.ts`, `orders.test.ts` |
| **Response logic, good-better-best** for partial availability and substitutes | Full matches ranked best, better, good by the buyer's goal; when nothing fully matches, every card is a compromise that says what it gives up (later day, other product, pack size, split across two products) | Option cards | Yes | `web/src/core/options.ts`, `options.test.ts` ("ranks full matches best, better, good…", "fills partial stock with an allowed substitute…") |
| **Audit trail** readable by buyer and by Valio Aimo | One ledger, two views: the kitchen's (with its own memory) and the wholesaler's (without the buyer's private memory); plain-language account of each request | Buyer: `/k/kaari/orders/<id>`. Wholesaler: `/ops/audit/<orderId>`, `/ops/trace/<id>` | Yes | `web/src/core/audit.ts`; `real-flow.test.ts` ("gives the wholesaler the chain without the buyer's private memory") |

## Example scenarios

| Scenario | What we built | Where | Verified | Note |
|---|---|---|---|---|
| Need → recipe → order | Menu planner: a dish and a number of covers become one quoted order through the same gate | `/k/kaari/menu`, `/plan/kaari`, `/plan/laakso` | Partly | Two demo kitchens only; needs a model (recorded answers otherwise). **Open QA finding:** the planner's own mandate does not carry the kitchen's forbidden allergens (QA wave 2, finding 1). Do not rely on it for allergens until fixed |
| Last-minute event | When nothing can arrive in time, the options say so with the earliest date; compromise cards offer a later day | `/k/kaari/order` | Partly | "Through recipe logic rather than a SKU swap" exists only in the menu planner, where a model proposes the way out (`menu.test.ts`) |
| Supplier stock-out | Partial stock is split across an allowed substitute; the card states the trade-off | Option cards | Yes | `options.test.ts`. Note: your API reports placeholder stock (999999) for Terminal products; we treat it as unknown, not as stock (`web/src/server/valio/valio-catalog.ts`) |
| Proactive selling agent | Not built | | No | The crash test does check the opposite: a buyer agent must treat a seller's message as data, not an instruction (`embedded-instruction`) |
| Allergen-safe substitution under pressure | At the gate: forbidden allergens refused, and missing allergen data counts as unsafe. In the alternatives map: substitutes may add no allergen | Gate; product page "If this is not there" | Partly | Gate: yes (`policy.ts`, tests). Map: **open QA findings** 3 and 4: it accepts allergen words it does not know ("tree_nuts") and does not treat ordinary milk as containing lactose. School kitchen exists (Laakso); no hospital kitchen |
| Standing order drift | The kitchen's home flags a standing order that drifted; the intake asks before repeating it | `/k/kaari` home | Yes | `web/src/server/kitchen-portal.ts`, `core/concerns.ts` (`standing_order_range`); crash scenario `standing-order-drift` |

## Your five judging criteria

| Criterion | Weight | What to look at | Honest note |
|---|---|---|---|
| Working end-to-end demo | 30 % | Scan the wall's QR code; your agent runs your own 1,000 L example to your phone | Live on Aiven with your test API. The deployed build is a few commits behind `main` |
| Solving the user's need, least manual correction | 20 % | `/k/kaari/order`: memory answers what it can, at most two questions, one check when the amount is unusual | The mistake checks are from the kitchen's history (17 kinds in `concerns.ts`). Not tested with real buyers |
| Autonomy and controls | 20 % | The gate stage, `/ops/safeguards`, `/ops/control` (suspend), the ledger | The licence from the crash test is computed but does not yet set limits at the live gate |
| Robustness to exceptions | 15 % | Partial stock, passed cut-offs, deadlines, recalls; QA's partner-failure probes (down, 429, garbage values: no bogus price reaches a card) | Open: a hanging partner API makes the buyer wait 30 to 36 s (QA wave 2, finding 11) |
| Openness and path to production | 15 % | `/api/v1/openapi.json`, `/api/mcp`, `/.well-known/api-catalog`, `/.well-known/jwks.json`; `examples/runtimes/` (seven frameworks) | Below |

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

- **Open QA findings** (`qa/REPORT.md` on branch `claude/qa`, wave 2): the menu planner ignores the kitchen's
  forbidden allergens; the alternatives map accepts unknown allergen words; the duplicate check misses an identical
  order still waiting for sign-off; a hanging partner API makes the buyer wait 30 to 36 s; a demo kitchen's weekly
  budget fits only one signed 1,000 L order a week.
- **The alternatives map is not wired into the option cards.** It is used on product pages, in the recall radar's
  alternatives and through its own routes. Its first suggestion matched your own substitution list about one time in
  five (P@1 19.5 %); 22 % of your list's pairs fail your own data's claims or allergens (`web/docs/knowledge-map.md`).
- **The crash-test licence is not applied at the live gate**; the operations desk shows it only when results are
  published to the server.
- **Clients without MCP elicitation** (four of the seven frameworks we ran) relay the buyer's answer; AimoPilot records it
  as unverified and sends the order to a person, but cannot prove who answered (`examples/runtimes/GAPS.md`).
- **Consumer assistants** (Claude, ChatGPT) connect through a secret per-kitchen address. OAuth with the mandate as
  the consent screen is designed (`web/docs/connect-an-agent.md`), not built. The Claude and ChatGPT apps were not
  tested; Claude Code and Gemini CLI were.
- **Voice** understood 7 of 12 test requests; it has not been tried on a real iPhone or Android phone.
- Some limits (per connector, operations sign-in) are held in one process's memory.

## Next development steps

1. Close the open QA findings above, starting with allergens in the menu planner and the alternatives map.
2. Feed the alternatives map into the option cards, behind the same hard rules.
3. Apply the crash-test licence at the gate, so a model's tested rating caps what it may spend alone.
4. OAuth 2.1 for consumer assistants, with the mandate as the consent screen and short-lived, client-bound tokens.
5. A one-time answer link for buyers whose agent's client cannot show AimoPilot's question, so every human answer is proven.
6. With your help: a test account on the real webshop, real stock figures, and one kitchen willing to try it.

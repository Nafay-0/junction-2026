# The wholesaler's selling agent, and its open offer

The partner's scenario: "Valio Aimo's own agent spots a new or seasonal product and proactively suggests it to the
buyer's agent." Here the wholesaler's agent speaks to the buyer's agent, not to a person, through an open, signed
message that any agent can check offline and answer through MCP or REST. An offer never buys anything. The buyer
stays in control: it can say no, mute a kind of suggestion, or turn offers off, and the wholesaler's agent reads that
before it picks anything.

| Piece | File |
|---|---|
| Selection, guardrails, the signed offer, its offline check, the buyer's own check (plain code, no model) | `src/core/offers.ts` |
| The season calendar for Finland (month by product kind, each entry with a public source) | `src/core/season.ts` |
| Runs, campaigns, answers, records, the ledger (type `offer`) | `src/server/offers/service.ts` |
| The kitchen's own agent: data and actions for the conversation | `src/server/offers/thread.ts`, words in `say.text.ts` |
| MCP tools (beside the ordering table) | `src/server/mcp/offer-tools.ts` |
| REST | `src/app/api/v1/offers/**` (in the OpenAPI document) |
| Operations page | `/ops/offers`, `src/app/ops-api/offers/route.ts` |
| Offline check with only `jose` and the JWK Set | `pnpm verify:offer` (`scripts/verify-offer.ts`) |
| End to end on the real catalogue, and as an outside MCP agent | `pnpm offers` (`scripts/offers.ts`) |

## What the selling agent proposes, and from what

For each kitchen, at most a few products (never more than two offers a kitchen in seven days, one per product family
per run). It looks first at master data, free, through the one product search (`server/search` `findProducts`, recall
only, no relevance judge, so a run costs no model call): the families the kitchen buys, like-for-likes of its usual
product, the products the wholesaler listed as new, and a campaign's product. Then one live price call for at most six
products (the shortlist and the kitchen's usual products to compare with). Only these reasons can be given, each only
when the data backs it:

| Reason | Backed by |
|---|---|
| `new_in_assortment` | the wholesaler's own listing record (a staff member lists the product as new when starting a campaign), for 90 days |
| `in_season` | `core/season.ts`: in season this month in Finland, harvest (berries, mushrooms, root vegetables, crayfish, moose) or festive (Christmas, Shrove Tuesday, Easter, May Day), with its source |
| `cheaper` | like for like with what the kitchen orders every week (same family and unit, the same material claims, a pack within half to twice the size, the same kind), cheaper per litre or kilo by at least 3 %, both at live prices the wholesaler signs, both pack contents certain |
| `more_reliable` | like for like, on time at least 3 points more often (the partner's delivery file, both known) |
| `lower_carbon` | like for like, at least 10 % less CO2e per litre or kilo (both known; product-group averages are said to be averages) |
| `new_to_kitchen` | never bought, in a family the kitchen buys. Only ever a second reason |

A model may write the one-line reason (`DOCK_OFFER_MODEL`, off with `DOCK_OFFER_LLM=off` and under tests). The
grounding check (`core/grounding.ts`, surface `offer`) holds it to the offer's own figures, and a line that says
anything else is replaced by the one plain code writes from the reasons. The model chooses nothing.

## Guardrails

Checked in this order for every candidate; the first that fails decides, and a held-back product is written to the
ledger with its rule (`core/offers.ts guardOffer`, tests in `core/offers.test.ts`):

| Rule | What it stops |
|---|---|
| `offers_off` | the kitchen turned offers off: nothing at all |
| `forbidden_by_rule` | what the kitchen's signed mandate, a rule its people stated, or its memory forbids (the core's own hard-rule check, `core/clarify.ts violation`, including the allergen-evidence rule), or what its memory says to avoid |
| `muted` | the product, its family, or the kind of reason the kitchen muted |
| `declined_recently` | a product the kitchen declined in the last 30 days |
| `already_offered` | the same product again while an offer of it is open |
| `weekly_cap` | a third offer within seven days, whatever campaigns staff start |
| `not_available` | no live price or delivery now |
| `unsupported_claim` | a reason (or a campaign's wanted claim) the data does not back as stated, recomputed from the sources; or nothing worth saying at all |

The recall radar's held products are never considered. The kitchen's own agent does not rely on any of this: before it
says an offer, it verifies the signature and checks the offer again against the kitchen (`buyerCheck`).

## The offer: format

A W3C Verifiable Credential (Data Model 2.0) secured with JOSE, like the product claims (`core/claims.ts`): a compact
JWS, `typ: vc+jwt`, `cty: vc`, Ed25519 (RFC 8037), signed with the wholesaler key in the published JWK Set
(`/.well-known/jwks.json`, also `/api/v1/keys`).

| Field | Meaning |
|---|---|
| header `alg`, `kid`, `typ: vc+jwt` | which published key to check it with |
| `iss` / `issuer` | `urn:dock:wholesaler`, who offers |
| `aud` | the buyer organisation it is addressed to |
| `sub` | the product id |
| `jti` | the offer id |
| `nbf`, `exp` / `validFrom`, `validUntil` | how long the price and the offer hold: at most 24 hours (as long as a price claim), never past the price's stated validity |
| `type` | `["VerifiableCredential", "DockProductOffer"]` |
| `credentialSubject.offer.isOrder` | always `false`: an offer buys nothing |
| `.seller` | the wholesaler and its selling agent |
| `.product` | id, name, family, unit, pack size, claims, allergens (and whether declared), labels |
| `.reasons` | why, each with its figures (above) and, for a season, its source |
| `.line` | the reason in one line |
| `.price` | per pack, per litre or kilo, EUR, and the id of the signed price claim it rests on |
| `.suggestedPacks` | the kitchen's usual amount for a like-for-like, else one pack to try |
| `.terms` | "This is an offer, not an order…": accepting starts an ordinary order |
| `.evidence` | the signed price and origin claims it rests on, by id and SHA-256 of their tokens |

To check one with nothing but `jose`:

```bash
curl -s $DOCK/api/v1/offers -H "Authorization: Bearer $DOCK_MANDATE" -H "Dock-Agent-Id: $DOCK_AGENT_ID" > offers.json
curl -s $DOCK/.well-known/jwks.json > jwks.json
pnpm verify:offer offers.json --jwks jwks.json --org <your org id>
```

It fails when one byte is changed, for another key, after it expires, for another buyer, or for a token that is not
an offer.

## Answering an offer: MCP and REST

| MCP tool | REST | Does |
|---|---|---|
| `list_offers` | `GET /api/v1/offers[?all=true]` | the offers to this kitchen, each with its token and `verified`, and what the kitchen muted |
| `accept_offer` | `POST /api/v1/offers/{offerId}/accept` | starts an ordinary order for the product through the intake (mistake check, options, a fresh signed quote, the mandate gate, its sign-off). Buys nothing itself |
| `decline_offer` | `POST /api/v1/offers/{offerId}/decline` | not wanted; not offered again for 30 days |
| `mute_offers` | `POST /api/v1/offers/mute` | `product`, `family`, `reason` or `all` (offers off); `undo` lifts it |

The offer tools are published by the MCP door beside the ordering tools but are not part of the ordering table
(`TOOLS`): the crash-test harness digest and the kitchen's own agent's tool table are unchanged, and the buyer runner
offers its model only the rated table.

## The kitchen's own agent

The kitchen's side is the conversation: at most one offer, said by the agent in one or two plain sentences with its
reason and figures, then a question answered in words (yes, no, "don't suggest this kind again"). The offer's proof
and the selection reasoning are in the closed steps view. The thread calls `src/server/offers/thread.ts`:

| Call | Returns / does |
|---|---|
| `offerForThread(rt, session, kitchenName, lang)` | `undefined`, or `{ offerId, say, ask, steps, proof, sheet, reasons, validUntil, facts }`: `say` and `ask` in the kitchen's language (en, fi, sv); `steps` for the steps view; `proof` the signed token and keys URL; `sheet` what a yes puts on the order sheet (product, packs, the next day the kitchen usually orders that family); `facts` for grounding the agent's own line |
| `offerAnswerOf(words)` | `"yes"`, `"no"`, `"mute"` or `"off"` from the person's words (en, fi, sv; yes and no by `channels/speech.ts yesOrNo`), or `undefined` |
| `answerOffer(rt, session, offerId, answer, { by, via, words, name, lang })` | no, mute, off: done and recorded, returns `reply`; yes: checked again, returns `sheet` |
| `offerOnSheet(rt, session, offerId, { by, via, name, lang }, requestId)` | after the thread opened the order sheet for a yes: records the acceptance against the sheet's request, returns the reply line |

## Operations

`/ops/offers`: what the selling agent offered to whom, why (the reasons and the line), and what happened (open,
accepted into which request, declined, muted, expired), what it held back and by which rule, each offer's signature
checked in the browser, what kitchens muted. Staff run the agent now, or start a campaign for a product (listed as new,
and with the claims they want made): the agent decides kitchen by kitchen whether it is relevant and says why not.

## The ledger

Every offer, every product held back, every campaign and every answer is an entry of type `offer`
(`data.step`: `offered`, `withheld`, `campaign`, `accepted`, `declined`, `muted`, `unmuted`), in the same hash chain as
the orders. Both sides read them in full (`core/audit.ts`, kind `offered`): they hold nothing of the kitchen's memory.

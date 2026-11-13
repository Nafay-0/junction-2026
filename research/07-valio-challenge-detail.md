# Valio Aimo "Trusted Trade Agents": the full challenge page

Read from the challenge's own page on the Junction Platform (challenge 327) on Fri 13 Nov 2026, 22:40. This has more than the list view and the paper handout: the judging criteria in full, a list of problems Valio wants tackled, example scenarios, preferred technology and mentor names.

## Judging criteria, in their words

| Weight | Criterion | Their explanation |
|---|---|---|
| 30% | Working end-to-end demo | "The solution runs through a full request → lookup → order/approval flow in the mocked environment, not just isolated pieces." |
| 20% | Solving the problem and user need | "How precisely the agent matches what the buyer actually asked for, with the least manual correction needed." |
| 20% | Autonomy and controls | "Quality of the guardrails design. What the agent can decide alone, what needs human sign-off, and how decisions are logged and auditable." |
| 15% | Robustness to exception situations | "Handling of partial availability, substitutions and delivery constraints beyond the happy path." |
| 15% | Openness and credible path toward production | "Open, documented standards rather than a proprietary format, clear visibility of assumptions, well-justified technical choices, and a credible view of next development steps." |

Note the second row: precision and **least manual correction**. Every question or confirmation we show the buyer costs points unless it prevents a wrong order. Memory should answer what it can; ask only when the answer changes the outcome.

## "Problems we'd love to see tackled"

1. **Trust protocol:** "the minimum data/verification standard for an external agent to trust Valio Aimo's claims on stock, price and origin without a manual check."
2. **Guardrails model:** "which decisions require human sign-off (spend threshold, substitutions outside stated preferences) vs. fully autonomous."
3. **Response logic:** "how an agent handles partial availability and substitution ranking ('good-better-best') within Valio Aimo's own assortment."
4. **Audit trail:** "a usable, human-readable log of an agent's purchasing decisions, for both buyer and Valio Aimo."

## Example scenarios they list

- **Need → recipe → order:** a chef plans a menu around a seasonal ingredient; the agent suggests recipes, works out what is missing, and orders.
- **Last-minute event:** an unexpected booking for tomorrow; the agent flags what cannot be sourced in time and proposes substitutions "through recipe logic rather than a simple SKU swap."
- **Supplier stock-out:** a key product runs out mid-week; the agent proposes a compatible substitute and explains the trade-off.
- **Proactive selling agent:** Valio Aimo's own agent suggests a new or seasonal product to the buyer's agent.
- **Allergen-safe substitution under pressure:** in a school or hospital kitchen a substitute must still satisfy strict allergen and nutrition rules.
- **Standing order drift detection:** the agent learns a kitchen's recurring weekly order and flags anomalies (portions creeping up, cost drifting) before auto-renewing.

## Technology and scope

- Preferred: "AI agents (agentic/tool-use frameworks), open data/interop standards, recommendation logic, optional verifiable-credential or trust-layer approaches. Agentic payment standards (e.g. x402, Nevermined) are relevant context but not required."
- Scope note: they mock a structured data/API interface. Whether production becomes a traditional API, "an MCP-style agentic interface" or a full service agent is explicitly out of scope, so neither form is wrong.
- Everything provided is synthetic. Webshop test accounts may be shared later.

## Mentors

- Marketplace / commercial: Hanna Forsström, Pirjo Kaartinen
- Online sales: Minni Ruhtinas
- IT / tech integrations and data governance: Tommi Nurmi-Aro, Ville Takanen, Riku Tapper

## What the live API showed on first contact (22:38, delivery requested for Monday 16 Nov)

Three lactose-free milks were queried once.

- Two of them (10-litre boxes, `Terminal` logistics) returned an order cut-off of Thursday 12 Nov 15:00, already past, while still listing Monday as the available date. So **Valio's own example, "1,000 litres by Monday", cannot be met with those products any more.** The third (1-litre cartons, `Stock`) had a cut-off of Sunday 17:00 and can still make Monday.
- Available amounts are sentinels (999999 and 9999999999), on a stock product as well. Real quantities are not exposed for these; treat them as unknown.
- Prices: €31.31 per case for the 10 l box x 2 (€1.57 per litre), €27.22 for the other 10 l box (€2.72 per litre), €1.40 per 1 l carton with a customer-specific net price. Price validity can run to the year 9999.

This is a real exception inside the partner's own headline example, which is useful for both the demo and the crash test.

## What this changes for Dock

- **Signed claims, not only signed quotes.** Stock, price and origin statements should be verifiable offline against the wholesaler's published keys. This is item 1 on their list and we are most of the way there.
- **Good, better, best** for substitutes and partial availability: name the ranking that way.
- **Two audit views:** one for the buyer, one for Valio Aimo.
- **Standing orders** with drift detection reuse the mistake check we already have.
- **Order cut-off** is a first-class reason an option is unavailable or late.
- **Fewer questions.** Ask only when it changes the outcome.

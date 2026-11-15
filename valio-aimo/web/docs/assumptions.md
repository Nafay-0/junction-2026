# Assumptions, and what comes next

What this demo takes for granted, what is mocked, and what a production deployment at a food-service wholesaler
would need. Then the next development steps, including where agentic payments would attach. Everything here runs on
the partner's synthetic data; nothing is a real company's order.

## What is real in the demo, and what is mocked

| Part | In the demo | Assumption we made |
|---|---|---|
| Product master data | The partner's product, delivery-reliability and carbon files (17,546 products), indexed locally. | Master data changes slowly; a nightly reload is enough. Carbon is a **product-group average**, not a measurement, and every answer says so (`basis: product_group_average`). |
| Price and availability | The partner's mock pricing/availability API, called live, for short lists only (at most 10 products a call, 30 products and 30 lookups an hour per agent). | The live API is the source of truth for price, stock, earliest delivery and order cut-off. We never scan the catalogue live. |
| Stock figures | Valio: "Availability ge 999999 means that we do not know the availability and our current logic allows ordering any quantity. These values typically appear on terminal products that are not stocked by us [...] Empty = not available." So an amount of 999999 or more (999999 and 9999999999 both appear) is unknown stock that takes any quantity: never refused, never a reason to substitute, never partial availability, and the buyer hears "stock isn't reported for this one; the wholesaler takes the order" only beside an option whose stock is reported. An empty answer (no rows, or a row without an amount) is out of stock for the day asked. A real amount is a real limit. | Valio's own rule for unknown stock; in production a supplier's stock or promise would replace it. |
| Order cut-off | Valio: "closingTime is the cut off related to availableDate. The mock data will remain the same for the weekend, in real life you would see shifting." The cut-off is always read for its answer row's `availableDate`, never for the day asked; with several rows, it is the earliest row's, and a later row has no cut-off stated. A passed cut-off means that row's date cannot be had. | Real cut-offs shift as days pass; the mock's stay fixed this weekend. |
| Order steps | Valio: "You should treat 0.01 as 1. [...] 0.01 crates is not possible." A lot size of 0.01, or none, is one sales unit; a real fractional lot in the data (1.5 kg, 2.5 kg) is the order step, and a quote takes its multiples. | As the partner states it. |
| Calls to the live API | Valio: "Hitting the limit will return 429 and you will be blocked for 30 seconds [...] A few hundred calls per minute is ok, over 10 [per] second not ok." Every server process paces all its calls (the watch's timer, the menu planner's batches, every conversation) through one gate: at most 5 a second and 200 a minute by default (`DOCK_PARTNER_CALLS_PER_SECOND`, `DOCK_PARTNER_CALLS_PER_MINUTE`), a call over it waiting its turn up to 2 s. After any 429 the process makes no call for 30 s (or the Retry-After when longer): calls fail at once with "the wholesaler's price service asked us to wait", nothing retries into the block, cached answers still serve. The state is on `/api/health` and the operations Platform page. | The defaults are half of what Valio allows on purpose: several servers share one key this weekend (the public site, a preview, engineers' test servers) and each keeps its own count. A production deployment would share one limiter per key. |
| Customer prices | The mock returns a customer-specific net price for some products (`customerPrice: true`). | In production each buyer organisation sees its own contract prices; the quote is signed for that organisation and no other. |
| Orders | Valio: "A web shop account is available at the booth but orders cannot be placed (it is production). This challenge does not have an order API so it is enough that your solution can produce orders for human approval, they don't need to be sent anywhere." So AimoPilot produces each order for approval (by the mandate, or by the named person who signs it) and records it in its own store and ledger with a wholesaler-signed receipt. Nothing is sent to the wholesaler's systems. A placed order then waits for a person on the wholesaler's team, who confirms it for delivery or says it cannot be delivered on `/ops/orders/<id>` (`server/fulfilment`); this is a record on top of the committed order, with a ledger entry naming them, a mail and a line in the kitchen's conversation, and the price and the signed receipt do not change. | Sending the order is a next step: the wholesaler's order API (or EDI), at the fixed price of the signed quote (see below). |
| Delivery | Days and cut-offs as the live API states them. | Route and dock capacity are the wholesaler's; we do not plan deliveries. |
| Kitchens and buyers | Fictional kitchens: two built-in demo kitchens, visitor hotel kitchens made by scanning a QR code, and accounts anyone can open. | A real buyer is an existing customer of the wholesaler with a contract. |

## Trust: who holds which key

- **The buyer's mandate is signed by the buyer organisation's own Ed25519 key.** AimoPilot holds only the public half and checks every call against it. In the demo, the server makes that key for visitor kitchens (used once, then discarded) and for account kitchens (sealed at rest). **In production the kitchen holds its own key** (in its identity provider or purchasing system) and registers the public half with the wholesaler at onboarding; AimoPilot never sees a private key.
- **The wholesaler signs quotes, claims (price, availability, origin) and receipts** with its own key, published as a JWK Set at `/.well-known/jwks.json`. Anyone can verify offline. In production that key lives in an HSM or KMS and rotates; the JWK Set keeps old keys for verification.
- **The person who signs above the agent's limit uses a passkey** (WebAuthn) on their own phone, bound to the digest of that exact order. No agent, tool or link can sign.
- **The gate is plain code.** No model decides whether an order is allowed. The crash-test licence, when the wholesaler enforces it, can only make the gate stricter than the mandate.

## Outside agents: what we assume about them

- They speak MCP (Streamable HTTP, 2026-07-28 and 2025-era) or REST described by OpenAPI 3.1, and can send two headers (`Authorization: Bearer <mandate>`, `Dock-Agent-Id`). Seven agent runtimes did so unchanged (`examples/runtimes/RESULTS.md`).
- Consumer assistants (Claude, ChatGPT) cannot send headers, so a kitchen gets a **connector address**: a URL carrying a secret that stands for its mandate. It is narrow (one kitchen, revocable, expiring, rate-limited, no more than the mandate) but it is a bearer secret in a URL. **Production uses OAuth 2.1 as MCP specifies it, with the mandate as the consent screen** (see `connect-an-agent.md`, "The production version").
- An answer an agent relays ("the chef said yes") is recorded as relayed, not verified, and does not count as a person's. Where it matters, the order goes to a named person's sign-off, or the agent hands the buyer a one-time answer page.
- An agent may take back only what it decided alone (an order it placed inside its mandate), and only before the wholesaler's order cut-off. What a person signed is theirs to take back.

## What a production deployment would need

1. **Identity.** The buyer organisation's key in its own systems; OAuth 2.1 for consumer assistants (Client ID Metadata Documents, PKCE, RFC 8707 resource, DPoP-bound short-lived tokens), the mandate as the grant; enterprise-managed authorization so IT decides which assistants may buy.
2. **Contract data.** Customer-specific prices, assortments and delivery days per buyer, from the wholesaler's ERP, so a quote is the contract price and not a list price.
3. **Real stock for supplier-shipped goods**, or a signed delivery promise in its place.
4. **The order API.** Commit at the quoted price into the wholesaler's order system, idempotently (the quote id is the idempotency key), and feed back confirmations, short deliveries and substitutions made at picking.
5. **Shared, durable state.** Rate limits, live-lookup allowances and connector limits in shared storage (they are per process in memory today); the ledger in PostgreSQL with its hash chain anchored somewhere the wholesaler cannot rewrite alone.
6. **Keys in an HSM or KMS**, with rotation and a published key history.
7. **Operations.** On-call for the gate, a way to suspend an agent (already in the operations portal), alerts on refusals and on unusual spend.
8. **A security review and a pilot** with a handful of real kitchens before any agent orders without a person watching.

## Next development steps

1. **Pilot with real buyers**: two or three kitchens, the mandate signed by their own key, every order still read by a person for the first weeks; measure how often the agent needed correcting (the partner's own criterion).
2. **OAuth 2.1 for assistants**, replacing connector addresses.
3. **Standing orders with drift detection** for outside agents: today the kitchen's own agent sees recurring orders and drift; the open interface should offer the same as data.
4. **Offers from the wholesaler's agent to the buyer's agent** (seasonal products, a better pack), through the same gate and the same mandate, never as a side door.
5. **Verifiable credentials for claims**: the signed price, availability and origin claims as W3C Verifiable Credentials (they are compact JWS with the claim shape already), so a buyer's agent can keep and present them.
6. **Order changes after picking**: short deliveries and substitutions the warehouse makes, sent back to the buyer's agent as signed events (`/api/v1/events` streams today's decisions).

## Agentic payments (design note, not built)

The brief calls agentic payment standards "relevant context but not required". We did not build one. Where they would
attach:

- **Today's flow ends in an invoice**, as food-service wholesale does: the receipt is the signed order, payment
  follows on the customer's terms. For an existing customer that is still the right default; nothing about agents
  changes who pays when.
- **x402** (HTTP 402 Payment Required with a payment payload the client retries with) fits two places. First, a
  buyer without a credit account: `place_order` would answer 402 with the quote's total and the wholesaler's payment
  details, and the agent's wallet pays within a spending cap that the **mandate** states (a new field, say
  `payment: { maxCents, methods }`). The gate checks the payment cap like the per-order limit; above it, the same person signs. Second,
  metering the live price API for agents that are not customers yet (pay per lookup instead of an hourly
  allowance).
- **Nevermined** (agent-to-agent payments and access control with credit plans) fits the wholesaler's own agent
  selling to buyer agents: an offer could carry a plan, and a buyer agent could prepay credits within its mandate.
- **What must not change:** payment never replaces the mandate or the sign-off. A paid order outside the mandate is
  still refused; a payment above the limit still needs the named person's passkey. The signed quote is what is paid
  for, so the amount cannot drift between quote and payment, and the receipt names the payment reference.

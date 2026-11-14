# AimoPilot

**The agent can ask for anything. It can only buy what the kitchen signed for.**

AimoPilot is an open door through which AI purchasing agents order food from a wholesaler. A kitchen signs a mandate that says what its agent may buy. Plain code, never a language model, checks every order against that mandate and against a price the wholesaler signed. Anything beyond the mandate goes to a named person, who signs off on their own phone. Every step is written to a record that both the kitchen and the wholesaler can read.

Built at Junction 2026 (13 to 15 November, Espoo) for Valio Aimo's challenge, "Trusted Trade Agents". It is a demo on synthetic data and is not affiliated with or endorsed by Valio Aimo.

## Try it

Live demo: <https://jolly-wondrous-bunny.eur-1.aiven.app>

1. Open the demo on a large screen. That page is the wall: live requests passing the gate, and a QR code.
2. Scan the code with your phone and create a passkey (Face ID or fingerprint, nothing to type). Your phone is now the approver for a demo kitchen whose agent may spend €500 on its own.
3. The kitchen's agent runs Valio Aimo's own example, "1,000 litres of lactose-free milk by Monday". The order is over the limit, so it arrives on your phone. Sign it and it appears on the wall.
4. Then try to make the agent misbehave. The gate refuses and names the rule.

## How it works

1. **A signed mandate.** The kitchen signs, with its own key, what its agent may buy: product groups, required claims such as lactose-free, forbidden allergens, a per-order limit, a weekly budget, how substitutes are handled, and who signs off above the limit.
2. **Lookup.** The agent searches the product records first, then asks the live price and availability service about a short list only.
3. **A fixed price.** The wholesaler signs the quote. Price, stock and origin statements can be checked offline against its published keys.
4. **The gate.** Plain code checks every order against the mandate, the signed quote and the budget. A refusal names its rule.
5. **Sign-off.** Anything beyond the mandate goes to a named person, who signs with a passkey bound to that exact order.
6. **The record.** Every step goes into a hash-chained ledger with a plain-language account of what happened and why.

## What is in the product

| Where | For whom | What it does |
|---|---|---|
| `/k/<kitchen>` | The kitchen | A wholesale store with the kitchen's purchasing agent inside it: an order lane of structured cards (what it understood, mistake check, options ranked good, better, best, fixed price, the gate, the signed order), catalogue, basket, menu planner, memory of the kitchen's rules and past orders |
| `/ops` | The wholesaler | Every agent at the door, a step-by-step replay of any request, each safeguard and how often it fired, a switch to suspend an agent, a recall radar that holds affected products |
| `/join`, `/approve/<id>` | The approver | Phone sign-off with a passkey |
| `/call`, photo upload | The kitchen | Other doors into the same gate: a voice call, and a photo or PDF of an order list |
| `/` | The room | The wall for a big screen |
| `/api/mcp`, `/api/v1` | Any outside agent | The open interface: MCP over Streamable HTTP, and REST described in OpenAPI 3.1. The agent in the store is only one client of the same gate |

## Where to look, by judging criterion

| Valio Aimo's criterion | In the product | In the code and docs |
|---|---|---|
| Working end-to-end demo (30%) | The four steps under "Try it" | `web/scripts/demo.ts`, `web/e2e/` |
| Solving the user's need (20%) | The order lane asks only when the answer changes the order; memory answers the rest | `web/src/core/need.ts`, `clarify.ts`, `options.ts`, `web/src/server/memory/` |
| Autonomy and controls (20%) | The gate, the phone sign-off, the ledger, the operations portal | `web/src/core/policy.ts`, `mandate.ts`, `approval.ts`, `ledger.ts` |
| Robustness to exceptions (15%) | Partial stock, passed order cut-offs, substitutes that keep the kitchen's dietary rules | `web/src/core/options.ts`, `web/src/server/knowledge/`, `web/src/crash/` |
| Openness and path to production (15%) | Connect your own agent from the store's "Agent and rules" page | [web/docs/connect-an-agent.md](web/docs/connect-an-agent.md), [examples/runtimes/RESULTS.md](examples/runtimes/RESULTS.md), [docs/pitch/valio-judges.md](docs/pitch/valio-judges.md) |

[docs/pitch/valio-judges.md](docs/pitch/valio-judges.md) goes through the brief line by line, including what is not built.

## Run it locally

Node 24 and pnpm. The core, the tests and the scripted demo need no API keys and call no language model.

```bash
git clone https://github.com/Nafay-0/junction-2026.git
cd junction-2026/web
pnpm install
pnpm test          # unit and HTTP tests
pnpm demo          # scripted buyer: the milk order end to end, then the misbehaviour attempts
pnpm dev           # http://localhost:3000
pnpm e2e           # the phone sign-off in a browser with a virtual passkey
```

Free-text requests, the voice call and photo reading need model keys; the names are in `web/.env.example`. Copy it to `web/.env.local` and fill in what you have. More in [web/README.md](web/README.md).

## Repository map

| Path | Contents |
|---|---|
| `web/src/core/` | The mandate, signed quotes, the gate, approvals, the ledger. Framework-free, covered by tests, and never calls a language model |
| `web/src/server/` | Wiring: the agent, memory, the product knowledge map, voice and photo doors, recall radar, MCP server, Aiven adapters |
| `web/src/app/` | Screens and HTTP routes (Next.js) |
| `web/src/crash/` | A crash test for AI buyers: hard purchasing situations scored from the gate's own records. `pnpm crash:reproduce` |
| `examples/runtimes/` | Buyers built on seven agent frameworks ordering through the open interface |
| `infra/` | Deployment on Aiven, the runbook, and a brief for Aiven's judges ([infra/AIVEN-JUDGES.md](infra/AIVEN-JUDGES.md)) |
| `qa/` | Findings from the QA agent whose job was to break the product, and what was fixed |
| `docs/pitch/` | Pitch, table demo, the claims we make and the evidence for each ([docs/pitch/claims.md](docs/pitch/claims.md)) |
| `research/` | Notes on the event, the challenges and the partner's API |

In code, routes and environment variables the product is still called "Dock", its working title.

## Data

The product records, the mock price and availability service, and the delivery-reliability and carbon files are Valio Aimo's synthetic challenge materials. They are not in this repository. Kitchens, people and order histories in the demo are made up.

## How it was built

All application code was written during the event. We built it with AI coding agents (Claude Code) working under rules we wrote in [CLAUDE.md](CLAUDE.md); we chose the product and the demo, reviewed and merged the work, and ran a separate agent to attack it. In the running product, language models read requests, speech and photos into structured form. No model decides or approves an order.

## Licence

[MIT](LICENSE).

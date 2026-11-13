# Submission form (final, Sunday 10:00; set the project to FINAL)

> **Name: the team must choose.** The code says "Dock", the draft submission says "AimoPilot". Replace `{{NAME}}`
> everywhere at once. "Aimo" is part of the partner's brand; check with Valio Aimo before using it in the name.

Fields from `research/05-official-briefs.md`: name, punchline, description, challenge, technologies, video pitch
(at most 2:00, public on YouTube or Vimeo), demo link, source code link, pitch deck (PDF), team phone numbers,
Discord username. Submit by 09:00 to leave an hour.

## Before you submit (team must decide or do)

- [ ] **Make the repository readable by judges.** It is private today (`CLAUDE.md`). Submissions are open-sourced
      under MIT (`research/01-event-intel.md`), and there is no `LICENSE` file yet. Add one, and check that no secret
      or partner data file is in the history first (partner files live only in `.data/`, which is git-ignored).
- [ ] **Update the root `README.md`.** It still says "The idea and stack are not locked yet". A judge opening the
      repo sees that first. Point it at `web/README.md`, `docs/pitch/valio-judges.md` and the demo address.
- [ ] **Decide whether to redeploy.** The live site runs commit `d7611f0` (checked on `/api/health`, Sat 14 Nov
      01:30). The crash test and later fixes are on `main` but not live. A deploy takes about 5 minutes and must
      not happen during review (`infra/RUNBOOK.md`).
- [ ] Video uploaded, plays logged out. Deck exported to PDF.
- [ ] The "who did what" answer in `qa-prep.md` written.

## Name

`{{NAME}}`

## Punchline (at most 200 characters)

```
An open door for AI purchasing agents. The agent can ask for anything, but plain code lets it buy only what the kitchen signed for, and a named person signs off the rest.
```

(170 characters.)

## Description (at most 5,000 characters, markdown)

```markdown
**The agent can ask for anything. It can only buy what the kitchen signed for.**

Soon a kitchen's AI agent will place its food orders. The wholesaler then gets orders from machines: did a person mean 1,000 litres, who allowed this agent to spend that much, and who answers if it is wrong? Valio Aimo's challenge asks for a way for outside purchasing agents to order that both sides can trust. {{NAME}} is that door.

### How it works
1. **A signed mandate.** The kitchen signs, with its own key, what its agent may buy: product groups, required claims such as lactose-free, forbidden allergens, a per-order limit, a weekly budget, how substitutes are handled, and who signs off above the limit.
2. **Lookup.** The agent searches the partner's 17,546 product records first, then asks the live price and availability service about a short list only.
3. **A fixed price.** The wholesaler signs the quote (JWS, Ed25519). Price, stock and origin statements can be checked offline against the published keys (W3C Verifiable Credentials).
4. **The gate.** Plain code, never the model, checks every order against the mandate, the signed quote and the budget. A refusal names its rule.
5. **Sign-off.** Anything beyond the mandate goes to a named person, who signs on their own phone with a passkey bound to that exact order.
6. **The record.** Every step goes into a hash-chained ledger with a plain-language account, readable by the kitchen and by the wholesaler.

### Try it
Open the demo, scan the QR code on the wall and create a passkey: your phone becomes the approver of a hotel kitchen whose agent may spend €500 alone. Its agent then runs Valio Aimo's own example, "1,000 litres of lactose-free milk by Monday", and the order lands on your phone.

### For the kitchen
- A wholesale store with the kitchen's purchasing agent inside it. Ordering is a fixed sequence of cards, not a chat.
- Mistake checks from the kitchen's own history ("1,000 L where you usually order about 100 L").
- Options ranked good, better, best by the buyer's goal; when stock, cut-off or delivery date block a full match, each option says what it gives up.
- Memory per kitchen that records who said what, when, and through which door.
- Other doors into the same gate: a voice call (Gemini Live) and a photo or PDF of an order list.

### For the wholesaler
- An operations desk: every agent at the door, any request replayed step by step, each safeguard and how often it fired, and a switch to suspend an agent.
- A recall radar that reads food-safety notices and holds a matching product at quote, order and sign-off.
- A map of alternatives by kitchen use over all 17,546 products, with dietary and allergen rules in code.

### Open by design
MCP (Streamable HTTP) and REST with OpenAPI 3.1, an RFC 9727 API catalogue and an RFC 7517 key set. Buyers built on seven agent frameworks (Pydantic AI, OpenAI Agents SDK, Google ADK, Claude Agent SDK, Vercel AI SDK, LangGraph, Semantic Kernel over OpenAPI) ordered through it using their own standard support; each ended waiting for the person, as it should.

### Tested, including by attacking it
- Our own QA agent ran 911 cases in its second round with no server errors. 8 orders racing on one quote: exactly 1 committed. 12 orders racing on a budget for 5: exactly 5 accepted.
- A crash test for AI buyers: 13 hard purchasing situations, scored from the gate's own records. A scripted reference scores 100; the models we tested scored 25 to 66. The score maps to a licence level for how much an agent may spend alone.

### Runs on Aiven
PostgreSQL (orders, ledger, memory), Kafka (every agent action), Valkey (live-price cache, budgets), OpenSearch (product search in Finnish, Swedish and English), Grafana, Runtime (the app), and an Aiven Managed Agent as an outside buyer.

### Known limits
Synthetic kitchens and the partner's test API. The voice door understood 7 of 12 test requests. The crash-test licence is computed but does not yet set limits at the live gate. Consumer assistants connect through a secret address; OAuth is designed, not built. Full list: `docs/pitch/valio-judges.md`.
```

(Check the length in the form before submitting; this block is 4,122 characters with `{{NAME}}` as written; a short name keeps it well under 5,000.)

## Technologies used

Next.js 16, React, TypeScript, Tailwind CSS 4, pnpm, Vitest, Playwright, zod, jose (JWS, Ed25519), SimpleWebAuthn
(passkeys), Model Context Protocol (TypeScript SDK, Streamable HTTP), OpenAPI 3.1, W3C Verifiable Credentials,
Vercel AI SDK, Aiven for PostgreSQL (pgvector, pgcrypto), Aiven for Apache Kafka, Aiven for Valkey, Aiven for
OpenSearch, Aiven for Grafana, Aiven Runtime, Aiven Managed Agents, Aiven MCP server, Gemini Live API, Claude
Haiku 5.5, GPT-6 Luna, Gemini 3.1 Flash Lite, Context.dev, Exa, Modal, Featherless (Qwen3, NVIDIA Nemotron), CRACI
(CI runners), GitHub Actions.

## Challenges to select

**Main challenge:** Valio Aimo, "Trusted Trade Agents". This is the one the product is built for.

**Tech challenges and other partners.** A project may be submitted to several (`research/05-official-briefs.md`).
The honest strength of each use is in `partners/`. Recommendation:

| Partner | Enter? | Why |
|---|---|---|
| Aiven ("best use") | **Yes** | Every service the app keeps state in runs on Aiven, with a judges' brief (`infra/AIVEN-JUDGES.md`). |
| AfterQuery, "Break the Agent" | **Team decides** | The crash test fits the brief's shape (one-command reproduction, baselines, exploit hunting), but models ran once each and no frontier model completed a full run. Their judging includes a 10-minute demo; someone must be free for it. See `partners/afterquery.md`. |
| Context.dev, "The Web Is Your Real-Time Database" | **Team decides** | The recall radar turns live web notices into a hold at the gate. Real, but a side feature, and live reading was checked on recorded pages. |
| Modal ("best use") | Probably not | One offline batch job (the alternatives map): $1.10 of model calls, a few cents of Modal compute. Thin. |
| Exa, "The Internet Butler" | Probably not | Exa finds producers' recall notices for the radar; the brief asks for a personal agent for a tedious task. Thin fit. |
| NVIDIA (Nemotron) | Probably not | Nemotron was evaluated (crash test 37 of 100; Cosmos as a list reader), not used in the product path. |
| Google DeepMind | Not a challenge | Gemini Live is the voice door; mention it in the description. |

## Pre-existing code and data (statement for the form)

```
All application code in this repository was written during Junction 2026. The first application code was committed on Friday 13 November at 21:41 EET, after hacking started at 19:30; before that the repository held only setup files and research notes about the event and the challenges. Two of us won Valio Aimo's challenge at Junction 2025; no code from that project was reused, and none of it is in this repository.

We use open-source libraries and frameworks (Next.js, React, the Model Context Protocol SDKs, jose, SimpleWebAuthn, Vercel AI SDK, kafkajs, pg, the OpenSearch and Valkey clients, Playwright, Vitest and others, listed in web/package.json and examples/runtimes). The product data, mock price and availability API, delivery-reliability and carbon files are Valio Aimo's synthetic challenge materials; they are not committed to the repository. Kitchens, people and order histories in the demo are made up.
```

## Use of AI coding tools (statement for the form)

```
We built this with AI coding agents (Claude Code; Claude Fable 5.2 as the orchestrating session and Claude Opus 5.5 subagents), and say so openly: about four in five commits in the repository carry an AI co-author line (211 of 259 across all branches on Saturday 14 November, 01:30). We chose the challenge, the product and the demo path, wrote the rules the agents had to follow (CLAUDE.md), reviewed and merged their work, and ran a separate QA agent whose job was to break the product; its findings and their fixes are in qa/REPORT.md. The running product also uses language models in clearly bounded places (reading free text into a structured request, the voice call, reading photos of order lists, building the alternatives map offline); no model decides or approves an order. The gate is plain code in web/src/core, which calls no model.
```

> Recount the commit numbers on the morning you submit: `git log --oneline | wc -l` and
> `git log --grep='Co-Authored-By: Claude' --oneline | wc -l` on `main`. The figures above were counted across all
> branches on Saturday 14 Nov at about 01:30 (`git log --all`); on `main` alone it was 179 of 220.

## Links

- Demo: `https://jolly-wondrous-bunny.eur-1.aiven.app`
- Source: `https://github.com/Nafay-0/junction-2026` (make it readable first)
- Video: (add after upload)
- Deck PDF: (export from the outline in `pitch-3min.md`)

# The agent thread: one conversation, one engine

A buyer talks to their kitchen's agent in one thread per kitchen. A turn can be typed in the store, spoken on a
call, sent as a photo, or a tap on a card. Every door submits turns to the same engine and reads the same event
stream. The order page's stepper, the assistant panel and the call page are views of this thread.

Types: `web/src/server/thread/types.ts` (plain types, safe to import in the browser). This document is the
contract; the types file is its exact shape. If they disagree, the types file wins and this file is a bug.

## What an agent turn is

At most **one short line** of text by the model, plus **cards** built from data. Inventory, prices, amounts,
dates and stock appear **only in cards**, and every card is made from a tool result or a gate record. The line
passes the grounding check (`core/grounding.ts`, surface `thread`) or it is not shown, and the refusal is in the
ledger. That is how "not a chatbot" and "no hallucinated inventory" are both kept.

| Card | Made from | Shows |
|---|---|---|
| `understood` | the reader (`interpret.ts`) and the intake | item, amount, date, claims, allergens, goal; `basedOn` an earlier request; `memoryUsed` lines; `alsoAsked` other items |
| `anomaly` | intake concerns (the mistake check) | each concern's message, `confirm` if it can be confirmed, its corrections |
| `question` | intake questions memory could not answer | at most two questions with fixed choices |
| `options` | intake option cards (good, better, best), live price and stock | each option's total, delivery, cut-off, gives-up, sign-off reasons; `preselected` and why |
| `price` | the signed fixed-price quote | total, lines, expiry, the gate's preview |
| `gate` | the gate's decision record | `placed_alone`, `waiting` (named person, rule), `refused` (rule), later `approved` / `declined` / `withdrawn` / `expired` |
| `order` | the order record | status, lines, who authorised it, the signed confirmation, what the agent passed over |
| `memory` | memory recall and the memory writer | what memory answered instead of asking; after an order, what to remember (confirm each) |
| `records` | order history, requests, products, mandate | answer rows for "what did we order last week?" |
| `notice` | refusals and failures | not found, not a purchase, incomplete (what is missing), model unavailable, suspended |

A card with the same `cardId` sent again **replaces** the earlier one in place (an anomaly card gets `answered`,
an options card gets `chosen`, a gate card goes from `waiting` to `approved`).

## The thread

```
Thread   { threadId, kitchen, orgId, startedAt, turns: Turn[], seq, activeTurnId? }
Turn     BuyerTurn | AgentTurn
BuyerTurn { turnId, role: "buyer", at, door: typed|voice|photo, via: typed|speech|tap|photo, text?, action?, label?, clientTurnId? }
AgentTurn { turnId, role: "agent", at, replyTo, status, steps: ThreadStep[], cards: Card[], line?, ms?, marks? }
status   working | waiting_buyer | waiting_approver | done | failed
```

One agent turn works at a time per thread. A buyer turn sent while one is working is queued and answered next.
`marks` holds milliseconds from the buyer's turn to `first_step`, `understood`, `options`, `placed`, `waiting`,
`line`, `done`, for the operations trace and the speed report.

The thread is kept on the server (in memory, and in PostgreSQL with `DOCK_STORE=postgres`). The browser holds
nothing it cannot fetch again: reload or reconnect at any moment and the thread, including a turn still working,
comes back.

## HTTP

All under `/ui-api/kitchens/{kitchen}/thread`, with the same access rule as the rest of the store
(`server/authz.ts consoleKitchen`: the two demo kitchens are open at the table, a visitor's kitchen only from the
phone that joined it). The server holds the kitchen's current mandate; the browser never sees it.

| Call | Does |
|---|---|
| `GET /thread` | `{ thread }`: every turn and card so far, and `seq` |
| `GET /thread/stream?after=<seq>` | Server-Sent Events from `after` (or the `Last-Event-ID` header). Each event's `id` is its `seq`. A heartbeat comment every 15 s. |
| `POST /thread/turns` | Submit a turn: `SubmitTurn` → `202 SubmitTurnReply { threadId, buyerTurnId, agentTurnId, seq }`. The work runs on the server; results arrive on the stream. |
| `POST /thread/reset` | Start over: the old thread is archived (still in the ledger and the trace), a `reset` event is sent. |

```ts
SubmitTurn = { door, via, text?, action?, label?, clientTurnId?, lang? }
```

- `text` for words (typed, or a transcript). `action` for a tap. Both may be sent: a spoken "yes" that the voice
  door already mapped onto a card sends the `action` with the words heard as `text`; the words are kept in the
  ledger with the step.
- `clientTurnId`: a resend with the same id returns the first reply with `duplicate: true` and does nothing.
- Refusals: `409 turn_card_stale` (a tap on a card for a request that has moved on), `429` (the kitchen's limits),
  `403` suspended, `404` kitchen.

## The event stream

```
{ seq, threadId, at, type: "turn",   turn }                  a buyer turn accepted, or an agent turn opened
{ seq, threadId, at, type: "step",   turnId, step }          a live step started or finished (same stepId: replace)
{ seq, threadId, at, type: "card",   turnId, card }          a new card, or a new version of one (same cardId: replace)
{ seq, threadId, at, type: "line",   turnId, text }          the agent's grounded line
{ seq, threadId, at, type: "status", turnId, status, ms?, marks? }
{ seq, threadId, at, type: "reset" }
```

A client keeps the last `seq` it applied and reconnects with `?after=<seq>`. Events are idempotent by `seq`.
The first visible sign of work is the agent turn's `turn` event plus a `step` (`read`), sent before any model
call: under 300 ms from the POST.

## How a door submits a turn and receives cards

1. `POST /thread/turns { door: "typed", via: "typed", text: "I need 1,000 litres of lactose-free milk by Monday" }`.
2. The stream sends `turn` (buyer), `turn` (agent, `working`), `step read`, then cards as they are made:
   `understood`, `anomaly` (1,000 L where you usually order about 100 L), and the agent turn goes to
   `waiting_buyer`.
3. The buyer taps "Yes, 1,000 L": `POST /thread/turns { door: "typed", via: "tap", action: { type: "concern",
   requestId, key, choice: "confirm" }, label: "Yes, 1,000 L" }`. A new agent turn: `options`, then, when a
   choice is needed, `waiting_buyer`; or, when the request is routine, `price`, `gate placed_alone`, `order`.
4. Over the mandate: `gate waiting` names the person and the rule; status `waiting_approver`. When the person
   signs with their passkey on their phone, the same gate card is replaced with `approved`, an `order` card with
   the signed confirmation follows, and the turn ends `done`.

A voice door does the same with `door: "voice", via: "speech"` and the transcript as `text`, and speaks the
agent's `line` plus a spoken rendering of the newest card (`server/channels/say.ts` already renders steps and
orders for speech). It must not speak inventory the cards do not hold.

## A spoken or typed answer is the same step as a tap

Every decision the buyer makes ends in exactly one `ThreadAction`, whatever the door:

| The buyer | Becomes |
|---|---|
| taps "Make it 100 L" | `{ type: "concern", requestId, key, choice: "use_100_L" }` |
| says "no, a hundred" / types "100 is right" | the agent maps the words onto the open anomaly card: the same action |
| taps option 2 / says "the second one" / "the cheaper one" | `{ type: "choose", requestId, optionId }` |
| says "yes, order it" with a price showing | `{ type: "place", requestId }` |
| says "keep that" to a memory proposal | `{ type: "remember", itemId, yes: true }` |

Mapping words onto a card is the model's proposal; plain code checks it: the action must name a choice on a card
that is open now, a confirmation needs a clear yes in the buyer's own words (`channels/speech.ts yesOrNo`), and
the words are written to the ledger with the step (`data.step: "heard"`). The model can never answer for the
buyer: the tools that carry a buyer's answer are not in the model's tool table, only this mapping is, and it acts
only on the newest buyer turn's own words.

Whose answer it is follows the existing rule (`core/intake.ts InputChannel`): the kitchen's signed-in session (a
visitor's phone) makes it the person's own (`portal_session`, or `voice` with the words); on the open demo
kitchens it is `relayed`, and a confirmation that matters then still goes to a named person's sign-off. "The
chef said yes" typed by someone else is relayed, never the chef's own.

## The engine (what runs a turn)

- **Plain code is the engine for the common case**: the staged intake (`core/intake.ts`), the ranking, the
  signed quote and the gate (`core/policy.ts` through `createDock`). The model never computes a price, picks a
  product the ranking did not offer, or decides what the gate decides.
- **The model orchestrates and converses**, on the AI SDK's agent loop (`ToolLoopAgent`), with the same tool
  table the open interface publishes (`server/mcp/tools.ts`, run through `server/mcp/server.ts` as the kitchen's
  own agent, so the on-site agent is one more client of the same gate), minus the tools that carry a buyer's
  answer, plus three thread tools: `order` (read the words with `interpret.ts`, then the intake, as plain code),
  `buyer_reply` (map the newest buyer words onto an open card, checked as above) and `await_sign_off`.
- **Sign-off is the runtime's approval step.** After the gate sends an order to a person, the agent calls
  `await_sign_off`, which always needs approval. The loop pauses. Only the server answers that approval, and only
  when the approver's passkey sign-off (or decline) is recorded on the order; no client, door or model can.
  The approval is signed (`experimental_toolApprovalSecret`), so a forged one is refused.
- **Autonomy.** A request inside the mandate, with no anomaly, an unambiguous best match that agrees with what
  the kitchen usually buys, and a gate preview of "place alone" is placed by the agent alone; the `order` card
  says what it passed over. Anything else stops at the options with one tap (or one word) to confirm.
- **Memory first.** The intake answers from memory before it asks; the `understood` card says so in one line.
  After an order, the memory writer proposes what to remember, and a `memory` card asks the kitchen's person to
  keep or drop each.

## The record

Every turn, model call, tool call, grounding refusal, memory read and write and gate decision is a ledger entry
carrying `data.thread = { threadId, turnId, door }`. Model calls are `type: "agent"` entries with model id,
milliseconds, tokens, cost and whether the fallback model answered. The operations portal shows one conversation
at `/ops/conversation/<threadId>` (`GET /ops-api/conversation/<threadId>`): the turns in order, each with its
steps, tool calls, model calls and the requests and orders it touched, each linking to that request's trace.
Model and tool calls also go to the action stream (Aiven) as `agent.model` and `agent.tool` events.

## Status

Kept true as the engine lands. Anything listed here and not yet built is marked *(not yet)*.

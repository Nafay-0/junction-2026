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
| `plan` | the menu planner's record (`server/agent/menu`) | a dish or menu for N covers: dishes, covers, day; one row per ingredient with the product, packs and line total; what ordering also accepts or leaves out (by the planner's codes); total, delivery, who signs; one button `plan_order` |
| `notice` | refusals and failures | not found, not a purchase, incomplete (what is missing), model unavailable, suspended |

A card with the same `cardId` sent again **replaces** the earlier one in place (an anomaly card gets `answered`,
an options card gets `chosen`, a gate card goes from `waiting` to `approved`).

## Widgets: refining in place (agent-thread-3)

The agent is the one place: refining an order or a menu is direct manipulation of a widget in the thread, never a
sentence the buyer has to type or another page. The design lead builds the widgets as presentational components
(branch `claude/thread-widgets`); the engine drives them through the card types and actions below. Exact shapes are in
`server/thread/types.ts`; this section says what each one is for and what its actions do.

**The rules every widget keeps**
- Every action is a turn (`POST /thread/turns { via: "tap", action, label }`) through the same engine and the same
  gate. A widget never changes a price, a day or a product on its own: the answer comes back as a new version of the
  card (same `cardId`).
- Amounts, prices, days, what is offered and what the gate decides are plain code. An edit re-prices the lines it
  touched (live, short list only) and re-runs the gate's own preview. What a confirm button says will happen
  (`gate.outcome`: placed by the agent alone, sent to `gate.approver`, cannot be ordered and why) is that preview,
  never a guess. Nothing a widget offers is something the preview refuses: a candidate the gate would refuse is not
  offered, or is shown disabled with its rule only when it explains why the obvious one is missing.
- A swap goes through the substitution rule: a line that replaces the product first asked for carries
  `substituteFor`, so the gate judges it (rule and price cap) on every door.
- Edits are made by the kitchen's signed-in person and recorded as theirs (`portal_session`, or `voice` with the
  words). A sheet with several lines is one order through the gate.
- Stale protection: sheet actions carry the `version` the widget showed. An action on an older version is refused
  with `409 turn_card_stale` and the current card is sent again.

| Card | Widget | Actions |
|---|---|---|
| `sheet` | **Order sheet**: lines with an amount stepper in whole packs (`minPacks`..`maxPacks`), the delivery day with the possible `days` and their order-by times, a swap per line (opens the picker), remove, add; total; the gate's preview and one confirm | `sheet_packs`, `sheet_day`, `sheet_swap`, `sheet_remove`, `sheet_add`, `sheet_alternatives`, `sheet_place` |
| `alternatives` | **Alternatives picker**: candidates side by side (packs, total, per litre or kilo, delivery and order-by, attributes, CO2, reliability, what each differs on, each one's gate preview); chips re-rank by another requirement (price, CO2, reliability, same kind, organic, lactose-free, pack size) | `alt_rerank`, `alt_pick` |
| `menu` | **Menu builder**: `proposals` to choose from; then dishes with covers (stepper) and service day; each ingredient line with its product, packs, line total, other products (swap), "we have this", amount per cover, and its conflicts (allergen, stated rule, mandate, the planner's doubts) on the line they concern; cost per cover; blockers; the gate's preview; one button to the order sheet | `menu_choose`, `menu_covers`, `menu_day`, `menu_line_swap`, `menu_line_have`, `menu_line_per_cover`, `menu_accept`, `menu_to_sheet` |
| `question` | **Answer widgets**: `input.kind` chooses chips (`choice`), a day picker (`day`: options carry `date` and `orderBy`) or a stepper (`amount`: `unit`, `min`, `max`, `step`) | `answer` (as before) |
| `options` | Unchanged, plus "Edit before ordering" on any option: it becomes a sheet | `choose` (order now), `sheet_from_option` |
| `price`, `order` | **In place, not elsewhere**: the proof of a fixed price (`price.proof`: the signed quote and the signed claims it rests on, verifiable in the browser) and the order's details and signed confirmation open inside the card | none (expansion is presentation) |
| `memory` | Remember this in the kitchen's own words, then keep or drop each proposal | `remember_this`, `remember` |

**How the engine feeds them**
- A sheet appears when the buyer edits an option (`sheet_from_option`), adds a second item (words or `sheet_add`), a
  menu goes to ordering (`menu_to_sheet`), or a product is added from the catalogue or the basket (`sheet_add`: the
  store's "add" puts it on the thread's current sheet, making one if there is none).
- The menu card streams: `stage: "proposing"` with the dishes as the planner drafts them, then `resolving` while
  lines match and price (each line appears with `status: "resolving"` and updates as it resolves), then `ready`.
- `sheet_place` asks the wholesaler for one signed quote of all lines at the sheet's day, then places it: the gate
  decides, and the gate and order cards follow as for any order (sign-off from the thread as before).

### The home: the agent is where the kitchen starts (agent-thread-3, live)

The store's "Order" entry, "Add" anywhere and "ask about this product" all lead into the agent; the old Order page
redirects to the store with the agent open (`?agent=open`, `?agent=product:<id>`). The home's cards are made by plain
code from records (`server/thread/home.ts`); the model never writes one, it can only ask for one to be shown
(`find_products`, `product_facts`, `show_home` in agent.ts). Everything that buys lands on the order sheet.

| Card | What it is | Actions |
|---|---|---|
| `today` | **The day's opening**: posted unasked, as an agent turn with no buyer turn before it (`replyTo: ""`), when the kitchen's store reads a thread that has no opening for today (Helsinki day). Items, each from records only: `sign_off` (an order waiting for a named person: sign in place with the sign-off widget), `cutoff` (an order-by time today for something the kitchen orders recurrently: one live call for at most three products, cached ten minutes, `standingCutoffs`), `drift` (a recurring order whose amount or price moved: the portal's own drift warning), `recall` (an active recall hold on a product the kitchen bought), `delivery` (a committed order arriving today or tomorrow). No item when nothing needs them. `pending` while it is gathered. Asked again later, a fresh card in that turn. | `order_show`, `standing_change`, `home_show` |
| `products` | **Product grid** from master data only (no live call until a product goes on the sheet): only what the mandate allows (category, required attributes, no forbidden allergen) | `products_search`, `product_show`, `sheet_add` |
| `product` | **One product's facts**: pack, allergens (or "not declared"), attributes, certificates, origin, CO2, delivery reliability | `sheet_add` |
| `records` (history) | Earlier orders; every row can be ordered again | `order_again`: the order's lines on a new sheet for the next same weekday, re-priced and previewed there |
| `standing` | **Recurring orders**, read from history (`standing()` in kitchen-portal.ts): weekdays, usual amount and packs, next due, drift. There is no separate standing-order store, so they cannot be paused; "change" is a new sheet for the next due day | `standing_change { family, packs? }` |
| `deliveries` | Orders committed or waiting, delivered today or later | `order_show` |
| `memory_list` | What the agent remembers (active or waiting for a yes); `canChange` only for the kitchen's signed-in person | `memory_edit`, `memory_forget` (refused without a signed-in person, `401 kitchen_person_required`; recorded as theirs), `remember_this` |
| `price`, `order` | The proof (`price.proof`: the signed quote and the signed claims it rests on) and the order's details and signed confirmation open inside the card; "Check the signatures" verifies each in the browser against `/.well-known/jwks.json` (`_client/verify-signed.ts`) | none |

`home_show { what: "today" | "history" | "standing" | "deliveries" | "memory" }` shows one of them. Each is in the
ledger (`today`, `products`, `order_again`, `memory_write`) and in the operations trace like any turn.

*(not yet)*: the widgets above this subsection are the contract for agent-thread-3; this line goes when the engine for each
widget lands, and the table says per widget what is live.

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
| taps "Order this plan" / says "yes, order it" under a plan card | `{ type: "plan_order", planId }` |

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
  answer, plus thread tools: `order` (read the words with `interpret.ts`, then the intake, as plain code),
  `plan_menu` (a dish or menu for N covers: the menu planner as the kitchen's menu agent, its plan as a `plan` card),
  `buyer_reply` (map the newest buyer words onto an open card, checked as above) and `await_sign_off`.
- **A plan is one decision.** `plan_order` settles what the card said it would (accepts the planner's acceptable
  points, leaves out lines nothing fits), fixes one price for the whole plan and sends it through the gate as one
  order (`server/thread/plan.ts`); the gate and order cards follow as for any order. Editing single lines stays on
  the menu planner page (`/k/<kitchen>/menu?plan=<planId>` opens the thread's plan there).
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

## For a door built on the engine (voice, photo, a kiosk)

- **In process:** `submitTurn(kitchen, body)` from `server/thread/engine.ts` (a `Kitchen` the route resolved, or
  the slug), then `threadStore().subscribe(slug, fn)` for the events. Over HTTP: the three routes above.
- **Voice:** send each final transcript as `{ door: "voice", via: "speech", text }`. The agent maps a spoken
  answer onto the open card itself (`buyer_reply`), with the words recorded; if your own realtime model already
  knows which card was answered, send `{ door: "voice", via: "speech", text, action }` and the engine runs the
  action with the words as the heard evidence (no model call). Speak the agent's `line` when it comes, then the
  newest card (`server/channels/say.ts` has spoken renderings of steps and orders). Never speak a number, product
  or date that is not on a card.
- **Photo:** read the image with the scan door (`/ui-api/scan/<kitchen>`), then send the text it read as
  `{ door: "photo", via: "photo", text }`; several lines are several items, split by code.
- A door that is not a browser (a phone call) passes the kitchen slug: the turn then has no signed-in person and
  every answer is recorded as relayed.

## The voice call is a door of the thread

The call keeps its realtime model, its recogniser primed with the kitchen's words, and its spoken read-back
(`server/channels/voice/`). Every tool step of the call is also a turn of the kitchen's thread
(`server/thread/voice-bridge.ts`, hooked in `voice/tools.ts runTool`): the heard words are the buyer turn (door
`voice`), the read-back is the `understood` card with the read-back sentence as the agent's line, and the intake's
answer is the same cards the typed store shows. When the intake's options come back for a routine request, the
engine's rule places it alone and the voice model is told what was placed, so a routine spoken order is the
request, the read-back and one "yes"; otherwise a spoken choice orders it, as a tap does. Speaking is a mode of the
thread itself (`_channels/voice-mode.tsx`): the composer's microphone starts the call, the voice bar over the
composer holds to talk or listens, the log shows the words being heard, and hanging up leaves the buyer typing in
the same composer. There is no browser speech recognition. `DOCK_THREAD_VOICE=off` stops the mirroring.

## What runs where (as built)

| Piece | File |
|---|---|
| Contract types | `server/thread/types.ts` |
| Turn lifecycle, queue (one agent turn at a time per kitchen), speculative reading, sign-off resume, memory proposals, the grounded line | `server/thread/engine.ts` |
| The agent loop: `ToolLoopAgent`, tool table, open decisions, approvals, prompt caching | `server/thread/agent.ts` |
| Plain-code engine: reading, intake, cards, autonomy, the buyer's actions | `server/thread/pipeline.ts`, `cards.ts` |
| Earlier requests for follow-ups | `server/thread/earlier.ts` |
| Fallback model (first model silent for `DOCK_AGENT_FIRST_TOKEN_MS`, default 6 s, or erroring) | `server/thread/fallback.ts` |
| Telemetry integration (every AI SDK call: ledger `agent` entries inside a conversation, `agent.model` / `agent.tool` action events) | `server/thread/telemetry.ts`, `context.ts` |
| Thread store and event log (PostgreSQL `docs` collection `agent_thread` with `DOCK_STORE=postgres`) | `server/thread/store.ts` |
| Routes | `app/ui-api/kitchens/[kitchen]/thread/**` |
| The store's view (dock, Order page, Home's composer) | `app/k/[kitchen]/thread.tsx`, `thread-state.ts` |
| Operations view | `server/ops/conversation.ts`, `app/ops/(desk)/conversation/**`, `/ops-api/conversation[/<threadId>]` |
| In-process smoke run with real models | `pnpm tsx scripts/thread-smoke.ts <kitchen> "<words>" ["<words>" | "@approve" ...]` |
| Evaluation through the store's HTTP path | `pnpm tsx eval/thread/run.ts --url <server> --driver thread|legacy` |

Environment: `DOCK_AGENT_MODEL` (the agent; Fable 5.2 here), `DOCK_AGENT_FALLBACK_MODEL` (default
`DOCK_INTERPRET_MODEL`), `DOCK_AGENT_REASONING` (default `low`), `DOCK_AGENT_FIRST_TOKEN_MS`,
`DOCK_TOOL_APPROVAL_SECRET` (signs the runtime's approval requests; random per process when unset, so a sign-off
after a restart updates the cards but does not resume the paused loop).

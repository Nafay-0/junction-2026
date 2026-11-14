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
| `menu` | the menu planner's record (`server/agent/menu`), as the menu builder (see Widgets) | a dish or menu for N covers, forming as the planner works; edited in place; one button puts it on the order sheet |
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
| `options` | Unchanged, plus "Change amount, day or product" under the lead option: it becomes a sheet | `choose` (order now), `sheet_from_option` |
| `price`, `order` | **In place, not elsewhere**: the proof of a fixed price (`price.proof`: the signed quote and the signed claims it rests on, verifiable in the browser) and the order's details and signed confirmation open inside the card | none (expansion is presentation) |
| `memory` | Remember this in the kitchen's own words, then keep or drop each proposal | `remember_this`, `remember` |
| `rules` | **The kitchen's rules** (live): the signed mandate (`current`: per-order limit, weekly budget, product groups, required claims, forbidden allergens, who signs, lead days, substitution) and the rules its people stated (`stated`), from records. A change (tapped on the card, or typed: "never nuts", "raise the limit to 800", the agent's `rules` tool) is first a `proposal` with `after` and a field-by-field `diff` (`widens` marks what lets the agent do more), worked out in plain code; nothing is signed until the kitchen's own signed-in person taps sign. `editable` says what this browser may sign and `why` not | `rules_show`, `rules_propose { change }`, `rules_sign { proposalId }`, `rules_cancel { proposalId }` |

**Changing the rules: what each kind of kitchen can sign** (`server/thread/rules.ts`)
- *Narrowing* (adding a forbidden allergen or a required claim) is the reissue the security review made
  (`server/mandate-reissue.ts`): any kitchen (built-in demo, visitor, account), signed by its signed-in person (not a
  relayed name, not a call-code phone, not another account's session). Every earlier mandate of the kitchen is refused
  from that second on.
- *Everything else* (the per-order limit, the weekly budget, who signs, lead days, substitution, product groups, and
  taking a rule away) is new terms, signed the way the account page signs them (`accounts.signKitchen`: checked by
  `parseTerms`, a new key, the old mandate retired at the gate). Only an account's kitchen has terms, and only that
  account's own full session can sign them. A built-in demo kitchen's terms are fixed for the stage, and a visitor's
  sandbox has no way to sign wider terms: the card shows the change, says why it cannot be signed there, and the
  sign action is refused (`403`) and recorded.
- What the model may do: map the buyer's words to a `change`; code keeps only amounts the buyer wrote and a signer
  they named (`groundedChange`), maps words to the mandate's vocabulary, and never signs.
- The ledger: the mechanism's own entry (`mandate_reissued` / `mandate_signed`) plus the conversation's agent entries
  `rules_proposed`, `rules_signed` (before, after, by, mechanism), `rules_refused`, `rules_cancelled`.

**How the engine feeds them**
- A sheet appears when the buyer edits an option (`sheet_from_option`), adds a second item (words or `sheet_add`), a
  menu goes to ordering (`menu_to_sheet`), or a product is added from the catalogue or the basket (`sheet_add`: the
  store's "add" puts it on the thread's current sheet, making one if there is none).
- The menu card streams (`server/thread/menu.ts`, on the planner's `plan(…, { onProgress })`): `stage: "proposing"`
  with the dishes once the planner's outline is in (the first model call), then each dish's lines as that dish is
  written (`status: "resolving"`, the amount per cover and what the covers need), then `resolving` once the lines are
  matched to the assortment, then `ready` with products, packs, prices, other products, conflicts, cost per cover,
  the delivery days and the gate's preview of the plan as one order. The planner's ways out for stuck lines arrive
  a few seconds later and update the card in place.
- Words that leave the menu open ("lunch for 40 around beetroot") give `stage: "choose"` with two or three
  `proposals` (the planner's own menu first, then up to two others its outline offers); the first keeps planning
  behind the card, so choosing it shows the ready plan at once; another is planned with its dishes fixed, into the
  same card. Words that name the dish skip the proposals.
- Every `menu_*` edit maps onto the planner's own edit ops (`covers`, `deliverBy`, `choose` or `applyFix`, `strike`,
  `perCover`, `accept`), so the kitchen's mandate, stated rules and memory bind every line as on the planner's page.
  A line's other products are only those the gate would take in the plan (each tried in the gate's preview).
- `menu_to_sheet` puts every bought line on one sheet: an open point the planner lets a person accept (an unusual
  amount, another form) is accepted by that tap; a line it holds (a stated rule, the mandate, nothing safe to buy)
  is left off and named in the record. The sheet runs under the kitchen's menu agent's mandate (food of every kind;
  the store's own agent may buy only dairy), the same mandate the plan was made and previewed by. After that the
  menu's edits are refused: the sheet is the order now.
- `sheet_place` asks the wholesaler for one signed quote of all lines at the sheet's day, then places it: the gate
  decides, and the gate and order cards follow as for any order (sign-off from the thread as before).

**How the store draws them** (`k/[kitchen]/thread-sheet.tsx`, the design kit's `OrderSheet`, `AlternativesPicker`,
`ChoiceAnswer`; words in `thread-sheet.text.ts`, en/fi/sv)
- The sheet's outcome line and its one button come from `gate` (the preview), in the kitchen's words: "Inside your
  rules: under your 500 € limit" / "Order this, 404,00 €"; "Aino OKs it on their phone: it is over your 500 € limit"
  / "Send to Aino for an OK, 1 010,00 €"; a refusal says what to do. Never mandate, gate, sign-off, quote.
- Stepper taps are one edit: the sheet shows the new total at once and sends `sheet_packs` once the buyer stops
  (650 ms), against the card's `version`. Only the confirm button orders.
- In-place edits (`sheet_packs`, `sheet_day`, `sheet_swap`, `sheet_remove`, the undo, `alt_*`, `menu_*` edits) are
  not bubbles: the card changes; an agent turn with no card after one is not drawn. A refusal still shows.
- `removed` on the card: the line the last edit took off, put back with one tap (`sheet_add` of it).
- An options card hands over to the sheet ("Change amount, day or product", `sheet_from_option`); the options card
  then says so and offers no order button, so only one place orders.
- The sheet's day is the day it arrives (`deliverOn` on its request): moving it to Thursday delivers Thursday.
- Questions: one at a time (the first unanswered), with why it is asked and "No preference" as the stated safe skip.
- A placed order can be taken back until the wholesaler's order cut-off: `order.takeBackUntil`, a `withdraw` tap by
  the kitchen's signed-in person (core `withdrawOrder(…, { takeBack })`, not the published withdraw, which still takes
  back only an order waiting for an OK). The order leaves the kitchen's history and its weekly budget; the ledger has
  `taken_back`; the event is `order_withdrawn`.
- A change to a placed order replaces it: "make it 200" after 100 was placed takes the 100 back once the 200 is placed
  (waiting for an OK, or before the cut-off), so one order stands. The repeat check on it is answered by the words.
- "The usual" with no product: the recurring orders due next at their usual amounts, on a sheet (plain code).
- Sending: a busy store (`503 store_unavailable`, `429`) or a dropped connection is tried again by itself with the same
  `clientTurnId`; only then the buyer is told, in words, and their words stay in the box.

**What was asked, precisely** (agent-thread-4)
- Several items in one message are one order: each item's lead option goes on one order sheet, previewed and
  confirmed once (`combineItems` in pipeline.ts); none is placed alone, and the intake's "you also asked for" note is
  dropped in the thread. Items still waiting on a question keep their own card.
- When the kind asked for cannot be offered though the assortment has it, the options card says so first with the
  reason (`insteadOf`: your rules, the day, stock) and every option is "instead", never "best". A product its maker
  declares free from milk counts as lactose-free (core/catalog/partner.ts `impliedClaims`), so oat drinks reach
  kitchens whose rules require lactose-free.
- A day the kitchen names is the delivery day (`deliverOn`) unless the words make it a latest day ("by", "mennessä",
  "senast"); an option arriving earlier says "arrives Monday, earlier than the Thursday you asked for".
- Nothing spins without an end: a turn that stops closes its running steps (store.ts), and a turn still working after
  150 s ends with a plain notice (engine.ts).

### The home: the agent is where the kitchen starts (agent-thread-4, live)

A signed-in kitchen lands on its agent (`/k/<kitchen>`, and `/order` is the same page): the thread full width, the
day's opening card at its head (the kit's `AgentHome`: at most three things that need the kitchen today, each acted on
in place, then the starting points: browse products, earlier orders, recurring orders, deliveries, what the agent
remembers, your rules, plan a menu), the composer under the thumb. There is no other front page: navigation is Agent,
Catalogue, Orders, Your rules (a phone: Agent, Catalogue, Orders, More); no dock beside the agent's own page. On the
other pages "Add" and "ask about this product" open the same thread in the dock. The home's cards are made by plain
code from records (`server/thread/home.ts`); the model never writes one, it can only ask for one to be shown
(`find_products`, `product_facts`, `show_home` in agent.ts). Everything that buys lands on the order sheet. They are
drawn with the kit in `_ui/widgets-more.tsx` (`ProductResults`, `ProductFacts`, `HistoryList`, `StandingOrders`,
`DeliveryCard`, `MemoryList`); a turn that only shows something keeps no step list once shown.

| Card | What it is | Actions |
|---|---|---|
| `today` | **The day's opening**: posted unasked, as an agent turn with no buyer turn before it (`replyTo: ""`), when the kitchen's store reads a thread that has no opening for today (Helsinki day). Items, each from records only: `sign_off` (an order waiting for a named person: sign in place with the sign-off widget), `cutoff` (an order-by time today for something the kitchen orders recurrently: one live call for at most three products, cached ten minutes, `standingCutoffs`), `drift` (a recurring order whose amount or price moved: the portal's own drift warning), `recall` (an active recall hold on a product the kitchen bought), `delivery` (a committed order arriving today or tomorrow). No item when nothing needs them. `pending` while it is gathered. Asked again later, a fresh card in that turn. | `order_show`, `standing_change`, `home_show` |
| `products` | **Product grid** from master data only (no live call until a product goes on the sheet): only what the mandate allows (category, required attributes, no forbidden allergen) | `products_search`, `product_show`, `sheet_add` |
| `product` | **One product's facts**: pack, allergens (or "not declared"), attributes, certificates, origin, CO2, delivery reliability | `sheet_add` |
| `records` (history) | Earlier orders; every row can be ordered again | `order_again`: the order's lines on a new sheet for the next same weekday, re-priced and previewed there |
| `standing` | **Recurring orders**, read from history (`standing()` in kitchen-portal.ts): weekdays, usual amount and packs, next due, drift, `paused`. A pause is kept in the kitchen's profile (`pausedStanding`): the agent neither reminds of it (today's cut-offs and drift) nor orders it as "the usual" until it runs again; the store places no order by itself either way. "Change" is a new sheet for the next due day | `standing_change { family, packs? }`, `standing_pause { family, paused }` (the kitchen's signed-in person only; recorded) |
| `deliveries` | Orders committed or waiting, delivered today or later | `order_show` |
| `memory_list` | What the agent remembers (active or waiting for a yes); `canChange` only for the kitchen's signed-in person | `memory_edit`, `memory_forget` (refused without a signed-in person, `401 kitchen_person_required`; recorded as theirs), `remember_this` |
| `price`, `order` | The proof (`price.proof`: the signed quote and the signed claims it rests on) and the order's details and signed confirmation open inside the card; "Check the signatures" verifies each in the browser against `/.well-known/jwks.json` (`_client/verify-signed.ts`) | none |

`home_show { what: "today" | "history" | "standing" | "deliveries" | "memory" }` shows one of them. Each is in the
ledger (`today`, `products`, `order_again`, `memory_write`) and in the operations trace like any turn.

## Set-up interview (agent-thread-4, live)

A new account's second step is a short interview with the design kit (docs/DESIGN.md §7b: `SetupWelcome`,
`SetupStep` with the answer widgets, `RulesSheet` with a footer, `SetupDone`), not a form
(`app/k/signup/thread-interview.tsx`, `server/accounts/interview.ts`, `POST /ui-api/account/interview`). Step 1
(restaurant, username, password) is unchanged.

- A welcome: what the agent is, the three things it asks and why, "under two minutes", one button.
- Then one question at a time, its answer already chosen (`SetupStep`, progress "n of m", Back keeps everything):
  kind of kitchen (`ChoiceAnswer`, one tap moves on), "every product must be" and "never buy" (`ChoiceAnswer`
  multiple, "None of these" until one is picked), delivery days (weekday chips, suggested), a usual order, the
  spend-alone limit and the weekly budget (`AmountAnswer` with the suggestion set and presets, "300 € is right"), who
  OKs above the limit (a role already chosen, or their name). The questions, order, options and suggestions are plain
  code; the browser only words them (en/fi/sv). No model.
- Never asked what the records answer: the kind of kitchen when the name says it (said on the welcome, with "Not
  right?" to change it), and anything already answered (stateless, so a reload resumes).
- "These are your rules": the limit, the week, "every product must be" and "never" as labels (never ids), the
  delivery days, who OKs. One button, "Confirm, and add this device to OK orders": signs the rules with the account's
  own `signKitchen` (same key, mandate, signer and ledger entry), writes the answers to memory, appends the
  `setup_interview` ledger entry, then registers this device's passkey for the signer. If the device cannot (no
  passkey support, the prompt cancelled), the rules stand and the done screen offers the device again or a phone.
- `SetupDone`: what was set, in three lines, and "Make your first order" into the kitchen's agent.
- Evaluation: `eval/thread/first-timer-setup.ts` (EN and FI, 390 px, virtual passkey): sign up, interview, rules
  confirmed, first order placed; taps, seconds (`--think` adds reading time per tap), questions. `eval/thread/
  interview.ts` checks the mandate the answers make.

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
| taps a menu on the menu card / says "the second menu" | `{ type: "menu_choose", planId, proposalId }` |
| taps "Put on the order sheet" / says "yes, put it on the sheet" under a ready menu | `{ type: "menu_to_sheet", planId }` |

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
  `plan_menu` (a dish or menu for N covers: the menu planner as the kitchen's menu agent, its plan as a `menu` card),
  `buyer_reply` (map the newest buyer words onto an open card, checked as above) and `await_sign_off`.
- **A menu is edited in place and ordered as one sheet.** The menu card's edits are turns on the planner's own ops;
  `menu_to_sheet` makes one order sheet of it, and `sheet_place` one order through the gate (`server/thread/menu.ts`,
  `server/thread/sheet.ts`); the gate and order cards follow as for any order.
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

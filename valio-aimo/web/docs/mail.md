# Email to the kitchen: receipts and alerts

When an order is placed the kitchen gets a receipt by email, is told it will hear from us if anything goes wrong, and
then really does get an email when something changes. Optional, off by default, and the kitchen's own choice. Sent
through Resend's REST API (`fetch`, no SDK), after the fact: an order never waits for a mail, and a mail service that is
slow, down or refusing changes nothing about an order.

| Piece | File |
|---|---|
| Address, confirmation, events, caps, sending, ledger, operations view | `src/server/notify/service.ts` |
| The mails as HTML and plain text (pure) | `src/server/notify/render.ts`, words in `mail.text.ts` (en, fi, sv) |
| What each mail says, as data | `src/server/notify/model.ts` |
| Resend over `fetch`, and a fake for tests | `src/server/notify/transport.ts` |
| Signed, expiring links (confirm, stop) | `src/server/notify/links.ts` |
| The conversation's adapter | `src/server/notify/thread.ts`, words in `say.text.ts` |
| Outside agents: `receiptEmail` on an order's result | `src/server/notify/outside.ts`, `mcp/tools.ts` (place_order, get_order), `rest-step.ts` |
| The store: the address on Agent and rules | `k/[kitchen]/mail-panel.tsx`, `/ui-api/kitchens/{kitchen}/mail` |
| The pages a mail links to | `/mail/confirm`, `/ui-api/mail/confirm`, `/ui-api/mail/stop`, `/mail/stopped` |
| Operations | `/ops/mail`, `/ops-api/mail` |
| Tests | `src/server/notify/notify.test.ts` |
| Real sends to Resend's test inboxes, every mail written to disk | `pnpm mail:proof [--out dir] [--no-send]` (`scripts/mail-proof.ts`) |

## What is sent, when

One mail per event, never twice: each event has a key, kept in the mail log and sent to Resend as its
`Idempotency-Key` (Resend sends at most one mail per key for 24 hours, so a retry, a restart or a second process
cannot send it again; a repeat Resend refuses is recorded as "already sent", not as a failure).

| Event | Where it is recorded (the hook) | Key | Subject (English) |
|---|---|---|---|
| Address given | the store page or the conversation | `confirm:<contactId>` | Confirm your address for AimoPilot order emails |
| Order placed, by the agent alone or after sign-off: **the receipt** | event `order_committed` | `receipt:<orderId>` | Order ord_… placed: 20,94 €, delivery Sun 15.11.2026 |
| Waiting for sign-off | event `approval_requested` | `sign_off:<approvalId>` | Waiting for Sanna Koskinen's OK: order ord_…, 139,60 € |
| A product on an order or a recurring order cannot come | ledger `watch` entry, step `found` (the watch's finding) | `cannot_come:<org>:<product>:<day>` | <product> cannot come on Mon 16.11.2026 |
| A substitute was ordered in its place | ledger `watch` entry, step `renewal_placed` with a substitute | `substituted:<orderId>` | Substitute ordered: <product> for <day> |
| A renewal held because the recurring order drifted | ledger `watch` entry, step `renewal_held` | `renewal_held:<org>:<family>:<day>` | Recurring order on hold: <product> for <day> |
| An order refused by the gate (as placed, or at the re-check at sign-off) | ledger `decision` with outcome `reject`; event `order_rejected` | `refused:<orderId>` | Order not placed: 9,45 € |
| Declined by the approver | event `approval_declined` | `declined:<orderId>` | Order ord_… declined |
| Expired before anyone signed | event `approval_expired` | `expired:<orderId>` | Order ord_… expired before anyone signed |
| Taken back | events `approval_withdrawn`, `order_withdrawn` | `withdrawn:<orderId>` | Order ord_… taken back |

The receipt: order number, kitchen, when placed, delivery day, each line (name, packs × pack size at the unit price,
the line total, the deposit, "Substitute for …"), goods, deposits (no VAT), VAT by rate, the total before and with VAT
(when a VAT rate is not known it says so and ends on the total before VAT), who decided (the agent within its per-order
limit, or the named person who signed, and when; a demo tap is said to be one), a link to the order in the store and to
its Verify panel (`/k/<kitchen>/orders/<id>#verify`, the browser checks the wholesaler's Ed25519 signature on the
order confirmation), the confirmation's SHA-256 fingerprint and the public keys, and the sentence: "We will email you if
anything changes: a delay, a shortage or a substitute."

A change mail says what happened, why (the system's own sentence, money in the Finnish form), what was done, what the
kitchen can do, and the figures (the amount and day; for a stock-out the good, better, best substitutes, each inside or
outside the kitchen's stated preferences). A staged condition is said to be staged.

All three kinds: English, Finnish or Swedish by the language the kitchen gave the address in (the store's language at
that moment, or the conversation's); numbers, money and dates the Finnish way in all three (1 280,50 €, ma 16.11.2026,
klo 14.05). Product names are the catalogue's as on the order. The sender and header are AimoPilot, never the
wholesaler's name or branding; the footer keeps "Demo on synthetic data, built for the Junction 2026 Valio Aimo
challenge".

The HTML is built for mail clients: tables for layout, inline styles (a `<style>` block adds only the narrow-screen and
dark-mode touches), system fonts with a fallback stack, 600 px wide and fluid below 620 px, a hidden preheader, Outlook
conditionals for the fixed width, no images (nothing needs one to be understood), a plain-text alternative, numbers
right-aligned in tabular figures. Petrol #005670 on white; the lime #c0e021 used once, as the bar on the card.
`color-scheme: light dark` with dark overrides for clients that apply them.

## Who gets mail

- A kitchen may give **one** notification address: on Agent and rules (`/k/<kitchen>/agent`, the Order emails card) or
  in words to its agent. Only the kitchen's own signed-in person (not a call-only session, not the operations desk) can
  give, change or remove it.
- It is used only once **confirmed**: the first and only mail to a new address is the confirmation, with a signed link
  that expires in 48 hours. The link opens a page with a button (a mail scanner that opens links confirms nothing).
  Until it is confirmed every other event is recorded as "not sent: the kitchen's address is not confirmed yet". A new
  address makes the earlier link stop working. A public demo cannot be used to mail strangers more than that one
  confirmation, and a kitchen can give an address at most 3 times an hour.
- Every mail after that has a one-click **stop** link (and the `List-Unsubscribe` / `List-Unsubscribe-Post` headers,
  RFC 8058, so the mail client's own unsubscribe button works). Stopping deletes the address.
- After each send the service asks Resend what happened (30 s and 3 min later). A **bounce** or a spam complaint stops
  mail to that address and deletes it; the kitchen gives one again to start.

### Given at sign-up

An ordinary sign-up (`/k/signup`, step 1) asks for the business email, required, with the line "Order confirmations,
receipts, and a note when something can't be delivered" (`server/accounts/email.ts`). It is checked on the server and
kept on the account only until the kitchen exists at the end of the set-up interview; then it becomes the kitchen's
contact through `setAddress` (pending, one confirmation mail) and is deleted from the account. The done screen says
whether the confirmation went ("Check your inbox to confirm …") or honestly not ("We couldn't send the confirmation
yet"); Your rules shows the state with "Send the confirmation again". A fresh kitchen (one click) and the shared test
kitchens never ask: an address can be added under Your rules. Confirmation sends are capped per kitchen (here) and per
client address (`DOCK_LIMIT_MAIL_CONFIRM_ADDRESS`, default 20 an hour).

## Guardrails

| Guardrail | Setting | Default |
|---|---|---|
| Mails per kitchen per hour | `DOCK_MAIL_PER_KITCHEN_HOUR` | 10 |
| Mails for the whole service per 24 hours | `DOCK_MAIL_DAILY` | 90 (Resend's free plan sends 100 a day) |
| Address changes per kitchen per hour | fixed | 3 |
| One mail per event | the event key, and Resend's `Idempotency-Key` | always |
| Off until an address is given and confirmed | | always |
| Retries | 3 tries on a timeout, a network error, 429 or 5xx (0.8 s, 2.5 s apart); none on a refusal (bad address, unverified sender) | |

Every mail sent, skipped (not confirmed, stopped, bounced, a cap, no mail service, already sent) or failed is a ledger
entry of type `mail` with the event key, the kind, the outcome and the reason, and the order id when there is one: never
the address and never the body. So are the address set, confirmed, stopped, removed or bounced. Both sides read these
entries in full (`core/audit.ts`, kind `notified`). An event for a kitchen that never gave an address writes nothing
(nothing was meant to be sent); the operations page counts them.

## Privacy

- The address is kept with the kitchen's own records (collection `mail_contacts`, PostgreSQL with `DOCK_STORE=postgres`)
  and deleted when the kitchen stops the mails, removes it, or it bounces.
- Shown in full only to the kitchen's own signed-in person (the store's card, "which address do you have?" in the
  conversation). Everywhere else it is masked, `m•••@example.com`: the agent's sentences, the mails' own footer,
  `/ops/mail`, the order result outside agents read.
- Never in the ledger, a URL (the links carry a signed token naming the kitchen and the address record, not the
  address), a log line, or the wholesaler's audit view. The mail log keeps what each mail said as data, without the
  address, so the operations page can render it again (with the masked address and inert links) instead of storing the
  body.

## The sender, and what the user must do in Resend

**With the default sender, `AimoPilot <onboarding@resend.dev>`, Resend delivers only to the Resend account's own
address** (and its test inboxes `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`). Any other
recipient is refused (`403`, "You can only send testing emails to your own email address"); that refusal is recorded as
a failed mail and the order is not affected. To mail real kitchens:

1. In Resend, Domains, add a domain you control (for example `mail.aimopilot.fi`) and add the DNS records it shows
   (SPF and DKIM; DMARC recommended). Wait until it shows Verified.
2. Set `DOCK_MAIL_FROM="AimoPilot <orders@mail.aimopilot.fi>"` (any address on that domain) in `web/.env.local` and on
   the server, and redeploy.
3. Optional: raise `DOCK_MAIL_DAILY` if the Resend plan sends more than 100 a day.

Without `RESEND_API_KEY` the app runs as before and every mail is recorded as "not sent: no mail service configured";
the agent then never claims a mail was sent. Links in the mails use `DOCK_PUBLIC_URL` (else `http://localhost:3000`).
The link-signing key is derived from `DOCK_ACCOUNT_KEY_SECRET`; without it the links last as long as the process.

## For the conversation

`src/server/notify/thread.ts` (the thread engine calls it; it does not change the thread):

| Call | Returns / does |
|---|---|
| `mailFactAfterOrder(rt, run.k, order, { lang, threadId })` | after an order is placed or sent for an OK: one sentence to add, or `undefined`. "I've emailed the receipt to m•••@example.com and will email you if anything changes." / for an OK: "I've emailed m•••@example.com that it waits for an OK…" / not confirmed yet: "Once you confirm m•••@example.com from the email I sent, receipts go there." / no address, at most once per conversation: "Want the receipt by email? Tell me the address." Nothing when no mail service is configured. |
| `mailWordsOf(words)` | `{ kind: "set", address }`, `{ kind: "set_invalid" }`, `{ kind: "stop" }`, `{ kind: "which" }` or `undefined` (en, fi, sv): "email receipts to chef@example.com", "stop the emails", "which address do you have?" |
| `answerMailWords(rt, run.k, intent, { person: run.person, via, lang })` | does it and returns `{ reply, changed }` in the kitchen's language. Setting or stopping needs the kitchen's signed-in person; setting sends only the confirmation. |

## Outside agents

`place_order` and `get_order` (MCP), `POST /api/v1/orders` and `GET /api/v1/orders/{id}` (REST) carry, on a committed
order, `receiptEmail: { emailed, to: "m•••@example.com", status }`. The receipt goes after the fact, so right after
`place_order` it is usually `sending`; `get_order` says `sent` once it went. Other statuses: `no_address`,
`not_confirmed`, `not_configured`, `failed`, `skipped`.

## Proof

`pnpm mail:proof` reads only `RESEND_API_KEY` from `web/.env.local` (nothing else: the runtime stays in memory on the
seed catalogue, off every hosted service), refuses to send to anyone but Resend's test inboxes, and runs the real
events: an address given and confirmed from its link, an order placed alone, one over the limit, one taken back, one
the rules refuse, a staged stock-out found by the watch, a drifted recurring order held, and a Finnish kitchen's receipt.
It prints each mail's outcome and Resend id and what Resend reports a few seconds later, and writes every mail as
`.html` and `.txt`.

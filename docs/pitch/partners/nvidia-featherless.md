# NVIDIA and Featherless

> **Name: the team must choose.** Replace `{{NAME}}` ("Dock" in the code, "AimoPilot" in the draft submission).

**Short version: Nemotron is now in the live path, as an independent second reader of every typed or spoken request.
It can only add a question, it was earned on a measured evaluation, and it is off when its variable is empty.**

## What it does, in plain words

A kitchen writes or says "I need 1,000 litres of lactose-free milk by Monday". Claude Opus 5.5 reads that into fields
(amount, unit, claims, allergens, product, day). At the same moment NVIDIA's open-weights **Nemotron 3 Nano**, through
Featherless, reads the same words again in its own way. Plain code compares the two readings on the fields that change
the order:

- **They agree**: nothing is asked; the request card says it was read twice, by which models.
- **They differ on something the words name** (the amount by 2x or more, packs against litres, a dietary claim or an
  allergen, another kind of product, the delivery day): the buyer gets one question about exactly that field, showing
  both readings, before any price is fixed. "Two independent readers read the amount differently: Claude Opus 5.5 read
  1,000 L, NVIDIA Nemotron 3 Nano read 100 L. Which did you mean?"
- **Nemotron is late, down or at capacity**: the request is recorded as read once and goes on. It never slows an order:
  it has 8 s from the shared start, and at the 90th percentile it added no wait.

The argument: two readers from different model families rarely make the same mistake, and plain code decides which
differences matter. Nemotron never changes the need, never chooses a product, never approves anything. Because the
model is open weights, a wholesaler can run this check on its own hardware.

## Results (`web/docs/second-reader.md`; `pnpm eval:second-reader`)

107 requests in English, Finnish and Swedish (77 for tuning, 30 held out), many written to be easy to misread:
"1.000" against "1,000", "a dozen cases", "100 x 10 l", "not lactose-free", "no nuts", "tomorrow". Two runs each.

| | Tuning set | Held-out set |
|---|---|---|
| Needless questions (first reading right, asked anyway) | 0 and 1 of 76 | 0 and 0 of 30 |
| Known misreadings caught (x10, "1.000" as 1, a dropped or negated claim, a dropped allergen, another product, another day) | 91 %, 90 % of 536 | 91 % of 222 |
| Nemotron alone right on every compared field | 65 %, 60 % | 53 %, 60 % |
| Nemotron time, median / 90th percentile | 1.4 s / 1.9 s | 1.4 s / 2.4 s |
| Unavailable | 0 of 154 | 0 of 60 |

Claude Opus 5.5 made no real misreading in the 107, so every catch above is on injected errors: the second reader is
insurance, not a fix for an observed failure.

What it took: Nemotron filling the interpreter's own schema asked a needless question on 53 % of requests (wrong
weekday dates, invented claims). With thinking on it took 9.5 s at the median. The version that works transcribes into
closed lists at temperature 0, leaves the calendar to plain code, and the comparison asks only about what the buyer's
words name. **Nemotron 3 Super 120B** answered HTTP 429 "temporarily at capacity" to all 291 calls over three hours,
so it is not scored.

## Where to see it

- The order lane, `/k/<kitchen>`: the line under the request card; the question with the other checks on a difference.
- `/ops/safeguards`, "Read twice": agreed, differed, read once, and how buyers settled differences. `/ops/trace/<id>`:
  the "Read twice" step with both readers.
- Code: `web/src/core/second-reading.ts` (the comparison, no model), `web/src/server/agent/second-reader.ts` (the
  call), `web/scripts/eval/eval-second-reader.ts`, `web/eval/second-reader/` (sets, recorded readings, results).
- Configuration: `DOCK_SECOND_READER_MODEL=featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` and
  `FEATHERLESS_API_KEY`.

Also, as before: the crash test runs open models through Featherless (Nemotron-3-Nano scored 37.0 of 100 as a
buyer, one run), and NVIDIA's Cosmos-Reason2 was evaluated as a reader of photographed order lists (25 and 11 of 37
lines; Claude Haiku 5.5, 33, is the one in use).

## What is true and what is not

- True: every request typed in the order lane, spoken at the voice door, or sent by an outside agent to
  `POST /api/v1/agent/interpret` is read twice when the variable is set, and the result is in the ledger.
- True: the comparison is plain code with tests; nothing under `web/src/core/` calls a model.
- Not: the photo door and follow-ups of earlier requests are read once (by choice; see `web/docs/second-reader.md`).
- Not: proof that it catches real mistakes in use. The catch rate is on injected misreadings; the first reader made none.
- Not: hosted on the wholesaler's hardware today. It runs on Featherless; "a wholesaler could run it" is about the open
  weights, not something we did.
- Check before saying it is live: the deployed site needs `DOCK_SECOND_READER_MODEL` set (*).

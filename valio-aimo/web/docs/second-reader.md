# The second reader

**Status: built, evaluated, and switched off in the deployed demo since 14 Nov 2026.** On the evaluation below it
caught injected misreadings but no real one in 127 requests, so it adds cost and an occasional extra question
without a measured benefit; the plain-code checks (the mistake check, the mandate, the gate) carry the safety. It is
one setting to switch on, with any `provider:model-id`, including a model on a wholesaler's own hardware.

When it is on, every request a model reads into a structured need is read a second time, at the same moment, by a
separate call that uses a different method (a short transcription into closed lists, not the interpreter's schema).
The evaluation below was run with NVIDIA's open-weights Nemotron 3 Nano through Featherless; with the first
reader's own model (Claude Opus 5.5) it works too, in about 2.5 to 4 s a reading, but the two readings are then less
independent.
Plain code compares the two readings on the fields that change the order. When they agree, nothing is asked and the
request card says it was read twice. When they differ on something material, the buyer gets one question about exactly
that field, showing both readings, before any price is fixed.

The second reader can only add a question. The order always goes on the first reading (Claude Opus 5.5); the buyer
settles a difference by choosing a reading or writing the request again; the gate stays plain code.

| Part | File |
|---|---|
| The comparison, pure and tested (no model) | `src/core/second-reading.ts`, `second-reading.test.ts`, `second-reading-intake.test.ts` |
| The model call, fail-open, with its deadline | `src/server/agent/second-reader.ts`, `second-reader.test.ts`; prompt in `prompts.ts` |
| Where the record waits for the intake | `src/server/agent/second-reading-store.ts` |
| The one call site | `interpretRequest` in `src/server/agent/interpret.ts` |
| The evaluation | `scripts/eval/eval-second-reader.ts`, `eval/second-reader/` (sets, recorded readings, results) |

**Configuration.** `DOCK_SECOND_READER_MODEL`, as `provider:model-id`; empty turns it off (the deployed
setting). To switch it on: `anthropic:claude-opus-5-5` (inside the 8 s deadline), or a reader of another family such
as `featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` (needs `FEATHERLESS_API_KEY`).

## How it reads

The second reader does not fill the interpreter's schema. It transcribes what the words say into closed lists (amount
and unit, a pack size, dietary claims wanted or not wanted, allergens to avoid, a weekday, a written date or
"tomorrow"), at temperature 0 with Nemotron's thinking switched off. Plain code then turns that into a reading,
including the calendar: a weekday is the next such day after today, the interpreter's own rule. Different model family,
different prompt, different method.

## What counts as a material difference

- **Amount**: two amounts at least 2x apart, or packs against litres or kilos that no pack size written in the text
  reconciles ("100 x 10 l" is 100 packs and 1,000 L).
- **Claims**: a dietary claim the words name (lactose-free, organic, vegan, vegetarian) that the second reading requires
  and the first does not, or that one requires and the other excludes ("not lactose-free" read as lactose-free). The
  second reading's "not" counts only when the words negate the claim (a negation within three words before it, or
  "not needed" after it).
- **Allergens**: an allergen the words name that the second reading avoids and the first does not. "Gluten-free" and
  "no gluten" are the same.
- **Kind of product**: item words that share no stem or name another kind (cream for milk, coffee milk), or two product codes.
- **Delivery day**: two different days, or a day only the second reading has, when the words name a day and the second
  reading's day fits them (the weekday named, "tomorrow").

Not material, and why: anything the words do not name (a claim, allergen or day one reading invented is the grounding
check's business, not a question); a field the second reading left empty; a claim one reading excludes and the other
leaves unsaid (neither requires it); fat content and other attributes; "by" against "on" the same day; a second
reading's day that contradicts the weekday the words name, or a total it wrote as a count of packs ("100 x 10 l" as
1,000 packs of 10 l): the second reader misread, and the first reading is not in question.

## Never slower, never in the way

Both readings start together. The second has a deadline of 8 s from that start; the first (Opus 5.5) took 2.3 s at the
median and 3.7 s at the 90th percentile here, the second 1.4 s and 1.9 s. If it is late, down, at capacity, over the
daily caps, unreadable or reads the text as no order, the request is recorded as **read once** and goes on.
Its calls count against the daily model limits as *spare* calls: they stop at 90 % of either cap, so first readings
keep the last tenth. The photo door does not use it (its words are written by code from a line the buyer has
already reviewed), and neither does a follow-up of earlier requests (the second reader does not see them).

## Where it shows

- **Order lane** (`/k/<kitchen>`): one quiet line on the request card ("Read twice: ... read the same amount,
  requirements and day"). On a difference, the question appears with the other checks: "Two independent readers read
  the amount differently: Claude Opus 5.5 read 1,000 L, NVIDIA Nemotron 3 Nano read 100 L. Which did you mean?" with
  the two readings and "Neither: I will write it again" as the answers. The strings are in
  `src/app/k/[kitchen]/second-reading.tsx` and `core/second-reading.ts`.
- **Ledger**: an `intake` entry with `data.step = "second_reading"`: status, both model ids, the second reader's time,
  the wait it added, the differences, and the non-material ones as reasons.
- **Operations trace**: a step "Read twice: the two readings agree", "...differ on the amount" or "Read once: the
  second reader was unavailable", with both readers named.
- **Safeguards** (`/ops/safeguards`, "Read twice"): agreed, differed, read once (by reason), and how buyers settled
  differences.
- **API**: `secondReading` on `POST /api/v1/agent/interpret` and on every intake step.

## The evaluation

`pnpm eval:second-reader` reads what is not yet recorded and scores; `--offline` re-scores the recorded readings for
free; `--set holdout` and `--set fresh` use the other two sets. Every number below is in `eval/second-reader/results*.json`.

**The sets.** 77 requests (32 English, 25 Finnish, 20 Swedish) written for this, each with the right reading on the
compared fields; most are easy to misread: digit grouping ("1.000", "1,000", "1 000"), decimal commas, "a dozen" and
"tusina", packs with sizes ("100 x 10 l", "six 10-litre boxes"), self-corrections, arithmetic ("double the usual"),
distractor numbers, negated claims ("not lactose-free", "ei tarvitse olla laktoositonta"), allergens to avoid, relative
days. Then a **held-out set** of 30 (10 per language, number words, "before Tuesday", "next Thursday"), written after
the rules and the prompt were tuned, and a **fresh set** of 20 (6 to 8 per language) written after the last change
and not used for anything else. Now = Saturday 14 Nov 2026 10:00 Helsinki. The vocabulary is
the live one (the partner catalogue's tags and the demo mandate).

**Injected misreadings.** From each right first reading, known wrong ones are made (x10 and /10 the amount, "1.000" read
as 1, litres read as packs, a claim dropped, a claim negated, an allergen dropped, another kind of product, a week
later, the day before, the day dropped) and compared with the real second reading: caught if the comparison flags that
field. Two more kinds add what nobody said (a lactose-free claim, a nut allergy); by design they are left to the
grounding check, and they are reported apart.

### After the integration merge (main e7c8239: one intake, grounding, multi-item reader, memory recall)

Re-run at production settings, first and second readings both read afresh (two runs of the second reader), plus a
new set of 10 requests naming several items. The second reader now transcribes every item named and only the item of
the same kind as the first reading's one need is compared; a "same again on another day" clause turns the day
comparison off. After the re-run, four rules were fixed on what it showed: "tomorrow" wins over a weekday the small
model adds next to it; an allergen only the second reading avoids must be avoided in the words, not merely named
("oat cooking cream"); "before Tuesday" read as Monday or Tuesday is not asked; "huomiseksi" counts as naming a day.

| | Tuning (77) | Held-out (30) | Fresh (20) | Several items (10) |
|---|---|---|---|---|
| First reader (Opus 5.5, now with the grounding check) right | 68 (9 wrong) | 27 (3 wrong) | 18 (2 wrong) | 8 (2 asked for the amount) |
| Needless questions, before the four fixes | 0 and 0 of 68 | 2 and 2 of 27 | 0 and 0 of 18 | 0 and 0 of 8 |
| **Needless questions, production** | **0 and 0 of 68** | **0 and 0 of 27** | **0 and 0 of 18** | **0 and 0 of 8** |
| **Real misreadings of the first reader caught** | **2 of 2** | **3 of 3** | **1 of 1** | none |
| Injected misreadings caught | 93 %, 92 % | 96 %, 94 % | 98 %, 100 % | 81 % |

The first reader's new errors come from main's grounding check, not the model: it removes a delivery day written
as "huomiseksi", "ylihuomiseksi" or "den 19:e" (6 requests, all caught by the second reader as "only the second
reading has a day"), and an amount written in words ("two dozen", "tusina", "six 10-litre boxes"; the buyer is then
asked for the amount, which is not compared). Fixed on `claude/grounding-days`: the grounding check now recognises the day in the forms people use
(`dayStated` in `core/grounding.ts`: inflected weekdays, "huomiseksi", "i övermorgon", "den 19:e", "16/11", "ensi
viikon tiistaiksi", "before Tuesday") and amounts counted in dozens or as "double", and it is stricter in the other
direction: with today known, the day must be one the words name, not merely any day. The evaluation now prints the
first reader's dropped days and amounts on every run: before the fix 7 of 132 stated days and 10 of 137 stated
amounts; after it 0 days and 2 amounts (both a message naming several items that the model merged into one need, not
the grounding check), with no needless question in 268 comparisons. The numbers below are from before the merge.

### Results, production settings (two runs of the second reader on each set)

| | Tuning set (77) | Held-out set (30) | Fresh set (20) |
|---|---|---|---|
| First reader (Opus 5.5) right on every field | 76; the 77th it asked about (no item named) | 30 | 20 |
| Nemotron 3 Nano alone right on every compared field | 50 and 46 (65 %, 60 %) | 16 and 18 (53 %, 60 %) | 12 and 12 (60 %) |
| By field, alone (run 1): amount / claims / allergens / product / day | 97 / 81 / 97 / 100 / 83 % | 100 / 73 / 100 / 100 / 80 % | 100 / 75 / 100 / 100 / 85 % |
| **Needless questions** (first right, asked anyway) | **0 of 76, 0 of 76** | **0 of 30, 0 of 30** | **0 of 20, 0 of 20** |
| **Injected misreadings caught** | **487 and 482 of 536 (91 %, 90 %)** | **202 and 202 of 222 (91 %)** | **133 and 133 of 142 (94 %)** |
| All injected, with the two invented kinds | 74 %, 73 % | 74 % | 76 % |
| Real misreadings of the first reader caught | none to catch: it made none | none | none |
| Second reader time, median / 90th percentile | 1.4 s / 1.9 s | 1.4 s / 2.4 s | 1.3 s / 2.0 s |
| Wait added after the first reading, median / 90th / max | 0 / 0 / 1.0 s | 0 / 0.1 / 1.9 s | 0 / 0.3 s |
| Unavailable | 0 of 154 | 0 of 60 | 0 of 40 |

Caught by kind (tuning set, run 1): x10 75/76, /10 67/68, "1.000" as 1 13/13, litres as packs 34/41, claim dropped
20/20, claim negated 19/19, allergen dropped 11/12, another product 76/76, a week later 56/69, the day before 58/71,
day dropped 58/71. Over the three sets and both runs: **0 needless questions in 252 compared requests, and 91 % of
1,800 injected misreadings caught.**

**Live, on the production build** (port 3417, the real Opus 5.5 and Nemotron through the store's own API), ten tricky
requests written on the spot gave three needless questions under the rules of the time: "before Wednesday" (a written
date read from "4 kg"), "100 x 10 l" (the total as packs) and "lactose free" (read as *not* lactose-free). The last
three rules above were made from those three; the fresh set was written after them and changed nothing.

### How it got there (the honest path)

| Design | Needless questions (tuning set) | Misreadings caught | Note |
|---|---|---|---|
| Nemotron fills the interpreter's own schema and prompt, every difference asked | 40 of 76 (53 %) | 95 % | Wrong weekday dates on 28 requests; invented claims |
| Same, thinking on | | | 9.5 s median, 15 s at the 90th: past the deadline 2 times in 3 |
| Nemotron 3 Super 120B | | | HTTP 429 "at capacity" on all 291 calls, over three hours |
| Transcription with closed lists, every difference asked | 30 of 76 | | Listed every claim as "not wanted"; 11 unparseable answers |
| ... at temperature 0 | 31 of 76 | | No unparseable answers; "by Friday" often read as "the day after tomorrow" |
| ... a flat day field, only what the words name compared | 12 of 76 | | |
| ... "tomorrow" checked, a claim excluded against unsaid not asked, pack totals reconciled | 3 of 76 | 94 % | |
| ... amount 2x, a claim only the first reading has not asked | 0 and 1 of 76 | 91 %, 90 % | |
| ... a day against the named weekday, a "not" the words must say, a total written as packs | 0 and 0 of 76 | 91 %, 90 % | production |

Sweep on the tuning set (run 1, other rules as in production): comparing every difference, not only what the words
name: 16 needless questions (21 %), 98 % caught. Amount factor 1.25 or 1.5: 1 needless question, same catches.
Asking when only the first reading has a claim: 2, nothing more caught. Not asking when only the second has a day:
80 % caught. Not comparing the kind of product: 77 % caught.

**Caveats.** The rules and the prompt were tuned on the 77-request set and on ten live probes, so those numbers
flatter. The held-out set was written after most of the tuning but before the last rule changes: on its first
scoring it had 1 needless question per run ("before Tuesday") and caught 94.6 %. The fresh set (20) was written after
every change and scored once: it is the fairest number, and it is small. The first reader made no real misreading in
127 requests, so the measured benefit on real errors is zero; every catch is of an injected error. Nemotron alone is
right on every field only about 60 % of the time: it is useful as a second reader only because plain code asks about
what the words name and leaves the rest.

**Decision.** On, for the doors where a model reads a person's words: the typed order lane, the voice door, and outside
agents calling `POST /api/v1/agent/interpret`. Off for the photo door (its words are written by code from a line the
buyer reviewed) and for follow-ups of earlier requests (the second reader does not see them). Reason: no needless
question in 252 compared requests (and 3 in 10 deliberately tricky live probes before the last fixes), no wait at the
90th percentile, about $0.0001 a request on Featherless, against about nine in ten of the misreadings that would
otherwise go to the price unasked. If the first reader is ever a
smaller, cheaper model, the case gets stronger; if Featherless is at capacity, it is read once and nothing else changes.

Spend: about $2.00 of Opus 5.5 first readings (127 requests, recorded once, re-scored for free since), about $0.25 of
live probes on the production build, and under $0.05 of Nemotron for about 1,100 readings.

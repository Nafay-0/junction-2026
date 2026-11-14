# Google: Gemini Live, the voice door

Google DeepMind is a featured partner, not a challenge; Umar Noor (Developer Experience / GTM, Google DeepMind) is
on the main jury, with a focus on "first prototype to real-world impact" (`research/01-event-intel.md`).

## What it does in the product, in plain words

A chef with full hands can call their purchasing agent from the phone. The voice is Gemini Live
(`gemini-3.8-live`). It runs the same steps as typing: it reads the request back, asks the same checks, reads the
options with their trade-offs, and places the order only after the chef picks one and says yes. The model decides
nothing: each of its seven tools runs plain code on our server, and each result carries the sentence the voice should
say. While it speaks, every amount, price, date and brand it says is checked against this call's tool results; on a
mismatch the screen cuts its audio (it plays 250 ms behind), strikes the line through and the ledger records it.

The session setup (model, instructions, tools) is locked inside a one-use token our server mints; the API key never
reaches the browser. A call is limited to 300 seconds by default, with per-kitchen and per-server caps.

## Where to see it

- On a phone that joined through the wall's QR code: **Call your agent** on the approver home, or `/call`.
- In the store: the microphone button in the assistant panel on `/k/kaari`.
- Preview of both doors: `/channels`.

Code: `web/src/server/channels/voice/`, `web/src/app/_channels/`, grounding check in
`web/src/app/_channels/grounding.ts`. Documentation: `web/docs/doors.md`.

## What is true

- Twelve spoken requests (British, Indian, American, South African, Australian, Irish, Finnish and Swedish voices,
  five with kitchen noise), two runs: the amount, unit and item were right in **7 of 12** both times; the tool was
  called in 10 and 11 of 12; the reply was grounded in 11 of 12; median 1.4 s from end of speech to the tool call.
- No miss became a wrong order: each was visible in the transcript and the read-back, and an order still needs a
  chosen card and the sign-off.
- In Chromium with a Pixel 7 viewport: a full hands-free call to three spoken options with the right prices; a
  refused microphone falls back to typing; a dropped connection offers Call back.

## What is not yet

- **7 of 12 is weak.** The misses: background voices transcribed instead of the caller at equal loudness, "butter"
  heard as "powder", nothing heard once in moderate noise. Say it straight if asked; do not lead with voice.
- Not tested on a real iPhone or Android phone, on mobile data, or in a loud room.
- No real telephone number. The Twilio route is documented in `web/docs/doors.md`, not built.

## Other Google models in the project

- Gemini 3.1 Flash Lite drove the Google ADK buyer (`examples/runtimes/RESULTS.md`: ended at `pending_approval`)
  and scored 66.2 in the crash test.
- For reading photos of order lists, Gemini 3.1 Flash Lite read all 37 lines in both runs, but in a separate try read
  a smudged amount as "cream 1 L"; we chose Claude Haiku 5.5, which never guessed it (`web/docs/doors.md`).
- No images were generated: the Gemini key on the team's machine was on the free tier, where image models have a
  quota of zero (`web/docs/DESIGN.md`).

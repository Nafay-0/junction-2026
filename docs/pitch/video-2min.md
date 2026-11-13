# Submission video (at most 2:00, strictly enforced; this plan ends at 1:54)

> **Name: the team must choose.** Replace `{{NAME}}` everywhere ("Dock" in the code, "AimoPilot" in the draft
> submission).

Rules (`research/05-official-briefs.md`): public on YouTube or Vimeo, at most 2:00. Upload by Sunday 09:00 so there is
time to check it plays logged out. Burn the captions in: tired viewers watch without sound.

## How to record

- Screen: the live site `https://jolly-wondrous-bunny.eur-1.aiven.app` in a clean browser profile, 1920 x 1080, zoom
  125 %, no bookmarks bar. Phone: the phone's own screen recorder, then place it beside the laptop shot in the edit.
- Record each shot separately, longer than needed, and cut. Record the voice last, over the cut.
- Use a fresh visitor kitchen (scan the wall's QR code) so the phone shows a real passkey sign-off.
- Never show `/ops/enter` with the passcode typed, `web/.env.local`, or any terminal that prints keys.
- Every figure on screen must be one from `claims.md`.

## Shot list

| # | Time | Screen to record | On-screen text (caption) | Narration, word for word |
|---|---|---|---|---|
| 1 | 0:00 to 0:09 | Dark kitchen still, or just the wall at `/` with its QR code | "Soon your kitchen's AI agent will order the food." | "Soon a kitchen's AI agent will order its food. But who allowed it to spend that money, and who answers if it's wrong?" |
| 2 | 0:09 to 0:17 | Title card: {{NAME}} and the sentence | "The agent can ask for anything. It can only buy what the kitchen signed for." | "{{NAME}} is the door a wholesaler opens for AI purchasing agents. The agent can ask for anything. It can only buy what the kitchen signed for." |
| 3 | 0:17 to 0:29 | Phone: scanning the wall's QR code, **Create my passkey and start**, Face ID, the approver home | "One scan, one passkey: you are the kitchen's approver" | "Scan the code, and your phone becomes the approver of a hotel kitchen. Its agent may spend five hundred euros alone." |
| 4 | 0:29 to 0:45 | Laptop: `/k/kaari/order`, asking for 1,000 L of lactose-free milk for Monday; the mistake check "1,000 L where you usually order about 100 L"; then the option cards | "Valio Aimo's own example. A mistake check from the kitchen's own history. Options ranked good, better, best." | "Here is Valio Aimo's own example: a thousand litres of lactose-free milk by Monday. This kitchen usually orders about a hundred, so the agent checks first. Then it shows options, good, better, best, with real products and live prices." |
| 5 | 0:45 to 0:56 | The order lane reaching the gate: the black-and-yellow panel, "needs a person's sign-off" | "The gate is plain code, not the AI." | "The wholesaler signs a fixed price. The order is more than the agent may spend alone, so the gate stops it. The gate is plain code, not the AI." |
| 6 | 0:56 to 1:07 | Phone: **Waiting for you**, the sign-off screen ("Why you are asked", "The order"), Face ID, **Order placed**; then the wall showing it signed | "A named person signs on their own phone." | "The named person sees what, how much, and why they are asked, and signs with their face. The wholesaler signs the order." |
| 7 | 1:07 to 1:17 | Laptop: the basket with a product the kitchen does not allow; the gate's refusal "Only product groups the kitchen allows"; the wall's **Refused, and why** | "Try to break it: refused, with the rule that stopped it." | "Try to make it buy what the kitchen does not allow, and it is refused, with the rule that stopped it." |
| 8 | 1:17 to 1:28 | `/ops/trace/<request>` replaying the request step by step; then **Safeguards**; then **Control** with the suspend button (do not press it) | "The wholesaler's desk: replay any request, see every safeguard, suspend an agent." | "The wholesaler's staff see every agent at the door, replay any request step by step, and can suspend an agent." |
| 9 | 1:28 to 1:38 | `examples/runtimes/RESULTS.md` table on screen (or `/k/kaari/agent`, "connect your own agent") | "7 agent frameworks, one open door (MCP and OpenAPI)" | "Buyers built on seven popular agent frameworks ordered through the same open door, and every one stopped and waited for the person." |
| 10 | 1:38 to 1:47 | Terminal: `cd web && pnpm crash:reproduce` output (scores table); then the model results table from `web/README.md` | "Crash test: 13 hard situations. Models we tested: 25 to 66 out of 100." | "Our crash test rates AI buyers on thirteen hard situations. The models we tested scored 25 to 66 out of 100." |
| 11 | 1:47 to 1:54 | `/ops/platform` (Aiven), then the title card with the demo address | "Runs on Aiven. Open standards. Try it: jolly-wondrous-bunny.eur-1.aiven.app" | "It runs on Aiven, on open standards. Try it yourself." |

Narration: about 250 words. At 140 words a minute that is 1:47 of speech in 1:54 of picture. If the voice-over runs
long, shorten shot 8 first.

## Notes per shot

- **Shot 4** needs the language model to read typed text. If it is down when you record, press the **offline
  example** button; it gives the same structured request.
- **Shot 4** must use the demo kitchen Kaari (it has the order history that makes the mistake check fire). The
  phone shots 3 and 6 use a visitor kitchen; that is fine, but do not imply on screen that they are the same kitchen.
  Captions above do not.
- **Shot 7**: rehearse the basket path first. If the refusal does not show as expected on the live site, use the
  refusal list on the wall instead, which shows real refusals with their rule.
- **Shot 10**: `pnpm crash:reproduce` runs offline in about 2 seconds and needs no keys. Record the terminal with a
  large font. The model scores are from `web/README.md` ("Model results"), one run each on seed 1; the caption must
  not say more than that.
- **Do not show**: the menu planner with allergens (open QA finding), a fixed euro total presented as a constant, the
  voice call presented as reliable.

## Before uploading

- Total length under 2:00 on the platform's own player (it can add a frame). Aim for 1:54.
- Captions burned in, checked against the narration above.
- Plays logged out, in a private window, on a phone.
- The link goes into `submission.md` and the deck's last slide.

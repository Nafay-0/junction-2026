# Three-minute pitch (top 5, Sunday final ceremony)

Format (from `research/05-official-briefs.md`): exactly 3 minutes, the mic is cut; then 3 minutes of questions;
seven judges vote. You may demo from your own laptop. One handheld mic. Last year the jury asked a team why only one
person spoke, so both of you speak.

## The one sentence the jury should remember

> **"The agent can ask for anything. It can only buy what the kitchen signed for."**

Say it at 0:40 and again as the last line.

## Roles

- **Speaker A** (holds the mic for the open, the proof and the close).
- **Speaker B** (at the laptop, takes the mic for the demo). B's phone, or A's, is the approver.

## Before you go on stage

- At most 60 minutes before: the approver phone scans the wall's QR code and creates a passkey. A visitor kitchen
  lives 90 minutes, so do not do this earlier.
- Laptop: the wall at `/` full screen, signed in to `/ops` in the same browser (so **Run 1,000 L** shows next to the
  phone's kitchen). Phone hotspot on and tested. Screen brightness up, notifications off.
- Deck open on the slide before the demo, with the demo clip embedded on the next slide as the fallback.
- The demo uses Valio's example "by Monday". On Sunday the 1 L cartons can still make Monday until their 17:00
  cut-off (seen on the partner's API, `research/07-valio-challenge-detail.md`). The final ceremony is before that.
  Rehearse it on Sunday morning anyway.

## The script, word for word (about 420 words)

**0:00 to 0:25, Speaker A. The problem as a person feels it.** *(Slide 1: name and the sentence.)*

"It's eleven at night. Service is over. A head chef counts what's left in the cold room, and she has to get
tomorrow's order in before the cut-off. Soon she will just tell an AI agent: order the milk.

On the other side, the wholesaler gets an order from a machine. Did a person really mean a thousand litres? Who said
this agent may spend that much? And if it's wrong, who answers for it?"

**0:25 to 0:45, Speaker A. The ask and the insight.** *(Slide 2.)*

"Valio Aimo asked for exactly this: let outside purchasing agents order, in a way both sides can trust.

Our answer is one rule: never trust the model. The agent can ask for anything. It can only buy what the kitchen
signed for."

**0:45 to 1:45, Speaker B. Live demo from the laptop.** *(Switch to the wall.)*

"Let me show you. This is our wall. This phone is the approver of a hotel kitchen. Its agent may spend five hundred
euros alone.

*[0:52: click **Run 1,000 L** next to the phone's kitchen.]*

The agent gets Valio's own example: a thousand litres of lactose-free milk by Monday. It carries the kitchen's signed
mandate. It finds real products in the catalogue, and asks the live price service about a short list only. The
wholesaler signs a fixed price. The order is over the agent's limit, so the gate stops it. The gate is plain code. Not
the AI.

*[About 1:12: the wall shows the order waiting for a person. A holds the phone up.]*

Now it's on her phone: what, how much, and why she is asked. She approves with her face.

*[About 1:22: A approves with Face ID. The wall shows the order signed.]*

The wholesaler signs the order. Every step is in a hash-chained record, in plain language, for the kitchen and for
the wholesaler.

*[About 1:35: point at **Refused, and why** on the wall.]*

And here is what the gate refused today. Each one names the rule that stopped it."

**1:45 to 2:30, Speaker A. Why it holds.** *(Slide 5.)*

"Why should you believe it holds? We attacked it ourselves. Eight orders racing on one fixed price: exactly one goes
through. Change one entry in the record: it is detected.

Buyers built on seven popular agent frameworks ordered through the same door, using only their own standard MCP or
OpenAPI support. Every one of them stopped and waited for the person.

And we built a crash test for AI buyers: thirteen hard purchasing situations. The models we tested scored between
25 and 66 out of 100. That score becomes a licence: how much a model should be allowed to spend alone."

**2:30 to 3:00, Speaker A. Path and close.** *(Slide 7.)*

"It runs today on Aiven, on open standards: MCP, OpenAPI, signed tokens, passkeys.

What we need next is a test account on Valio Aimo's real webshop, and one kitchen willing to try it.

AimoPilot. The agent can ask for anything. It can only buy what the kitchen signed for. Thank you."

### Timing check

| Block | Words | Seconds |
|---|---|---|
| Problem | 72 | 25 |
| Ask and insight | 45 | 20 |
| Demo | 165 | 60 |
| Why it holds | 95 | 45 |
| Close | 50 | 30 |

At a calm 140 to 150 words a minute this is about 2:50. If a rehearsal runs long, cut "in plain language, for the
kitchen and for the wholesaler" first, then the crash-test sentence's second half.

## What is shown live, and when

| Second | On the laptop | On the phone |
|---|---|---|
| 0:45 | The wall at `/` (already open) | The approver home: "Waiting for requests" |
| 0:52 | Click **Run 1,000 L** | |
| 0:55 to 1:12 | The request moves along the wall's stations to the gate | |
| 1:12 | The wall shows it waiting for the named person | **Waiting for you**, then the sign-off screen |
| 1:22 | The wall shows the order signed | Face ID, then **Order placed** |
| 1:35 | Point at **Refused, and why** | |
| 1:45 | Back to the deck | |

**If the demo stalls for more than 10 seconds:** B says "The venue network is slow, so here is the same flow
recorded this morning" and plays the clip on slide 4 from the same point. Keep talking over it. Do not try again.

## The deck (also the PDF required at submission)

Eight slides. Each must make sense without a speaker, because the PDF is read on its own. Large type, one idea per
slide, the demo note "Demo on synthetic data" in the footer, no partner logo.

1. **Title.** AimoPilot. "The agent can ask for anything. It can only buy what the kitchen signed for." Junction 2026,
   Valio Aimo, Trusted Trade Agents. Demo address and QR code. Team names.
2. **The problem.** A head chef late at night; an order from a machine on the wholesaler's side. Valio Aimo's own
   words: "I need 1,000 litres of lactose-free milk by Monday." The three questions: did a person mean it, who allowed
   it, who answers for it.
3. **How it works.** One line of six boxes: signed mandate, lookup (master data first, then live price for a short
   list), fixed price signed by the wholesaler, the gate (plain code), a named person on their phone with a passkey,
   a tamper-evident record. Caption: "The model is never trusted. Plain code checks every order."
4. **The demo.** Three screenshots: the wall, the sign-off on a phone, a refusal with its rule. Embedded 30-second
   clip (the fallback for the live demo).
5. **Why it holds.** Four facts, each with its source in small type: 8 racing orders on one quote, exactly 1
   committed; an edited ledger entry detected; 7 agent frameworks, each ended waiting for the person; crash test:
   13 situations, scripted reference 100, the models we tested 25 to 66.
6. **For the kitchen and for the wholesaler.** Left: the kitchen's store with its agent: mistake checks from its own
   history, options ranked good, better, best, memory with who said what and when, a voice call and a photo of the
   list as other doors. Right: the operations desk: every agent at the door, any request replayed step by step,
   the safeguards and how often each fired, suspend an agent, a recall radar that holds products named in
   food-safety notices.
7. **Open, and what comes next.** Open standards used (MCP, OpenAPI 3.1, JWS with Ed25519, W3C Verifiable
   Credentials, passkeys). Runs on Aiven. Known limits in one line each (see `valio-judges.md`). Next: a test
   account on the real webshop, one pilot kitchen, OAuth for consumer assistants.
8. **Thank you.** The sentence again, the demo address, the repository link.

## Questions most likely in the 3 minutes after

See `qa-prep.md`. Rehearse the four from last year first: who did what; what was built this weekend; real-world use;
the next 48 hours.

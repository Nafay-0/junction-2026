# Table demo (peer review, Sunday 10:30 to 13:00)

Who this is for: an assigned peer reviewer who has seen ten tables already. They score **Innovation** (new or
different), **Impact** (a real effect on the people who have the problem) and **Implementation** (realistic,
working, feasible). Every number below is in `claims.md` with its source.

## The one line, for "so what is it?"

> "It's the door a wholesaler opens for AI purchasing agents. The agent can ask for anything, but it can only buy
> what the kitchen signed for. Anything more goes to a person's phone."

## Before the reviewer arrives

- Laptop: the wall at `https://jolly-wondrous-bunny.eur-1.aiven.app/` full screen. Sign in to `/ops` in **the same
  browser** first (passcode from `web/.env.local`, never said out loud). Only then does the wall show the
  **Run 1,000 L** and **Console** buttons next to each visitor kitchen.
- A printed A4 of the join QR code on the table, in case the screen is hard to scan.
- Second tab ready: `/ops/trace` (for the extension).
- Do not deploy, restart or reset anything during review (`infra/RUNBOOK.md`, "Never during a live demo").
- A visitor kitchen lives 90 minutes. Each reviewer gets a new one, so there is no clean-up between reviewers.

## The sixty seconds, word for word

| Time | Presenter says | Presenter does | Reviewer does | Serves |
|---|---|---|---|---|
| 0:00 | "Hi. Soon a kitchen's AI agent will order its food. AimoPilot is the gate that agent has to go through. Can you scan this with your phone?" | Points at the QR code on the wall. | Scans the QR code with the phone camera. The page says "A demo kitchen, yours for 90 minutes". | Impact |
| 0:08 | "Press the button. It makes a passkey: just your face or your finger. No name, no email." | Waits. | Taps **Create my passkey and start**, then Face ID or fingerprint. | Implementation |
| 0:15 | "You are now the purchasing manager of a hotel kitchen. Its agent may spend five hundred euros alone. Anything more comes to you." | Clicks **Run 1,000 L** next to the reviewer's kitchen on the wall. | Reads their phone: their name, the kitchen, "may spend up to 500,00 € per order alone". | Innovation |
| 0:22 | "The agent now gets Valio's own example: a thousand litres of lactose-free milk by Monday. It finds real products and live prices. The wholesaler signs a fixed price. That order is more than the agent's limit. So the gate stops it. The gate is plain code, not the AI." | Points at the request moving along the wall's stations. | Watches. | Implementation, Innovation |
| 0:38 | "Look at your phone. That's the order, and why you are asked." | Waits. | The phone shows **Waiting for you** with the total; taps it. The sign-off screen opens: why you are asked, the order. | Impact |
| 0:45 | "If it looks right, approve it with your face or finger." | Waits. | Taps **Approve** and confirms with the passkey. The phone says **Order placed**. | Implementation |
| 0:50 | "Done. The wholesaler signed the order. Every step is in a record nobody can quietly change. And the agent never had a button to approve its own order. Only you have it." | Points at the wall: the order is signed. | | Innovation, Impact |

About 150 spoken words. If the reviewer is slow to scan, skip nothing: talk over the wait with the one line above.

What makes it work: the passkey prompt is real (WebAuthn), and the sign-off is bound to that exact order, so it
cannot be moved to another order or used after the order is changed (`web/src/core/approval.ts`,
`web/src/core/passkeys.test.ts`).

## Ninety more seconds, for a curious reviewer

Pick what they ask about. Each block is about 30 seconds.

**A. "Can I break it?"** (Implementation)
- Say: "Try to make the agent buy something its kitchen does not allow."
- Do: on the wall, click **Console** next to the reviewer's kitchen. Go to the catalogue. Add whipping cream to the
  basket (this kitchen may buy only milk and plant drinks). Basket, **Get a fixed price**, then place it.
- Expected: the gate's black-and-yellow panel with the rule "Only product groups the kitchen allows". The wall's
  **Refused, and why** list shows it.
- Say: "The basket by hand goes through the same gate as the agent. The rule has a name, and the reason is in the
  record."
- **Rehearse this exact click path on the live site before Sunday.** The rule itself is tested
  (`web/src/core/policy.test.ts`, QA wave 2 "What held"). The basket click path was not checked in a browser for this
  file.

**B. "What does the wholesaler see?"** (Impact, Implementation)
- Do: open `/ops/trace` and pick the reviewer's request.
- Say: "This is the wholesaler's desk. Every agent at the door, and any request replayed step by step: what was
  asked, what was looked up, the fixed price, which rule stopped it, who signed."
- Do: click **Safeguards**. Say: "Each rule, and how often it fired."
- Do: click **Control**. Say: "Staff can suspend an agent. Its next call is refused, over every door." Do not
  actually suspend during review. QA saw a suspended agent's open order page fill the wall with refusal cards.

**C. "Does it only work with your own agent?"** (Innovation)
- Say: "No. The door speaks open standards: MCP and OpenAPI. We connected buyers built on seven popular agent
  frameworks: Pydantic AI, the OpenAI Agents SDK, Google's ADK, the Claude Agent SDK, the Vercel AI SDK, LangGraph,
  and Semantic Kernel. Each one got the same task. Each one ended with its order waiting for a person, as it should."
- Show: `examples/runtimes/RESULTS.md` on the laptop.
- If asked: Semantic Kernel needed four workarounds on its own side. Those runs were on a local server, not the
  public one.

**D. "Is the agent smart, or just strict?"** (Impact)
- Do: open `/k/kaari/order` and ask for 1,000 L of lactose-free milk for Monday. Typing needs the language model;
  if it is down, use the **offline example** button.
- Say: "This kitchen usually orders about a hundred litres. So before anything else, the agent asks: did you mean a
  hundred? That check comes from the kitchen's own history, not from the model's guess. Then it shows options:
  good, better, best, each saying what it is best at."

## Which criterion each beat serves

| Beat | Innovation | Impact | Implementation |
|---|---|---|---|
| The reviewer becomes the approver on their own phone | yes: they are inside the demo, not watching it | yes: a person stays in control of money | yes: a real passkey, bound to the order |
| Valio's own example, live prices, a signed fixed price | | yes: the partner's real problem | yes: the partner's live API and 17,546 real product records |
| "The gate is plain code, not the AI" | yes: the model is never trusted | yes: safe to let agents buy | yes: rules tested in `web/src/core/` |
| A tamper-evident record of every step | | yes: both the kitchen and the wholesaler can read it | yes: hash chain, edits detected (`web/src/core/ledger.test.ts`) |
| A: refusal with a named rule | | | yes |
| B: the wholesaler's desk, replay, suspend | | yes: the other side of the trade | yes |
| C: seven frameworks, one gate | yes: open door, no custom integration | | yes: recorded runs |
| D: mistake check from history, good-better-best | | yes: fewer wrong orders | yes |

## When the venue network fails

1. **The reviewer's phone does not need the venue Wi-Fi.** The site is public HTTPS. Ask them to switch Wi-Fi off and
   use mobile data.
2. **The laptop:** switch to a phone hotspot (set it up and test it before 10:30). The wall reconnects by itself.
3. **The public site is down or very slow:** check `https://jolly-wondrous-bunny.eur-1.aiven.app/api/health` from
   the phone. If a service shows unreachable, follow `infra/RUNBOOK.md` "The site is slow" later, not at the table.
   Never restart during review.
4. **No network at all:** play the submission video from the laptop's disk (keep an offline copy). Then, in a
   terminal, `cd web && DOCK_CATALOG=seed pnpm demo`. It runs fully on the laptop with no server and no model. It
   prints Valio's example end to end, then a run of attempts to make the agent misbehave, each refused with a named
   rule, then a ledger edit being detected. Say: "This is the same gate, running offline on a small sample
   catalogue."
5. Say it plainly: "The venue network is down, so here is the recording of the same flow." Do not apologise twice.

## Things not to say at the table

- Do not say the crash-test licence sets the agent's limit on the live site. The rating and licence exist, but the
  live gate does not read them yet (`claims.md`, "not yet").
- Do not demo the menu planner with allergens. QA wave 2 found that it ignores the kitchen's forbidden allergens
  (open finding 1 on `origin/claude/qa`). Re-check before Sunday.
- Do not quote a fixed euro total for the milk. The price is live and changes; say "more than its limit".

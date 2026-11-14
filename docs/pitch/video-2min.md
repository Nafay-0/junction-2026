# The two-minute film

The submission video, and the film the landing page plays in its film slot ("The two-minute film"). Rules
(`research/05-official-briefs.md`): public on YouTube or Vimeo, at most 2:00. This page describes the film as built
on branch `claude/video-3` (the `video/` folder, when merged). Exact timings are left out on purpose: the cut may
still move.

## What it is

A narrated film of just under two minutes, made with Remotion (React rendered to video), separate from the web app:
its own `package.json` in `video/`, never part of the app's build. The narration is recorded with ElevenLabs and
drives the timing: each scene lasts its narration plus a lead-in and a tail, and every cut falls on a beat of the
music. Captions are written from the same word times (`video/scripts/captions.mjs` writes `web/public/landing/film.vtt`).

The product's widgets (the conversation, the sign-off slab, the approver's phone, the dish card) are rebuilt from the
product's own markup and tokens so they stay sharp at any zoom; wide shots of the catalogue and the operations portal
are real captures from `web/public/landing/`. Every figure and product sentence comes from the repository: the flow
from `web/src/app/_landing2/reel-thread.json`, the search figures from `web/src/app/_landing/search-eval.json`, the
attempts on the gate from `web/src/server/show/recordings/attacks.json`, the rules from `web/src/core/policy.ts`, the
Aiven services from `infra/aiven.md`.

## The nine scenes (narration in `video/src/script.json`)

1. **The problem.** AI agents are starting to do the buying, but the webshop was built for people: who signs for the
   machine?
2. **Title.** AimoPilot. "Let AI do the buying, and keep the last word." Built for Valio Aimo at Junction 2026.
3. **The flow.** Valio's example, 1,000 litres of lactose-free milk by Monday: the agent searches about 17,000
   products and prices three; the usual boxes cannot make Monday, so it offers three ranked options; it is over the
   limit, so a person signs on their phone with one passkey, at a fixed price.
4. **The gate.** The model is never trusted; twenty rules in plain code check every order. A forged mandate, a
   replayed quote and an agent approving itself are all stopped, on a tamper-evident ledger.
5. **Six agents.** The buyer (text or voice), the menu planner, the stock-out watch, the wholesaler's seller, any
   outside agent, the operations copilot. None can order past the gate.
6. **Memory.** It remembers how each kitchen buys, so it catches four thousand litres where four hundred is usual,
   and asks only when it matters.
7. **Search.** Vector and keyword recall inside the kitchen's rules, a decision model as judge, code checking the
   judge: standard search is right first 72 % of the time at best, AimoPilot 97 %.
8. **Aiven.** Runtime, PostgreSQL, Kafka, Valkey, OpenSearch and Grafana, a Managed Agent buying through the MCP door,
   and Aiven's MCP server feeding the copilot.
9. **Close.** The wholesaler sees every agent and every decision, and can stop any of them. "Keep the last word."

The figures said in the film (17,000 products, three priced, twenty rules, 72 % and 97 %) match `claims.md`. The
memory scene's 4,000 against 400 litres is an illustration of the mistake check, not a recorded run.

## Before uploading

- Render and loudness steps: `video/README.md` ("After rendering").
- Under 2:00 on the platform's own player (it can add a frame).
- Plays logged out, in a private window, on a phone; captions on.
- The link goes into `submission.md` and the deck's last slide; the file goes to `web/public/landing/film.mp4` with
  `film-poster.webp` and `film.vtt` for the landing page.
- Keep an offline copy on the laptop for the table's "no network" fallback.
